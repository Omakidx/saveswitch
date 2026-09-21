resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/ecs/${local.name}/api"
  retention_in_days = var.api_log_retention_days

  tags = {
    DataClassification = "confidential"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  configuration {
    execute_command_configuration {
      logging = "NONE"
    }
  }
}

resource "aws_ecs_task_definition" "api" {
  count = var.enable_api_service ? 1 : 0

  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.task_cpu)
  memory                   = tostring(var.task_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.application.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  ephemeral_storage {
    size_in_gib = 21
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = local.api_container_name
      image                  = local.api_image
      essential              = true
      user                   = "10001:10001"
      privileged             = false
      readonlyRootFilesystem = true
      stopTimeout            = 120

      portMappings = [
        {
          name          = "http"
          containerPort = var.container_port
          hostPort      = var.container_port
          protocol      = "tcp"
          appProtocol   = "http"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = tostring(var.container_port) },
        { name = "CLIENT_ORIGIN", value = var.client_origin },
        { name = "GOOGLE_REDIRECT_URI", value = var.google_redirect_uri },
      ]

      secrets = [
        for secret_name, environment_name in local.secret_environment_names : {
          name      = environment_name
          valueFrom = aws_secretsmanager_secret.runtime[secret_name].arn
        }
      ]

      healthCheck = {
        command = [
          "CMD-SHELL",
          "bun -e \"const r=await fetch('http://127.0.0.1:${var.container_port}${var.container_health_check_path}');if(!r.ok)process.exit(1)\"",
        ]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }

      mountPoints = [
        {
          sourceVolume  = "tmp"
          containerPath = "/tmp"
          readOnly      = false
        }
      ]

      linuxParameters = {
        initProcessEnabled = true
        capabilities = {
          drop = ["ALL"]
        }
      }

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.region
          awslogs-stream-prefix = "api"
          mode                  = "non-blocking"
          max-buffer-size       = "10m"
        }
      }
    }
  ])

  lifecycle {
    precondition {
      condition = (
        (var.task_cpu == 256 && contains([512, 1024, 2048], var.task_memory)) ||
        (var.task_cpu == 512 && contains(range(1024, 4097, 1024), var.task_memory)) ||
        (var.task_cpu == 1024 && contains(range(2048, 8193, 1024), var.task_memory)) ||
        (var.task_cpu == 2048 && contains(range(4096, 16385, 1024), var.task_memory)) ||
        (var.task_cpu == 4096 && contains(range(8192, 30721, 1024), var.task_memory)) ||
        (var.task_cpu == 8192 && contains(range(16384, 61441, 4096), var.task_memory)) ||
        (var.task_cpu == 16384 && contains(range(32768, 122881, 8192), var.task_memory))
      )
      error_message = "task_cpu and task_memory must be a supported Fargate CPU/memory combination."
    }

    precondition {
      condition     = var.api_image_digest != null
      error_message = "Enabling the API service requires the immutable ECR image digest."
    }

    precondition {
      condition     = var.api_runtime_ready
      error_message = "Enabling the API service requires api_runtime_ready=true after all documented application gates pass."
    }

    precondition {
      condition     = var.alert_email != null
      error_message = "Enabling the API service requires an operator alert email; confirm the SNS subscription before cutover."
    }
  }

  depends_on = [aws_iam_role_policy.task_execution]

  tags = {
    Component = "api"
  }
}

resource "aws_ecs_service" "api" {
  count = var.enable_api_service ? 1 : 0

  name             = "api"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.api[0].arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "1.4.0"

  enable_execute_command = false
  wait_for_steady_state  = true

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 120

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = false
    subnets          = [for subnet in aws_subnet.application : subnet.id]
    security_groups  = [aws_security_group.api.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = local.api_container_name
    container_port   = var.container_port
  }

  deployment_controller {
    type = "ECS"
  }

  lifecycle {
    precondition {
      condition     = var.desired_count == 1
      error_message = "The API service cannot scale beyond one task before shared coordination is implemented."
    }

    precondition {
      condition     = var.api_runtime_ready && var.api_image_digest != null && var.alert_email != null
      error_message = "The API service requires the readiness attestation, immutable image digest, and operator alert email."
    }
  }

  depends_on = [
    aws_lb_listener.https,
    aws_wafv2_web_acl_association.api,
  ]

  tags = {
    Component = "api"
  }
}

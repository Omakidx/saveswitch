resource "terraform_data" "cleanup_gate" {
  input = {
    create_resources = var.create_cleanup_resources
    enable_schedule  = var.enable_cleanup_scheduler
  }

  lifecycle {
    precondition {
      condition     = !var.enable_cleanup_scheduler || var.create_cleanup_resources
      error_message = "enable_cleanup_scheduler=true requires create_cleanup_resources=true."
    }

    precondition {
      condition     = !var.create_cleanup_resources || (var.cleanup_job_ready && length(var.cleanup_command) > 0 && var.api_image_digest != null && var.alert_email != null)
      error_message = "Provisioning cleanup resources requires job readiness, a reviewed command, an immutable image digest, and an operator alert email."
    }

    precondition {
      condition     = !var.enable_cleanup_scheduler || var.cleanup_completion_monitoring_ready
      error_message = "Enabling cleanup requires a successful disabled-schedule canary and verified completion/failure monitoring."
    }
  }
}

resource "aws_ecs_task_definition" "cleanup" {
  count = var.create_cleanup_resources ? 1 : 0

  family                   = "${local.name}-cleanup"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.application.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    {
      name                   = "cleanup"
      image                  = local.api_image
      essential              = true
      user                   = "10001:10001"
      privileged             = false
      readonlyRootFilesystem = true
      command                = var.cleanup_command
      stopTimeout            = 120

      environment = [
        { name = "NODE_ENV", value = "production" },
      ]

      secrets = [
        for secret_name, environment_name in local.cleanup_secret_environment_names : {
          name      = environment_name
          valueFrom = aws_secretsmanager_secret.runtime[secret_name].arn
        }
      ]

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
          awslogs-stream-prefix = "cleanup"
          mode                  = "non-blocking"
          max-buffer-size       = "10m"
        }
      }
    }
  ])

  lifecycle {
    precondition {
      condition     = var.cleanup_job_ready && length(var.cleanup_command) > 0
      error_message = "Creating cleanup resources requires cleanup_job_ready=true and a reviewed non-empty cleanup_command."
    }

    precondition {
      condition     = var.api_image_digest != null
      error_message = "Creating cleanup resources requires an immutable ECR image digest."
    }

    precondition {
      condition     = var.alert_email != null
      error_message = "Creating cleanup resources requires an operator alert email and confirmed SNS subscription."
    }
  }

  depends_on = [aws_iam_role_policy.task_execution]

  tags = {
    Component = "cleanup"
  }
}

data "aws_iam_policy_document" "scheduler_assume" {
  count = var.create_cleanup_resources ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [var.aws_account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:aws:scheduler:${var.region}:${var.aws_account_id}:schedule/default/${local.name}-cleanup"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count = var.create_cleanup_resources ? 1 : 0

  name               = "${local.name}-cleanup-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume[0].json
  description        = "Runs only the reviewed cleanup task definition"
}

data "aws_iam_policy_document" "scheduler" {
  count = var.create_cleanup_resources ? 1 : 0

  statement {
    sid       = "RunCleanupTask"
    effect    = "Allow"
    actions   = ["ecs:RunTask"]
    resources = [aws_ecs_task_definition.cleanup[0].arn]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid     = "PassOnlyCleanupRoles"
    effect  = "Allow"
    actions = ["iam:PassRole"]
    resources = [
      aws_iam_role.task_execution.arn,
      aws_iam_role.application.arn,
    ]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "scheduler" {
  count = var.create_cleanup_resources ? 1 : 0

  name   = "run-reviewed-cleanup-task"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler[0].json
}

resource "aws_scheduler_schedule" "cleanup" {
  count = var.create_cleanup_resources ? 1 : 0

  name                         = "${local.name}-cleanup"
  group_name                   = "default"
  description                  = "Approved idempotent cleanup task after Cloudinary reconciliation"
  state                        = var.enable_cleanup_scheduler ? "ENABLED" : "DISABLED"
  schedule_expression          = var.cleanup_schedule_expression
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler[0].arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.cleanup[0].arn
      launch_type         = "FARGATE"
      platform_version    = "1.4.0"
      task_count          = 1

      network_configuration {
        assign_public_ip = false
        subnets          = [for subnet in aws_subnet.application : subnet.id]
        security_groups  = [aws_security_group.cleanup.id]
      }
    }

    retry_policy {
      maximum_event_age_in_seconds = 3600
      maximum_retry_attempts       = 2
    }
  }

  lifecycle {
    precondition {
      condition     = !var.enable_cleanup_scheduler || var.cleanup_completion_monitoring_ready
      error_message = "Enabling cleanup requires verified disabled-schedule canaries and completion/failure monitoring."
    }
  }

  depends_on = [
    terraform_data.cleanup_gate,
    aws_cloudwatch_event_target.cleanup_nonzero_exit,
    aws_cloudwatch_event_target.cleanup_failed_start,
    aws_cloudwatch_metric_alarm.cleanup_target_errors,
    aws_cloudwatch_metric_alarm.cleanup_dropped_invocations,
  ]
}

resource "aws_cloudwatch_event_rule" "cleanup_nonzero_exit" {
  count = var.create_cleanup_resources ? 1 : 0

  name        = "${local.name}-cleanup-nonzero-exit"
  description = "Alerts when the reviewed cleanup container exits unsuccessfully"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn        = [aws_ecs_cluster.main.arn]
      taskDefinitionArn = [aws_ecs_task_definition.cleanup[0].arn]
      lastStatus        = ["STOPPED"]
      containers = {
        exitCode = [
          { "anything-but" = 0 },
        ]
      }
    }
  })
}

resource "aws_cloudwatch_event_rule" "cleanup_failed_start" {
  count = var.create_cleanup_resources ? 1 : 0

  name        = "${local.name}-cleanup-failed-start"
  description = "Alerts when the reviewed cleanup task cannot start"

  event_pattern = jsonencode({
    source        = ["aws.ecs"]
    "detail-type" = ["ECS Task State Change"]
    detail = {
      clusterArn        = [aws_ecs_cluster.main.arn]
      taskDefinitionArn = [aws_ecs_task_definition.cleanup[0].arn]
      lastStatus        = ["STOPPED"]
      stopCode          = ["TaskFailedToStart"]
    }
  })
}

resource "aws_cloudwatch_event_target" "cleanup_nonzero_exit" {
  count = var.create_cleanup_resources ? 1 : 0

  rule      = aws_cloudwatch_event_rule.cleanup_nonzero_exit[0].name
  target_id = "operator-alert"
  arn       = aws_sns_topic.alerts.arn
  input = jsonencode({
    alert = "Saveswitch cleanup task exited with a nonzero status. Inspect the ECS stopped-task reason and cleanup logs."
  })

  depends_on = [aws_sns_topic_policy.alerts]
}

resource "aws_cloudwatch_event_target" "cleanup_failed_start" {
  count = var.create_cleanup_resources ? 1 : 0

  rule      = aws_cloudwatch_event_rule.cleanup_failed_start[0].name
  target_id = "operator-alert"
  arn       = aws_sns_topic.alerts.arn
  input = jsonencode({
    alert = "Saveswitch cleanup task failed to start. Inspect the ECS stopped-task reason."
  })

  depends_on = [aws_sns_topic_policy.alerts]
}

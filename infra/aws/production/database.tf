resource "aws_kms_key" "rds" {
  description             = "Encrypts Saveswitch production RDS storage, managed master secret, and Performance Insights"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    DataClassification = "restricted"
  }
}

resource "aws_kms_alias" "rds" {
  name          = "alias/${local.name}-rds"
  target_key_id = aws_kms_key.rds.key_id
}

resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = [for subnet in aws_subnet.database : subnet.id]

  tags = {
    Name = local.name
  }
}

resource "aws_db_parameter_group" "postgres" {
  name_prefix = "${local.name}-postgres18-"
  family      = var.db_parameter_group_family
  description = "Saveswitch production PostgreSQL 18 safety baseline"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  parameter {
    name  = "log_connections"
    value = "1"
  }

  parameter {
    name  = "log_disconnections"
    value = "1"
  }

  parameter {
    name  = "log_lock_waits"
    value = "1"
  }

  parameter {
    name  = "rds.log_retention_period"
    value = "10080"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "rds_exports" {
  for_each = toset(["postgresql", "upgrade"])

  name              = "/aws/rds/instance/${local.name}/${each.value}"
  retention_in_days = var.rds_log_retention_days

  tags = {
    DataClassification = "confidential"
  }

  lifecycle {
    prevent_destroy = true
  }
}

# Enhanced Monitoring uses this Region-wide log group. The authorized pre-plan
# inventory must stop on a name/ownership collision before this root adopts it.
resource "aws_cloudwatch_log_group" "rds_enhanced_monitoring" {
  name              = "RDSOSMetrics"
  retention_in_days = var.rds_log_retention_days

  tags = {
    DataClassification = "confidential"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier = local.name

  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  db_name  = "saveswitch"
  username = var.db_master_username
  port     = 5432

  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.rds.arn

  allocated_storage     = var.db_allocated_storage_gib
  max_allocated_storage = var.db_max_allocated_storage_gib
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.rds.arn

  multi_az               = true
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]

  parameter_group_name = aws_db_parameter_group.postgres.name
  ca_cert_identifier   = var.db_ca_cert_identifier

  backup_retention_period = var.db_backup_retention_days
  backup_window           = var.db_backup_window
  maintenance_window      = var.db_maintenance_window
  copy_tags_to_snapshot   = true

  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = var.db_final_snapshot_identifier
  delete_automated_backups  = false

  auto_minor_version_upgrade = true
  apply_immediately          = false

  enabled_cloudwatch_logs_exports       = ["postgresql", "upgrade"]
  monitoring_interval                   = 60
  monitoring_role_arn                   = aws_iam_role.rds_monitoring.arn
  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.rds.arn
  performance_insights_retention_period = 7

  iam_database_authentication_enabled = true

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = var.db_max_allocated_storage_gib >= var.db_allocated_storage_gib
      error_message = "db_max_allocated_storage_gib must be greater than or equal to the initial allocation."
    }

    precondition {
      condition     = var.db_backup_window != var.db_maintenance_window
      error_message = "The backup and maintenance windows must not overlap."
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.rds_enhanced_monitoring,
    aws_cloudwatch_log_group.rds_exports,
    aws_iam_role_policy_attachment.rds_monitoring,
  ]

  tags = {
    Name               = local.name
    DataClassification = "restricted"
  }
}

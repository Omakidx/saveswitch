variable "aws_account_id" {
  description = "Twelve-digit production account ID. This target guard is not a credential."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a twelve-digit AWS account ID."
  }
}

variable "region" {
  description = "Approved production AWS Region."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.region == "us-east-1"
    error_message = "The approved Saveswitch target Region is us-east-1."
  }
}

variable "project" {
  description = "Project name used in resource names and mandatory tags."
  type        = string
  default     = "saveswitch"
}

variable "environment" {
  description = "Deployment environment. This stack is intentionally production-only."
  type        = string
  default     = "production"

  validation {
    condition     = var.environment == "production"
    error_message = "This state root manages only the production environment."
  }
}

variable "tags" {
  description = "Additional tags merged with required project/environment/management/data-classification tags."
  type        = map(string)
  default     = {}
}

variable "availability_zones" {
  description = "Two distinct availability zones. Validate account-specific availability immediately before plan."
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]

  validation {
    condition     = length(var.availability_zones) == 2 && length(distinct(var.availability_zones)) == 2 && alltrue([for az in var.availability_zones : startswith(az, "us-east-1")])
    error_message = "Provide exactly two distinct us-east-1 availability zones."
  }
}

variable "vpc_cidr" {
  description = "IPv4 CIDR for the dedicated production VPC."
  type        = string
  default     = "10.40.0.0/16"
}

variable "public_subnet_cidrs" {
  description = "CIDRs for internet-facing ALB subnets, ordered like availability_zones."
  type        = list(string)
  default     = ["10.40.0.0/24", "10.40.1.0/24"]

  validation {
    condition     = length(var.public_subnet_cidrs) == 2
    error_message = "Provide exactly two public subnet CIDRs."
  }
}

variable "application_subnet_cidrs" {
  description = "CIDRs for private ECS subnets, ordered like availability_zones."
  type        = list(string)
  default     = ["10.40.10.0/24", "10.40.11.0/24"]

  validation {
    condition     = length(var.application_subnet_cidrs) == 2
    error_message = "Provide exactly two application subnet CIDRs."
  }
}

variable "database_subnet_cidrs" {
  description = "CIDRs for isolated RDS subnets, ordered like availability_zones."
  type        = list(string)
  default     = ["10.40.20.0/24", "10.40.21.0/24"]

  validation {
    condition     = length(var.database_subnet_cidrs) == 2
    error_message = "Provide exactly two database subnet CIDRs."
  }
}

variable "api_domain" {
  description = "DNS-only Cloudflare hostname that will target the public ALB."
  type        = string
  default     = "api.saveswitch.xyz"

  validation {
    condition     = can(regex("^([a-z0-9]|[a-z0-9][a-z0-9.-]*[a-z0-9])$", var.api_domain))
    error_message = "api_domain must be a lower-case DNS hostname."
  }
}

variable "acm_certificate_arn" {
  description = "ARN of an ISSUED ACM certificate from the certificate state root."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:us-east-1:[0-9]{12}:certificate/[0-9a-f-]+$", var.acm_certificate_arn))
    error_message = "acm_certificate_arn must be an ACM certificate ARN in us-east-1."
  }
}

variable "api_image_digest" {
  description = "Immutable sha256 digest of the approved API image in this stack's ECR repository. Leave null for the foundation phase."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.api_image_digest == null || can(regex("^sha256:[0-9a-f]{64}$", var.api_image_digest))
    error_message = "api_image_digest must be null or have the form sha256:<64 lowercase hex characters>."
  }
}

variable "enable_api_service" {
  description = "Creates the API task definition and service only after the image, secret values, database roles, and application gates are ready."
  type        = bool
  default     = false
}

variable "api_runtime_ready" {
  description = "Owner attestation that the hardened image and application cutover blockers documented in README are closed. Required to enable the API service."
  type        = bool
  default     = false
}

variable "container_port" {
  description = "Bun/Elysia API port."
  type        = number
  default     = 5000

  validation {
    condition     = var.container_port == 5000
    error_message = "The reviewed container contract uses port 5000."
  }
}

variable "task_cpu" {
  description = "Fargate task CPU units."
  type        = number
  default     = 512

  validation {
    condition     = contains([256, 512, 1024, 2048, 4096, 8192, 16384], var.task_cpu)
    error_message = "task_cpu must be a supported Fargate CPU value."
  }
}

variable "task_memory" {
  description = "Fargate task memory in MiB."
  type        = number
  default     = 1024

  validation {
    condition     = var.task_memory >= 512 && var.task_memory <= 122880
    error_message = "task_memory must be between 512 MiB and 120 GiB; the exact CPU/memory pairing is checked before task creation."
  }
}

variable "desired_count" {
  description = "Initial service task count. Must remain one until shared coordination and scheduled jobs are externalized."
  type        = number
  default     = 1

  validation {
    condition     = var.desired_count == 1
    error_message = "Saveswitch must remain at one API task until the horizontal-scaling blockers are closed."
  }
}

variable "client_origin" {
  description = "Cloudflare-hosted frontend origin accepted by the API."
  type        = string
  default     = "https://saveswitch.xyz"

  validation {
    condition     = can(regex("^https://[^/[:space:]]+/?$", var.client_origin))
    error_message = "client_origin must be an HTTPS origin without a path."
  }
}

variable "google_redirect_uri" {
  description = "Production Google OAuth callback URI."
  type        = string
  default     = "https://api.saveswitch.xyz/auth/google/callback"

  validation {
    condition     = can(regex("^https://[^/[:space:]]+/auth/google/callback$", var.google_redirect_uri))
    error_message = "google_redirect_uri must be an HTTPS /auth/google/callback URL."
  }
}

variable "container_health_check_path" {
  description = "In-container process liveness path."
  type        = string
  default     = "/health"

  validation {
    condition     = can(regex("^/[^[:space:]]*$", var.container_health_check_path))
    error_message = "container_health_check_path must be an absolute path without whitespace."
  }
}

variable "alb_health_check_path" {
  description = "Dependency-aware readiness path used by the ALB. The application must implement it before enable_api_service can be true."
  type        = string
  default     = "/ready"

  validation {
    condition     = can(regex("^/[^[:space:]]*$", var.alb_health_check_path))
    error_message = "alb_health_check_path must be an absolute path without whitespace."
  }
}

variable "api_log_retention_days" {
  description = "CloudWatch application log retention."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.api_log_retention_days)
    error_message = "api_log_retention_days must be a CloudWatch Logs supported retention value."
  }
}

variable "rds_log_retention_days" {
  description = "CloudWatch retention for PostgreSQL, upgrade, and Enhanced Monitoring logs."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.rds_log_retention_days)
    error_message = "rds_log_retention_days must be a CloudWatch Logs supported retention value."
  }
}

variable "db_engine_version" {
  description = "RDS PostgreSQL engine version. Revalidate support immediately before plan."
  type        = string
  default     = "18.6"

  validation {
    condition     = startswith(var.db_engine_version, "18.")
    error_message = "This reviewed baseline targets PostgreSQL 18.x."
  }
}

variable "db_parameter_group_family" {
  description = "RDS parameter group family matching db_engine_version."
  type        = string
  default     = "postgres18"
}

variable "db_instance_class" {
  description = "Production-balanced RDS instance class; confirm load and current pricing before plan."
  type        = string
  default     = "db.t4g.small"
}

variable "db_allocated_storage_gib" {
  description = "Initial encrypted gp3 storage."
  type        = number
  default     = 20

  validation {
    condition     = var.db_allocated_storage_gib >= 20
    error_message = "PostgreSQL gp3 storage must start at 20 GiB or more."
  }
}

variable "db_max_allocated_storage_gib" {
  description = "Storage autoscaling ceiling."
  type        = number
  default     = 100

  validation {
    condition     = var.db_max_allocated_storage_gib >= 100
    error_message = "The autoscaling ceiling must be at least 100 GiB for this production baseline."
  }
}

variable "db_master_username" {
  description = "Bootstrap administrator name. Its AWS-managed password is not exposed to the application."
  type        = string
  default     = "saveswitch_admin"

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9_]{0,62}$", var.db_master_username))
    error_message = "db_master_username must be a valid PostgreSQL identifier of at most 63 characters."
  }
}

variable "db_backup_retention_days" {
  description = "Automated backup/PITR retention. Supports the five-minute RPO target when continuously healthy."
  type        = number
  default     = 14

  validation {
    condition     = var.db_backup_retention_days >= 7 && var.db_backup_retention_days <= 35
    error_message = "Production backup retention must be between 7 and 35 days."
  }
}

variable "db_backup_window" {
  description = "Daily UTC backup window, intentionally outside maintenance."
  type        = string
  default     = "02:00-03:00"

  validation {
    condition     = can(regex("^[0-2][0-9]:[0-5][0-9]-[0-2][0-9]:[0-5][0-9]$", var.db_backup_window))
    error_message = "db_backup_window must use hh24:mi-hh24:mi UTC syntax."
  }
}

variable "db_maintenance_window" {
  description = "Weekly UTC maintenance window selected by the owner."
  type        = string
  default     = "sun:04:00-sun:05:00"

  validation {
    condition     = can(regex("^(mon|tue|wed|thu|fri|sat|sun):[0-2][0-9]:[0-5][0-9]-(mon|tue|wed|thu|fri|sat|sun):[0-2][0-9]:[0-5][0-9]$", var.db_maintenance_window))
    error_message = "db_maintenance_window must use ddd:hh24:mi-ddd:hh24:mi UTC syntax."
  }
}

variable "db_final_snapshot_identifier" {
  description = "Final snapshot name used only in a separately authorized destroy workflow; change it if already present."
  type        = string
  default     = "saveswitch-production-final"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9-]{0,253}$", var.db_final_snapshot_identifier)) && !strcontains(var.db_final_snapshot_identifier, "--") && !endswith(var.db_final_snapshot_identifier, "-")
    error_message = "db_final_snapshot_identifier must meet RDS identifier syntax."
  }
}

variable "db_ca_cert_identifier" {
  description = "RDS CA identifier. Revalidate against the current AWS trust store before deployment."
  type        = string
  default     = "rds-ca-rsa2048-g1"
}

variable "rds_connection_alarm_threshold" {
  description = "DatabaseConnections threshold; tune after measuring the selected class connection budget."
  type        = number
  default     = 75
}

variable "budget_limit_usd" {
  description = "Recommended monthly alert threshold, not a service-enforced spending cap."
  type        = number
  default     = 250

  validation {
    condition     = var.budget_limit_usd > 0
    error_message = "budget_limit_usd must be positive."
  }
}

variable "alert_email" {
  description = "Optional operator email for SNS and Budget notifications. Supply out of band; confirmation is required."
  type        = string
  default     = null
  nullable    = true

  validation {
    condition     = var.alert_email == null || can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", var.alert_email))
    error_message = "alert_email must be null or a plausible email address."
  }
}

variable "enable_waf_logging" {
  description = "Privacy gate for redacted, blocked-request-only WAF logging. Leave false until the data owner approves fields and retention."
  type        = bool
  default     = false
}

variable "enable_alb_access_logs" {
  description = "Privacy gate for ALB request logs, which can contain full paths and query strings."
  type        = bool
  default     = false
}

variable "alb_access_log_privacy_accepted" {
  description = "Data-owner attestation that ALB log fields and 90-day retention are accepted. Required when access logs are enabled."
  type        = bool
  default     = false
}

variable "waf_rate_limit_auth" {
  description = "Per-source-IP request threshold for /auth paths during a five-minute evaluation window."
  type        = number
  default     = 100

  validation {
    condition     = var.waf_rate_limit_auth >= 10
    error_message = "waf_rate_limit_auth must be at least 10 requests per evaluation window."
  }
}

variable "waf_rate_limit_anonymous_create" {
  description = "Per-source-IP POST /xoomshare threshold during a five-minute evaluation window."
  type        = number
  default     = 60

  validation {
    condition     = var.waf_rate_limit_anonymous_create >= 10
    error_message = "waf_rate_limit_anonymous_create must be at least 10 requests per evaluation window."
  }
}

variable "waf_rate_limit_upload" {
  description = "Per-source-IP resource-create threshold during a five-minute evaluation window."
  type        = number
  default     = 100

  validation {
    condition     = var.waf_rate_limit_upload >= 10
    error_message = "waf_rate_limit_upload must be at least 10 requests per evaluation window."
  }
}

variable "waf_rate_limit_websocket" {
  description = "Per-source-IP /ws handshake threshold during a five-minute evaluation window."
  type        = number
  default     = 300

  validation {
    condition     = var.waf_rate_limit_websocket >= 10
    error_message = "waf_rate_limit_websocket must be at least 10 requests per evaluation window."
  }
}

variable "enable_cleanup_scheduler" {
  description = "Enables an already-provisioned cleanup schedule only after its disabled canary and monitoring gates pass."
  type        = bool
  default     = false
}

variable "create_cleanup_resources" {
  description = "Provisions the cleanup task, failure monitoring, and schedule in DISABLED state for canary validation."
  type        = bool
  default     = false
}

variable "cleanup_job_ready" {
  description = "Explicit application-readiness attestation required before cleanup resources are provisioned."
  type        = bool
  default     = false
}

variable "cleanup_completion_monitoring_ready" {
  description = "Attests that disabled-schedule canaries proved nonzero exits and partial cleanup failures reach the operator alert path."
  type        = bool
  default     = false
}

variable "cleanup_schedule_expression" {
  description = "EventBridge Scheduler expression for the future idempotent cleanup job."
  type        = string
  default     = "rate(5 minutes)"
}

variable "cleanup_command" {
  description = "Container command for the reviewed idempotent cleanup mode. Empty until that mode exists."
  type        = list(string)
  default     = []
}

variable "aws_account_id" {
  description = "Exact AWS account allowed for this production root."
  type        = string
  default     = "065897469956"

  validation {
    condition     = var.aws_account_id == "065897469956" && can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must remain the reviewed Saveswitch account 065897469956."
  }
}

variable "aws_region" {
  description = "Exact AWS Region allowed for this production root."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.aws_region == "us-east-1"
    error_message = "aws_region must remain us-east-1."
  }
}

variable "environment" {
  description = "Deployment environment guard."
  type        = string
  default     = "production"

  validation {
    condition     = var.environment == "production"
    error_message = "environment must remain production."
  }
}

variable "availability_zone" {
  description = "Single explicit Lightsail Availability Zone; revalidate it in the target account before planning."
  type        = string
  default     = "us-east-1a"

  validation {
    condition     = can(regex("^us-east-1[a-f]$", var.availability_zone))
    error_message = "availability_zone must be an explicit us-east-1 lettered Availability Zone."
  }
}

variable "instance_blueprint_id" {
  description = "Reviewed Ubuntu blueprint candidate; live preflight must prove it remains available."
  type        = string
  default     = "ubuntu_24_04"

  validation {
    condition     = var.instance_blueprint_id == "ubuntu_24_04"
    error_message = "instance_blueprint_id must remain the reviewed ubuntu_24_04 candidate."
  }
}

variable "instance_bundle_id" {
  description = "Reviewed smallest IPv4 Linux bundle candidate (0.5 GiB RAM, 2 vCPU, 20 GiB SSD); live preflight must prove its current specification, account eligibility, and price."
  type        = string
  default     = "nano_3_0"

  validation {
    condition     = var.instance_bundle_id == "nano_3_0"
    error_message = "instance_bundle_id must remain the reviewed nano_3_0 candidate."
  }
}

variable "database_disk_size_gb" {
  description = "Fixed Lightsail block-disk size for PostgreSQL data."
  type        = number
  default     = 16

  validation {
    condition     = var.database_disk_size_gb == 16
    error_message = "database_disk_size_gb must remain exactly 16 GiB."
  }
}

variable "operator_ssh_public_key" {
  description = "Existing operator SSH public key only. Never provide private key material."
  type        = string

  validation {
    condition = (
      can(regex("^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521))[[:space:]][A-Za-z0-9+/]{20,}={0,3}([[:space:]][^\\r\\n]+)?$", trimspace(var.operator_ssh_public_key))) &&
      !can(regex("PRIVATE[[:space:]]+KEY", upper(var.operator_ssh_public_key)))
    )
    error_message = "operator_ssh_public_key must be one structurally valid single-line OpenSSH public key and must not contain private key material."
  }
}

variable "admin_ipv4_cidrs" {
  description = "Nonempty set of exact operator IPv4 /32 CIDRs allowed to use break-glass SSH."
  type        = set(string)

  validation {
    condition = length(var.admin_ipv4_cidrs) > 0 && alltrue([
      for cidr in var.admin_ipv4_cidrs :
      can(regex("^([0-9]{1,3}\\.){3}[0-9]{1,3}/32$", cidr)) &&
      can(cidrhost(cidr, 0)) &&
      cidr != "0.0.0.0/32"
    ])
    error_message = "admin_ipv4_cidrs must contain only exact, valid IPv4 /32 CIDRs and cannot contain 0.0.0.0/32."
  }
}

variable "automatic_snapshot_utc_hour" {
  description = "UTC hour for Lightsail automatic instance snapshots, scheduled after the future database-aware dump window."
  type        = number
  default     = 4

  validation {
    condition     = var.automatic_snapshot_utc_hour >= 0 && var.automatic_snapshot_utc_hour <= 23 && floor(var.automatic_snapshot_utc_hour) == var.automatic_snapshot_utc_hour
    error_message = "automatic_snapshot_utc_hour must be a whole UTC hour from 0 through 23."
  }
}

variable "monthly_budget_usd" {
  description = "Account-wide monthly AWS budget alert target. This is not a hard spending cap."
  type        = number
  default     = 25

  validation {
    condition     = var.monthly_budget_usd == 25
    error_message = "monthly_budget_usd must remain exactly 25 USD."
  }
}

variable "budget_alert_email" {
  description = "Email recipient for AWS Budget notifications. An email address is configuration, not an application secret."
  type        = string

  validation {
    condition     = can(regex("^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$", trimspace(var.budget_alert_email)))
    error_message = "budget_alert_email must look like a valid email address."
  }
}

variable "additional_tags" {
  description = "Optional non-sensitive tags. Required ownership tags always take precedence."
  type        = map(string)
  default     = {}

  validation {
    condition = alltrue([
      for key, value in var.additional_tags :
      length(trimspace(key)) > 0 && length(trimspace(value)) > 0
    ])
    error_message = "additional_tags cannot contain empty keys or values."
  }
}

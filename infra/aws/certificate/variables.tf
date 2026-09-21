variable "aws_account_id" {
  description = "Twelve-digit AWS account ID used as a provider target guard."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a twelve-digit AWS account ID."
  }
}

variable "region" {
  description = "AWS Region in which the ALB certificate is issued."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.region == "us-east-1"
    error_message = "The approved Saveswitch target Region is us-east-1."
  }
}

variable "api_domain" {
  description = "Public API hostname owned in Cloudflare DNS."
  type        = string
  default     = "api.saveswitch.xyz"

  validation {
    condition     = can(regex("^[a-z0-9.-]+$", var.api_domain))
    error_message = "api_domain must be a lower-case DNS hostname."
  }
}

variable "validation_record_fqdns" {
  description = "FQDNs of ACM validation records after the Cloudflare owner creates them. Leave empty during the request-only phase."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default     = {}
}

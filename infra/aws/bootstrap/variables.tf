variable "aws_account_id" {
  description = "Twelve-digit AWS account ID. This is a target guard, not a credential."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{12}$", var.aws_account_id))
    error_message = "aws_account_id must be a twelve-digit AWS account ID."
  }
}

variable "region" {
  description = "AWS Region for the state bucket and KMS key."
  type        = string
  default     = "us-east-1"

  validation {
    condition     = var.region == "us-east-1"
    error_message = "The approved Saveswitch target Region is us-east-1."
  }
}

variable "state_bucket_name" {
  description = "Globally unique S3 bucket name for Terraform state. Include an account-specific suffix out of band."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket_name))
    error_message = "state_bucket_name must be a valid globally unique S3 bucket name."
  }
}

variable "tags" {
  description = "Additional tags merged with the mandatory state-management tags."
  type        = map(string)
  default     = {}
}

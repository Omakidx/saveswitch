output "state_bucket_name" {
  description = "S3 bucket used by the certificate and production backends."
  value       = aws_s3_bucket.state.id
}

output "state_kms_key_arn" {
  description = "KMS key used by the S3 backend."
  value       = aws_kms_key.state.arn
}

output "backend_region" {
  description = "Region for backend configuration."
  value       = var.region
}

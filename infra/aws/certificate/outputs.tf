output "certificate_arn" {
  description = "Requested certificate ARN. Do not pass it to production until status is ISSUED."
  value       = aws_acm_certificate.api.arn
}

output "dns_validation_records" {
  description = "Records the Cloudflare owner must create with proxying disabled for ACM validation."
  value = [
    for option in aws_acm_certificate.api.domain_validation_options : {
      name  = option.resource_record_name
      type  = option.resource_record_type
      value = option.resource_record_value
    }
  ]
}

output "validated_certificate_arn" {
  description = "Non-null only after this stack has completed DNS validation."
  value       = length(aws_acm_certificate_validation.api) == 1 ? aws_acm_certificate_validation.api[0].certificate_arn : null
}

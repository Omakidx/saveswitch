resource "aws_acm_certificate" "api" {
  domain_name       = var.api_domain
  validation_method = "DNS"
  key_algorithm     = "RSA_2048"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "api" {
  count = length(var.validation_record_fqdns) > 0 ? 1 : 0

  certificate_arn         = aws_acm_certificate.api.arn
  validation_record_fqdns = var.validation_record_fqdns

  timeouts {
    create = "45m"
  }
}

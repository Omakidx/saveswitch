output "alb_dns_name" {
  description = "Cloudflare should create a DNS-only CNAME for api_domain to this name after readiness approval."
  value       = aws_lb.api.dns_name
}

output "alb_zone_id" {
  description = "ALB canonical hosted zone ID for operator reference. Cloudflare uses a CNAME, not a Route 53 alias."
  value       = aws_lb.api.zone_id
}

output "ecr_repository_url" {
  description = "Push the reviewed API image here and deploy it only by digest."
  value       = aws_ecr_repository.api.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "ECS API service name, or null during the foundation-only phase."
  value       = var.enable_api_service ? aws_ecs_service.api[0].name : null
}

output "api_service_enabled" {
  description = "Whether the gated API task definition and service are present."
  value       = var.enable_api_service
}

output "rds_endpoint" {
  description = "Private RDS endpoint. Keep it out of frontend configuration."
  value       = aws_db_instance.main.endpoint
  sensitive   = true
}

output "rds_master_secret_arn" {
  description = "AWS-managed bootstrap administrator secret; application tasks must not receive it."
  value       = aws_db_instance.main.master_user_secret[0].secret_arn
  sensitive   = true
}

output "runtime_secret_arns" {
  description = "Secret containers that require separately authorized values before task deployment."
  value       = { for name, secret in aws_secretsmanager_secret.runtime : name => secret.arn }
  sensitive   = true
}

output "cleanup_scheduler_state" {
  description = "ABSENT by default, DISABLED during canary validation, and ENABLED only after explicit opt-in."
  value       = var.create_cleanup_resources ? aws_scheduler_schedule.cleanup[0].state : "ABSENT"
}

output "lightsail_instance_name" {
  description = "Stable instance identifier for later gated deployment workflows."
  value       = aws_lightsail_instance.production.name
}

output "lightsail_database_disk_name" {
  description = "Stable attached-disk identifier; it is not proof that the disk is formatted or mounted."
  value       = aws_lightsail_disk.postgres.name
}

output "ecr_repository_url" {
  description = "Non-secret repository URL. Deployment must still select an accepted immutable digest."
  value       = aws_ecr_repository.api.repository_url
}

output "budget_name" {
  description = "Account-wide alert-only budget identifier."
  value       = aws_budgets_budget.account_monthly.name
}

output "terraform_state_key" {
  description = "Proposed mutually exclusive remote-state key for this root."
  value       = "lightsail-production/core.tfstate"
}

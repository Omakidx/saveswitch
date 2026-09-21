locals {
  name_prefix = "saveswitch-production"

  required_tags = merge(var.additional_tags, {
    Application   = "saveswitch"
    Environment   = var.environment
    ManagedBy     = "terraform"
    Architecture  = "lightsail-single-instance"
    DataAuthority = "aws-postgresql-after-approved-cutover"
  })

  instance_name = "${local.name_prefix}-app-db"
  disk_name     = "${local.name_prefix}-postgres"
  key_pair_name = "${local.name_prefix}-operator"
  ecr_name      = "saveswitch-production-api"
  budget_name   = "saveswitch-account-monthly-25-usd"

  automatic_snapshot_time = format("%02d:00", var.automatic_snapshot_utc_hour)

  bootstrap_user_data = templatefile("${path.module}/templates/bootstrap-user-data.sh.tftpl", {
    admin_ipv4_cidrs = sort(tolist(var.admin_ipv4_cidrs))
  })
}

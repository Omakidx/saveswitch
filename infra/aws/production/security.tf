resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public HTTPS entry point; HTTP exists only for redirect"
  vpc_id      = aws_vpc.main.id

  revoke_rules_on_delete = true

  tags = {
    Name = "${local.name}-alb"
  }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "Public API HTTPS"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "alb_http_redirect" {
  security_group_id = aws_security_group.alb.id
  description       = "Redirect HTTP to HTTPS"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_security_group" "api" {
  name        = "${local.name}-api"
  description = "Private ECS API tasks"
  vpc_id      = aws_vpc.main.id

  revoke_rules_on_delete = true

  tags = {
    Name = "${local.name}-api"
  }
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Only forward requests to ECS API tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API traffic only from the ALB"
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_security_group" "migration" {
  name        = "${local.name}-migration"
  description = "No-ingress security group reserved for approved one-off database migration tasks"
  vpc_id      = aws_vpc.main.id

  revoke_rules_on_delete = true

  tags = {
    Name = "${local.name}-migration"
  }
}

resource "aws_security_group" "cleanup" {
  name        = "${local.name}-cleanup"
  description = "No-ingress security group reserved for the gated scheduled cleanup task"
  vpc_id      = aws_vpc.main.id

  revoke_rules_on_delete = true

  tags = {
    Name = "${local.name}-cleanup"
  }
}

resource "aws_security_group" "database" {
  name        = "${local.name}-database"
  description = "Private RDS PostgreSQL; ingress only from approved task security groups"
  vpc_id      = aws_vpc.main.id

  revoke_rules_on_delete = true

  tags = {
    Name = "${local.name}-database"
  }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_api" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_migration" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from separately approved migration tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.migration.id
}

resource "aws_vpc_security_group_ingress_rule" "database_from_cleanup" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the gated cleanup task"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.cleanup.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_database" {
  security_group_id            = aws_security_group.api.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_egress_rule" "migration_to_database" {
  security_group_id            = aws_security_group.migration.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_egress_rule" "cleanup_to_database" {
  security_group_id            = aws_security_group.cleanup.id
  description                  = "PostgreSQL to RDS"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.database.id
}

locals {
  outbound_task_security_groups = {
    api       = aws_security_group.api.id
    migration = aws_security_group.migration.id
    cleanup   = aws_security_group.cleanup.id
  }
}

resource "aws_vpc_security_group_egress_rule" "task_https" {
  for_each = local.outbound_task_security_groups

  security_group_id = each.value
  description       = "HTTPS via VPC endpoints or same-AZ NAT for AWS APIs and approved external providers"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "api_http" {
  security_group_id = aws_security_group.api.id
  description       = "HTTP URL preview egress; application SSRF controls remain mandatory"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "task_dns_udp" {
  for_each = local.outbound_task_security_groups

  security_group_id = each.value
  description       = "VPC resolver UDP"
  ip_protocol       = "udp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = "${cidrhost(var.vpc_cidr, 2)}/32"
}

resource "aws_vpc_security_group_egress_rule" "task_dns_tcp" {
  for_each = local.outbound_task_security_groups

  security_group_id = each.value
  description       = "VPC resolver TCP fallback"
  ip_protocol       = "tcp"
  from_port         = 53
  to_port           = 53
  cidr_ipv4         = "${cidrhost(var.vpc_cidr, 2)}/32"
}

resource "aws_security_group" "endpoints" {
  name        = "${local.name}-endpoints"
  description = "Private AWS interface endpoints"
  vpc_id      = aws_vpc.main.id

  revoke_rules_on_delete = true

  tags = {
    Name = "${local.name}-endpoints"
  }
}

resource "aws_vpc_security_group_ingress_rule" "endpoint_from_tasks" {
  for_each = local.outbound_task_security_groups

  security_group_id            = aws_security_group.endpoints.id
  description                  = "HTTPS from ${each.key} tasks"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = each.value
}

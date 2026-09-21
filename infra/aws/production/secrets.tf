resource "aws_kms_key" "secrets" {
  description             = "Encrypts Saveswitch production runtime secrets"
  deletion_window_in_days = 30
  enable_key_rotation     = true

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    DataClassification = "restricted"
  }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.name}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

# Only secret containers are managed here. Values are populated through a
# separately authorized secret-write workflow and are never placed in IaC.
resource "aws_secretsmanager_secret" "runtime" {
  for_each = local.runtime_secret_names

  name                    = "${local.name}/${each.value}"
  description             = "Saveswitch ${var.environment} ${each.value}; value managed outside Terraform"
  kms_key_id              = aws_kms_key.secrets.arn
  recovery_window_in_days = 30

  lifecycle {
    prevent_destroy = true
  }

  tags = {
    DataClassification = "restricted"
  }
}

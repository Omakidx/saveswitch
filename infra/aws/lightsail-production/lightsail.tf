resource "aws_lightsail_key_pair" "operator" {
  name       = local.key_pair_name
  public_key = trimspace(var.operator_ssh_public_key)

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_instance" "production" {
  name              = local.instance_name
  availability_zone = var.availability_zone
  blueprint_id      = var.instance_blueprint_id
  bundle_id         = var.instance_bundle_id
  key_pair_name     = aws_lightsail_key_pair.operator.name
  ip_address_type   = "ipv4"
  user_data         = local.bootstrap_user_data

  add_on {
    type          = "AutoSnapshot"
    snapshot_time = local.automatic_snapshot_time
    status        = "Enabled"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_disk" "postgres" {
  name              = local.disk_name
  availability_zone = var.availability_zone
  size_in_gb        = var.database_disk_size_gb

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_disk_attachment" "postgres" {
  disk_name     = aws_lightsail_disk.postgres.name
  instance_name = aws_lightsail_instance.production.name
  disk_path     = "/dev/xvdf"

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_lightsail_instance_public_ports" "ssh_break_glass" {
  instance_name = aws_lightsail_instance.production.name

  port_info {
    protocol  = "tcp"
    from_port = 22
    to_port   = 22
    cidrs     = sort(tolist(var.admin_ipv4_cidrs))
  }

  lifecycle {
    prevent_destroy = true
  }
}

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
TF_FILES=("$ROOT"/*.tf)
SOURCE_FILES=(
  "$ROOT"/*.tf
  "$ROOT/backend.hcl.example"
  "$ROOT/terraform.tfvars.example"
  "$ROOT/templates/bootstrap-user-data.sh.tftpl"
  "$ROOT/scripts/remediate-existing-instance.sh"
)

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_fixed() {
  local needle="$1"
  local file="$2"
  grep -Fq -- "$needle" "$file" || fail "missing required contract in $file: $needle"
}

require_regex() {
  local pattern="$1"
  local file="$2"
  grep -Eq -- "$pattern" "$file" || fail "missing required pattern in $file: $pattern"
}

reject_regex() {
  local pattern="$1"
  shift
  if grep -Eiq -- "$pattern" "$@"; then
    fail "forbidden pattern found: $pattern"
  fi
}

resource_body() {
  local file="$1"
  local type="$2"
  local name="$3"
  awk -v header="resource \"$type\" \"$name\"" '
    index($0, header) == 1 { inside = 1 }
    inside {
      print
      line = $0
      opens = gsub(/\{/, "", line)
      line = $0
      closes = gsub(/\}/, "", line)
      depth += opens - closes
      if (depth == 0) exit
    }
  ' "$file"
}

require_resource_guard() {
  local file="$1"
  local type="$2"
  local name="$3"
  local body
  body="$(resource_body "$file" "$type" "$name")"
  [[ -n "$body" ]] || fail "resource ${type}.${name} is missing"
  grep -Eq 'prevent_destroy[[:space:]]*=[[:space:]]*true' <<<"$body" ||
    fail "resource ${type}.${name} lacks prevent_destroy"
}

[[ "$(basename -- "$ROOT")" == "lightsail-production" ]] ||
  fail "validator must live in the mutually exclusive lightsail-production root"

require_fixed 'key          = "lightsail-production/core.tfstate"' "$ROOT/backend.hcl.example"
require_fixed 'bucket       = "saveswitch-terraform-state-065897469956"' "$ROOT/backend.hcl.example"
require_fixed 'region       = "us-east-1"' "$ROOT/backend.hcl.example"
require_fixed 'encrypt      = true' "$ROOT/backend.hcl.example"
require_fixed 'use_lockfile = true' "$ROOT/backend.hcl.example"
require_fixed 'kms_key_id   = "arn:aws:kms:us-east-1:065897469956:key/2b923daa-87c6-491d-aca2-8ecc46aef866"' "$ROOT/backend.hcl.example"
require_fixed 'backend "s3" {}' "$ROOT/backend.tf"

expected_types="$({
  printf '%s\n' \
    aws_budgets_budget \
    aws_ecr_lifecycle_policy \
    aws_ecr_repository \
    aws_lightsail_disk \
    aws_lightsail_disk_attachment \
    aws_lightsail_instance \
    aws_lightsail_instance_public_ports \
    aws_lightsail_key_pair
} | sort)"
actual_types="$(sed -nE 's/^[[:space:]]*resource[[:space:]]+"([^"]+)".*/\1/p' "${TF_FILES[@]}" | sort)"
[[ "$actual_types" == "$expected_types" ]] || {
  printf 'Expected resource types:\n%s\nActual resource types:\n%s\n' "$expected_types" "$actual_types" >&2
  fail "resource inventory differs from the reviewed eight-resource graph"
}

reject_regex '^resource[[:space:]]+"aws_(vpc|subnet|nat_|internet_gateway|vpc_endpoint|lb|alb|acm|wafv2|ecs|rds|db_|secretsmanager|kms|cloudwatch|eventbridge|scheduler|s3_bucket|route53|lightsail_static_ip)' "${TF_FILES[@]}"
reject_regex '(^|[[:space:]])(profile|shared_credentials_file)[[:space:]]*=' "${TF_FILES[@]}" "$ROOT/backend.hcl.example"
reject_regex '(local-exec|remote-exec|provisioner[[:space:]]+")' "${SOURCE_FILES[@]}"
reject_regex '(^|[[:space:]])(database_url|jwt_secret|google_client_secret|cloudinary_url|tunnel_token|secret_value|private_key)[[:space:]]*=' "${SOURCE_FILES[@]}"
reject_regex 'variable[[:space:]]+"(database_url|jwt_secret|google_client_secret|cloudinary_url|tunnel_token|secret_value|private_key)"' "${SOURCE_FILES[@]}"
reject_regex '(BEGIN[[:space:]]+(RSA[[:space:]]+|OPENSSH[[:space:]]+|EC[[:space:]]+)?PRIVATE[[:space:]]+KEY|postgres(ql)?://|cloudinary://)' "${SOURCE_FILES[@]}"
reject_regex '(0\.0\.0\.0/0|::/0)' "${SOURCE_FILES[@]}"
reject_regex '(from_port|to_port)[[:space:]]*=[[:space:]]*(80|443|5000|5432)([^0-9]|$)' "${TF_FILES[@]}"

require_fixed 'allowed_account_ids = [var.aws_account_id]' "$ROOT/provider.tf"
require_fixed 'condition     = var.aws_region == "us-east-1"' "$ROOT/variables.tf"
require_fixed 'condition     = var.environment == "production"' "$ROOT/variables.tf"
require_fixed 'condition     = var.instance_blueprint_id == "ubuntu_24_04"' "$ROOT/variables.tf"
require_fixed 'condition     = var.instance_bundle_id == "nano_3_0"' "$ROOT/variables.tf"
require_fixed 'condition     = var.database_disk_size_gb == 16' "$ROOT/variables.tf"
require_fixed 'length(var.admin_ipv4_cidrs) > 0' "$ROOT/variables.tf"
require_fixed '/32$' "$ROOT/variables.tf"
require_fixed 'disk_name     = "${local.name_prefix}-postgres"' "$ROOT/locals.tf"
require_fixed 'bootstrap_user_data = templatefile("${path.module}/templates/bootstrap-user-data.sh.tftpl"' "$ROOT/locals.tf"
require_fixed 'user_data         = local.bootstrap_user_data' "$ROOT/lightsail.tf"
[[ ! -e "$ROOT/templates/cloud-init.yaml.tftpl" ]] || fail "incompatible cloud-config template still exists"

public_ports="$(resource_body "$ROOT/lightsail.tf" aws_lightsail_instance_public_ports ssh_break_glass)"
grep -Eq 'protocol[[:space:]]*=[[:space:]]*"tcp"' <<<"$public_ports" || fail "Lightsail firewall protocol is not TCP"
grep -Eq 'from_port[[:space:]]*=[[:space:]]*22' <<<"$public_ports" || fail "Lightsail firewall start port is not 22"
grep -Eq 'to_port[[:space:]]*=[[:space:]]*22' <<<"$public_ports" || fail "Lightsail firewall end port is not 22"
grep -Fq 'cidrs     = sort(tolist(var.admin_ipv4_cidrs))' <<<"$public_ports" || fail "Lightsail firewall does not use validated admin /32s"

require_fixed 'ip_address_type   = "ipv4"' "$ROOT/lightsail.tf"
require_fixed 'type          = "AutoSnapshot"' "$ROOT/lightsail.tf"
require_fixed 'snapshot_time = local.automatic_snapshot_time' "$ROOT/lightsail.tf"
require_fixed 'status        = "Enabled"' "$ROOT/lightsail.tf"
require_fixed 'size_in_gb        = var.database_disk_size_gb' "$ROOT/lightsail.tf"
require_fixed 'disk_path     = "/dev/xvdf"' "$ROOT/lightsail.tf"
require_resource_guard "$ROOT/lightsail.tf" aws_lightsail_key_pair operator
require_resource_guard "$ROOT/lightsail.tf" aws_lightsail_instance production
require_resource_guard "$ROOT/lightsail.tf" aws_lightsail_disk postgres
require_resource_guard "$ROOT/lightsail.tf" aws_lightsail_disk_attachment postgres
require_resource_guard "$ROOT/lightsail.tf" aws_lightsail_instance_public_ports ssh_break_glass
require_resource_guard "$ROOT/ecr.tf" aws_ecr_repository api
require_resource_guard "$ROOT/ecr.tf" aws_ecr_lifecycle_policy api
require_resource_guard "$ROOT/budget.tf" aws_budgets_budget account_monthly

require_fixed 'image_tag_mutability = "IMMUTABLE"' "$ROOT/ecr.tf"
require_fixed 'encryption_type = "AES256"' "$ROOT/ecr.tf"
require_fixed 'scan_on_push = true' "$ROOT/ecr.tf"
require_fixed 'tagStatus   = "untagged"' "$ROOT/ecr.tf"
require_fixed 'countNumber = 7' "$ROOT/ecr.tf"
require_fixed 'tagPrefixList = ["release-"]' "$ROOT/ecr.tf"
require_fixed 'countNumber   = 5' "$ROOT/ecr.tf"

require_fixed 'default     = 25' "$ROOT/variables.tf"
require_fixed 'condition     = var.monthly_budget_usd == 25' "$ROOT/variables.tf"
require_fixed 'limit_amount = tostring(var.monthly_budget_usd)' "$ROOT/budget.tf"
require_fixed 'limit_unit   = "USD"' "$ROOT/budget.tf"
require_fixed 'time_unit    = "MONTHLY"' "$ROOT/budget.tf"
[[ "$(grep -Ec '^[[:space:]]*notification[[:space:]]*\{' "$ROOT/budget.tf")" -eq 4 ]] || fail "budget must contain exactly four notifications"
[[ "$(grep -Ec 'notification_type[[:space:]]*=[[:space:]]*"ACTUAL"' "$ROOT/budget.tf")" -eq 3 ]] || fail "budget must contain exactly three ACTUAL notifications"
[[ "$(grep -Ec 'notification_type[[:space:]]*=[[:space:]]*"FORECASTED"' "$ROOT/budget.tf")" -eq 1 ]] || fail "budget must contain exactly one FORECASTED notification"
[[ "$(grep -Ec 'threshold_type[[:space:]]*=[[:space:]]*"ABSOLUTE_VALUE"' "$ROOT/budget.tf")" -eq 4 ]] || fail "all budget thresholds must be absolute values"
[[ "$(grep -Ec 'threshold[[:space:]]*=[[:space:]]*18([^0-9]|$)' "$ROOT/budget.tf")" -eq 1 ]] || fail "USD 18 alert is missing or duplicated"
[[ "$(grep -Ec 'threshold[[:space:]]*=[[:space:]]*21([^0-9]|$)' "$ROOT/budget.tf")" -eq 2 ]] || fail "USD 21 actual/forecast alerts are missing"
[[ "$(grep -Ec 'threshold[[:space:]]*=[[:space:]]*24([^0-9]|$)' "$ROOT/budget.tf")" -eq 1 ]] || fail "USD 24 alert is missing or duplicated"
reject_regex '(cost_filter|cost_types|filter[[:space:]]*\{)' "$ROOT/budget.tf"

require_fixed 'Cloudinary remains Saveswitch' "$ROOT/README.md"
require_fixed 'Terraform state only' "$ROOT/README.md"
require_fixed 'lightsail-production/core.tfstate' "$ROOT/README.md"
require_fixed 'never reuse, migrate, import, or' "$ROOT/README.md"
require_fixed 'No new production plan or apply is allowed' "$ROOT/README.md"
require_fixed 'same-disk dump alone is insufficient' "$ROOT/README.md"
require_fixed 'hostname and CA' "$ROOT/README.md"
require_fixed 'alert-only' "$ROOT/README.md"
require_fixed 'CF-Connecting-IP' "$ROOT/README.md"
require_fixed 'socket peer is loopback' "$ROOT/README.md"
require_fixed 'Treat snapshot creation, restore, export, copy' "$ROOT/README.md"
require_fixed 'may require replacement of the managed instance' "$ROOT/README.md"
require_fixed 'must not be used as live remediation' "$ROOT/README.md"
require_fixed '/usr/sbin:/usr/bin:/sbin:/bin' "$ROOT/README.md"
require_fixed 'findmnt --verify --tab-file' "$ROOT/README.md"
require_fixed 'fixed filesystem UUID' "$ROOT/README.md"
require_fixed 'recovery trap' "$ROOT/README.md"
require_fixed 'No Terraform command was run' "$ROOT/README.md"

lock_hash="$(sha256sum "$ROOT/.terraform.lock.hcl" | awk '{print $1}')"
[[ "$lock_hash" == "17db16fc1f7be70baf8a409bfbd67ba775aeb5c9502ce3198692f4c63c5df852" ]] ||
  fail "AWS provider lockfile differs from the reviewed 6.65.0 lockfile"

bash "$ROOT/iam/validate-policy-pack.sh"
sh "$ROOT/tests/validate-bootstrap.sh"
(cd "$ROOT" && sha256sum -c remediation-artifacts.sha256)

printf 'PASS: static Lightsail production contract validated (%s)\n' "$ROOT"

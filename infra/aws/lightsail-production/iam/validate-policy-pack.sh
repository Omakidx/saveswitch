#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)"
IAC_ROOT="$(CDPATH= cd -- "$ROOT/.." && pwd -P)"

POLICIES=(
  "$ROOT/preflight-backend-read-policy.json"
  "$ROOT/provider-read-policy.json"
  "$ROOT/state-backend-write-policy.json"
  "$ROOT/lightsail-foundation-policy.json"
  "$ROOT/ecr-lifecycle-policy.json"
  "$ROOT/budget-policy.json"
)

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_fixed() {
  local needle="$1"
  local file="$2"
  grep -Fq -- "$needle" "$file" || fail "missing reviewed IaC contract in $file: $needle"
}

command -v jq >/dev/null 2>&1 || fail "jq is required for offline IAM validation"

require_fixed 'instance_name = "${local.name_prefix}-app-db"' "$IAC_ROOT/locals.tf"
require_fixed 'disk_name     = "${local.name_prefix}-postgres"' "$IAC_ROOT/locals.tf"
require_fixed 'key_pair_name = "${local.name_prefix}-operator"' "$IAC_ROOT/locals.tf"
require_fixed 'ecr_name      = "saveswitch-production-api"' "$IAC_ROOT/locals.tf"
require_fixed 'budget_name   = "saveswitch-account-monthly-25-usd"' "$IAC_ROOT/locals.tf"
require_fixed 'key          = "lightsail-production/core.tfstate"' "$IAC_ROOT/backend.hcl.example"

for policy in "${POLICIES[@]}"; do
  jq -e '
    .Version == "2012-10-17" and
    (.Statement | type == "array" and length > 0) and
    ([.Statement[].Effect] | all(. == "Allow"))
  ' "$policy" >/dev/null || fail "invalid IAM document shape: $policy"

  jq -e '[.. | objects | has("NotAction") or has("NotResource")] | any | not' "$policy" >/dev/null ||
    fail "NotAction or NotResource is forbidden: $policy"

  jq -e '[.Statement[].Action | if type == "array" then .[] else . end | select(test("\\*"))] | length == 0' "$policy" >/dev/null ||
    fail "wildcard Action is forbidden: $policy"
done

assert_hash() {
  local policy="$1"
  local expected="$2"
  local actual
  actual="$(sha256sum "$policy" | awk '{print $1}')"
  [[ "$actual" == "$expected" ]] ||
    fail "policy differs from its byte-for-byte reviewed document: $policy"
}

# Canonical hashes prevent statement-merging mutations from exploiting
# vacuous aggregate resource checks. Any policy edit requires explicit review
# and deliberate hash refresh after the semantic assertions below pass.
assert_hash "$ROOT/preflight-backend-read-policy.json" "520700b09ca8a18a48c291fee8a76a7b0568711b83bc595f20e83ce6eb856a62"
assert_hash "$ROOT/provider-read-policy.json" "bde80bd16dbeaaa44629cfd859830c6c71819a6d18569c1f6a2d70553cd789df"
assert_hash "$ROOT/state-backend-write-policy.json" "6c166768c54b00700b41b767038433bcd79b8ef9017a3f790a3a793cf9e41ad5"
assert_hash "$ROOT/lightsail-foundation-policy.json" "585c3b3b47130042cd64eb943608428501594813d0726a4313133bfbfc7c7c67"
assert_hash "$ROOT/ecr-lifecycle-policy.json" "ff740e406a07e30bba201f1a5091e2f718c8bde130b5347e136b9231d5c6cce0"
assert_hash "$ROOT/budget-policy.json" "033ad95588aa0c676e26aea21658aaa454ada1abe50ea83d56ddd9a976a36277"

all_actions() {
  jq -r '.Statement[].Action | if type == "array" then .[] else . end' "$1" | sort -u
}

all_policy_actions() {
  jq -r '.Statement[].Action | if type == "array" then .[] else . end' "${POLICIES[@]}" | sort -u
}

assert_actions() {
  local policy="$1"
  shift
  local expected actual
  expected="$(printf '%s\n' "$@" | sort -u)"
  actual="$(all_actions "$policy")"
  [[ "$actual" == "$expected" ]] || {
    printf 'Expected actions for %s:\n%s\nActual actions:\n%s\n' "$policy" "$expected" "$actual" >&2
    fail "action set differs from review contract"
  }
}

assert_actions "$ROOT/preflight-backend-read-policy.json" \
  kms:DescribeKey kms:GetKeyPolicy kms:GetKeyRotationStatus kms:ListResourceTags \
  s3:GetBucketLocation s3:GetBucketOwnershipControls s3:GetBucketPolicy \
  s3:GetBucketPolicyStatus s3:GetBucketPublicAccessBlock s3:GetBucketVersioning \
  s3:GetEncryptionConfiguration s3:ListBucket s3:ListBucketVersions \
  sts:GetCallerIdentity

assert_actions "$ROOT/provider-read-policy.json" \
  budgets:ListTagsForResource budgets:ViewBudget \
  ecr:DescribeRepositories ecr:GetLifecyclePolicy ecr:ListTagsForResource \
  lightsail:GetBlueprints lightsail:GetBundles lightsail:GetDisk lightsail:GetDisks \
  lightsail:GetInstance lightsail:GetInstancePortStates lightsail:GetInstances \
  lightsail:GetKeyPair lightsail:GetKeyPairs lightsail:GetOperation lightsail:GetOperations \
  lightsail:GetRegions servicequotas:GetAWSDefaultServiceQuota \
  servicequotas:GetServiceQuota servicequotas:ListServiceQuotas

assert_actions "$ROOT/state-backend-write-policy.json" \
  kms:Decrypt kms:Encrypt kms:GenerateDataKey s3:DeleteObject s3:GetObject s3:PutObject

assert_actions "$ROOT/lightsail-foundation-policy.json" \
  lightsail:AttachDisk lightsail:CreateDisk lightsail:CreateInstances \
  lightsail:EnableAddOn lightsail:ImportKeyPair lightsail:PutInstancePublicPorts \
  lightsail:TagResource lightsail:UntagResource

assert_actions "$ROOT/ecr-lifecycle-policy.json" \
  ecr:CreateRepository ecr:PutImageScanningConfiguration ecr:PutImageTagMutability \
  ecr:PutLifecyclePolicy ecr:TagResource ecr:UntagResource

assert_actions "$ROOT/budget-policy.json" \
  budgets:ModifyBudget budgets:TagResource budgets:UntagResource

ACCOUNT="065897469956"
REGION="us-east-1"
BUCKET="arn:aws:s3:::saveswitch-terraform-state-065897469956"
STATE="$BUCKET/lightsail-production/core.tfstate"
LOCK="$BUCKET/lightsail-production/core.tfstate.tflock"
KEY="arn:aws:kms:us-east-1:065897469956:key/2b923daa-87c6-491d-aca2-8ecc46aef866"
ECR="arn:aws:ecr:us-east-1:065897469956:repository/saveswitch-production-api"
BUDGET="arn:aws:budgets::065897469956:budget/saveswitch-account-monthly-25-usd"

jq -se --arg bucket "$BUCKET" --arg state "$STATE" --arg lock "$LOCK" '
  all(
    .[].Statement[].Resource |
    if type == "array" then .[] else . end |
    select(startswith("arn:aws:s3:::"));
    . == $bucket or . == $state or . == $lock
  )
' "${POLICIES[@]}" >/dev/null || fail "an S3 resource escapes the exact state boundary"

jq -se --arg key "$KEY" '
  all(
    .[].Statement[].Resource |
    if type == "array" then .[] else . end |
    select(startswith("arn:aws:kms:"));
    . == $key
  )
' "${POLICIES[@]}" >/dev/null || fail "a KMS resource escapes the exact state key"

jq -se --arg ecr "$ECR" '
  all(
    .[].Statement[].Resource |
    if type == "array" then .[] else . end |
    select(startswith("arn:aws:ecr:"));
    . == $ecr
  )
' "${POLICIES[@]}" >/dev/null || fail "an ECR resource escapes the exact repository"

jq -se --arg budget "$BUDGET" '
  all(
    .[].Statement[].Resource |
    if type == "array" then .[] else . end |
    select(startswith("arn:aws:budgets:"));
    . == $budget
  )
' "${POLICIES[@]}" >/dev/null || fail "a budget resource escapes the exact budget"

jq -e --arg state "lightsail-production/core.tfstate" --arg lock "lightsail-production/core.tfstate.tflock" '
  .Statement[] |
  select(.Sid == "ListOnlyProposedStateAndLock") |
  .Condition.StringEquals["s3:prefix"] == [$state, $lock]
' "$ROOT/preflight-backend-read-policy.json" >/dev/null || fail "state listing prefix is not exact"

jq -e --arg lock "$LOCK" '
  [.Statement[] | select(.Action == "s3:DeleteObject")] == [{
    "Sid": "ReleaseOnlyProposedStateLock",
    "Effect": "Allow",
    "Action": "s3:DeleteObject",
    "Resource": $lock
  }]
' "$ROOT/state-backend-write-policy.json" >/dev/null || fail "DeleteObject is not limited to lock release"

jq -e --arg account "$ACCOUNT" --arg bucket "$BUCKET" --arg state "$STATE" --arg lock "$LOCK" '
  .Statement[] |
  select(.Sid == "UseExactStateKeyOnlyThroughStateBucket") |
  .Condition.StringEquals == {
    "kms:CallerAccount": $account,
    "kms:ViaService": "s3.us-east-1.amazonaws.com"
  } and
  .Condition.StringLike["kms:EncryptionContext:aws:s3:arn"] == [$bucket, $state, $lock]
' "$ROOT/state-backend-write-policy.json" >/dev/null || fail "KMS use is not bound to the exact S3 state context"

expected_wildcards="$({
  printf '%s\n' \
    VerifyCaller \
    ReadRegionalLightsailMetadataAndExactGraph \
    ReadRegionalServiceQuotaMetadata \
    CreateAndUpdateReviewedLightsailGraph
} | sort)"
actual_wildcards="$(jq -r '
  .Statement[] |
  select(.Resource == "*" or (.Resource | type == "array" and any(. == "*"))) |
  .Sid
' "${POLICIES[@]}" | sort)"
[[ "$actual_wildcards" == "$expected_wildcards" ]] || fail "unexpected wildcard Resource statement"

jq -se --arg account "$ACCOUNT" --arg region "$REGION" '
  all(
    .[].Statement[] | select(.Resource == "*");
    if .Sid == "VerifyCaller" then
      .Condition.StringEquals["aws:PrincipalAccount"] == $account
    else
      .Condition.StringEquals["aws:PrincipalAccount"] == $account and
      .Condition.StringEquals["aws:RequestedRegion"] == $region
    end
  )
' "${POLICIES[@]}" >/dev/null || fail "wildcard Resource lacks the required account/Region guard"

if all_policy_actions | grep -Eiq '(^iam:|^sso:|^sso-admin:|^identitystore:|^secretsmanager:|^route53:|^ecs:|^rds:|^ec2:|^elasticloadbalancing:|^wafv2:|^cloudformation:|^cloudtrail:|^cloudwatch:|^logs:|^events:|^scheduler:|^sns:)'; then
  fail "forbidden or superseded AWS service action found"
fi

if all_policy_actions | grep -Eiq '(^lightsail:(Delete|Detach|Disable|Create.*FromSnapshot|Copy.*Snapshot|Export.*Snapshot|GetInstanceAccessDetails$|CreateInstanceSnapshot$|CreateDiskSnapshot$|ShareSnapshot$|StartInstance$|StopInstance$|RebootInstance$)|^ecr:(Delete|BatchDeleteImage$|PutImage$|BatchGetImage$|GetDownloadUrlForLayer$|BatchCheckLayerAvailability$|InitiateLayerUpload$|UploadLayerPart$|CompleteLayerUpload$)|^s3:(DeleteObjectVersion$|DeleteBucket$)|^kms:(Create|Put|Update|Enable|Disable|Schedule|Cancel|CreateGrant$|RetireGrant$|RevokeGrant$))'; then
  fail "destructive, credential, snapshot, image-transfer, or key-administration action found"
fi

if grep -RIEq --include='*.json' \
  '("production/core\.tfstate"|bootstrap/shared\.tfstate|certificate/production\.tfstate|GetInstanceAccessDetails|0\.0\.0\.0/0|::/0|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|postgres(ql)?://|cloudinary://)' \
  "$ROOT"; then
  fail "forbidden old-state, exposure, credential, or connection-string pattern found in policy JSON"
fi

if grep -RIEq --include='*.json' '([[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}|ssh-(rsa|ed25519)[[:space:]])' "$ROOT"; then
  fail "operator email or SSH public key material must not be embedded in policy JSON"
fi

printf 'PASS: six Lightsail IAM policies parsed and matched the offline least-privilege contract (%s)\n' "$ROOT"

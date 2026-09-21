# Saveswitch Lightsail IAM policy package

This directory is an offline, reviewable proposal for two AWS IAM Identity
Center permission sets. It is not authorization to create IAM policies, change
Identity Center, access AWS, initialize Terraform, plan, apply, or deploy.

The production deployment permission set is named
`SaveswitchLightsailDeploy`; its future local AWS CLI profile is
`saveswitch-lightsail-deploy`. A separate read-only permission set named
`SaveswitchLightsailPreflight` is recommended so discovery cannot silently
gain state-write or infrastructure-mutation authority.

## Fixed target

| Boundary | Exact value |
| --- | --- |
| AWS account | `065897469956` |
| Region | `us-east-1` |
| Terraform state bucket | `saveswitch-terraform-state-065897469956` |
| Terraform state key | `lightsail-production/core.tfstate` |
| Native lock object | `lightsail-production/core.tfstate.tflock` |
| State KMS key | `arn:aws:kms:us-east-1:065897469956:key/2b923daa-87c6-491d-aca2-8ecc46aef866` |
| Lightsail instance | `saveswitch-production-app-db` |
| Lightsail attached disk | `saveswitch-production-postgres` |
| Lightsail imported key pair | `saveswitch-production-operator` |
| ECR repository | `saveswitch-production-api` |
| Account-wide budget | `saveswitch-account-monthly-25-usd` |

The old `production/core.tfstate`, `bootstrap/shared.tfstate`, and
`certificate/production.tfstate` objects are outside this package. The old
ECS/RDS/VPC/ALB/WAF design is also outside it. Cloudflare retains frontend,
DNS, Tunnel, and edge ownership; Cloudinary remains the media/object-storage
provider.

## Policy split and permission-set composition

Create the customer-managed IAM policies with the exact names below and the
default `/` path. Identity Center customer-managed policy references do not
create these policies: each referenced policy must already exist in the target
AWS account with the same name and path.

| Customer-managed policy name | Source | Responsibility | Preflight | Deploy |
| --- | --- | --- | --- | --- |
| `SaveswitchLightsailPreflightBackendRead` | `preflight-backend-read-policy.json` | caller proof, state-bucket controls and exact-key/version history, KMS metadata/policy | yes | yes |
| `SaveswitchLightsailProviderRead` | `provider-read-policy.json` | Lightsail/provider metadata, exact ECR and budget/tag reads, relevant Regional quota reads | yes | yes |
| `SaveswitchLightsailStateBackendWrite` | `state-backend-write-policy.json` | current state/lock read-write, lock release, state-key cryptographic use | no | yes |
| `SaveswitchLightsailFoundation` | `lightsail-foundation-policy.json` | create/update only the accepted Lightsail foundation action classes | no | yes |
| `SaveswitchLightsailEcrLifecycle` | `ecr-lifecycle-policy.json` | create/configure the exact ECR repository and lifecycle policy | no | yes |
| `SaveswitchLightsailBudget` | `budget-policy.json` | manage and tag only the exact USD 25 account budget | no | yes |

`SaveswitchLightsailPreflight` attaches only the first two policies.
`SaveswitchLightsailDeploy` attaches all six. Keep both permission-set session
durations at one hour unless a shorter duration is operationally practical.
Do not attach AWS managed administrator, power-user, billing-full-access, or
Lightsail-full-access policies.

Assign the deployment permission set only for an approved Terraform change
window and remove that account assignment after the reviewed operation and
post-checks. Keep the preflight permission set as the ordinary read-only role.
An expired local SSO session is not a substitute for removing an unnecessary
standing deployment assignment.

## Action and resource matrix

| Surface | Reads | Create/update | Explicitly withheld |
| --- | --- | --- | --- |
| S3 state backend | exact bucket metadata/policy; list only the proposed state and lock names; get only current proposed state/lock | put only current proposed state/lock; delete only the transient `.tflock` | state deletion, version reads/deletion, other prefixes, bucket mutation |
| State KMS key | describe, policy, rotation, tags | encrypt/decrypt/data-key only through the exact S3 service/account and matching encryption contexts | key administration, grants, rotation changes, disable/schedule deletion |
| Lightsail | blueprint, bundle, Region/AZ, exact graph lookup, operation status | import key, create instance/disk, attach disk, enable automatic snapshot add-on, replace declared public-port set, tag/untag | all delete/detach/disable actions, instance access credentials, start/stop/reboot, snapshot create/copy/export/share/restore, static IP, DNS, buckets, databases |
| ECR | describe exact repository, lifecycle, tags | create exact repository; configure scanning, immutability, lifecycle, tags | image push/pull, image deletion, repository/lifecycle deletion, policy mutation |
| Budgets | view exact budget and its tags | `budgets:ModifyBudget`, `budgets:TagResource`, and `budgets:UntagResource` for the exact budget | other budgets and AWS Budget Actions |
| Service Quotas | read Regional quota metadata | none | quota-increase requests |

No policy grants IAM/Identity Center mutation, Secrets Manager, Route 53,
Cloudflare, ECS, RDS, VPC/EC2, ALB, WAF, application S3, database, or secret
access. ECR image transfer is deliberately a later, separately authorized
workflow.

The lifecycle policy in Terraform will eventually expire matching ECR images.
`ecr:PutLifecyclePolicy` is therefore narrowly retained even though image
deletion APIs are withheld. A future apply must prove that the reviewed policy
still means seven days for untagged images and five retained `release-`
images; changing that retention contract requires review.

## Why some resources are `*`

The policy files do not use wildcard actions. The following APIs require or
practically need `Resource: "*"` because the request is account metadata or
because the new Lightsail resource ARN is not available before creation:

- `sts:GetCallerIdentity`;
- the enumerated Lightsail read operations;
- the enumerated Service Quotas reads; and
- the enumerated Lightsail create/update/tag operations.

Each Regional wildcard-resource statement is constrained by the global
`aws:PrincipalAccount` and `aws:RequestedRegion` condition keys. Caller proof
is constrained by `aws:PrincipalAccount`. This package intentionally does not
invent a Lightsail resource-name condition key. As a result, IAM alone cannot
encode the instance, disk, or key-pair names carried in Lightsail request
bodies. The exact-name boundary is enforced by this Terraform root, its static
validator, saved-plan review, artifact-bound approval, and a required future
IAM simulation/live preflight. Treat that as a residual least-privilege gap,
not as permission to create differently named resources.

In particular, `lightsail:PutInstancePublicPorts`, `TagResource`, and
`UntagResource` cannot be constrained here to the reviewed port/CIDR/tag
payload. During its short assignment window the deploy role could affect other
Lightsail resources in the same account and Region through those actions. The
future plan must show only TCP 22 with exact operator `/32` CIDRs, and the
account should contain no unrelated Lightsail resources during a change window.

AWS Budgets exposes create, update, and delete of a budget through the single
`budgets:ModifyBudget` IAM permission. Creating the Terraform budget with the
provider's required tags also needs `budgets:TagResource`; stable tag refresh
and reconciliation use `budgets:ListTagsForResource` and
`budgets:UntagResource`. These permissions are limited to
`saveswitch-account-monthly-25-usd`; `prevent_destroy` blocks Terraform-driven
deletion but not a direct API call. Keep the deploy assignment temporary and
verify after every change window that the budget and all four alerts still
exist.

When repairing an existing deployment after the first partial apply, update the
default versions of `SaveswitchLightsailProviderRead` and
`SaveswitchLightsailBudget` from the matching JSON files. Their names, `/`
paths, permission-set references, and account assignment do not change, so do
not recreate or reassign the permission set. Wait for normal IAM propagation
before the next read-only reconciliation.

## Later console setup (not authorized by this source)

Only after the owner separately authorizes IAM/Identity Center changes:

1. In the target account's IAM console, create each customer-managed policy
   from the matching JSON file. Use the exact name in the table and path `/`.
   Run AWS policy validation and stop on any unknown action or unsupported
   action/resource/condition combination.
2. In IAM Identity Center, create `SaveswitchLightsailPreflight` as a custom
   permission set and attach only its two customer-managed policy references.
3. Create `SaveswitchLightsailDeploy` and attach all six references. Enter
   policy **names**, without a leading slash; do not paste a file path into the
   policy-name field.
4. Assign each permission set only to the intended user or tightly controlled
   group in account `065897469956`, then wait for provisioning to complete.
5. Configure SSO profiles only after assignment. Use the organization's real
   access-portal start URL, the Identity Center Region, registration scope
   `sso:account:access`, account `065897469956`, the exact permission-set role,
   AWS Region `us-east-1`, and output format `json`. Never enter or store access
   keys, secret keys, or session tokens in this repository.

Recommended local profile names are `saveswitch-lightsail-preflight` and
`saveswitch-lightsail-deploy`. A profile is configuration, not authorization
to use it. Successful SSO login also does not authorize Terraform or AWS
operations.

## Future read-only preflight authorization template

Use a fresh, explicit approval similar to the following after the read-only
permission set is assigned:

> I authorize a read-only AWS Lightsail production preflight using profile
> `saveswitch-lightsail-preflight`, permission set
> `SaveswitchLightsailPreflight`, account ending `9956`, in `us-east-1`, for
> the Saveswitch `lightsail-production` target. Verify caller identity; the
> current state and lock keys including version history and the exact four
> expected managed addresses after the stopped partial apply;
> state-bucket and KMS controls; exact Lightsail, ECR, and budget name
> collisions; blueprint, bundle specification/current price, Availability
> Zone, and relevant quotas; and the locked provider schema. No Terraform
> initialization, refresh, plan, apply, state/object write, IAM/SSO change,
> image transfer, snapshot action, secret access, Cloudflare/DNS change,
> database action, deployment, modification, replacement, or deletion is
> authorized.

Provider schema inspection may require local provider initialization or
execution. That is not included merely because AWS reads are authorized; name
it separately if it may download or execute provider code. If preflight finds
an unexpected managed address, live-resource drift, a current lock, a name
collision, unsupported provider behavior, policy denial, price/bundle
mismatch, or account/Region mismatch, stop rather than broadening these
policies.

## Validation

Run only the offline checks:

```bash
bash infra/aws/lightsail-production/iam/validate-policy-pack.sh
bash -n infra/aws/lightsail-production/iam/validate-policy-pack.sh
```

The validator parses every policy with `jq`, pins each reviewed JSON document
byte-for-byte, checks the accepted action sets and resources, rejects wildcard
actions and `NotAction`/`NotResource`, and checks the withheld destructive and
secret-bearing surfaces. A policy edit therefore requires explicit semantic
review and a deliberate canonical-hash update. The validator is not AWS IAM
Access Analyzer, policy simulation, a provider-backed plan, or proof that every
API will authorize successfully. Those remain live, separately authorized
gates.

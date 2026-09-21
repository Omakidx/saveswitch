# Saveswitch AWS infrastructure

> **Active production target (accepted 2026-09-20):** the low-cost,
> single-instance design in `lightsail-production/`. The older
> `production/` ECS/RDS design is superseded, has never been applied, and must
> not be initialized, planned, or applied. The two roots are alternatives, not
> layers of one deployment.

This directory is the repository-only AWS target for Saveswitch. It declares a
new production environment in `us-east-1`; it does not deploy anything by
itself. No Terraform command in this directory is permission to contact AWS,
create a plan, apply a change, move state, populate a secret, or change DNS.
Each of those actions needs its own target-specific approval.

Terraform was selected because the repository had no existing IaC tool and the
AWS provider gives a reviewable resource graph, mature static tooling, native
remote-state locking, and explicit lifecycle controls. The tradeoff is a
sensitive state file and a provider-backed plan that can read/write remote
state; those operations are treated as live AWS actions. OpenTofu,
CloudFormation, and CDK are intentionally not mixed into this resource graph.

## Active low-cost architecture

The accepted target is one Lightsail Linux instance in one `us-east-1`
Availability Zone, with the Bun/Elysia API and PostgreSQL co-located on that
host. PostgreSQL data resides on a separately attached Lightsail disk. The API
listens on loopback and is published through an outbound-only Cloudflare
Tunnel. Cloudflare continues to own the frontend, DNS, public TLS, and edge
policy; Cloudinary remains the application media/object-storage provider.

The active Terraform root is `lightsail-production/` and its proposed isolated
state key is `lightsail-production/core.tfstate`. It intentionally does not
create ECS, Fargate, RDS, a VPC, NAT gateways, endpoints, an ALB, AWS WAF,
application Secrets Manager resources, Route 53 records, or media buckets.
The existing bootstrap state bucket/KMS key remain Terraform-state
infrastructure only. The already-issued ACM certificate is retained in its
separate state but is not used by Cloudflare Tunnel.

This design accepts single-instance/single-AZ downtime risk, shared API and
database resources, and approximately 24-hour RPO/four-hour RTO targets subject
to a successful restore drill. The AWS budget is an account-wide USD 25 alert
target, not a billing cap. Live initialization, planning, applying, Cloudflare
configuration, host bootstrap, secret handling, database migration, and
deployment each remain separate authorization gates.

See `lightsail-production/README.md` for its exact resource and safety
contract.

## Superseded ECS/RDS architecture (historical; do not run)

> **Archive boundary:** everything from this heading through the end of this
> file records the earlier ECS/RDS design and its past review evidence. Any
> imperative wording, commands, gates, cost figures, or “production” references
> below are historical only and are not an executable runbook. The only active
> production instructions are in `lightsail-production/README.md`.

```text
Cloudflare DNS (DNS-only api.saveswitch.xyz)
                    |
             HTTPS + AWS WAF
                    |
       public ALB in two public subnets
                    |
       one ECS Fargate task, no public IP
       in two private application subnets
                    |
       private RDS PostgreSQL Multi-AZ
        in two isolated DB subnets

ECS -> same-AZ NAT gateways -> Google / Cloudinary / URL previews
ECS -> VPC endpoints -> ECR / S3 / CloudWatch Logs / Secrets Manager
```

The production-balanced defaults are deliberately changeable inputs:

- Region: `us-east-1`; two account-validated AZs are required. The supplied
  `us-east-1a`/`us-east-1b` labels are examples until the target account's AZ
  mapping is rechecked during an authorized pre-plan review.
- Recovery objectives: five-minute RPO target and 60-minute RTO target. These
  are acceptance targets, not guarantees until backup and restore exercises
  demonstrate them.
- RDS: PostgreSQL `18.6`, `db.t4g.small`, 20 GiB gp3 with a 100 GiB autoscaling
  ceiling, Multi-AZ, 14-day automated-backup/PITR retention, deletion
  protection, retained automated backups, final snapshot, Enhanced Monitoring,
  and Performance Insights.
- Backup window: 02:00-03:00 UTC. Maintenance window: Sunday 04:00-05:00 UTC.
- ECS API: 0.5 vCPU, 1 GiB, desired count exactly one, deployment circuit
  breaker and rollback, non-root UID/GID, read-only root filesystem, capability
  drop, and a task-lifetime Fargate ephemeral bind mount at writable `/tmp`.
- Egress: a NAT gateway in each application AZ avoids a single-AZ dependency.
  Interface/gateway endpoints reduce AWS-service NAT traffic. Public TCP 80/443
  remains necessary for Google OAuth, Cloudinary, and user-selected URL
  previews; application SSRF defenses remain a cutover gate.
- Cost alert recommendation: USD 250/month at 80% forecast and 100% actual.
  This is an alert threshold, not a spending cap or approved budget. No Budget
  or email subscription exists unless `alert_email` is supplied out of band.
- CloudWatch application and RDS logs: 30 days; VPC-flow logs: 14 days. WAF
  request logging and ALB request logging default off behind separate privacy
  gates. If approved, WAF logs retain blocked/redacted requests for 14 days and
  ALB logs retain request records for 90 days. ALB logs cannot redact query
  strings and may capture short-lived OAuth callback parameters. CloudWatch
  ALB metrics and application logs remain enabled while that gate is closed.
  The `RDSOSMetrics` Enhanced Monitoring group is Region-wide, so the pre-plan
  collision/ownership check must stop rather than silently adopt a group
  managed by another stack.

There is no Valkey resource. Horizontal scaling remains blocked until realtime
fanout and rate limits use shared state. API task/service resources are absent
from the foundation phase. They are created only when `enable_api_service`, an
immutable digest, and `api_runtime_ready` are all supplied after external image,
secret-value, database, and application checks. Cleanup task, IAM, and Scheduler
resources are likewise absent by default. A first gated change provisions the
schedule disabled so manual canaries can prove idempotency and alert delivery;
a later, separately reviewed change enables it. An unready task definition
cannot become a deployable production artifact.

## State and file model

| Root | State key | Responsibility |
| --- | --- | --- |
| `bootstrap/` | `bootstrap/shared.tfstate` after separately approved migration | Versioned, encrypted, private S3 backend and KMS key |
| `certificate/` | `certificate/production.tfstate` | ACM request and Cloudflare DNS-validation handoff |
| `lightsail-production/` | `lightsail-production/core.tfstate` (proposed; not initialized) | **Active target:** one Lightsail host/disk, restricted break-glass SSH, ECR, and account-wide budget alerts |
| `production/` | `production/core.tfstate` (empty; never applied) | **Superseded:** historical ECS/RDS design; do not initialize, plan, or apply |

The bootstrap root has an empty S3 backend block but must first be initialized
with `-backend=false`, because its bucket and KMS key do not exist yet. Its
initial local state is sensitive. Creating the bootstrap resources requires
apply approval; initializing the newly created backend with `-migrate-state`
is a later, separate state-mutation approval with a protected state backup and
exclusive access. Never run bootstrap normally against a fresh directory
without the reviewed backend configuration after migration.

The certificate, active Lightsail, and superseded production roots have empty
S3 backend declarations. Only the active root may be initialized after a new
approval; never initialize the superseded production root. Pass a reviewed
copy of the active root's `backend.hcl.example` and never commit the real file.
Native S3 lockfiles require Terraform 1.10 or newer. Provider policy is AWS
provider `>= 6.0, < 7.0`. The four repository dependency lockfiles currently
select AWS provider `6.65.0` with HashiCorp-signed cross-platform checksums.
Future initialization must stop for review if it proposes another selection.

The infrastructure-local `.gitignore` excludes provider caches, state, plans,
crash logs, backend configuration, private variable files, and key material.
State and saved plans are always sensitive even when variables contain only
ARNs.

## Archived ECS/RDS authorization gates (do not execute)

Do not combine these gates. A successful plan is not apply approval, and apply
approval is not deletion, DNS, secret-write, or state-mutation approval.

1. **Offline review:** review code, architecture blockers, default sizing,
   current official documentation, and the intended account/Region. No AWS
   session is needed.
2. **Bootstrap plan:** separately authorize an authenticated Terraform plan for
   the exact production account, `us-east-1`, bootstrap root, backend mode, and
   source revision. Review the durable S3/KMS creation and IAM permissions.
3. **Bootstrap apply:** separately authorize the reviewed plan. Preserve the
   local state with restricted permissions. Backend migration is a later,
   explicit state action.
4. **Certificate request:** separately plan/apply only `certificate/`. Give the
   `dns_validation_records` output to the Cloudflare owner. The owner creates
   validation records with proxying disabled. A second reviewed plan/apply
   completes ACM validation. Confirm the certificate is `ISSUED` before passing
   its ARN to production.
5. **Production plan:** verify identity, account, `us-east-1`, remote backend,
   lock, source revision, provider lock, quotas, resource-name collisions,
   PostgreSQL version/class/CA availability, current price estimate, and drift.
   Populate no secret values. Review every addition, replacement, deletion,
   public edge, IAM statement, and recurring cost, then stop.
6. **Foundation apply:** requires a new approval tied to the exact reviewed
   plan checksum. The RDS instance has both deletion protection and Terraform
   `prevent_destroy`; never weaken either in the deployment change window.
7. **Secret/image readiness:** use separately authorized workflows to populate
   secret versions and push a scanned image. Record the immutable digest and
   build provenance, but keep the API service disabled.
8. **Database migration:** before API activation, the database owner applies
   the reviewed baseline and migration ledger, creates distinct least-privilege
   PostgreSQL roles, loads the accepted canonical data, and validates it. IaC
   never contains dumps or row data.
9. **API activation:** close the application and alert gates, update the image
   digest and enable flags, review a new plan, and request a distinct service
   apply. Verify readiness without public DNS traffic.
10. **Cloudflare cutover:** only after ALB/WAF/API/database acceptance, the
   Cloudflare owner creates a DNS-only CNAME from `api.saveswitch.xyz` to
   `alb_dns_name`. Proxying or origin lockdown is a later design and test.

At every live gate, stop on account/Region mismatch, expired SSO, missing lock,
unexpected drift, an unreviewed provider version, quota failure, replacement or
deletion, changed plan checksum, or a secret-bearing output.

### Access and permission boundary

The current IAM Identity Center `ViewOnlyAccess` session was sufficient for the
bounded inventory; it is not a deployment identity and must not be expanded
silently. Backend initialization needs scoped S3 object/lock and KMS use on the
one state prefix/key. A provider-backed plan needs the documented read surface;
bootstrap and production applies need separately reviewed create/update
permissions. Destructive, state-mutation, secret-write, image-push, and DNS
permissions remain separate gates. Before any live command, record the source
revision, provider lock checksum, target account/Region, backend key, current
lock/drift evidence, plan artifact checksum, expected cost, and replacements or
deletions. No CI/OIDC role is created by this surface.

## Archived ECS/RDS configuration contract (do not execute)

The former copy commands are intentionally omitted so this archive cannot be
mistaken for the active Lightsail setup instructions.

Never paste credential values, database URLs, secret values, private keys, or
data exports into those files. The full account ID is a target guard, not a
credential. The certificate ARN must be from the approved account and Region.
The image input is omitted in the foundation phase. When the service gate is
opened, it accepts only `sha256:<64 lowercase hex>` and forms an ECR digest
reference; tags cannot be deployed. A syntactically valid digest is not proof
that the image exists, has the expected architecture, or passed scanning.

The foundation creates Secrets Manager *containers* for:

- `DATABASE_URL`
- `DATABASE_SSL_CA`
- `JWT_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `CLOUDINARY_URL`

It creates no secret versions. This deliberately breaks the dependency cycle:
foundation first creates ECR, RDS, and secret containers; separately authorized
work then pushes the immutable image, creates least-privilege database roles,
and writes secret versions; only a later reviewed service plan opens the API
gate. The application connection must use a dedicated, least-privilege
PostgreSQL login; it must never use the RDS-managed master secret. The separate
migration login may perform only the accepted baseline and migration operations
and must be revoked or disabled after cutover. RDS forces TLS, but application
code must still use the current RDS CA and hostname verification; encryption
without server authentication is not sufficient.

Generate `JWT_SECRET` with a cryptographically secure generator; do not invent
or hand-type it. Production accepts only 43-128 base64url characters,
representing at least 32 random bytes. For example, generate a
64-character/32-byte value in a restricted shell with `openssl rand -hex 32`,
write it only through the separately authorized secret workflow, and never
paste it into Terraform variables, plans, state, logs, or this repository.
Before cutover, check the existing secret's shape out of band without printing
its value. A legacy secret containing `+`, `/`, `=`, or a different length will
be rejected. If it is incompatible, schedule an explicit JWT rotation and
session-invalidation window; do not weaken validation or silently replace it.

## Archived ECS/RDS deployment sequence (do not execute)

The old commands below are historical evidence, not authorization to execute
them.
Every `init` that configures S3, provider-backed `plan`, `apply`, image push,
secret write, database operation, or DNS change remains its own approval gate.
Saved plans and state must live in a restricted workspace outside the repository.

1. **Historical bootstrap and state migration.** The former copy-paste commands
   are intentionally omitted. This step was completed under earlier,
   artifact-bound approvals and is not part of the Lightsail root.

2. **Request and validate the ACM certificate.** Initialize `certificate/`
   against the reviewed remote backend. The first reviewed plan/apply leaves
   `validation_record_fqdns = []`. Give its DNS output to the Cloudflare owner;
   after the DNS-only validation CNAMEs exist, a second reviewed plan/apply
   creates the validation resource. Confirm ACM reports `ISSUED`.
3. **Create the production foundation.** In `production/terraform.tfvars`, keep
   `enable_api_service = false`, `api_runtime_ready = false`, omit
   `api_image_digest`, and keep `enable_cleanup_scheduler = false`. A reviewed
   foundation plan creates networking, ECR, secret containers, private RDS,
   ECS cluster/roles, ALB/ACM listener/WAF, telemetry, and optional cost alerts,
   but no API or cleanup task/service/schedule.
4. **Prepare the image and secrets out of band.** Build from a base pinned by
   version and digest, scan it, push it to the newly created ECR repository, and
   give the accepted digest an immutable `release-...` tag so the lifecycle
   policy retains it for rollback. Record the repository digest and provenance.
   Establish the canonical schema and least-privilege PostgreSQL roles. Populate
   every secret container using a separately authorized secret-write workflow.
   Never use the managed RDS master credential as `DATABASE_URL`.
5. **Load and validate the database while the API remains disabled.** The
   database owner applies the reviewed baseline/ledger and accepted canonical
   load, creates the least-privilege application login, and validates the
   target before any web task can connect. Data exports and rows never enter
   this IaC or its state. The preferred production execution path is a
   separately reviewed, one-off
   private Fargate migration task using the reserved migration security group,
   an immutable purpose-built image, a short-lived migration database role, and
   no public IP. This root intentionally does not invent that task definition,
   command, artifact permission, or secret before the database owner accepts
   the baseline and ledger. Revoke/disable the migration role after acceptance.
6. **Enable the API only after application and data acceptance.** Implement
   the `/ready` dependency-aware endpoint and close the blockers below. Set the
   real digest, supply the approved operator email, confirm its SNS
   subscription, set `api_runtime_ready = true`, and set
   `enable_api_service = true`; review a fresh provider-backed plan and request
   a distinct apply approval. Verify target health and alarms without public
   DNS traffic.
7. **Cut over deliberately.** After end-to-end acceptance and a go/no-go
   decision, the Cloudflare owner creates the DNS-only API CNAME.
8. **Add cleanup later.** Only after idempotency, overlap prevention, expired
   record behavior, and Cloudinary reconciliation are accepted, provide the
   reviewed one-shot command (`["bun", "src/jobs/cleanup-cli.ts"]`) and set
   `create_cleanup_resources = true` while
   leaving `enable_cleanup_scheduler = false`. Apply the reviewed plan, invoke
   manual success, nonzero-exit, failed-start, and partial-failure canaries, and
   prove their operator alerts. Only then attest
   `cleanup_completion_monitoring_ready = true`, enable the schedule, and review
   a distinct plan/apply. Partial failures must make the one-shot command exit
   nonzero; ECS stopped-task events cover nonzero exits and failed starts, while
   Scheduler alarms cover target errors and exhausted retries.

## Archived ECS/RDS ACM and Cloudflare handoff

The certificate root has two deliberately separate phases:

1. Apply with `validation_record_fqdns = []` to request the certificate and
   retrieve `dns_validation_records`.
2. The Cloudflare owner creates the exact CNAME records with proxying disabled.
   Supply their FQDNs, review a new plan, and apply the ACM validation resource.

Do not create the production HTTPS listener with a merely pending certificate.
The API record remains DNS-only initially, so the ALB sees direct client source
IPs. WAF rate aggregation therefore uses the connection IP and does not trust
forwarded headers.

## Archived ECS/RDS WAF and privacy gate

The web ACL attaches AWS Common, Known Bad Inputs, SQL injection, and IP
reputation rule groups. It also has direct-IP rate controls for:

- `/auth/*`
- anonymous `POST /xoomshare`
- the two resource-creation/upload paths
- the `/ws` WebSocket handshake

Thresholds are initial tuning values, not proven capacity limits. Test real API
paths for abuse resistance and false positives before cutover. WAF protects the
HTTP handshake, not subsequent WebSocket frames. An ALB-associated WAF only
inspects a bounded leading portion of request bodies. The managed common-rule
body-size action is counted to avoid rejecting legitimate uploads. A separate
explicit rule blocks bodies beyond that boundary on every route except
`POST` requests to the two reviewed resource-upload paths. Oversize upload
bodies are counted and must still pass the application's 15 MiB and content
validation. Test both the block and upload exceptions through the real ALB
before cutover.

Full WAF request logging defaults off. If the data owner accepts it, enabling
logging retains only blocked requests and redacts authorization, cookies, the
`x-saveswitch-xoomshare-path` capability header, query strings, and URI paths
that can contain Xoomshare capabilities. Other metadata can still be sensitive,
so the flag must not be enabled casually. Metrics and
alarms exist without request logs.

ALB access logging also defaults off. Unlike the WAF configuration, ALB access
logs cannot redact individual query fields and may record short-lived Google
OAuth callback parameters. Enable it only with
`alb_access_log_privacy_accepted = true` after an explicit data-owner review;
the encrypted/private log bucket and 90-day lifecycle exist in the foundation
so enabling it does not require a new storage design.

## Archived ECS/RDS validation evidence

The former copy-paste validation commands are intentionally omitted. Historical
evidence below records what was run; use only the active Lightsail root's
documented offline checks for the current design.

Downloading providers or policy-tool rules is a network/install action, not
part of offline validation. `terraform plan`, `refresh`, backend initialization,
drift checks, and provider data lookups are authenticated live actions and need
separate approval.

### Read-only planning evidence — 2026-09-19

An authorized validation used checksum/signature-verified Terraform `1.16.3`,
AWS provider `6.65.0`, profile-selected account suffix `9956`, and
`us-east-1`. All three roots passed `fmt -check` and provider-schema
`validate`. Because remote-backend initialization and state mutation were not
authorized, protected temporary copies omitted only `backend.tf` and used an
empty local backend. Their remaining Terraform files and lockfiles matched the
repository byte-for-byte.

With refresh disabled, the plans contained only expected creations:

| Root | Create | Change | Replace | Destroy |
| --- | ---: | ---: | ---: | ---: |
| `bootstrap` | 9 | 0 | 0 | 0 |
| `certificate` | 1 | 0 | 0 | 0 |
| `production` foundation | 119 | 0 | 0 | 0 |

This is validation evidence, not an apply artifact. The production plan used a
syntactically valid placeholder ACM ARN because the certificate does not exist,
and empty local state cannot prove drift or ownership. Re-plan against the
approved remote state after the certificate is `ISSUED`, denied inventory and
quota checks are resolved, and the source revision is committed. No plan from
this validation may be applied.

The production foundation was re-planned after adding the separately populated
regional RDS CA bundle container. That historical protected plan checksum is
`b66730c17cda84657698b0cf3ba98f22696aaca4b413f25714c47d44b1a88fb3`;
it is backend-free, refresh-disabled, empty-state, and non-applyable. Later WAF
log-redaction changes supersede its source, so a fresh reviewed plan is required.

Before approving a provider-backed plan, prove:

- the production account has an independently owned, durable CloudTrail,
  GuardDuty, and AWS Config baseline, including a reviewed decision on S3
  Terraform-state data-event auditing; this application root does not own or
  assume those account-wide controls;
- no public IP on tasks and `publicly_accessible = false` on RDS;
- ALB-only task ingress and task/migration/cleanup-only database ingress;
- two NAT gateways in distinct AZs, private AWS endpoints, and isolated DB
  route tables with no internet route;
- immutable ECR, a digest-only task image, non-root/read-only runtime, narrow
  execution permissions, and an empty application role;
- RDS deletion protection, `prevent_destroy`, final snapshot, backup/PITR,
  Multi-AZ, encryption, CA selection, monitoring, and log exports;
- cleanup Scheduler resources are absent by default, then remain disabled until
  manual canaries and completion/failure alerting are accepted;
  desired API count remains one;
- CloudWatch alarms reach a confirmed operator and Budget tagging matches
  actual AWS cost-allocation-tag activation;
- the API readiness path, WebSocket drain/reconnect behavior, database TLS,
  URL-preview SSRF controls, and private-download authorization are tested.

## Archived ECS/RDS recovery and rollback

RDS Multi-AZ handles an instance/AZ failure but is not read scaling or a backup.
Exercise a point-in-time restore into an isolated network, validate the baseline
and representative canonical records, and measure the 60-minute RTO before
acceptance. Keep deletion protection enabled. Any RDS destroy/replacement needs
a separate window, a unique final snapshot name, retained automated backups,
restore evidence, dependency closure, and explicit destructive approval.

ECS retains prior task-definition revisions and uses the deployment circuit
breaker. A failed image release should roll back to the last known-good digest;
database schema compatibility must be forward/backward safe for that rollback.
ALB/WebSocket deployments still disconnect clients, so graceful shutdown and
client reconnect/resubscribe tests remain mandatory.

Before the new RDS target accepts writes, traffic can return to the frozen
legacy source. After accepted target writes, do not route back to Heroku or Neon
without a separately tested reverse migration; prefer compute rollback or
forward repair against RDS.

## Archived ECS/RDS cost and inventory gates

The largest recurring cost drivers are two NAT gateways and processed data,
RDS Multi-AZ compute/storage/backups/Performance Insights, four interface
endpoints, ALB capacity, Fargate runtime, WAF managed/rate rules and requests,
CloudWatch logs/metrics/alarms, Secrets Manager, and data transfer. Cloudinary
and Cloudflare remain external costs. Re-estimate all of them with the current
AWS Pricing Calculator immediately before plan approval. Do not assume free
tier, credits, discounts, or stable 2026 prices.

The 2026-09-19 read-only inventory found a greenfield target except for the
default VPC. It could not verify all Service Quotas, Secrets Manager names,
CloudWatch alarms, Scheduler resources, account-wide ECR scanning settings, or
ALB account limits because ViewOnlyAccess denied those APIs. Treat collisions,
quotas, ECR enhanced scanning, IAM permissions, email endpoints, and cost-tag
activation as unknown until a separately authorized pre-plan check. This stack
does not use the default VPC.

## Archived ECS/RDS cutover blockers

The repository now contains a digest-pinned, non-root image definition, a
database-aware `/ready`, CA-authenticated production PostgreSQL configuration,
a checksum-ledgered clean-database baseline, and a locked one-shot cleanup
command. Those controls have local static/unit/disposable-PostgreSQL evidence,
but infrastructure alone does not make the application production-ready. At
minimum:

- build and scan the amd64 image, then prove non-root/read-only runtime,
  liveness/readiness, SIGTERM, and WebSocket reconnect behavior with the real
  container and a disposable TLS PostgreSQL endpoint;
- populate the regional RDS CA bundle out of band and prove correct-host
  success plus untrusted-CA, wrong-host, and plaintext failures;
- run the baseline/ledger and least-privilege role sequence against a fresh
  isolated RDS restore target before loading final canonical data;
- canary the one-shot cleanup task and its exit-code alerts while the schedule
  remains disabled;
- Cloudinary reference reconciliation and deletion policy are not accepted.
- realtime fanout/rate limits are process-local, so desired count stays one.
- private-resource authorization is implemented locally, but migrated provider
  URLs, direct-ALB client-IP behavior, WebSocket drain/reconnect, and WAF path
  thresholds still require end-to-end tests.
- new Xoomshare rooms use server-generated 128-bit capabilities. Hold cutover
  for at least three hours after the final source write freeze, or explicitly
  rotate/invalidate every still-live migrated legacy human-chosen room code.
- application log review must prove tokens, cookies, OAuth parameters, database
  URLs, uploaded content, and private resource payloads are not emitted.
- the canonical RDS baseline and ordered ledger still need database-owner
  acceptance for the production RDS target.

## Archived ECS/RDS non-goals

This surface does not manage Cloudflare Workers or DNS, Route 53, Cloudinary,
media migration to S3, Heroku/Neon discovery or retirement, semantic database
merge rules, database exports or rows, secret values, container builds/pushes,
CI/CD/OIDC, Valkey, autoscaling, RDS Proxy, Aurora, source write freezes, or any
live AWS operation.

## Primary documentation

- [Terraform S3 backend and native lockfile](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Terraform dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock)
- [AWS provider documentation](https://registry.terraform.io/providers/hashicorp/aws/latest/docs)
- [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html)
- [ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html)
- [ECS Secrets Manager injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [ALB HTTPS listeners and WebSockets](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html)
- [RDS PostgreSQL Multi-AZ](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)
- [RDS SSL/TLS certificates](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/UsingWithRDS.SSL.html)
- [AWS WAF oversize request components](https://docs.aws.amazon.com/waf/latest/developerguide/waf-oversize-request-components.html)
- [EventBridge Scheduler ECS target](https://docs.aws.amazon.com/scheduler/latest/UserGuide/managing-targets-templated.html#templated-targets-ecs)
- [AWS Pricing Calculator](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html)

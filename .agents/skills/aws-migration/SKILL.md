---
name: aws-migration
description: Refine Saveswitch's AWS target, author or review repository-scoped AWS infrastructure as code, and validate migration and cutover readiness. Use for AWS-specific migration work, not Heroku inventory, semantic database merging, Cloudflare frontend implementation, or generic non-AWS delivery.
---

# AWS Migration

Own the AWS target side of the Saveswitch migration while keeping repository changes, provider access, and live mutations as separate authorization layers. The default mode is offline inspection, architecture refinement, IaC authoring when explicitly requested, and local validation.

## Select the authorized mode

Classify the request before acting:

1. **Discovery and design:** inspect repository evidence, refine AWS boundaries, identify unknowns, and produce decisions or readiness gates. Read-only.
2. **Repository IaC:** create or update AWS IaC only when the request explicitly asks for implementation. Writes remain in the assigned repository infrastructure surface.
3. **Live AWS evidence:** authenticated identity, inventory, drift, quota, cost, or provider-backed plan/change-set calls require separate approval naming the account, Region, environment, stack, and read/plan action.
4. **Live mutation:** apply, deploy, import, state mutation or unlock, secret creation/rotation, access changes, scaling, DNS changes, and deletion each require target-specific approval. Approval for one class does not authorize another.

A broad request to “migrate,” “ship,” or “clean up” is not live-change approval. Platform or shell approval does not replace authorization for the action's purpose. If tools or authenticated AWS access are unavailable, finish safe offline work and report the missing evidence; do not install a plugin or ask for credential values as a workaround.

Before any live mode, read [AWS change-safety gates](references/change-safety.md). For Saveswitch architecture or IaC, read [Saveswitch AWS target](references/saveswitch-target.md) and inspect `AWS_MIGRATION_PLAN.md` when present. Treat repository prose as evidence, then reconcile it with current code and official documentation.

## Protect identity, secrets, and state

Never read or display access keys, session tokens, secret values, connection strings, `.env` contents, local AWS credential files, CI secret stores, database exports, or secret-bearing variable files. Use the platform's existing SSO, OIDC, role, or session mechanism only after live access is authorized. Identity checks may establish the account, partition, principal type, and Region without exposing credentials; redact personal principal details from reports.

Keep secret *values* out of IaC, source control, task definitions, build arguments, outputs, logs, and frontend variables. Model Secrets Manager references and least-privilege access. Treat IaC state and saved plan artifacts as sensitive because providers can record values in them:

- never commit local state, provider caches, lock overrides, plan binaries, database dumps, or generated credentials;
- use an encrypted, access-controlled, versioned remote backend with locking for team environments;
- keep environment/account/Region boundaries explicit and do not silently select a default production target;
- never manually edit state. Import, move, remove, replace-provider, force-unlock, backend migration, or recovery requires an approved backup, exact address mapping, exclusive lock, and post-action verification.

## Author safe repository IaC

Follow the repository's established IaC tool. If none exists, record the selection decision and tradeoffs before scaffolding a production stack. Do not introduce multiple tools for the same resource graph without a defined ownership boundary.

Make environments reproducible and reviewable. Separate configuration from secrets; pin tool/provider policy; use stable logical names and required tags; declare outputs narrowly; and document the account, Region, environment, state backend, dependencies, and recovery boundary without embedding live identifiers unnecessarily.

For the accepted target, require at least:

- private ECS tasks and RDS subnets, narrowly scoped security-group edges, and no public RDS endpoint;
- HTTPS ALB with ACM, health/readiness checks, WAF attachment, access and application telemetry, deployment failure detection, and immutable ECR image references;
- distinct task execution and application task roles with least privilege;
- encrypted RDS, backups and recovery settings, deletion protection, and an explicit final-snapshot/retention decision;
- Secrets Manager references, bounded CloudWatch retention, alarms, budgets/tags, and EventBridge Scheduler roles scoped to the maintenance task;
- desired count one until shared WebSocket fanout, distributed rate limits, and singleton scheduled work are proven.

For Saveswitch, a WAF attachment alone is insufficient. Require reviewed managed rules, route-specific rate controls for authentication, anonymous creation, uploads, and WebSocket handshakes, explicit oversize handling, redacted telemetry/alarms, and real ALB-path abuse and false-positive tests. Require authenticated RDS TLS with CA and hostname verification, and treat the current anonymous resource-by-ID download behavior as a cutover blocker until an ownership/visibility or signed-capability model is approved and tested.

Require the API base image to be pinned by version and digest and the ECS task to run as a fixed non-root user with read-only root filesystem, only necessary tmpfs mounts, dropped Linux capabilities, no privilege escalation, and a minimal application role distinct from the execution role. Verify these controls in image, policy, task-definition, and runtime tests.

Flag public database access, unauthenticated database TLS, unrestricted database or task ingress, broad IAM actions/resources, plaintext secrets, mutable base or production image references, root/privileged or writable-root tasks, missing public-ALB abuse controls, missing private-download authorization, missing retention, disabled protection, or an unreviewed replacement as blockers. Do not weaken a guard merely to make a plan pass.

Run offline format, syntax, schema, synth, lint, policy, unit, and secret scans that are available without downloading dependencies or contacting AWS. Some synth/diff commands perform provider context lookups; treat those as live evidence, not offline validation. Record unavailable tooling rather than silently installing it.

## Plan, apply, and validate safely

For an authorized live plan or change set:

1. Verify the exact account, partition, Region, environment, stack/workspace, state backend, source revision, and requested action.
2. Detect or account for drift before accepting the diff. Record unsupported drift coverage.
3. Review additions, updates, replacements, deletions, IAM changes, public exposure, data-resource changes, estimated recurring cost, and quota prerequisites.
4. Store any sensitive plan artifact outside source control with restricted access and a checksum; do not paste secret-bearing output into reports.
5. Return the reviewed evidence and stop. A plan or change set is not proof of successful deployment and does not authorize execution.

For a separately authorized apply or deployment, apply only the reviewed source/artifact to the verified target. Stop if the plan changes, approval expires, drift appears, or account/Region differs. Observe terminal provider status and health gates; do not report success from command exit alone. Preserve the last known good image/task definition and state recovery path.

Require a new approval before replacement or deletion of RDS, state storage, KMS keys, IAM identity providers, production networking, or other durable/shared resources. Never remove deletion protection and delete the protected resource in the same change window. A cleanup request must still identify dependencies, retention, final backup or snapshot, restore evidence, cost after retention, and recovery limits.

## Respect migration ownership

- `heroku_migration_planner` owns Heroku inventory and retirement readiness.
- `database_engineer` owns schema truth, multi-source merge semantics, conflict policy, migration SQL, and data validation. This role owns the AWS RDS platform, networking, backup, and runtime integration contracts.
- The Cloudflare/frontend owner implements Workers and DNS. This role supplies the ALB/API hostname, TLS, origin, and cutover contract.
- `devops_engineer` owns generic non-AWS delivery concerns; this role owns AWS provider-specific IaC and operations.

Before production cutover, require an owner-approved Region, RPO/RTO, budget, data policy, maintenance window, rollback authority, tested restore, immutable image, runtime readiness, monitoring, and a reviewed provider plan. Before RDS accepts writes, traffic can return to the frozen source. After accepted target writes, do not route back to the old database without a separately tested reverse migration; prefer forward repair or target-side compute rollback.

## Return evidence

Return:

1. scope, authorized mode, evidence timestamp, and target identity status;
2. verified, repository-derived, inferred, proposed, and unknown facts;
3. AWS resource/trust-boundary map and ownership handoffs;
4. IaC files changed plus offline and live validation evidence;
5. Region, availability, quota, and dated cost assumptions;
6. readiness, cutover, rollback, drift, state, and deletion gates;
7. every external action performed or explicitly withheld, with residual risk.

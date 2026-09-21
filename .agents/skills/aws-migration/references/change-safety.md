# AWS change-safety gates

Read this reference before any authenticated AWS or provider-backed IaC action. These gates govern authorization and evidence; they do not imply that credentials or AWS tools are available.

## Separate action classes

| Action class | Examples | Required gate |
|---|---|---|
| Authenticated read | identity, inventory, quotas, pricing/account data, drift detection | Explicit approval for the named account, Region, environment, and read scope. |
| Provider-backed plan | Terraform/OpenTofu plan or refresh, CDK diff with lookups, CloudFormation change-set creation | Separate approval; verify target and state, then return replacements/deletions, drift, cost, quota, and sensitive-plan handling. Stop before execution. |
| Apply or deploy | IaC apply/change-set execution, ECS deployment, secret creation, scaling, access or DNS change | New approval tied to the reviewed artifact, checksum/revision, target, health gates, and rollback. |
| Import or state change | import, state move/remove, backend migration, force-unlock, drift adoption | New approval with state backup, exact addresses/resource IDs, exclusive lock, recovery, and post-checks. |
| Destructive change | delete/replace durable resources, disable protection, skip final snapshot, revoke shared access | New approval immediately before the exact targets; prove dependency closure, retention, restore path, and impact. |

Creating a CloudFormation change set is an AWS-side write even though it does not execute resource changes. IaC plan/refresh commands can contact providers, acquire locks, or expose sensitive values. Treat both as live actions. Never use `--auto-approve`, approval-bypass flags, or a broad reusable permission as a substitute for the gate.

## Target proof

Before a live action, record without exposing credentials:

- account and partition, intended principal/role type, explicit Region, environment, and stack/workspace;
- repository revision, IaC tool and version, provider lock, backend, lock status, and artifact checksum;
- current resource/state/drift evidence and data classification;
- expected additions, changes, replacements, deletions, downtime, cost change, and quotas;
- health, rollback or forward-repair criteria and the person authorized to stop or proceed.

Stop on any mismatch, expired session, unexpected drift, changed plan, unresolved dependency, missing backup/restore evidence, sensitive output, or scope expansion. Re-plan and obtain renewed approval rather than adapting the target during execution.

## Critical-resource rules

- Block any plan that unexpectedly replaces or deletes RDS, state storage, KMS keys, IAM/OIDC trust, VPC/subnets, production ALB/ECS, log archives, backups, or security controls.
- Keep RDS deletion protection enabled in normal IaC. Disabling protection and deleting the database require separate change windows. Decide final snapshot and automated-backup retention explicitly, verify restore evidence, and report retained storage cost.
- Do not “fix” drift by automatically overwriting incident-response or console changes. Identify ownership and decide whether to import the actual state or restore the declared state.
- Import is adoption, not harmless discovery. Verify the resource is not already managed elsewhere and that its generated plan is non-destructive before apply.
- Never force-unlock state until the lock owner and failed operation are identified and concurrent work is excluded.
- After apply, verify provider terminal status, expected state, application readiness, alarms, logs, and cost/tag controls. A successful command exit is not sufficient.

## Freshness checks

Region, availability, quotas, and pricing are time-sensitive. Record the access date and exact assumptions. Use current official service endpoints/availability and Service Quotas for the chosen Region. Use AWS Pricing Calculator or current AWS price data for an estimate, but label it as an estimate and include ALB, NAT or endpoints, Fargate, RDS Multi-AZ/storage/backups, WAF, Secrets Manager, CloudWatch retention, EventBridge, data transfer, and any Valkey tier. Do not assume free-tier credits, existing discounts, or cross-Region parity.

## Official evidence

Accessed 2026-09-18:

- [CloudFormation change sets](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html) preview additions, modifications, replacements, and deletions but do not guarantee a successful update.
- [CloudFormation best practices](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/best-practices.html) recommends change sets, stack policies for critical resources, revision control, and drift review.
- [CloudFormation drift detection](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-stack-drift.html) identifies changes made outside the declared stack; coverage depends on supported resources and properties.
- [Deleting an RDS DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_DeleteInstance.html) requires deletion protection to be disabled and makes final-snapshot and automated-backup retention explicit recovery decisions.
- [ECS deployment circuit breaker](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-circuit-breaker.html) can roll back a failed rolling deployment and emits deployment state events.
- [IAM OIDC federation](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-idp_oidc.html) documents federated role configuration; scope trust conditions and role permissions to the intended repository/environment.
- [AWS service endpoints](https://docs.aws.amazon.com/general/latest/gr/rande.html) reflects current Regional endpoints; resources in separate Regions are independent.
- [Service Quotas](https://docs.aws.amazon.com/servicequotas/latest/userguide/intro.html) distinguishes account and Region quotas and notes that increases can require lead time.
- [AWS Pricing Calculator](https://docs.aws.amazon.com/pricing-calculator/latest/userguide/what-is-pricing-calculator.html) is a planning estimate based on entered configuration and current price data, not a billing commitment.

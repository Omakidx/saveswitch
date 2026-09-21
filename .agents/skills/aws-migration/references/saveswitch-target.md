# Saveswitch AWS target

Use this project baseline when refining architecture or implementing AWS IaC. Revalidate it against current code, `AWS_MIGRATION_PLAN.md`, selected Region, requirements, official service documentation, and measured load. Do not silently expand it into Cloudflare implementation or database-merge ownership.

## Accepted service boundary

- Cloudflare Workers hosts the dynamic Next.js frontend; Cloudflare owns DNS.
- Initially, `api.saveswitch.xyz` is a DNS-only record targeting an AWS Application Load Balancer. ACM terminates API TLS and AWS WAF protects the ALB.
- Amazon ECR stores immutable API images. Amazon ECS on Fargate runs the existing long-lived Bun/Elysia HTTP and WebSocket API in private application subnets.
- Amazon RDS for PostgreSQL uses private database subnets and a Multi-AZ DB instance baseline.
- Start with one ECS API task. More than one task is blocked until WebSocket fanout and rate limits use shared Valkey/Redis-compatible coordination and periodic cleanup is moved to an idempotent EventBridge Scheduler-launched ECS task.
- Secrets Manager, CloudWatch logs/metrics/alarms, least-privilege IAM, tagged cost controls, and repository-owned IaC are required.

App Runner is not an alternative for a new Saveswitch account: AWS says it closed to new customers starting 2026-03-31 and now recommends ECS Express Mode for App Runner migrations. Lambda/API Gateway remains a deliberate rewrite rather than a lift-and-shift. Aurora PostgreSQL and RDS Proxy remain deferred until measured scaling, failover, or connection evidence justifies them.

## Architecture invariants

- ALB is the only public AWS application ingress. ECS tasks have no public IP; their application port accepts traffic only from the ALB security group. RDS accepts PostgreSQL only from approved application and migration paths.
- Private tasks still need controlled egress for image pulls, AWS APIs, Google OAuth, Cloudinary, and URL-preview requests. Compare NAT and VPC endpoint coverage, availability, and recurring cost in the selected Region.
- ALB supports WebSocket upgrades, but deployments and task replacement still disconnect clients. Configure draining, idle timeout, graceful termination, reconnect/resubscribe behavior, and a synthetic realtime check.
- `/health` is currently liveness only. Production readiness must include a bounded required-dependency check and drive ALB/ECS deployment gates.
- The current application does not safely trust forwarded client-IP headers. Any Cloudflare-to-ALB trusted-proxy design requires authenticated/restricted origin ingress and application tests before IP-based limits rely on it.
- Because the initial API is DNS-only and internet-facing at the ALB, cutover requires a concrete WAF policy: reviewed managed rules; route-sensitive rate controls for authentication, anonymous creation, uploads, and WebSocket handshakes; explicit request-body oversize handling; privacy-safe logs, metrics, and alarms; and real-path abuse/false-positive tests. Forwarded headers remain untrusted until a separately proven boundary exists.
- The current resource-by-ID download path does not prove ownership or parent-page visibility. Treat the production access model as a cutover blocker: require authenticated authorization or signed, expiring, revocable capabilities, validate migrated URLs/providers, and prove anonymous/cross-user denial for private resources.
- RDS TLS must authenticate the server, not merely encrypt traffic. Require the current AWS RDS CA and hostname verification (`verify-full` semantics or an equivalent `rejectUnauthorized: true` configuration); any TLS bypass must be an exact development-only choice. Test untrusted CA, wrong hostname, and plaintext endpoints fail closed.
- ECS-injected secret changes do not update running tasks. Rotation includes a controlled new deployment and session-impact validation.
- Pin the Bun build/runtime base by exact version and digest. Build once, scan, push an immutable ECR artifact, and deploy by digest. Run the task as a fixed non-root UID/GID with read-only root filesystem, only required writable tmpfs paths, dropped Linux capabilities, no privilege escalation, and a minimal application task role distinct from the execution role. CI uses scoped OIDC roles rather than long-lived AWS keys.
- RDS Multi-AZ provides high availability with a synchronous standby; it is not a read-scaling topology. Backup, point-in-time recovery, restore tests, and explicit disaster-recovery decisions remain necessary.

## Owner and readiness boundaries

The AWS role may define RDS engine/version/parameter/network/backup requirements, but `database_engineer` decides canonical schemas, Heroku-versus-Neon conflicts, merge algorithms, transformation SQL, and data acceptance. Restore each source into isolated staging before an audited merge into a clean target.

The AWS role provides the ALB hostname, certificate, origin restrictions, and cutover checks. The Cloudflare owner implements Workers compatibility, DNS, proxy mode, and frontend build variables.

Still require owner decisions for Region, partition, RPO/RTO, cost ceiling, maintenance window, data authority, retention, Cloudinary scope, freeze-versus-CDC, and rollback authority. Recheck service availability, quotas, instance/runtime support, and prices in that exact Region immediately before plan approval.

## Official evidence

Accessed 2026-09-18:

- [AWS App Runner `CreateService`](https://docs.aws.amazon.com/apprunner/latest/api/API_CreateService.html) states that App Runner closes to new customers starting 2026-03-31; the [availability-change guide](https://docs.aws.amazon.com/apprunner/latest/dg/apprunner-availability-change.html) recommends ECS Express Mode to existing App Runner customers.
- [Fargate task networking](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-networking.html) documents per-task ENIs, private-subnet egress choices, task/execution-role traffic, and `ip` target groups for load-balanced Fargate tasks.
- [ALB listeners](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html) documents native WebSocket upgrades and HTTPS certificate requirements.
- [RDS Multi-AZ DB instances](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html) documents the synchronous standby and explains that it does not serve read traffic.
- [ECS Secrets Manager injection](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html) states that rotated values require a new task or forced service deployment.
- [EventBridge Scheduler for ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/tasks-scheduled-eventbridge-scheduler.html) documents scheduled ECS task execution.

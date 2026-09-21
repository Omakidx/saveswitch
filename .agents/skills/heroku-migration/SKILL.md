---
name: heroku-migration
description: Audit Heroku source apps with authenticated read-only inventory, map migration dependencies and readiness, and prepare cutover, rollback, and retirement plans. Use when moving workloads off Heroku; do not use to operate Heroku or design the target cloud.
---

# Heroku Migration

Produce a source-of-truth assessment for leaving Heroku without changing live state. A request to “migrate,” “cut over,” or “retire” authorizes planning only. Route target-cloud architecture and implementation to the relevant architecture, database, or deployment owner.

## Keep the session read-only

Prefer the authenticated Heroku operations connector when it is available. Establish authentication only if uncertain, resolve exact app names, then limit live calls to authentication status, app listing and details, dyno formation, releases, and add-ons. Do not retrieve logs or config vars, even for troubleshooting, and do not repeat account identities returned incidentally by a tool.

Never deploy, restart or scale dynos, toggle maintenance, change domains, run one-off commands, capture or download a database backup, detach or destroy an add-on, delete an app, or install a plugin. Treat a later request for any mutation as a separate, target-specific authorization and hand it to an operational role; this workflow remains read-only.

If the connector is unavailable or lacks a needed read operation, identify the missing evidence. Do not substitute `heroku config`, connection strings, dashboard scraping, secret files, or undocumented commands.

## Build the evidence set

For each in-scope app, record the observation time and source, then capture only what the available read tools support:

- app name, region, stack or container deploy type, and current state;
- dyno process types, quantities, and sizes;
- recent release identifiers and timestamps needed to establish activity, without exposing actor identities;
- add-on service, plan, attachment relationship, and provisioning state;
- repository deployment contracts, including Dockerfiles, `heroku.yml`, Procfiles, start or release commands, worker and scheduler entrypoints, health checks, and environment-variable *names* referenced by source.

Do not open `.env` files, credential stores, downloaded backups, or files likely to contain secret values. Repository evidence proves an implementation contract, not production configuration. Label every item as **observed**, **repository-derived**, **inferred**, or **unknown**.

Map dependencies across apps before proposing retirement. Include HTTP callers, workers, schedulers, databases and other add-ons, shared attachments, custom domains or callback URLs when evidence is available, release-phase tasks, and any client or external integration that still references a Heroku endpoint. Never assume that an app with no dynos or add-ons is safe to delete.

## Decide readiness and handoffs

Convert the evidence into explicit gates instead of selecting target services:

1. **Runtime parity:** every process type, release task, health signal, and scaling assumption has a target owner and validation method.
2. **Configuration parity:** required variable names and external dependencies are mapped; values remain in approved secret stores and outside this report.
3. **Data readiness:** each database or stateful add-on has an owner, migration method, consistency window, restore test, and rollback source. Do not create or handle backup artifacts in this workflow.
4. **Traffic readiness:** DNS, TLS, custom domains, callback URLs, and cache behavior have owners plus before/after checks.
5. **Operational parity:** monitoring, alerts, jobs, logs, retention, and incident rollback are accepted on the target.

Assign AWS or other target architecture to the architect or provider specialist, database transfer and merge design to the database specialist, deployment execution to the deployment owner, and security-sensitive gaps to the security reviewer. Express source-side constraints and required evidence clearly enough for those owners to act without re-inventorying Heroku.

## Plan cutover, rollback, and retirement

Write the plan as a sequence of checkpoints with an owner, prerequisite evidence, go/no-go test, rollback trigger, and verification result. Keep all live commands out of the plan unless the user explicitly asks for a separately reviewed runbook; name the intended action and impact instead.

Retirement must be delayed until the rollback window closes and all consumers are verified on the target. The safe dependency order is: preserve and restore-test required data; prove target runtime and traffic; quiesce source writers in an approved change window; verify target behavior and data consistency; observe the agreed rollback window; confirm no Heroku endpoint or shared add-on remains in use; then separately authorize workload scale-down, add-on removal, and permanent app deletion. Each state-changing step remains marked **proposed—not performed**.

When Postgres export, cutover quiescence, or permanent retirement is in scope, read [Heroku source-retirement evidence](references/source-retirement.md). Recheck the linked official documentation when network access is available because platform behavior and retention policies can change.

## Return the assessment

Return:

1. scope, evidence timestamp, and unavailable evidence;
2. redacted app/workload/add-on inventory;
3. dependency map and shared-resource hazards;
4. readiness matrix with owner, status, evidence, and gap;
5. cutover and rollback gates;
6. retirement sequence with mutations explicitly gated and unperformed;
7. handoffs and unresolved risks.

For Saveswitch, treat any supplied inventory as a starting observation and revalidate it only through allowed read operations. Do not hard-code current app names, plans, or formation into this reusable workflow.

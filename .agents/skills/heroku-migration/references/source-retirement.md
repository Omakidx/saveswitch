# Heroku source-retirement evidence

Use these notes only for migration-method and retirement decisions. They summarize official Heroku guidance accessed on 2026-09-18; recheck the linked page before a live migration because product limits and retention behavior can change.

## PostgreSQL export

- [Importing and Exporting Heroku Postgres Databases](https://devcenter.heroku.com/articles/heroku-postgres-import-export) (updated 2026-01-13) says PGBackups exports use PostgreSQL custom-format `pg_dump` archives and describes capture/download for transfer to external PostgreSQL. It characterizes PGBackups as suitable for moderately loaded databases up to 20 GB.
- [Heroku Postgres Logical Backups](https://devcenter.heroku.com/articles/heroku-postgres-logical-backups) (updated 2026-01-28) warns that logical backups consume database resources and recommends a short-lived fork for databases over 20 GB. It also notes that PGBackups storage is in the United States.
- [Heroku PGBackups](https://devcenter.heroku.com/articles/heroku-postgres-backups) (updated 2026-09-16) states that backups for a deprovisioned database are deleted after a short grace period and must be downloaded to external storage if they must be retained.

Planning implication: identify database size, load, extensions, version compatibility, recovery-point objective, transfer location, checksum, restore test, and retention owner before selecting an export method. Backup capture and download are live/data-bearing operations and are outside this read-only workflow.

## Cutover quiescence

- [Maintenance Mode](https://devcenter.heroku.com/articles/maintenance-mode) says maintenance mode blocks incoming web requests but does not stop dynos or billing. Workers also continue to run. Heroku suggests scaling relevant dynos to zero during maintenance when transactions must stop.

Planning implication: maintenance alone does not create a database write freeze. Inventory every web, worker, scheduler, release-phase, and external writer, then assign explicit quiescence and rollback checks. Enabling maintenance or scaling is a state change that requires separate authorization.

## Permanent retirement

- [Heroku App Lifecycle](https://devcenter.heroku.com/articles/heroku-application-lifecycle) (updated 2025-09-17) describes decommissioning as scaling down, removing add-ons, and deleting the app. It states that app deletion is permanent and removes associated configuration, code, builds, releases, and data.
- [Managing Add-ons](https://devcenter.heroku.com/articles/managing-add-ons) describes add-on destruction as permanent resource removal. Shared attachments must be mapped before retirement.

Planning implication: close the rollback window, preserve required evidence and data outside Heroku, prove that no consumer or shared attachment remains, and obtain separate target-specific authorization before each destructive step. Never present app or add-on deletion as reversible.

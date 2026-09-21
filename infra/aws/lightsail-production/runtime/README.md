# Saveswitch Lightsail runtime bundle

This offline bundle is for the existing `nano_3_0` Ubuntu 24.04 host. It
co-locates PostgreSQL 18 and the Bun API on the attached database disk. The API
is published only as `127.0.0.1:5000`; the separately installed Cloudflare
Tunnel is outbound-only. Cloudinary remains the application media/object
provider—this bundle creates no S3 media store.

It is not a deployment script. Starting containers, generating TLS keys,
installing Docker/cloudflared, restoring data, and changing Cloudflare traffic
all require separate live authorization. Do not use this bundle until the
reviewed database-disk gate completed and `/srv/saveswitch/postgres` is mounted.

## Capacity and network limits

The host has 512 MiB RAM and 512 MiB swap. PostgreSQL is capped at 256 MiB,
the API at 128 MiB, and the cleanup job at 96 MiB. Docker, Cloudflared, Ubuntu,
page cache, and temporary spikes need the remainder. This is a single-user
target: cutover is blocked by OOM kills, sustained swap pressure, or failed
`/ready` checks during the production-shaped restore/load test.

PostgreSQL has no host port. Docker maps the API only to host loopback. Keep
the Lightsail and UFW firewalls closed to 80, 443, 5000, and 5432. A remotely
managed Cloudflare Tunnel uses **only** its token from the systemd credential
`cloudflared-token`; its
Cloudflare configuration must route `api.saveswitch.xyz` to
`http://127.0.0.1:5000` and end its ingress rules with a catch-all reject
rule (for example the remotely managed equivalent of `http_status:404`). Never
point public DNS to the Lightsail dynamic public IPv4.

## Files and secret contracts

Install this directory at `/opt/saveswitch/runtime` as `root:root`, mode `0750`.
Create `/etc/saveswitch/runtime` as `root:root`, mode `0700`, then make these
copies outside the repository:

| Host path | Owner/mode | Purpose |
| --- | --- | --- |
| `runtime.env` | `root:root 0600` | verified immutable image digests and paths |
| `api.env` | `root:root 0600` | API, OAuth, JWT, DB/TLS CA, Cloudinary values |
| `postgres-password` | `root:root 0600` | one PostgreSQL password, no trailing newline |
| `cloudflared-token` | `root:root 0600` | tunnel token consumed through systemd `LoadCredential` and `--token-file` |
| `cloudinary-backup/{cloud-name,api-key,api-secret,encryption-passphrase}` | directory `0700`, files `root:root 0600` | dedicated backup upload values and an independent high-entropy encryption passphrase |
| `postgres-server.crt` | `root:root 0644` | local PostgreSQL certificate |
| `postgres-server.key` | `root:999 0640` | key readable only by official PostgreSQL image UID 999 |

`api.env` is an env-file, not a shell script. `DATABASE_URL` must use the
least-privilege `saveswitch_app` role and Docker service host `postgres`, never
Neon or a public address. `TRUSTED_PROXY_PEERS` must remain the exact dedicated
bridge gateway `172.30.250.1`; before creating the network, prove
`172.30.250.0/24` does not overlap any existing host route or Docker network.
After start, verify that a loopback request arriving through Docker is observed
by the API as that exact peer before enabling public traffic. Production code
requires `DATABASE_SSL_CA`, so generate a local CA plus a server certificate
with `DNS:postgres`; put the public CA in `api.env` as a single-quoted
multiline PEM. Keep the CA private key outside the repository. Generate the
database password and JWT secret independently. Use an unpadded base64url DB
password so its URL form is unambiguous. Neon is a read-only migration source
and must receive no writes.

## Immutable prerequisites

`runtime.env` requires immutable API and PostgreSQL image digests. Build the
existing [server Dockerfile](../../../../server/Dockerfile) separately, choose
its ECR **digest** (not tag), and use a verified official
`postgres:18.0-bookworm` manifest digest. There is no `latest` fallback.

Install a supported Docker Engine and Compose plugin only from reviewed,
version-pinned packages with recorded SHA-256s. This bundle performs no package
installation. At deployment, select a currently supported Cloudflare
`cloudflared` release from Cloudflare's official release channel, record its
exact version and verify its downloaded package SHA-256 before installation,
put it at `/usr/local/bin/cloudflared`, and create an unprivileged
`cloudflared` user. The supplied unit uses `--no-autoupdate`: it has no
`latest` or automatic-upgrade fallback, so each future upgrade is a reviewed
change.

## Stage and validate (operator runbook)

The following are future deployment commands—not instructions to run now:

```sh
install -d -o root -g root -m 0750 /opt/saveswitch/runtime
install -d -o root -g root -m 0700 /etc/saveswitch/runtime
install -d -o root -g root -m 0700 /srv/saveswitch/postgres/backups
install -d -o root -g root -m 0750 /usr/local/libexec/saveswitch
install -m 0700 backup-postgres.sh /usr/local/libexec/saveswitch/backup-postgres
install -m 0700 upload-postgres-backup-cloudinary.sh /usr/local/libexec/saveswitch/upload-postgres-backup
install -m 0644 saveswitch-compose.service /etc/systemd/system/
install -m 0644 saveswitch-cleanup.service saveswitch-cleanup.timer /etc/systemd/system/
install -m 0644 saveswitch-backup.service saveswitch-backup.timer /etc/systemd/system/
install -m 0644 cloudflared.service /etc/systemd/system/
systemctl daemon-reload
./validate-runtime.sh
docker compose --env-file /etc/saveswitch/runtime/runtime.env config --quiet
```

Before a first start, verify secret ownership/modes, digest values, mounted
database path, certificate ownership, and that the API image passed its build
and tests. Restore and merge source data first using the separate migration
workflow; this compose file deliberately does not auto-run migrations or data
imports.

## Start, check, and cut over

After separately approved production data is ready:

```sh
systemctl enable --now saveswitch-compose.service
curl --fail --silent --show-error http://127.0.0.1:5000/health
curl --fail --silent --show-error http://127.0.0.1:5000/ready
docker compose --env-file /etc/saveswitch/runtime/runtime.env ps
docker compose --env-file /etc/saveswitch/runtime/runtime.env logs --tail 100 postgres api
ss -ltnp | rg ':(5000|5432)'
```

Expected listeners: `127.0.0.1:5000`, no `0.0.0.0:5000`, no `[::]:5000`, and
no host 5432 listener. Prove the backend accepts `CF-Connecting-IP` only from
the local tunnel and rejects direct-loopback spoofed forwarded headers before
cutover. Then enable the tunnel and validate it is connected:

```sh
systemctl enable --now cloudflared.service
systemctl status --no-pager cloudflared.service
```

Only then enable the Cloudflare public hostname and verify HTTPS `/health`,
`/ready`, OAuth, Cloudinary operations, and a real user flow.

## Logs, jobs, backups, rollback

Container logs use Docker's bounded local driver (three 5 MiB files per
service). Never log environment files. Enable cleanup only after the API is
healthy:

```sh
systemctl enable --now saveswitch-cleanup.timer
systemctl list-timers saveswitch-cleanup.timer
```

The backup job makes a custom dump, verifies it with `pg_restore --list`, then
uses the fixed root-owned `/usr/local/libexec/saveswitch/upload-postgres-backup`
hook. The hook encrypts with a dedicated high-entropy passphrase, uploads the
opaque file as a Cloudinary `raw` asset under `saveswitch/database-backups`,
downloads it, decrypts it, and compares both encrypted and plaintext SHA-256
values before writing a local manifest. It refuses dumps over 90 MiB so a
future larger database cannot silently exceed the direct Upload API contract.
The Cloudinary API secret and backup passphrase remain in separate root-only
files and are never command arguments. A dump only on the attached disk is not
a backup. Enable the timer only after a clean-host restore drill from the
Cloudinary asset succeeds:

```sh
systemctl enable --now saveswitch-backup.timer
systemctl list-timers saveswitch-backup.timer
```

For application rollback, first withdraw public traffic with
`systemctl stop cloudflared.service`, replace only `SAVESWITCH_API_IMAGE` with
a previously healthy digest, validate Compose, and restart
`saveswitch-compose.service`. Recheck local health before restoring the
tunnel. Never use `docker compose down -v`, prune volumes, remove the mounted
database path, or delete Heroku/Neon sources. Database rollback needs a
separately authorized restore from a verified logical backup.

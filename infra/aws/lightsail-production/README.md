# Saveswitch low-cost AWS production root

This is the mutually exclusive Terraform root for the owner-approved,
single-instance Lightsail architecture. It is the repository declaration for a
partially created live graph; repository changes alone do not change AWS.
Nothing in this directory authorizes an AWS, Cloudflare, database, secret,
image, state, or deployment operation.

## Hard ownership boundary

This root proposes the new remote-state key
`lightsail-production/core.tfstate`. It must never reuse, migrate, import, or
operate on the abandoned `production/core.tfstate` graph. The separate
`bootstrap/shared.tfstate` state continues to own the encrypted Terraform
state bucket and KMS key. The separate `certificate/production.tfstate` state
continues to own the issued ACM certificate; this design neither references
nor destroys it.

Terraform in this root owns only:

- one imported-public-key Lightsail key pair;
- one IPv4 Lightsail instance in one explicit Availability Zone;
- one service-encrypted 16 GiB Lightsail block disk and its attachment;
- one Lightsail firewall rule: TCP 22 from explicit operator IPv4 `/32`s;
- one immutable, scan-on-push ECR repository and its lifecycle policy; and
- one account-wide USD 25 monthly AWS Budget with alert notifications.

It intentionally owns no VPC, subnet, NAT gateway, VPC endpoint, ALB, ACM,
WAF, ECS, RDS, Secrets Manager, application KMS key, CloudWatch log group,
EventBridge resource, static IP, Route 53 record, or application/media S3
bucket. The S3 bucket named in `backend.hcl.example` is Terraform state only.
Cloudinary remains Saveswitch's application object-storage provider; this root
does not replace it with S3.

Do not initialize, plan, or apply the old `infra/aws/production/` root as part
of this architecture. A plan from one root is not evidence for the other.

## Current applied-foundation boundary

After reconciling the partial provider failure and completing the separately
reviewed follow-up plans on **2026-09-21**, the remote
`lightsail-production/core.tfstate` manages exactly these eight addresses:

- `aws_budgets_budget.account_monthly`;
- `aws_ecr_repository.api`;
- `aws_ecr_lifecycle_policy.api`;
- `aws_lightsail_disk.postgres`; and
- `aws_lightsail_disk_attachment.postgres`;
- `aws_lightsail_instance.production`;
- `aws_lightsail_instance_public_ports.ssh_break_glass`; and
- `aws_lightsail_key_pair.operator`.

Every previously saved plan is permanently stale and must never be reused.
Repository changes in this remediation have not been initialized, planned, or
applied to that state.

## Accepted availability and recovery trade-off

The owner accepted a single instance and single Availability Zone, with the
API and PostgreSQL sharing CPU and memory. There is no automatic database
failover. Maintenance, instance recovery, disk recovery, and restore exercises
can cause downtime. The initial objectives are approximately 24-hour RPO and
four-hour RTO, but they are not proven guarantees until a production-shaped
backup and restore drill meets them.

The target account currently permits only the smallest Lightsail plan. The
reviewed `nano_3_0` candidate has 0.5 GiB RAM, 2 vCPUs, and a 20 GiB system
disk. It is a constrained single-user stopgap, not a capacity claim. Before
cutover, a production-shaped load test must prove the operating system,
PostgreSQL, API, and Cloudflare Tunnel remain healthy without OOM kills or
sustained swap pressure. If they do not, stop: wait for a bundle-quota increase
or redesign the runtime instead of accepting an unstable production service.

The automatic instance snapshot is scheduled for `04:00` UTC by default,
after the proposed daily database-aware dump window. AWS documentation says an
instance snapshot includes attached block disks. That statement is not restore
evidence: cutover remains blocked until a live drill restores both the instance
and disk, restores the logical PostgreSQL custom-format dump into a clean
database, validates the accepted data checks, and records measured RPO/RTO.
A dump left only on the attached database disk is not an acceptable backup.
The approved operations workflow must prove the later snapshot/off-instance
copy exists and is restorable before pruning earlier recovery points.

`prevent_destroy` protects the instance, disk and attachment, key pair,
declarative public-port resource, ECR repository and lifecycle policy, and
account budget from an ordinary Terraform destroy plan. It is not an AWS
deletion lock and does not authorize retaining or deleting anything. Any
replacement, state operation, image-retention change, firewall resource
removal, budget removal, or deletion requires a separate recovery decision and
approval.

## Network and trust boundary

The Lightsail service firewall and host UFW baseline permit only TCP 22 from
the exact `admin_ipv4_cidrs` `/32` values. They do not open 80, 443, the API
port, or PostgreSQL. The instance still receives an ordinary dynamic public
IPv4 address, but there is deliberately no static-IP resource.

Cloudflare Tunnel will later make `api.saveswitch.xyz` reachable using an
outbound-only connection. Cloudflare owns DNS and frontend hosting. Tunnel and
DNS configuration are separate Cloudflare work; neither is represented in
this state. Cloudflare Access SSH is the intended normal administration path
after it is separately implemented and tested. The direct `/32` SSH rule is a
break-glass path and must be narrowed or rotated when the operator's address
changes.

Cloudflare Tunnel also changes the client-IP trust boundary. The current API
uses the accepted socket peer for its in-process limiter; through local
`cloudflared`, unrelated clients may otherwise collapse to the loopback peer.
Before cutover, the backend must accept a canonical `CF-Connecting-IP` only
when the socket peer is loopback and every public origin/API port is closed. It
must reject malformed or spoofed forwarded addresses and continue to distrust
arbitrary `X-Forwarded-For`. Prove this with direct-local spoof tests and the
real tunnel, and separately configure Cloudflare edge rate/abuse controls.
Until those checks pass, API cutover is blocked.

The non-secret Lightsail shell user-data template:

- disables root, password, keyboard-interactive, and challenge-response SSH;
- disables SSH forwarding and enables public-key authentication;
- default-denies incoming UFW traffic and adds only the reviewed `/32` SSH
  rules while retaining loopback and outbound traffic;
- enables Ubuntu's periodic unattended-security-upgrade configuration without
  installing an unpinned package; and
- creates root-owned contract directories and a bootstrap-status marker.

First-boot user data deliberately does **not** format or mount the attached disk, install
the application/runtime/Cloudflare agent, configure a tunnel, create a local
CA, generate credentials, deploy an image, initialize PostgreSQL, restore data,
or start the API. It fails closed if the selected Ubuntu image does not already
provide UFW. Package and container versions must be selected and pinned in the
later deployment runbook rather than silently installing the latest release.

### Bootstrap defect and existing-instance remediation

The initial instance received a `#cloud-config` document, but Lightsail wrapped
the supplied payload in its own `/bin/sh` program. The resulting cloud-final
script attempted to execute YAML as shell and failed. The replacement
`templates/bootstrap-user-data.sh.tftpl` is intentionally POSIX-sh-shaped,
contains no shebang dependency, performs no network/package/disk/swap/runtime
work, pins and exports `/usr/sbin:/usr/bin:/sbin:/bin` before resolving any
external command, and creates its completion contract only after all baseline
checks pass. Existing managed file targets must be regular files, so a
directory or symlink cannot turn `install` into an unintended copy.

Changing `user_data` for the already-managed Lightsail resource may require replacement of the managed instance.
That Terraform change must not be used as live remediation for the existing
host. `prevent_destroy` remains in place;
stop any plan that proposes replacement or deletion. The new user data is the
first-boot contract for a separately approved future creation or replacement.

The existing instance has a separate reviewed script at
`scripts/remediate-existing-instance.sh`. Its no-argument and `help` modes only
show usage, while `check` is read-only and explicitly reports evidence as
inaccessible when it is not run with sufficient read privilege. Do not copy or execute it on the host
without a separate live-host authorization tied to its checksum. It accepts
exactly one mutation gate per invocation:

1. `protected-directories` invalidates the untrustworthy marker from the failed
   bootstrap and establishes root-owned mode-0700 paths and marker storage.
2. `ssh-hardening` installs the lexically first `00-` drop-in, validates the
   candidate and full SSH configuration after safely establishing Ubuntu's
   volatile root-owned `/run/sshd` directory, and reloads only an active
   `ssh.service`; an active Ubuntu 24.04 `ssh.socket` needs no forced restart.
3. `unattended-upgrades` configures the existing Ubuntu tools and enables their
   timers without installing or fetching packages.
4. `ufw` requires the exact reviewed `/32` set, confirms the current direct SSH
   source is in that set, and requires the literal reset confirmation token.
   Before reset it installs a POSIX exit/signal recovery trap. A command error
   or caught HUP, INT, or TERM reconstructs and enables the minimal
   default-deny, loopback, reviewed-SSH ruleset. Success also requires exact
   live verification and a root-only persisted CIDR contract before the
   recovery trap is cleared. UFW may display a single-host rule as either
   `A.B.C.D/32` or canonical `A.B.C.D`; verification normalizes only that
   display difference while preserving the persisted `/32` contract. It parses
   complete UFW columns and rejects every known `ALLOW` or `LIMIT` inbound or
   forwarded permission except an exact loopback `ALLOW IN` row or one exact
   `22/tcp ALLOW IN` rule per reviewed host. A near-match host, different
   port/protocol, broader/IPv6 source, `LIMIT IN`, `ALLOW FWD`, `LIMIT FWD`, or
   extra non-loopback permission is rejected rather than accepted through
   substring matching. The parser intentionally fails closed for the current
   UFW status grammar; a materially changed future UFW output format requires
   a new offline review before a live retry. SIGKILL, power loss, or persistent
   UFW failure still require the independent Lightsail edge firewall and an
   immediate post-check.
5. `swap` is independent and requires `/swapfile`, an exact 256 or 512 MiB
   size, sufficient disk headroom, and its literal confirmation token. It
   rejects every other active swap and every dormant fstab swap row whose
   source is not `/swapfile`.
6. `database-disk` is independent and requires a caller-supplied stable
   `/dev/disk/by-id/` or `/dev/disk/by-path/` symlink, exact 16 GiB byte size,
   and its literal format confirmation. It rejects the root disk, partitions,
   child devices, holders, active swap, mounts elsewhere, read-only media,
   unexpected signatures, non-ext4 existing filesystems, and ambiguous fstab
   entries. Disk probes are fail-closed: an empty `blkid -p` status-2
   no-identifier/inconclusive outcome is never enough by itself; successful
   empty `findmnt`, `lsblk` partition-table and mountpoint, and `wipefs`
   probes must corroborate blankness or no-mount state. A successful but empty
   `blkid` result, nonempty status-2 result, or any probe error is rejected.
   Immediately
   before `mkfs.ext4`, the script re-resolves the stable link and requires the
   exact same canonical device, major:minor identity, whole-disk type, byte
   size, writable state, root separation, empty child/holder graph, no swap,
   mounts, partition table, signatures, filesystem metadata, or fstab
   reference. Active fstab rows are captured before parsing; alternate
   `/dev` aliases, targets, labels, and filesystem UUID sources are first
   canonicalized using the same double-quote and `\NNN` octal field semantics
   accepted by util-linux. Encoded separators, UUID hyphens, reserved labels,
   or whole-field quoting therefore cannot evade comparison; undecodable
   fields fail closed. Absolute targets are additionally resolved with a
   guarded non-mutating canonicalizer, so trailing/doubled separators, dot
   segments, or existing symlink components cannot create an alias of the
   reviewed mountpoint; resolver errors fail closed. Canonical `/dev` and UUID sources are resolved to
   major:minor identity, and every path—including an empty fstab—requires the
   UUID to resolve to exactly one device before fstab or mount mutation. The
   ext4-safe `LABEL=saveswitch-postg` source and legacy overlength-intent
   spelling `LABEL=saveswitch-postgres` are always treated as related
   and conflicting, so it cannot coexist at another target with a second
   managed UUID row. Raw rows are retained for exact expected-row acceptance.
   Before first format it atomically journals the exact stable path,
   resolved device, byte size, block major:minor, label, and a kernel-generated
   fixed filesystem UUID outside the disk, then passes that UUID to
   `mkfs.ext4 -U`. A retry may continue only when every journal identity and
   the observed blank or labeled ext4 state match exactly. The journal remains
   until fstab, mount, options, root-only volume marker, and final verification
   all succeed. An interrupted-format recovery uses the dedicated
   `RECOVER-INTENT-MATCHED-SAVESWITCH-DATABASE-DISK` confirmation, which
   refuses every state except the exact journal/UUID-bound ext4 recovery path
   and therefore cannot reach `mkfs`. It persists and verifies the filesystem
   by UUID only. A repeat run
   accepts an existing ext4 filesystem only when its exact
   `saveswitch-postg` label and root-owned UUID-bound volume marker match;
   an arbitrary pre-existing ext4 filesystem is rejected. An already occupied
   target is verified against the canonical source, major:minor identity, and
   unique UUID before fstab changes or any ownership, mode, or marker-content
   mutation can touch that mounted filesystem. An absent mountpoint is created
   with fail-if-present `mkdir`, rather than an operation that could chmod or
   chown a concurrently mounted root. After a new mount, the same identity
   proof runs before root ownership, mode, marker, or completion evidence is
   written; a same-UUID clone is rejected.

Run the four baseline gates in order. Review and authorize swap and database
disk operations independently; neither is implied by baseline remediation.
After each gate, run `check` and a separate read-only host preflight before
authorizing the next gate. A completion marker is evidence only for the exact
reviewed script checksum and a successful post-check—it is not proof by itself.
Before the database-disk gate and until its final post-check succeeds, serialize
all AWS/Lightsail disk detach, attach, snapshot-restore, and resize operations;
do not allow a concurrent operator or automation to alter the disk graph during
the final identity recheck and format window. The recheck fails closed on a
changed graph, but serialization remains required to minimize hotplug races.
Every gate removes its own prior marker and the aggregate contract immediately
before its first mutation. Markers are accepted only with exact content,
root ownership, mode 0600, no symlink, and matching current configuration.
Aggregate success is rebuilt only after the managed SSH file and effective
settings, timers, exact UFW CIDRs/state, protected directories, and any
completed swap/database state all revalidate.

Every fstab change is built in a same-directory candidate with an unconditional
newline separator, checked using `findmnt --verify --tab-file`, and atomically
renamed only after validation. Empty fstab, missing-final-newline, malformed,
duplicate, and conflicting source/target cases are covered by offline fixtures;
the original remains untouched when candidate validation fails.

Repository review sequence:

```text
sh -n infra/aws/lightsail-production/scripts/remediate-existing-instance.sh
dash -n infra/aws/lightsail-production/scripts/remediate-existing-instance.sh
infra/aws/lightsail-production/tests/validate-bootstrap.sh
infra/aws/lightsail-production/validate-static.sh
cd infra/aws/lightsail-production && sha256sum -c remediation-artifacts.sha256
sha256sum \
  infra/aws/lightsail-production/templates/bootstrap-user-data.sh.tftpl \
  infra/aws/lightsail-production/scripts/remediate-existing-instance.sh
```

These commands are offline review only. They do not authorize transfer,
execution, Terraform planning/application, host changes, disk formatting,
mounting, service activation, package work, or deployment. Before any future
Terraform plan, reconcile the eight live addresses and stop if the user-data
change produces an instance replacement.

## Secret and runtime boundary

The following must never enter Terraform variables, source, user data,
outputs, plan files, or state:

- Cloudflare Tunnel credentials;
- the local TLS certificate-authority private key;
- database passwords or connection URLs;
- JWT and Google OAuth credentials;
- Cloudinary credentials;
- SSH private keys; and
- Heroku/Neon exports, rows, or connection details.

Automatic snapshots may contain the host filesystem, attached database disk,
root-only runtime credentials, tunnel credentials, and PostgreSQL server-key
material. Treat snapshot creation, restore, export, copy, and Lightsail
instance-access capabilities as secret access. They belong to a separately
reviewed incident/recovery identity, not the normal Terraform or deployment
identity. Before live IAM work, prove the exact Lightsail API surface and deny
unneeded snapshot sharing/copy/export and instance-access actions.

The supplied SSH value is a public key only. The budget email is operational
configuration, not an application credential, but it is still supplied through
an ignored local variable file rather than committed for a real person.

The later runtime deployment must meet all of these gates:

1. Identify the attached disk by the reviewed device mapping, format it once,
   mount it by filesystem UUID, set restrictive ownership, and prove reboot
   persistence. Never infer that the unformatted Terraform device path is the
   final Linux path without checking the running host.
2. Run PostgreSQL 18 as a pinned immutable container on a private container
   network. Do not publish port 5432 to any host interface. Configure host swap
   before starting the application stack, then tightly bound PostgreSQL memory,
   connections, logs, and disk growth for the 0.5 GiB host. Prove the complete
   runtime stays within memory and does not enter sustained swap thrashing.
3. Generate the PostgreSQL server certificate outside Terraform. Keep the CA
   private key off the instance; deliver only the CA certificate and required
   server certificate/key with root-only permissions. The API must authenticate
   the hostname and CA (`verify-full` semantics or equivalent). Prove
   plaintext, wrong-hostname, and untrusted-CA connections fail closed.
4. Run the API as a fixed unprivileged user from a pinned, accepted ECR digest.
   Publish it only on loopback for Cloudflare Tunnel, with resource caps and a
   readiness check. No API or database listener may bind publicly.
5. Deliver runtime credentials through a separately approved root-only channel.
   The host must not retain long-lived AWS credentials. Transfer/load the
   accepted image digest through the administration channel, or use a scoped
   one-time registry login and then log out and remove its credential material.
6. Run a daily custom-format logical dump before the automatic snapshot.
   Encrypt and verify the dump, complete the snapshot/off-instance recovery
   step, retain checksums and aggregate-only validation evidence, and alert on
   any missed stage. A same-disk dump alone is insufficient.
7. Complete a clean-host and clean-database restore drill before accepting
   writes. The database owner retains authority over Heroku/Neon merge rules,
   canonical migrations, validation, write cutover, and rollback.
8. Install and authenticate Cloudflare Tunnel only in its separately approved
   workflow, then prove the public hostname reaches loopback API readiness while
   direct origin ports remain unreachable.

## ECR release contract

The repository uses immutable tags, scan-on-push, and AWS-managed AES-256
encryption. Untagged images expire after seven days. At most the five newest
`release-*` images are retained for rollback. Builds, scans, pushes, digest
acceptance, host transfer/login, and deployments are outside this root.

An immutable tag is not sufficient provenance. Before deployment, record the
source revision, build inputs, architecture, SBOM, vulnerability decision,
image digest, and runtime test result. Deploy and roll back by the accepted
digest, not by a mutable name.

## Budget and dated cost assumption

The cost assumption was reviewed on **2026-09-21** and must be refreshed in the
target Region immediately before plan approval.

| Assumption | Estimated monthly AWS cost |
| --- | ---: |
| 0.5 GiB / 2 vCPU / 20 GiB Linux Lightsail bundle candidate | USD 5.00 |
| 16 GiB encrypted Lightsail block disk | USD 1.60 |
| Snapshot allowance | USD 2.00 |
| Existing Terraform-state KMS key allocation | USD 1.00 |
| Terraform-state S3 allowance | USD 0.05 |
| Small ECR storage allowance | USD 0.10 |
| **Expected AWS total** | **USD 9.75** |
| **Headroom to alert target** | **USD 15.25** |

Usage, snapshot growth, ECR growth, outbound transfer, taxes, price changes,
and any unrelated resource in this AWS account can increase the bill. The
Budget is account-wide and deliberately has no tag filter. It emits ACTUAL
absolute-value alerts at USD 18, 21, and 24, plus a FORECASTED absolute-value
alert at USD 21. AWS Budgets is alert-only: it cannot guarantee, enforce, or
stop billing at USD 25.

The reviewed `nano_3_0` and `ubuntu_24_04` strings are candidates, not proof
of current bundle specifications, price, architecture, or availability. The
live preflight must revalidate them against the target account and
`us-east-1` before any plan.

## Inputs

Copy `terraform.tfvars.example` to the ignored `terraform.tfvars` only during a
separately authorized future workflow. Replace its documentation-only public
key, `/32`, and email placeholders. Never put a private key or application
credential in that file.

| Input | Fixed/reviewed contract |
| --- | --- |
| `aws_account_id` | exact target account guard |
| `aws_region` | `us-east-1` only |
| `environment` | `production` only |
| `availability_zone` | explicit `us-east-1` lettered AZ; live revalidation required |
| `instance_blueprint_id` | `ubuntu_24_04` candidate only |
| `instance_bundle_id` | `nano_3_0` smallest IPv4 Linux candidate only |
| `database_disk_size_gb` | exactly 16 |
| `operator_ssh_public_key` | existing single-line OpenSSH public key only |
| `admin_ipv4_cidrs` | nonempty exact IPv4 `/32` set; no world-open rule |
| `automatic_snapshot_utc_hour` | whole UTC hour; default 04:00 |
| `monthly_budget_usd` | exactly 25 |
| `budget_alert_email` | required notification recipient |

## State, identity, and execution gates

`backend.hcl.example` is a reviewable target guard, not a credential file. It
uses the existing versioned/encrypted state bucket, exact state KMS key, native
S3 lockfile, `us-east-1`, and the new key
`lightsail-production/core.tfstate`. Do not commit a real `backend.hcl`, state,
locks, plans, caches, credentials, or private variable files.

The existing production deployment identity was designed for the ECS/RDS root
and exact `production/core.tfstate` objects. Do not broaden or reuse it by
assumption. The offline policy proposal in `iam/` defines separate read-only
preflight and short-lived deployment permission sets scoped to:

- the exact new state and lock objects and the existing state KMS key;
- the reviewed Lightsail key, instance, disk, attachment, and firewall graph,
  subject to the documented wildcard/name-boundary residual in `iam/README.md`;
- the exact ECR repository and lifecycle policy; and
- the exact account budget and necessary provider metadata reads.

The package permits only normal current state/lock writes needed by Terraform;
manual state operations, version deletion, destructive Lightsail/ECR/snapshot
permissions, secret reads/writes, image push, Cloudflare, and database authority
remain separate. One documented exception is `budgets:ModifyBudget`, which AWS
uses for create, update, and direct deletion of the exact budget. Exact-budget
tag read/write permissions are also required because provider default tags are
part of the declared resource. Mitigate these permissions with a temporary
deploy assignment, Terraform `prevent_destroy`, and a budget post-check. The
revised policies must pass AWS validation and simulation before use.
Provider schema inspection is also a gate: the locked AWS provider is `6.65.0`,
but local static formatting does not prove every argument against the installed
schema.

The future sequence is intentionally split:

1. **Policy repair:** update the existing exact-budget IAM customer-managed
   policies from this repository, validate them in AWS, and wait for IAM
   propagation. Their names and permission-set references do not change. This
   is a separate IAM change.
2. **Read-only reconciliation:** verify caller/account/Region, the exact four
   managed addresses, absent current lock, KMS/backend policy, live resource
   properties, `nano_3_0` specification/current price/account eligibility,
   Availability Zone, relevant quotas, and the provider schema. Stop on drift
   or any unexpected address.
3. **Protected reinitialization:** create a new protected byte-for-byte source
   copy and initialize it against the existing backend. Do not migrate, import,
   edit, or replace state.
4. **Provider-backed plan:** separately authorize and review every action,
   public edge, IAM implication, replacement/deletion, and current recurring
   price. Expect exactly the four missing additions documented above and no
   other action.
5. **Infrastructure apply:** separately authorize only that saved plan and
   checksum. Stop on changed source, state, identity, plan, or target.
6. **Host/runtime deployment:** separately authorize disk setup, pinned
   software, accepted image transfer, credentials, database creation and data
   merge, backups, restore tests, and Cloudflare Tunnel in their owner-specific
   phases.
7. **Cutover:** only after security, readiness, data, backup, restore, budget,
   and rollback evidence is accepted. After AWS accepts writes, do not route
   writes back to Heroku or Neon without a separately tested reverse migration.

No new production plan or apply is allowed until the revised budget policies
are provisioned and a live read-only reconciliation validates the exact state,
provider schema, blueprint, nano bundle, Availability Zone, resource names,
quotas, and current pricing.

## Offline validation

`validate-static.sh` is deterministic and read-only. It checks the narrow
resource inventory, backend boundary, fixed budget/notifications, firewall
contract, durable-resource guards, ECR controls, shell user-data exclusions,
the original YAML-as-shell regression, gated remediation safety contracts, and
forbidden services or provisioners. It does not authenticate, initialize a
backend, load a provider, validate provider schemas, or prove runtime behavior.

The offline checks used for this remediation are:

```text
bash -n infra/aws/lightsail-production/validate-static.sh
sh -n infra/aws/lightsail-production/scripts/remediate-existing-instance.sh
dash -n infra/aws/lightsail-production/scripts/remediate-existing-instance.sh
infra/aws/lightsail-production/tests/validate-bootstrap.sh
infra/aws/lightsail-production/validate-static.sh
cd infra/aws/lightsail-production && sha256sum -c remediation-artifacts.sha256
```

No Terraform command was run for this remediation because the authorization
explicitly excluded all Terraform commands. Future formatting, initialization,
validation, planning, or application remains a separate action gate.

Provider-backed validation, initialization, plan, state access, AWS inventory,
Cloudflare changes, image work, secret work, database work, and deployment each
remain separate authorization gates.

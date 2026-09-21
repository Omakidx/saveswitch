#!/bin/sh
# Existing-instance remediation for the Saveswitch Lightsail host.
#
# No argument and `help` are non-mutating. `check` is read-only. Every mutation
# requires `apply --gate NAME`; this script deliberately accepts one gate per
# invocation so review and authorization can remain narrow.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
umask 077

PROGRAM=${0##*/}
MODE=help
GATE=
ADMIN_CIDRS=
CONFIRM_UFW=
SWAP_FILE=
SWAP_SIZE_MIB=
CONFIRM_SWAP=
DATABASE_DEVICE=
DATABASE_SIZE_BYTES=
DATABASE_MOUNT_POINT=
CONFIRM_DATABASE=

CONTRACT=/etc/saveswitch/bootstrap-contract
GATE_DIRECTORY=/etc/saveswitch/remediation-gates
SSH_CONFIG=/etc/ssh/sshd_config.d/00-saveswitch-hardening.conf
APT_CONFIG=/etc/apt/apt.conf.d/20auto-upgrades
UFW_CIDR_CONTRACT=/etc/saveswitch/ufw-admin-cidrs
DATABASE_INTENT=/etc/saveswitch/database-disk-format.intent
FSTAB_FILE=/etc/fstab
DATABASE_EXPECTED_LABEL=saveswitch-postg

usage() {
  cat <<'USAGE'
Usage:
  remediate-existing-instance.sh
  remediate-existing-instance.sh help
  remediate-existing-instance.sh check
  remediate-existing-instance.sh apply --gate protected-directories
  remediate-existing-instance.sh apply --gate ssh-hardening
  remediate-existing-instance.sh apply --gate unattended-upgrades
  remediate-existing-instance.sh apply --gate ufw \
    --admin-cidr 203.0.113.10/32 [--admin-cidr ...] \
    --confirm-ufw-reset RESET-UFW-TO-REVIEWED-SSH-RULES
  remediate-existing-instance.sh apply --gate swap \
    --swap-file /swapfile --swap-size-mib 512 \
    --confirm-swap CREATE-BOUNDED-SWAP
  remediate-existing-instance.sh apply --gate database-disk \
    --database-device /dev/disk/by-id/REVIEWED_STABLE_ID \
    --database-size-bytes 17179869184 \
    --database-mount-point /srv/saveswitch/postgres \
    --confirm-database FORMAT-BLANK-SAVESWITCH-DATABASE-DISK
  remediate-existing-instance.sh apply --gate database-disk \
    --database-device /dev/disk/by-id/REVIEWED_STABLE_ID \
    --database-size-bytes 17179869184 \
    --database-mount-point /srv/saveswitch/postgres \
    --confirm-database RECOVER-INTENT-MATCHED-SAVESWITCH-DATABASE-DISK

Safety model:
  * No arguments and `help` only print this text.
  * `check` reads status and never changes the host.
  * `apply` accepts exactly one named gate per invocation and must run as root.
  * Run protected-directories first. Other gates write a completion marker only
    after their own verification succeeds.
  * UFW reset requires the current SSH source address to match one supplied /32.
  * Swap is limited to a dedicated /swapfile of exactly 256 or 512 MiB.
  * Database initialization requires a caller-supplied stable /dev/disk/by-id
    or /dev/disk/by-path symlink, exact byte size, blank-state proof, and a
    second confirmation. It never formats a root, mounted, nonblank, child-
    bearing, read-only, held, ambiguous, or wrong-sized device. Persistence is
    written by filesystem UUID only.

This script never installs packages and contains no AWS, application,
database-data, Cloudflare, Cloudinary, image, or secret workflow.
USAGE
}

fail() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

require_root() {
  [ "$(id -u)" -eq 0 ] || fail 'apply mode must run as root'
}

require_regular_target() {
  target=$1
  description=$2
  if [ -L "$target" ]; then
    fail "refusing symbolic-link $description: $target"
  fi
  if [ -e "$target" ] && [ ! -f "$target" ]; then
    fail "refusing non-regular $description: $target"
  fi
}

install_exact_file() {
  source_file=$1
  target_file=$2
  target_mode=$3
  require_regular_target "$target_file" 'configuration target'
  if [ -f "$target_file" ] && cmp -s "$source_file" "$target_file"; then
    chown root:root "$target_file"
    chmod "$target_mode" "$target_file"
  else
    install -o root -g root -m "$target_mode" "$source_file" "$target_file"
  fi
}

valid_ipv4_32() {
  printf '%s\n' "$1" | awk '
    BEGIN { valid = 0 }
    /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\/32$/ {
      split($0, slash, "/")
      split(slash[1], octet, ".")
      valid = 1
      for (i = 1; i <= 4; i++) {
        if (octet[i] !~ /^[0-9]+$/ || octet[i] < 0 || octet[i] > 255) valid = 0
      }
      if (slash[1] == "0.0.0.0") valid = 0
    }
    END { exit valid ? 0 : 1 }
  '
}

append_admin_cidr() {
  cidr=$1
  valid_ipv4_32 "$cidr" || fail "invalid exact IPv4 /32: $cidr"
  case "
$ADMIN_CIDRS
" in
    *"
$cidr
"*) fail "duplicate --admin-cidr: $cidr" ;;
  esac
  if [ -n "$ADMIN_CIDRS" ]; then
    ADMIN_CIDRS="$ADMIN_CIDRS
$cidr"
  else
    ADMIN_CIDRS=$cidr
  fi
}

marker_path() {
  printf '%s/%s.complete\n' "$GATE_DIRECTORY" "$1"
}

require_directory_gate() {
  [ -d "$GATE_DIRECTORY" ] && [ ! -L "$GATE_DIRECTORY" ] ||
    fail 'protected-directories gate must complete first'
  gate_marker_valid protected-directories ||
    fail 'protected-directories completion evidence is absent or invalid'
}

gate_marker_valid() {
  inspected_gate=$1
  inspected_marker=$(marker_path "$inspected_gate")
  [ -f "$inspected_marker" ] && [ ! -L "$inspected_marker" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$inspected_marker" 2>/dev/null || true)" = 'root:root:600' ] || return 1
  [ "$(cat "$inspected_marker" 2>/dev/null || true)" = "$inspected_gate-complete" ]
}

invalidate_contract() {
  require_regular_target "$CONTRACT" 'bootstrap contract'
  rm -f "$CONTRACT"
}

begin_gate() {
  started_gate=$1
  started_marker=$(marker_path "$started_gate")
  require_regular_target "$started_marker" 'gate marker'
  require_regular_target "$CONTRACT" 'bootstrap contract'
  # These removals are deliberately the first mutation in every gate. A failed
  # rerun can never inherit success evidence from an earlier invocation.
  rm -f "$started_marker" "$CONTRACT"
}

write_gate_marker() {
  completed_gate=$1
  marker=$(marker_path "$completed_gate")
  require_regular_target "$marker" 'gate marker'
  marker_candidate=$(mktemp "$GATE_DIRECTORY/.${completed_gate}.XXXXXX")
  printf '%s\n' "$completed_gate-complete" >"$marker_candidate"
  chown root:root "$marker_candidate"
  chmod 0600 "$marker_candidate"
  mv -f "$marker_candidate" "$marker"
  gate_marker_valid "$completed_gate" || fail "gate marker verification failed: $completed_gate"
}

verify_protected_directories() {
  for protected_directory in \
    /etc/saveswitch \
    "$GATE_DIRECTORY" \
    /srv/saveswitch \
    /srv/saveswitch/backups \
    /srv/saveswitch/config \
    /srv/saveswitch/releases \
    /srv/saveswitch/restore-tests; do
    [ -d "$protected_directory" ] && [ ! -L "$protected_directory" ] || return 1
    [ "$(stat -c '%U:%G:%a' "$protected_directory" 2>/dev/null || true)" = 'root:root:700' ] || return 1
  done
}

ssh_config_content_matches() {
  [ -f "$SSH_CONFIG" ] && [ ! -L "$SSH_CONFIG" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$SSH_CONFIG" 2>/dev/null || true)" = 'root:root:644' ] || return 1
  expected_ssh_config=$(cat <<'SSH_EXPECTED_EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
GatewayPorts no
PermitTunnel no
SSH_EXPECTED_EOF
)
  [ "$(cat "$SSH_CONFIG" 2>/dev/null || true)" = "$expected_ssh_config" ]
}

apt_config_content_matches() {
  [ -f "$APT_CONFIG" ] && [ ! -L "$APT_CONFIG" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$APT_CONFIG" 2>/dev/null || true)" = 'root:root:644' ] || return 1
  expected_apt_config=$(cat <<'APT_EXPECTED_EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT_EXPECTED_EOF
)
  [ "$(cat "$APT_CONFIG" 2>/dev/null || true)" = "$expected_apt_config" ]
}

ufw_contract_valid() {
  [ -f "$UFW_CIDR_CONTRACT" ] && [ ! -L "$UFW_CIDR_CONTRACT" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$UFW_CIDR_CONTRACT" 2>/dev/null || true)" = 'root:root:600' ] || return 1
  [ -s "$UFW_CIDR_CONTRACT" ] || return 1
  [ "$(cat "$UFW_CIDR_CONTRACT")" = "$(sort -u "$UFW_CIDR_CONTRACT")" ] || return 1
  previous_cidr=
  contract_rows=0
  while IFS= read -r contract_cidr || [ -n "$contract_cidr" ]; do
    valid_ipv4_32 "$contract_cidr" || return 1
    [ "$contract_cidr" != "$previous_cidr" ] || return 1
    previous_cidr=$contract_cidr
    contract_rows=$((contract_rows + 1))
  done <"$UFW_CIDR_CONTRACT"
  [ "$contract_rows" -gt 0 ]
}

ufw_status_matches_contract() {
  inspected_contract=$1
  # UFW may render an IPv4 single-host rule as either A.B.C.D/32 or the
  # canonical A.B.C.D. The persisted contract remains /32-only; this parser
  # normalizes only the display form and compares complete UFW columns.
  awk -v contract_file="$inspected_contract" '
    BEGIN {
      while ((getline cidr < contract_file) > 0) {
        host = cidr
        sub(/\/32$/, "", host)
        allowed_host[host] = 1
        expected_rules++
      }
      close(contract_file)
      if (expected_rules == 0) exit 1
    }
    {
      comment_field = NF + 1
      for (field = 1; field <= NF; field++) {
        if ($field == "#") {
          comment_field = field
          break
        }
      }
      for (field = 1; field < comment_field; field++) {
        if (($field != "ALLOW" && $field != "LIMIT") ||
            ($(field + 1) != "IN" && $(field + 1) != "FWD")) continue
        # A status row may contain only one active permission action before an
        # optional comment. Any ALLOW/LIMIT inbound or forwarded permission is
        # denied unless it is one exact reviewed rule below.
        if ($field == "ALLOW" && $(field + 1) == "IN" &&
          ((NF == 6 &&
          $1 == "Anywhere" && $2 == "on" && $3 == "lo" &&
          $4 == "ALLOW" && $5 == "IN" && $6 == "Anywhere") ||
          (NF == 8 &&
          $1 == "Anywhere" && $2 == "(v6)" && $3 == "on" && $4 == "lo" &&
          $5 == "ALLOW" && $6 == "IN" && $7 == "Anywhere" && $8 == "(v6)"))) break
        # The reviewed command creates this exact UFW status shape:
        # 22/tcp ALLOW IN A.B.C.D[(/32)]. Do not accept partial host matches,
        # a different port/protocol, a LIMIT/FWD action, or extra rules.
        if ($field != "ALLOW" || $(field + 1) != "IN" || field != 2 ||
            !(comment_field == 5 || (comment_field == NF + 1 && NF == 4)) ||
            $1 != "22/tcp" || !( $4 in allowed_host ) &&
            !( $4 ~ /\/32$/ && substr($4, 1, length($4) - 3) in allowed_host )) {
          invalid = 1
          next
        }
        host = $4
        sub(/\/32$/, "", host)
        seen_rules[host]++
        break
      }
    }
    END {
      if (invalid) exit 1
      for (host in allowed_host) {
        if (seen_rules[host] != 1) exit 1
      }
    }
  '
}

verify_ufw_state() {
  ufw_contract_valid || return 1
  ufw_status=$(ufw status verbose) || return 1
  printf '%s\n' "$ufw_status" | grep -Fqx 'Status: active' || return 1
  printf '%s\n' "$ufw_status" | grep -Eq '^Default:[[:space:]]+deny \(incoming\), allow \(outgoing\)' || return 1
  printf '%s\n' "$ufw_status" | ufw_status_matches_contract "$UFW_CIDR_CONTRACT"
}

verify_baseline_evidence() {
  for baseline_gate in protected-directories ssh-hardening unattended-upgrades ufw; do
    gate_marker_valid "$baseline_gate" || return 1
  done
  verify_protected_directories || return 1
  ssh_config_content_matches || return 1
  sshd -t || return 1
  verify_effective_ssh || return 1
  if ! systemctl is-active --quiet ssh.service && ! systemctl is-active --quiet ssh.socket; then
    return 1
  fi
  apt_config_content_matches || return 1
  apt-config dump >/dev/null || return 1
  systemctl is-enabled --quiet apt-daily.timer || return 1
  systemctl is-enabled --quiet apt-daily-upgrade.timer || return 1
  verify_ufw_state || return 1
}

refresh_contract() {
  for required_baseline_gate in protected-directories ssh-hardening unattended-upgrades ufw; do
    required_baseline_marker=$(marker_path "$required_baseline_gate")
    if [ ! -e "$required_baseline_marker" ] && [ ! -L "$required_baseline_marker" ]; then
      return 0
    fi
    gate_marker_valid "$required_baseline_gate" ||
      fail "cannot rebuild aggregate contract from invalid marker: $required_baseline_gate"
  done
  verify_baseline_evidence || fail 'cannot rebuild aggregate contract from stale baseline configuration'

  swap_complete=false
  swap_marker=$(marker_path swap)
  if [ -e "$swap_marker" ] || [ -L "$swap_marker" ]; then
    gate_marker_valid swap || fail 'cannot rebuild aggregate contract from invalid swap marker'
    verify_swap_current || fail 'cannot rebuild aggregate contract from stale swap configuration'
    swap_complete=true
  fi
  database_complete=false
  database_marker=$(marker_path database-disk)
  if [ -e "$database_marker" ] || [ -L "$database_marker" ]; then
    gate_marker_valid database-disk || fail 'cannot rebuild aggregate contract from invalid database marker'
    verify_database_current || fail 'cannot rebuild aggregate contract from stale database configuration'
    database_complete=true
  fi

  require_regular_target "$CONTRACT" 'bootstrap contract'
  contract_candidate=$(mktemp /etc/saveswitch/.bootstrap-contract.XXXXXX)
  {
    printf '%s\n' 'existing-instance-baseline-remediated'
    printf '%s\n' 'runtime-deployment-pending'
    if [ "$swap_complete" = true ]; then
      printf '%s\n' 'swap-configured-and-verified'
    else
      printf '%s\n' 'swap-unconfigured'
    fi
    if [ "$database_complete" = true ]; then
      printf '%s\n' 'database-disk-mounted-and-verified'
    else
      printf '%s\n' 'database-disk-unformatted'
    fi
    printf '%s\n' 'cloudflare-tunnel-unconfigured'
  } >"$contract_candidate"
  chown root:root "$contract_candidate"
  chmod 0600 "$contract_candidate"
  mv -f "$contract_candidate" "$CONTRACT"
  [ -f "$CONTRACT" ] && [ ! -L "$CONTRACT" ] || fail 'aggregate contract is not a regular file'
  [ "$(stat -c '%U:%G:%a' "$CONTRACT")" = 'root:root:600' ] || fail 'aggregate contract metadata is invalid'
  if [ "$swap_complete" = true ]; then
    expected_swap_contract=swap-configured-and-verified
  else
    expected_swap_contract=swap-unconfigured
  fi
  if [ "$database_complete" = true ]; then
    expected_database_contract=database-disk-mounted-and-verified
  else
    expected_database_contract=database-disk-unformatted
  fi
  expected_contract="existing-instance-baseline-remediated
runtime-deployment-pending
$expected_swap_contract
$expected_database_contract
cloudflare-tunnel-unconfigured"
  [ "$(cat "$CONTRACT")" = "$expected_contract" ] || fail 'aggregate contract content is invalid'
}

gate_protected_directories() {
  for protected_directory in \
    /etc/saveswitch \
    "$GATE_DIRECTORY" \
    /srv/saveswitch \
    /srv/saveswitch/backups \
    /srv/saveswitch/config \
    /srv/saveswitch/releases \
    /srv/saveswitch/restore-tests; do
    [ ! -L "$protected_directory" ] || fail "refusing symbolic-link directory: $protected_directory"
  done
  require_regular_target "$CONTRACT" 'bootstrap contract'
  begin_gate protected-directories

  install -d -o root -g root -m 0700 \
    /etc/saveswitch \
    "$GATE_DIRECTORY" \
    /srv/saveswitch \
    /srv/saveswitch/backups \
    /srv/saveswitch/config \
    /srv/saveswitch/releases \
    /srv/saveswitch/restore-tests

  for protected_directory in \
    /etc/saveswitch \
    "$GATE_DIRECTORY" \
    /srv/saveswitch \
    /srv/saveswitch/backups \
    /srv/saveswitch/config \
    /srv/saveswitch/releases \
    /srv/saveswitch/restore-tests; do
    [ "$(stat -c '%U:%G:%a' "$protected_directory")" = 'root:root:700' ] ||
      fail "directory verification failed: $protected_directory"
  done

  verify_protected_directories || fail 'protected-directory verification failed'
  write_gate_marker protected-directories
}

write_ssh_candidate() {
  candidate=$1
  cat >"$candidate" <<'SSH_EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PubkeyAuthentication yes
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
GatewayPorts no
PermitTunnel no
SSH_EOF
}

verify_effective_ssh() {
  for expected_setting in \
    'permitrootlogin no' \
    'passwordauthentication no' \
    'kbdinteractiveauthentication no' \
    'pubkeyauthentication yes' \
    'x11forwarding no' \
    'allowtcpforwarding no' \
    'allowagentforwarding no' \
    'gatewayports no' \
    'permittunnel no'; do
    sshd -T | grep -Fqx "$expected_setting" || return 1
  done
}

gate_ssh_hardening() {
  require_directory_gate
  require_command sshd
  require_regular_target "$SSH_CONFIG" 'SSH hardening target'
  begin_gate ssh-hardening
  [ ! -L /run/sshd ] || fail 'refusing symbolic-link SSH runtime directory'
  install -d -o root -g root -m 0755 /run/sshd
  [ "$(stat -c '%U:%G:%a' /run/sshd)" = 'root:root:755' ] ||
    fail 'SSH runtime directory owner or mode is unsafe'

  ssh_candidate=$(mktemp /tmp/saveswitch-sshd.XXXXXX)
  ssh_backup=$(mktemp /tmp/saveswitch-sshd-backup.XXXXXX)
  ssh_had_previous=false
  write_ssh_candidate "$ssh_candidate"
  chmod 0600 "$ssh_candidate" "$ssh_backup"
  sshd -t -f "$ssh_candidate" || fail 'SSH hardening candidate is invalid'

  if [ -f "$SSH_CONFIG" ]; then
    install -o root -g root -m 0600 "$SSH_CONFIG" "$ssh_backup"
    ssh_had_previous=true
  fi
  install_exact_file "$ssh_candidate" "$SSH_CONFIG" 0644
  if ! sshd -t; then
    if [ "$ssh_had_previous" = true ]; then
      install -o root -g root -m 0644 "$ssh_backup" "$SSH_CONFIG"
    else
      rm -f "$SSH_CONFIG"
    fi
    sshd -t || fail 'SSH rollback did not restore a valid configuration'
    fail 'complete SSH configuration rejected the hardening drop-in'
  fi
  rm -f "$ssh_candidate" "$ssh_backup"
  verify_effective_ssh || fail 'effective SSH hardening verification failed before activation'

  if systemctl is-active --quiet ssh.service; then
    systemctl reload ssh.service
  elif systemctl is-active --quiet ssh.socket; then
    :
  else
    fail 'neither ssh.service nor ssh.socket is active; refusing to start or restart SSH'
  fi
  verify_effective_ssh || fail 'effective SSH hardening verification failed after activation'
  ssh_config_content_matches || fail 'managed SSH configuration content or metadata changed unexpectedly'
  write_gate_marker ssh-hardening
  refresh_contract
}

gate_unattended_upgrades() {
  require_directory_gate
  require_command apt-config
  require_command unattended-upgrade
  require_regular_target "$APT_CONFIG" 'unattended-upgrade configuration target'
  begin_gate unattended-upgrades

  apt_candidate=$(mktemp /tmp/saveswitch-auto-upgrades.XXXXXX)
  cat >"$apt_candidate" <<'APT_EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
APT_EOF
  chmod 0600 "$apt_candidate"
  install_exact_file "$apt_candidate" "$APT_CONFIG" 0644
  rm -f "$apt_candidate"
  apt-config dump >/dev/null
  systemctl enable apt-daily.timer apt-daily-upgrade.timer >/dev/null
  systemctl is-enabled --quiet apt-daily.timer || fail 'apt-daily.timer is not enabled'
  systemctl is-enabled --quiet apt-daily-upgrade.timer || fail 'apt-daily-upgrade.timer is not enabled'
  apt_config_content_matches || fail 'managed unattended-upgrade configuration content or metadata is invalid'
  write_gate_marker unattended-upgrades
  refresh_contract
}

configure_ufw_from_admin_cidrs() {
  ufw --force reset >/dev/null
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw allow in on lo >/dev/null
  ufw allow out on lo >/dev/null
  saved_ifs=$IFS
  IFS='
'
  for allowed_cidr in $ADMIN_CIDRS; do
    ufw allow proto tcp from "$allowed_cidr" to any port 22 comment 'Saveswitch break-glass SSH' >/dev/null
  done
  IFS=$saved_ifs
  ufw --force enable >/dev/null
}

ufw_recover() {
  recovery_status=$1
  trap - 0 1 2 15
  if [ "${SAVESWITCH_UFW_RECOVERY_ACTIVE:-false}" = true ]; then
    configure_ufw_from_admin_cidrs >/dev/null 2>&1 || :
  fi
  exit "$recovery_status"
}

write_ufw_contract() {
  require_regular_target "$UFW_CIDR_CONTRACT" 'UFW CIDR contract'
  ufw_contract_candidate=$(mktemp /etc/saveswitch/.ufw-admin-cidrs.XXXXXX)
  printf '%s\n' "$ADMIN_CIDRS" | awk 'NF { print }' | sort -u >"$ufw_contract_candidate"
  chown root:root "$ufw_contract_candidate"
  chmod 0600 "$ufw_contract_candidate"
  mv -f "$ufw_contract_candidate" "$UFW_CIDR_CONTRACT"
  ufw_contract_valid || fail 'persisted UFW CIDR contract failed verification'
}

gate_ufw() {
  require_directory_gate
  require_command sort
  require_command ufw
  [ -n "$ADMIN_CIDRS" ] || fail 'ufw gate requires at least one --admin-cidr'
  [ "$CONFIRM_UFW" = 'RESET-UFW-TO-REVIEWED-SSH-RULES' ] ||
    fail 'ufw gate requires the exact --confirm-ufw-reset token'
  [ -n "${SSH_CONNECTION:-}" ] ||
    fail 'ufw gate must run from the direct reviewed SSH session'
  require_regular_target "$UFW_CIDR_CONTRACT" 'UFW CIDR contract'
  ufw --version >/dev/null

  ssh_source_ip=$(printf '%s\n' "$SSH_CONNECTION" | awk '{print $1}')
  source_is_allowed=false
  saved_ifs=$IFS
  IFS='
'
  for allowed_cidr in $ADMIN_CIDRS; do
    [ "$allowed_cidr" = "$ssh_source_ip/32" ] && source_is_allowed=true
  done
  IFS=$saved_ifs
  [ "$source_is_allowed" = true ] ||
    fail 'current SSH source is absent from the supplied admin /32 set'

  SAVESWITCH_UFW_RECOVERY_ACTIVE=false
  trap 'ufw_recover $?' 0
  trap 'ufw_recover 129' 1
  trap 'ufw_recover 130' 2
  trap 'ufw_recover 143' 15
  begin_gate ufw
  rm -f "$UFW_CIDR_CONTRACT"
  SAVESWITCH_UFW_RECOVERY_ACTIVE=true
  configure_ufw_from_admin_cidrs
  write_ufw_contract
  verify_ufw_state || fail 'UFW exact-state verification failed'
  SAVESWITCH_UFW_RECOVERY_ACTIVE=false
  trap - 0 1 2 15

  write_gate_marker ufw
  refresh_contract
}

saveswitch_fstab_active_lines() {
  inspected_fstab=$1
  awk 'NF > 0 && $1 !~ /^#/ { print }' "$inspected_fstab"
}

saveswitch_normalize_fstab_field() {
  raw_fstab_field=$1
  # util-linux fstab parsing accepts double-quoted fields and \NNN octal
  # escapes.  Safety comparisons must use the decoded value, while callers
  # retain the untouched row for exact-contract acceptance.
  printf '%s\n' "$raw_fstab_field" | awk '
    {
      raw = $0
      normalized = ""
      for (index_in = 1; index_in <= length(raw); index_in++) {
        character = substr(raw, index_in, 1)
        if (character == "\"") {
          continue
        }
        if (character == "\\") {
          octal = substr(raw, index_in + 1, 3)
          if (octal !~ /^[0-7][0-7][0-7]$/) {
            exit 1
          }
          decoded = (substr(octal, 1, 1) * 64) + (substr(octal, 2, 1) * 8) + substr(octal, 3, 1)
          if (decoded == 0 || decoded == 10 || decoded == 13) {
            exit 1
          }
          normalized = normalized sprintf("%c", decoded)
          index_in += 3
          continue
        }
        normalized = normalized character
      }
      print normalized
    }
  '
}

saveswitch_fstab_related_lines() {
  inspected_fstab=$1
  inspected_source=$2
  inspected_target=$3
  if ! inspected_active_lines=$(saveswitch_fstab_active_lines "$inspected_fstab"); then
    return 1
  fi
  while IFS= read -r inspected_line || [ -n "$inspected_line" ]; do
    [ -n "$inspected_line" ] || continue
    inspected_raw_source=$(printf '%s\n' "$inspected_line" | awk 'NF >= 2 { print $1; exit }') || return 1
    inspected_raw_target=$(printf '%s\n' "$inspected_line" | awk 'NF >= 2 { print $2; exit }') || return 1
    inspected_normalized_source=$(saveswitch_normalize_fstab_field "$inspected_raw_source") || return 1
    inspected_normalized_target=$(saveswitch_normalize_fstab_field "$inspected_raw_target") || return 1
    if [ "$inspected_normalized_source" = "$inspected_source" ] ||
      { [ -n "$inspected_target" ] && [ "$inspected_normalized_target" = "$inspected_target" ]; }; then
      printf '%s\n' "$inspected_line"
    fi
  done <<EOF
$inspected_active_lines
EOF
}

saveswitch_build_validated_fstab_candidate() {
  source_fstab=$1
  candidate_fstab=$2
  reviewed_entry=$3
  if ! cat "$source_fstab" >"$candidate_fstab"; then
    return 1
  fi
  # Always provide a separator. This is safe for an empty file and prevents an
  # existing final row without a newline from absorbing the reviewed entry.
  if ! printf '\n%s\n' "$reviewed_entry" >>"$candidate_fstab"; then
    return 1
  fi
  findmnt --verify --tab-file "$candidate_fstab" >/dev/null 2>&1
}

fstab_active_lines() {
  require_regular_target "$FSTAB_FILE" 'fstab target'
  saveswitch_fstab_active_lines "$FSTAB_FILE"
}

append_fstab_line() {
  fstab_line=$1
  require_command findmnt
  require_regular_target "$FSTAB_FILE" 'fstab target'
  fstab_candidate=$(mktemp /etc/.fstab.saveswitch.XXXXXX)
  if ! saveswitch_build_validated_fstab_candidate "$FSTAB_FILE" "$fstab_candidate" "$fstab_line"; then
    rm -f "$fstab_candidate"
    fail 'candidate fstab failed findmnt syntax verification; original is unchanged'
  fi
  chown root:root "$fstab_candidate"
  chmod 0644 "$fstab_candidate"
  mv -f "$fstab_candidate" "$FSTAB_FILE"
}

ensure_swap_fstab() {
  swap_source=$1
  swap_line="$swap_source none swap sw 0 0"
  swap_matches=$(fstab_active_lines | awk -v source="$swap_source" '$1 == source { print }')
  if [ -n "$swap_matches" ]; then
    [ "$swap_matches" = "$swap_line" ] || fail 'existing swap fstab entry differs from the reviewed contract'
    return 0
  fi
  append_fstab_line "$swap_line"
}

validate_swap_fstab() {
  swap_source=$1
  swap_line="$swap_source none swap sw 0 0"
  unexpected_swap_sources=$(fstab_active_lines | awk -v wanted="$swap_source" '$3 == "swap" && $1 != wanted { print $1 }')
  [ -z "$unexpected_swap_sources" ] ||
    fail 'an unexpected dormant swap entry exists in fstab'
  swap_matches=$(fstab_active_lines | awk -v source="$swap_source" '$1 == source { print }')
  [ -z "$swap_matches" ] || [ "$swap_matches" = "$swap_line" ] ||
    fail 'existing swap fstab entry differs from the reviewed contract'
}

verify_swap_current() {
  [ -f /swapfile ] && [ ! -L /swapfile ] || return 1
  swap_bytes=$(stat -c '%s' /swapfile 2>/dev/null || true)
  [ "$swap_bytes" -eq 268435456 ] 2>/dev/null || [ "$swap_bytes" -eq 536870912 ] 2>/dev/null || return 1
  [ "$(stat -c '%U:%G:%a' /swapfile 2>/dev/null || true)" = 'root:root:600' ] || return 1
  [ "$(blkid -p -s TYPE -o value /swapfile 2>/dev/null || true)" = swap ] || return 1
  active_swap_rows=$(awk 'NR > 1 { print $1 }' /proc/swaps)
  [ "$active_swap_rows" = /swapfile ] || return 1
  fstab_swap_rows=$(fstab_active_lines | awk '$3 == "swap" { print }')
  [ "$fstab_swap_rows" = '/swapfile none swap sw 0 0' ]
}

gate_swap() {
  require_directory_gate
  [ "$SWAP_FILE" = '/swapfile' ] || fail 'swap gate permits only --swap-file /swapfile'
  case "$SWAP_SIZE_MIB" in
    256|512) ;;
    *) fail 'swap gate permits exactly 256 or 512 MiB' ;;
  esac
  [ "$CONFIRM_SWAP" = 'CREATE-BOUNDED-SWAP' ] ||
    fail 'swap gate requires the exact --confirm-swap token'
  [ ! -L "$SWAP_FILE" ] || fail 'refusing symbolic-link swap path'
  [ ! -e "$SWAP_FILE" ] || [ -f "$SWAP_FILE" ] || fail 'existing swap path is not a regular file'

  require_command blkid
  require_command swapon
  require_command mkswap
  require_command dd
  require_command df
  expected_swap_bytes=$((SWAP_SIZE_MIB * 1024 * 1024))

  other_swap=$(awk -v wanted="$SWAP_FILE" 'NR > 1 && $1 != wanted { print $1 }' /proc/swaps)
  [ -z "$other_swap" ] || fail 'an unexpected swap device or file is already active'
  validate_swap_fstab "$SWAP_FILE"

  created_swap=false
  if [ -e "$SWAP_FILE" ]; then
    [ "$(stat -c '%s' "$SWAP_FILE")" -eq "$expected_swap_bytes" ] ||
      fail 'existing swap file has the wrong exact size'
    [ "$(stat -c '%U:%G:%a' "$SWAP_FILE")" = 'root:root:600' ] ||
      fail 'existing swap file owner or mode is unsafe'
    [ "$(blkid -p -s TYPE -o value "$SWAP_FILE" 2>/dev/null || true)" = 'swap' ] ||
      fail 'existing swap file does not contain a swap signature'
  else
    available_kib=$(df -Pk / | awk 'NR == 2 { print $4 }')
    required_kib=$((SWAP_SIZE_MIB * 1024 + 262144))
    [ "$available_kib" -ge "$required_kib" ] ||
      fail 'insufficient root-filesystem headroom for bounded swap creation'
    begin_gate swap
    if ! dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$SWAP_SIZE_MIB" conv=fsync status=none; then
      rm -f "$SWAP_FILE"
      fail 'swap-file allocation failed'
    fi
    created_swap=true
    chown root:root "$SWAP_FILE"
    chmod 0600 "$SWAP_FILE"
    if ! mkswap "$SWAP_FILE" >/dev/null; then
      rm -f "$SWAP_FILE"
      fail 'mkswap failed; newly allocated file was removed'
    fi
  fi

  if [ "$created_swap" = false ]; then
    begin_gate swap
  fi

  if ! awk -v wanted="$SWAP_FILE" 'NR > 1 && $1 == wanted { found = 1 } END { exit found ? 0 : 1 }' /proc/swaps; then
    if ! swapon "$SWAP_FILE"; then
      [ "$created_swap" = false ] || rm -f "$SWAP_FILE"
      fail 'swapon failed'
    fi
  fi
  ensure_swap_fstab "$SWAP_FILE"
  awk -v wanted="$SWAP_FILE" 'NR > 1 && $1 == wanted { found = 1 } END { exit found ? 0 : 1 }' /proc/swaps ||
    fail 'swap is not active after configuration'
  write_gate_marker swap
  refresh_contract
}

top_level_disk() {
  if ! current_device=$(readlink -f "$1" 2>/dev/null); then
    return 1
  fi
  [ -b "$current_device" ] || return 1
  while :; do
    if ! parent_raw=$(lsblk -dnro PKNAME "$current_device" 2>/dev/null); then
      return 1
    fi
    if ! parent_name=$(printf '%s\n' "$parent_raw" | awk '
      NF { count++; value = $0 }
      END { if (count > 1) exit 1; if (count == 1) print value }
    '); then
      return 1
    fi
    [ -n "$parent_name" ] || break
    current_device=/dev/$parent_name
    [ -b "$current_device" ] || return 1
  done
  printf '%s\n' "$current_device"
}

device_is_active_swap() {
  candidate_device=$1
  if ! database_swap_sources=$(awk 'NR > 1 { print $1 }' /proc/swaps); then
    fail 'cannot read active swap sources safely'
  fi
  while IFS= read -r swap_source || [ -n "$swap_source" ]; do
    [ -n "$swap_source" ] || continue
    if ! resolved_swap=$(readlink -f "$swap_source" 2>/dev/null); then
      fail 'cannot resolve an active swap source safely'
    fi
    [ "$resolved_swap" != "$candidate_device" ] || return 1
  done <<EOF
$database_swap_sources
EOF
  return 0
}

database_stable_identity_is_link() {
  [ -L "$1" ]
}

database_block_device_exists() {
  [ -b "$1" ]
}

database_holders_directory_available() {
  [ -d "$1" ]
}

# Database-disk probing is deliberately fail-closed.  Do not replace these
# helpers with pipelines such as `lsblk | awk` or `wipefs | awk`: a pipeline
# would discard the status of the safety-critical producer under POSIX sh.
DATABASE_PROBE_OUTPUT=
DATABASE_PROBE_STATUS=0
DATABASE_VERIFIED_CANONICAL=
DATABASE_VERIFIED_MAJOR_MINOR=
DATABASE_FILESYSTEM_TYPE=
DATABASE_FILESYSTEM_UUID=
DATABASE_FILESYSTEM_LABEL=
DATABASE_PARTITION_TABLE=
DATABASE_SIGNATURES=
DATABASE_MOUNTED_TARGETS=

database_capture_probe() {
  DATABASE_PROBE_OUTPUT=
  if DATABASE_PROBE_OUTPUT=$("$@" 2>/dev/null); then
    DATABASE_PROBE_STATUS=0
    return 0
  else
    DATABASE_PROBE_STATUS=$?
    return "$DATABASE_PROBE_STATUS"
  fi
}

database_require_probe() {
  database_probe_description=$1
  shift
  database_capture_probe "$@" ||
    fail "$database_probe_description probe failed (exit $DATABASE_PROBE_STATUS)"
}

database_optional_single_value() {
  database_value_raw=$1
  if ! database_value=$(printf '%s\n' "$database_value_raw" | awk '
    NF { count++; value = $0 }
    END { if (count > 1) exit 1; if (count == 1) print value }
  '); then
    fail 'database probe returned ambiguous output'
  fi
  printf '%s\n' "$database_value"
}

database_required_single_value() {
  database_required_description=$1
  database_required_raw=$2
  database_required_value=$(database_optional_single_value "$database_required_raw")
  [ -n "$database_required_value" ] || fail "$database_required_description probe returned no value"
  printf '%s\n' "$database_required_value"
}

database_blkid_field() {
  database_field_name=$1
  database_field_raw=$2
  if ! database_field_value=$(printf '%s\n' "$database_field_raw" | awk -v field="$database_field_name=" '
    index($0, field) == 1 {
      count++
      value = substr($0, length(field) + 1)
    }
    END { if (count > 1) exit 1; if (count == 1) print value }
  '); then
    fail "blkid metadata has duplicate $database_field_name fields"
  fi
  printf '%s\n' "$database_field_value"
}

database_collect_metadata() {
  database_metadata_device=$1
  DATABASE_FILESYSTEM_TYPE=
  DATABASE_FILESYSTEM_UUID=
  DATABASE_FILESYSTEM_LABEL=

  # An empty blkid -p status-2 outcome is treated as no identifier only when
  # successful wipefs/PTTYPE/mount probes independently corroborate blankness.
  # Empty success, nonempty status 2, and every other nonzero status fail closed.
  if database_capture_probe blkid -p -o export "$database_metadata_device"; then
    [ -n "$DATABASE_PROBE_OUTPUT" ] ||
      fail 'blkid metadata probe succeeded without metadata; refusing blank-state inference'
    DATABASE_FILESYSTEM_TYPE=$(database_blkid_field TYPE "$DATABASE_PROBE_OUTPUT")
    DATABASE_FILESYSTEM_UUID=$(database_blkid_field UUID "$DATABASE_PROBE_OUTPUT")
    DATABASE_FILESYSTEM_LABEL=$(database_blkid_field LABEL "$DATABASE_PROBE_OUTPUT")
    [ -n "$DATABASE_FILESYSTEM_TYPE" ] ||
      fail 'blkid metadata lacks a recognized filesystem TYPE; refusing blank-state inference'
  else
    [ "$DATABASE_PROBE_STATUS" -eq 2 ] && [ -z "$DATABASE_PROBE_OUTPUT" ] ||
      fail "blkid metadata probe failed (exit $DATABASE_PROBE_STATUS)"
  fi

  database_require_probe 'lsblk partition-table' lsblk -dnro PTTYPE "$database_metadata_device"
  DATABASE_PARTITION_TABLE=$(database_optional_single_value "$DATABASE_PROBE_OUTPUT")

  database_require_probe 'wipefs signature' wipefs -n --noheadings --output TYPE "$database_metadata_device"
  if ! DATABASE_SIGNATURES=$(printf '%s\n' "$DATABASE_PROBE_OUTPUT" | awk 'NF { print }'); then
    fail 'wipefs signature output could not be parsed'
  fi
}

database_collect_holders() {
  database_holders_directory=$1
  database_holders_directory_available "$database_holders_directory" ||
    fail 'database disk holders directory is unavailable'
  database_require_probe 'database disk holder graph' find "$database_holders_directory" -mindepth 1 -maxdepth 1 -printf '%f\n'
  [ -z "$DATABASE_PROBE_OUTPUT" ] || fail 'database disk is held by another block device'
}

database_capture_active_fstab_lines() {
  if DATABASE_FSTAB_ACTIVE_LINES=$(fstab_active_lines); then
    return 0
  else
    DATABASE_FSTAB_STATUS=$?
    fail "active fstab probe failed (exit $DATABASE_FSTAB_STATUS)"
  fi
}

database_readlink_m() {
  command readlink -m -- "$1"
}

database_canonicalize_fstab_target() {
  database_target_to_canonicalize=$1
  case "$database_target_to_canonicalize" in
    /*)
      database_require_probe 'fstab target canonicalization' \
        database_readlink_m "$database_target_to_canonicalize"
      database_canonical_target=$(database_required_single_value \
        'fstab target canonicalization' "$DATABASE_PROBE_OUTPUT")
      case "$database_canonical_target" in
        /*) printf '%s\n' "$database_canonical_target" ;;
        *) fail 'fstab target canonicalization returned a non-absolute path' ;;
      esac
      ;;
    *) printf '%s\n' "$database_target_to_canonicalize" ;;
  esac
}

database_fstab_source_matches_target() {
  database_fstab_source=$1
  database_fstab_stable=$2
  database_fstab_canonical=$3
  database_fstab_major_minor=$4

  [ "$database_fstab_source" = "$database_fstab_stable" ] && return 0
  [ "$database_fstab_source" = "$database_fstab_canonical" ] && return 0
  case "$database_fstab_source" in
    'LABEL=saveswitch-postg'|'LABEL="saveswitch-postg"'|\
    'LABEL=saveswitch-postgres'|'LABEL="saveswitch-postgres"')
      # This label is reserved for the reviewed database filesystem.  Treat
      # any active label-based row as related/conflicting so a second UUID row
      # can never be appended alongside a predictable LABEL alias.
      return 0
      ;;
    LABEL=*) return 1 ;;
    /dev/*)
      database_require_probe 'fstab device-source resolution' readlink -f "$database_fstab_source"
      database_fstab_resolved=$(database_required_single_value \
        'fstab device-source resolution' "$DATABASE_PROBE_OUTPUT")
      database_block_device_exists "$database_fstab_resolved" ||
        fail 'fstab device source does not resolve to a block device'
      ;;
    UUID=*)
      database_fstab_uuid=${database_fstab_source#UUID=}
      # Non-filesystem UUID syntaxes are ordinary unrelated fstab sources; a
      # canonical ext UUID is resolved and compared rather than matched by text.
      # Query every matching device rather than using blkid -U (list-one): a
      # cloned filesystem UUID must fail before any fstab or mount mutation.
      valid_filesystem_uuid "$database_fstab_uuid" || return 1
      if database_capture_probe blkid -o device -t "UUID=$database_fstab_uuid"; then
        if ! database_fstab_resolved=$(printf '%s\n' "$DATABASE_PROBE_OUTPUT" | awk '
          NF { count++; value = $0 }
          END { if (count != 1) exit 1; print value }
        '); then
          fail 'fstab UUID source does not resolve uniquely'
        fi
        [ -n "$database_fstab_resolved" ] ||
          fail 'fstab UUID source does not resolve uniquely'
        database_block_device_exists "$database_fstab_resolved" ||
          fail 'fstab UUID source does not resolve to a block device'
      else
        [ "$DATABASE_PROBE_STATUS" -eq 2 ] && [ -z "$DATABASE_PROBE_OUTPUT" ] && return 1
        fail "fstab UUID-source resolution failed (exit $DATABASE_PROBE_STATUS)"
      fi
      ;;
    *) return 1 ;;
  esac
  database_require_probe 'fstab device major:minor identity' lsblk -dnro MAJ:MIN "$database_fstab_resolved"
  database_fstab_source_major_minor=$(database_required_single_value \
    'fstab device major:minor identity' "$DATABASE_PROBE_OUTPUT")
  [ "$database_fstab_source_major_minor" = "$database_fstab_major_minor" ]
}

database_fstab_device_conflicts() {
  database_fstab_lines=$1
  database_fstab_stable=$2
  database_fstab_canonical=$3
  database_fstab_major_minor=$4
  database_fstab_mountpoint=$5
  database_fstab_canonical_mountpoint=$(database_canonicalize_fstab_target \
    "$database_fstab_mountpoint") || fail 'reviewed database mountpoint could not be canonicalized safely'
  while IFS= read -r database_fstab_line || [ -n "$database_fstab_line" ]; do
    [ -n "$database_fstab_line" ] || continue
    if ! database_fstab_raw_source=$(printf '%s\n' "$database_fstab_line" | awk '
      NF >= 2 { print $1; found = 1; exit }
      END { exit found ? 0 : 1 }
    '); then
      fail 'active fstab row could not be parsed safely'
    fi
    if ! database_fstab_raw_target=$(printf '%s\n' "$database_fstab_line" | awk '
      NF >= 2 { print $2; found = 1; exit }
      END { exit found ? 0 : 1 }
    '); then
      fail 'active fstab row could not be parsed safely'
    fi
    database_fstab_source=$(saveswitch_normalize_fstab_field "$database_fstab_raw_source") ||
      fail 'active fstab source could not be normalized safely'
    database_fstab_target=$(saveswitch_normalize_fstab_field "$database_fstab_raw_target") ||
      fail 'active fstab target could not be normalized safely'
    database_fstab_canonical_target=$(database_canonicalize_fstab_target \
      "$database_fstab_target") || fail 'active fstab target could not be canonicalized safely'
    [ "$database_fstab_canonical_target" = "$database_fstab_canonical_mountpoint" ] && {
      printf '%s\n' "$database_fstab_line"
      continue
    }
    if database_fstab_source_matches_target \
      "$database_fstab_source" \
      "$database_fstab_stable" \
      "$database_fstab_canonical" \
      "$database_fstab_major_minor"; then
      printf '%s\n' "$database_fstab_line"
    fi
  done <<EOF
$database_fstab_lines
EOF
}

database_collect_mount_state() {
  database_mount_device=$1
  database_expected_mount=$2

  # A full findmnt graph has an unambiguous success status even when this disk
  # has no matching mount.  Cross-check it against lsblk MOUNTPOINTS before a
  # no-mount conclusion is accepted.
  database_require_probe 'findmnt mount graph' findmnt -rn -o SOURCE,TARGET
  if ! DATABASE_MOUNTED_TARGETS=$(printf '%s\n' "$DATABASE_PROBE_OUTPUT" | awk -v device="$database_mount_device" '
    $1 == device { count++; print $2 }
    END { if (count > 1) exit 1 }
  '); then
    fail 'findmnt mount graph has ambiguous database-disk entries'
  fi

  database_require_probe 'lsblk mountpoint graph' lsblk -dnro MOUNTPOINTS "$database_mount_device"
  database_lsblk_mountpoints=$(database_optional_single_value "$DATABASE_PROBE_OUTPUT")

  if [ -z "$DATABASE_MOUNTED_TARGETS" ] && [ -z "$database_lsblk_mountpoints" ]; then
    return 0
  fi
  [ "$DATABASE_MOUNTED_TARGETS" = "$database_expected_mount" ] &&
    [ "$database_lsblk_mountpoints" = "$database_expected_mount" ] ||
    fail 'database disk is mounted at an unexpected, ambiguous, or graph-inconsistent target'
}

database_verify_target_identity() {
  database_stable_device=$1
  database_expected_size=$2
  database_stable_identity_is_link "$database_stable_device" ||
    fail 'database device identity must remain a symbolic link'
  database_require_probe 'stable database identity resolution' readlink -f "$database_stable_device"
  DATABASE_VERIFIED_CANONICAL=$(database_required_single_value \
    'stable database identity resolution' "$DATABASE_PROBE_OUTPUT")
  database_block_device_exists "$DATABASE_VERIFIED_CANONICAL" ||
    fail 'stable database identity does not resolve to a block device'

  database_require_probe 'lsblk device type' lsblk -dnro TYPE "$DATABASE_VERIFIED_CANONICAL"
  [ "$(database_required_single_value 'lsblk device type' "$DATABASE_PROBE_OUTPUT")" = disk ] ||
    fail 'database identity must resolve to a whole disk, not a partition or mapper'

  database_require_probe 'lsblk child graph' lsblk -nrpo NAME "$DATABASE_VERIFIED_CANONICAL"
  if ! database_child_count=$(printf '%s\n' "$DATABASE_PROBE_OUTPUT" | awk 'NF { count++ } END { print count + 0 }'); then
    fail 'lsblk child graph output could not be parsed'
  fi
  [ "$database_child_count" -eq 1 ] ||
    fail 'database disk has child devices or an ambiguous block graph'

  database_require_probe 'block read-only state' blockdev --getro "$DATABASE_VERIFIED_CANONICAL"
  [ "$(database_required_single_value 'block read-only state' "$DATABASE_PROBE_OUTPUT")" = 0 ] ||
    fail 'database disk is read-only'

  database_require_probe 'block byte size' blockdev --getsize64 "$DATABASE_VERIFIED_CANONICAL"
  [ "$(database_required_single_value 'block byte size' "$DATABASE_PROBE_OUTPUT")" = "$database_expected_size" ] ||
    fail 'database disk exact byte size does not match the caller-supplied expectation'

  database_require_probe 'root mount source' findmnt -nro SOURCE /
  root_source=$(database_required_single_value 'root mount source' "$DATABASE_PROBE_OUTPUT")
  root_disk=$(top_level_disk "$root_source") || fail 'cannot resolve the root disk safely'
  database_top_disk=$(top_level_disk "$DATABASE_VERIFIED_CANONICAL") ||
    fail 'cannot resolve the database disk safely'
  [ "$database_top_disk" != "$root_disk" ] || fail 'refusing to operate on the root disk'

  database_basename=${DATABASE_VERIFIED_CANONICAL##*/}
  database_collect_holders "/sys/class/block/$database_basename/holders"
  device_is_active_swap "$DATABASE_VERIFIED_CANONICAL" || fail 'database disk is active swap'

  database_require_probe 'lsblk major:minor identity' lsblk -dnro MAJ:MIN "$DATABASE_VERIFIED_CANONICAL"
  DATABASE_VERIFIED_MAJOR_MINOR=$(database_required_single_value \
    'lsblk major:minor identity' "$DATABASE_PROBE_OUTPUT")
  printf '%s\n' "$DATABASE_VERIFIED_MAJOR_MINOR" | grep -Eq '^[0-9]+:[0-9]+$' ||
    fail 'database disk major:minor identity is malformed'
}

verify_database_format_target_unchanged() {
  database_recheck_stable=$1
  database_recheck_canonical=$2
  database_recheck_size=$3
  database_recheck_major_minor=$4
  database_recheck_mount=$5

  database_verify_target_identity "$database_recheck_stable" "$database_recheck_size"
  [ "$DATABASE_VERIFIED_CANONICAL" = "$database_recheck_canonical" ] ||
    fail 'database stable identity rebound before formatting'
  [ "$DATABASE_VERIFIED_MAJOR_MINOR" = "$database_recheck_major_minor" ] ||
    fail 'database major:minor identity changed before formatting'
  database_collect_mount_state "$DATABASE_VERIFIED_CANONICAL" "$database_recheck_mount"
  [ -z "$DATABASE_MOUNTED_TARGETS" ] || fail 'database disk became mounted before formatting'
  database_collect_metadata "$DATABASE_VERIFIED_CANONICAL"
  [ -z "$DATABASE_FILESYSTEM_TYPE" ] || fail 'database disk gained filesystem metadata before formatting'
  [ -z "$DATABASE_FILESYSTEM_UUID" ] && [ -z "$DATABASE_FILESYSTEM_LABEL" ] ||
    fail 'database disk gained filesystem metadata before formatting'
  [ -z "$DATABASE_PARTITION_TABLE" ] || fail 'database disk gained a partition-table signature before formatting'
  [ -z "$DATABASE_SIGNATURES" ] || fail 'database disk gained a signature before formatting'
  database_capture_active_fstab_lines
  if ! database_recheck_fstab_conflicts=$(database_fstab_device_conflicts \
    "$DATABASE_FSTAB_ACTIVE_LINES" \
    "$database_recheck_stable" \
    "$database_recheck_canonical" \
    "$database_recheck_major_minor" \
    "$database_recheck_mount"); then
    fail 'database fstab conflict evaluation failed'
  fi
  [ -z "$database_recheck_fstab_conflicts" ] ||
    fail 'database disk gained an fstab reference before formatting'
}

format_blank_database_target() {
  database_format_stable=$1
  database_format_canonical=$2
  database_format_size=$3
  database_format_major_minor=$4
  database_format_mount=$5
  database_format_uuid=$6
  verify_database_format_target_unchanged \
    "$database_format_stable" \
    "$database_format_canonical" \
    "$database_format_size" \
    "$database_format_major_minor" \
    "$database_format_mount"
  database_mkfs_ext4 -F -L "$DATABASE_EXPECTED_LABEL" -U "$database_format_uuid" "$database_format_canonical"
}

database_mkfs_ext4() {
  command mkfs.ext4 "$@"
}

database_verify_uuid_unique_for_canonical() {
  database_unique_uuid=$1
  database_unique_canonical=$2
  # UUID lookup must resolve exactly one block device and that device must be
  # the reviewed disk; a cloned volume with the same UUID is not accepted.
  database_require_probe 'database filesystem UUID uniqueness' blkid -o device -t "UUID=$database_unique_uuid"
  if ! database_uuid_device=$(printf '%s\n' "$DATABASE_PROBE_OUTPUT" | awk '
    NF { count++; value = $0 }
    END { if (count != 1) exit 1; print value }
  '); then
    fail 'database filesystem UUID does not resolve uniquely'
  fi
  [ -n "$database_uuid_device" ] || fail 'database filesystem UUID does not resolve uniquely'
  database_require_probe 'database filesystem UUID resolution' readlink -f "$database_uuid_device"
  database_uuid_resolved=$(database_required_single_value \
    'database filesystem UUID resolution' "$DATABASE_PROBE_OUTPUT")
  [ "$database_uuid_resolved" = "$database_unique_canonical" ] ||
    fail 'database filesystem UUID resolves to an unreviewed disk'
}

database_verify_mounted_target_identity() {
  database_mounted_mountpoint=$1
  database_mounted_canonical=$2
  database_mounted_major_minor=$3
  database_mounted_uuid=$4

  database_require_probe 'mounted database source' findmnt -nro SOURCE -M "$database_mounted_mountpoint"
  DATABASE_MOUNTED_SOURCE=$(database_required_single_value \
    'mounted database source' "$DATABASE_PROBE_OUTPUT")
  database_require_probe 'mounted database source resolution' readlink -f "$DATABASE_MOUNTED_SOURCE"
  database_mounted_resolved=$(database_required_single_value \
    'mounted database source resolution' "$DATABASE_PROBE_OUTPUT")
  database_block_device_exists "$database_mounted_resolved" ||
    fail 'mounted database source does not resolve to a block device'
  [ "$database_mounted_resolved" = "$database_mounted_canonical" ] ||
    fail 'mounted database source differs from the reviewed disk'
  database_require_probe 'mounted database major:minor identity' lsblk -dnro MAJ:MIN "$database_mounted_resolved"
  database_mounted_source_major_minor=$(database_required_single_value \
    'mounted database major:minor identity' "$DATABASE_PROBE_OUTPUT")
  [ "$database_mounted_source_major_minor" = "$database_mounted_major_minor" ] ||
    fail 'mounted database major:minor differs from the reviewed disk'
  database_verify_uuid_unique_for_canonical "$database_mounted_uuid" "$database_mounted_canonical"
}

database_verify_unmounted_mountpoint_empty() {
  database_empty_mountpoint=$1
  [ "$(stat -c '%U:%G:%a' "$database_empty_mountpoint")" = 'root:root:700' ] ||
    fail 'unmounted database mount point ownership or mode is unsafe'
  database_require_probe 'database mountpoint emptiness' find "$database_empty_mountpoint" -mindepth 1 -maxdepth 1 -print -quit
  [ -z "$DATABASE_PROBE_OUTPUT" ] || fail 'unmounted database mount point is not empty'
}

database_mountpoint_is_mounted() {
  database_mountpoint_probe=$1
  if database_capture_probe findmnt -rn -M "$database_mountpoint_probe"; then
    [ -n "$DATABASE_PROBE_OUTPUT" ] ||
      fail 'database mountpoint probe succeeded without a mounted filesystem'
    return 0
  else
    database_mountpoint_status=$DATABASE_PROBE_STATUS
    [ "$database_mountpoint_status" -eq 1 ] && [ -z "$DATABASE_PROBE_OUTPUT" ] ||
      fail "database mountpoint probe failed (exit $database_mountpoint_status)"
    return 1
  fi
}

database_secure_verified_mountpoint() {
  database_secure_mountpoint=$1
  database_secure_canonical=$2
  database_secure_major_minor=$3
  database_secure_uuid=$4
  database_secure_needs_marker=$5

  # This verifier must remain the first operation in this helper.  It proves
  # canonical path, major:minor, and unique UUID before ownership, mode, or
  # marker content on an already-mounted filesystem can be changed.
  database_verify_mounted_target_identity \
    "$database_secure_mountpoint" \
    "$database_secure_canonical" \
    "$database_secure_major_minor" \
    "$database_secure_uuid"
  chown root:root "$database_secure_mountpoint"
  chmod 0700 "$database_secure_mountpoint"
  if [ "$database_secure_needs_marker" = true ]; then
    write_database_marker "$database_secure_mountpoint" "$database_secure_uuid"
  fi
}

ensure_database_fstab() {
  filesystem_uuid=$1
  stable_device=$2
  canonical_device=$3
  database_fstab_major_minor=$4
  mount_point=$5
  expected_line="UUID=$filesystem_uuid $mount_point ext4 defaults,nofail,nodev,nosuid,noexec 0 2"

  database_capture_active_fstab_lines
  if ! related_lines=$(database_fstab_device_conflicts \
    "$DATABASE_FSTAB_ACTIVE_LINES" \
    "$stable_device" \
    "$canonical_device" \
    "$database_fstab_major_minor" \
    "$mount_point"); then
    fail 'database fstab conflict evaluation failed'
  fi
  if [ -n "$related_lines" ]; then
    [ "$related_lines" = "$expected_line" ] ||
      fail 'existing database fstab entry is ambiguous or differs from the UUID-only contract'
    return 0
  fi
  append_fstab_line "$expected_line"
}

database_marker_is_valid() {
  marker_root=$1
  marker_uuid=$2
  volume_marker=$marker_root/.saveswitch-volume-contract
  [ -f "$volume_marker" ] && [ ! -L "$volume_marker" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$volume_marker")" = 'root:root:600' ] || return 1
  expected_marker="saveswitch-postgres-volume-v1
UUID=$marker_uuid"
  actual_marker=$(cat "$volume_marker")
  [ "$actual_marker" = "$expected_marker" ]
}

verify_database_current() {
  verify_mount_point=/srv/saveswitch/postgres
  findmnt -rn -M "$verify_mount_point" >/dev/null 2>&1 || return 1
  verify_source=$(findmnt -nro SOURCE -M "$verify_mount_point")
  verify_type=$(findmnt -nro FSTYPE -M "$verify_mount_point")
  verify_options=$(findmnt -nro OPTIONS -M "$verify_mount_point")
  [ "$verify_type" = ext4 ] || return 1
  [ -b "$verify_source" ] || return 1
  verify_canonical_source=$(readlink -f "$verify_source" 2>/dev/null) || return 1
  [ -b "$verify_canonical_source" ] || return 1
  verify_major_minor=$(lsblk -dnro MAJ:MIN "$verify_canonical_source" 2>/dev/null) || return 1
  printf '%s\n' "$verify_major_minor" | grep -Eq '^[0-9]+:[0-9]+$' || return 1
  [ "$(blockdev --getsize64 "$verify_source" 2>/dev/null || true)" -eq 17179869184 ] 2>/dev/null || return 1
  verify_uuid=$(blkid -p -s UUID -o value "$verify_source" 2>/dev/null || true)
  verify_label=$(blkid -p -s LABEL -o value "$verify_source" 2>/dev/null || true)
  valid_filesystem_uuid "$verify_uuid" || return 1
  [ "$verify_label" = "$DATABASE_EXPECTED_LABEL" ] || return 1
  database_marker_is_valid "$verify_mount_point" "$verify_uuid" || return 1
  for verify_mount_option in nodev nosuid noexec; do
    printf '%s\n' "$verify_options" | tr ',' '\n' | grep -Fqx "$verify_mount_option" || return 1
  done
  verify_fstab_line="UUID=$verify_uuid $verify_mount_point ext4 defaults,nofail,nodev,nosuid,noexec 0 2"
  database_capture_active_fstab_lines
  if ! verify_related_fstab=$(database_fstab_device_conflicts \
    "$DATABASE_FSTAB_ACTIVE_LINES" \
    "$verify_canonical_source" \
    "$verify_canonical_source" \
    "$verify_major_minor" \
    "$verify_mount_point"); then
    return 1
  fi
  [ "$verify_related_fstab" = "$verify_fstab_line" ]
}

write_database_marker() {
  marker_root=$1
  marker_uuid=$2
  volume_marker=$marker_root/.saveswitch-volume-contract
  require_regular_target "$volume_marker" 'database volume marker'
  volume_marker_candidate=$(mktemp "$marker_root/.saveswitch-volume-contract.XXXXXX")
  printf '%s\n' 'saveswitch-postgres-volume-v1' "UUID=$marker_uuid" >"$volume_marker_candidate"
  chown root:root "$volume_marker_candidate"
  chmod 0600 "$volume_marker_candidate"
  mv -f "$volume_marker_candidate" "$volume_marker"
}

valid_filesystem_uuid() {
  printf '%s\n' "$1" | grep -Eq '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
}

database_intent_content_matches() {
  intent_file=$1
  intent_stable=$2
  intent_canonical=$3
  intent_size=$4
  intent_major_minor=$5
  intent_uuid=$6
  expected_intent="version=1
stable_device=$intent_stable
canonical_device=$intent_canonical
size_bytes=$intent_size
major_minor=$intent_major_minor
filesystem_label=$DATABASE_EXPECTED_LABEL
filesystem_uuid=$intent_uuid"
  # Version-1 journals written by the original script used a label longer than
  # ext4's 16-byte limit. Accept that exact legacy spelling only so the
  # identity/UUID-bound interrupted format can resume without reformatting.
  legacy_intent="version=1
stable_device=$intent_stable
canonical_device=$intent_canonical
size_bytes=$intent_size
major_minor=$intent_major_minor
filesystem_label=saveswitch-postgres
filesystem_uuid=$intent_uuid"
  actual_intent=$(cat "$intent_file" 2>/dev/null || true)
  [ "$actual_intent" = "$expected_intent" ] || [ "$actual_intent" = "$legacy_intent" ]
}

read_matching_database_intent_uuid() {
  intent_stable=$1
  intent_canonical=$2
  intent_size=$3
  intent_major_minor=$4
  [ -f "$DATABASE_INTENT" ] && [ ! -L "$DATABASE_INTENT" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$DATABASE_INTENT" 2>/dev/null || true)" = 'root:root:600' ] || return 1
  intent_uuid=$(awk -F= '$1 == "filesystem_uuid" { count++; value = $2 } END { if (count == 1) print value }' "$DATABASE_INTENT")
  valid_filesystem_uuid "$intent_uuid" || return 1
  database_intent_content_matches "$DATABASE_INTENT" "$intent_stable" "$intent_canonical" "$intent_size" "$intent_major_minor" "$intent_uuid" || return 1
  printf '%s\n' "$intent_uuid"
}

write_database_intent() {
  intent_stable=$1
  intent_canonical=$2
  intent_size=$3
  intent_major_minor=$4
  intent_uuid=$5
  require_regular_target "$DATABASE_INTENT" 'database format intent journal'
  valid_filesystem_uuid "$intent_uuid" || fail 'generated database filesystem UUID is invalid'
  intent_candidate=$(mktemp /etc/saveswitch/.database-disk-format.intent.XXXXXX)
  {
    printf '%s\n' 'version=1'
    printf 'stable_device=%s\n' "$intent_stable"
    printf 'canonical_device=%s\n' "$intent_canonical"
    printf 'size_bytes=%s\n' "$intent_size"
    printf 'major_minor=%s\n' "$intent_major_minor"
    printf 'filesystem_label=%s\n' "$DATABASE_EXPECTED_LABEL"
    printf 'filesystem_uuid=%s\n' "$intent_uuid"
  } >"$intent_candidate"
  chown root:root "$intent_candidate"
  chmod 0600 "$intent_candidate"
  mv -f "$intent_candidate" "$DATABASE_INTENT"
  read_matching_database_intent_uuid "$intent_stable" "$intent_canonical" "$intent_size" "$intent_major_minor" >/dev/null ||
    fail 'database format intent journal failed exact verification'
}

database_interruption_decision() {
  decision_has_intent=$1
  decision_intent_matches=$2
  decision_filesystem_type=$3
  decision_label_matches=$4
  decision_uuid_matches=$5
  decision_marker_matches=$6

  if [ "$decision_has_intent" = true ]; then
    [ "$decision_intent_matches" = true ] || return 1
    if [ -z "$decision_filesystem_type" ]; then
      printf '%s\n' format-from-intent
      return 0
    fi
    [ "$decision_filesystem_type" = ext4 ] &&
      [ "$decision_label_matches" = true ] &&
      [ "$decision_uuid_matches" = true ] || return 1
    printf '%s\n' recover-from-intent
    return 0
  fi

  if [ -z "$decision_filesystem_type" ]; then
    printf '%s\n' create-intent
    return 0
  fi
  [ "$decision_filesystem_type" = ext4 ] &&
    [ "$decision_label_matches" = true ] &&
    [ "$decision_marker_matches" = true ] || return 1
  printf '%s\n' existing-managed
}

gate_database_disk() {
  require_directory_gate
  case "$DATABASE_DEVICE" in
    /dev/disk/by-id/*|/dev/disk/by-path/*) ;;
    *) fail 'database device must be a caller-supplied /dev/disk/by-id or /dev/disk/by-path path' ;;
  esac
  [ -L "$DATABASE_DEVICE" ] || fail 'database device identity must be a symbolic link'
  case "$DATABASE_SIZE_BYTES" in
    ''|*[!0-9]*) fail 'database size must be an exact positive byte count' ;;
  esac
  [ "$DATABASE_SIZE_BYTES" -eq 17179869184 ] ||
    fail 'database size must be the reviewed exact 16 GiB byte count (17179869184)'
  [ "$DATABASE_MOUNT_POINT" = '/srv/saveswitch/postgres' ] ||
    fail 'database mount point must be /srv/saveswitch/postgres'
  database_recovery_only=false
  case "$CONFIRM_DATABASE" in
    FORMAT-BLANK-SAVESWITCH-DATABASE-DISK) ;;
    RECOVER-INTENT-MATCHED-SAVESWITCH-DATABASE-DISK) database_recovery_only=true ;;
    *) fail 'database gate requires an exact format or recovery confirmation token' ;;
  esac

  for disk_command in blkid blockdev find findmnt lsblk mkdir mkfs.ext4 mount readlink rmdir tr umount wipefs; do
    require_command "$disk_command"
  done

  database_verify_target_identity "$DATABASE_DEVICE" "$DATABASE_SIZE_BYTES"
  canonical_database_device=$DATABASE_VERIFIED_CANONICAL
  database_major_minor=$DATABASE_VERIFIED_MAJOR_MINOR

  # Identity and root-disk checks are complete. Invalidate prior success before
  # any journal, temporary mount, format, fstab, mount, or marker mutation.
  begin_gate database-disk
  require_regular_target "$DATABASE_INTENT" 'database format intent journal'

  database_collect_mount_state "$canonical_database_device" "$DATABASE_MOUNT_POINT"
  mounted_targets=$DATABASE_MOUNTED_TARGETS
  database_collect_metadata "$canonical_database_device"
  filesystem_type=$DATABASE_FILESYSTEM_TYPE
  filesystem_uuid=$DATABASE_FILESYSTEM_UUID
  filesystem_label=$DATABASE_FILESYSTEM_LABEL
  partition_table=$DATABASE_PARTITION_TABLE
  signatures=$DATABASE_SIGNATURES

  database_capture_active_fstab_lines
  if ! preformat_fstab_conflicts=$(database_fstab_device_conflicts \
    "$DATABASE_FSTAB_ACTIVE_LINES" \
    "$DATABASE_DEVICE" \
    "$canonical_database_device" \
    "$database_major_minor" \
    "$DATABASE_MOUNT_POINT"); then
    fail 'database fstab conflict evaluation failed'
  fi
  if [ -z "$filesystem_type" ] && [ -n "$preformat_fstab_conflicts" ]; then
    fail 'blank database candidate has a pre-existing fstab reference'
  fi
  if [ -n "$filesystem_type" ] && [ -n "$preformat_fstab_conflicts" ]; then
    preformat_expected_fstab="UUID=$filesystem_uuid $DATABASE_MOUNT_POINT ext4 defaults,nofail,nodev,nosuid,noexec 0 2"
    [ "$preformat_fstab_conflicts" = "$preformat_expected_fstab" ] ||
      fail 'database filesystem has an alternate or conflicting fstab reference'
  fi

  database_intent_present=false
  database_intent_matches=false
  database_intent_uuid=
  if [ -e "$DATABASE_INTENT" ]; then
    database_intent_present=true
    database_intent_uuid=$(read_matching_database_intent_uuid \
      "$DATABASE_DEVICE" \
      "$canonical_database_device" \
      "$DATABASE_SIZE_BYTES" \
      "$database_major_minor" || true)
    [ -n "$database_intent_uuid" ] || fail 'database format intent does not exactly match the reviewed block identity'
    database_intent_matches=true
  fi

  if [ -n "$filesystem_type" ]; then
    [ "$filesystem_type" = 'ext4' ] || fail 'database disk is nonblank and is not the reviewed ext4 filesystem'
    [ -z "$partition_table" ] || fail 'database filesystem has an unexpected partition-table signature'
    [ "$signatures" = 'ext4' ] || fail 'database filesystem has additional or unexpected signatures'
    valid_filesystem_uuid "$filesystem_uuid" || fail 'database filesystem UUID is invalid'
  else
    [ -z "$partition_table" ] || fail 'blank candidate unexpectedly has a partition-table signature'
    [ -z "$signatures" ] || fail 'blank candidate unexpectedly has a filesystem or RAID signature'
    [ -z "$mounted_targets" ] || fail 'blank database disk is unexpectedly mounted'
  fi

  # A mount already occupying the reviewed target is untrusted until its
  # source, block identity, and UUID uniqueness all bind to this exact disk.
  # This check precedes every ownership, mode, marker, fstab, or mount action.
  if database_mountpoint_is_mounted "$DATABASE_MOUNT_POINT"; then
    [ -n "$filesystem_type" ] ||
      fail 'database mountpoint is occupied while the reviewed disk appears blank'
    database_verify_mounted_target_identity \
      "$DATABASE_MOUNT_POINT" \
      "$canonical_database_device" \
      "$database_major_minor" \
      "$filesystem_uuid"
  fi

  database_label_matches=false
  [ "$filesystem_label" = "$DATABASE_EXPECTED_LABEL" ] && database_label_matches=true
  database_uuid_matches=false
  if [ -n "$database_intent_uuid" ] && [ "$filesystem_uuid" = "$database_intent_uuid" ]; then
    database_uuid_matches=true
  fi

  database_marker_matches=false
  if [ -n "$filesystem_type" ] && [ "$database_intent_present" = false ] && [ "$database_label_matches" = true ]; then
    if [ "$mounted_targets" = "$DATABASE_MOUNT_POINT" ]; then
      database_marker_is_valid "$DATABASE_MOUNT_POINT" "$filesystem_uuid" && database_marker_matches=true
    else
      marker_check_mount=$(mktemp -d /run/saveswitch-volume-check.XXXXXX)
      if ! mount -o ro,noload,nodev,nosuid,noexec "$canonical_database_device" "$marker_check_mount"; then
        rmdir "$marker_check_mount"
        fail 'cannot mount pre-existing database filesystem read-only for identity verification'
      fi
      if database_marker_is_valid "$marker_check_mount" "$filesystem_uuid"; then
        database_marker_matches=true
      fi
      if ! umount "$marker_check_mount"; then
        fail 'cannot unmount read-only database identity check'
      fi
      rmdir "$marker_check_mount"
    fi
  fi

  database_action=$(database_interruption_decision \
    "$database_intent_present" \
    "$database_intent_matches" \
    "$filesystem_type" \
    "$database_label_matches" \
    "$database_uuid_matches" \
    "$database_marker_matches" || true)
  [ -n "$database_action" ] ||
    fail 'database disk is neither blank, exact intent-matched recovery, nor an already managed filesystem'
  if [ "$database_recovery_only" = true ]; then
    [ "$database_action" = recover-from-intent ] ||
      fail 'recovery-only confirmation refuses every state except exact intent-matched ext4 recovery'
  fi

  case "$database_action" in
    create-intent)
      [ -r /proc/sys/kernel/random/uuid ] || fail 'kernel UUID source is unavailable'
      database_intent_uuid=$(cat /proc/sys/kernel/random/uuid)
      valid_filesystem_uuid "$database_intent_uuid" || fail 'kernel UUID source returned an invalid UUID'
      write_database_intent \
        "$DATABASE_DEVICE" \
        "$canonical_database_device" \
        "$DATABASE_SIZE_BYTES" \
        "$database_major_minor" \
        "$database_intent_uuid"
      ;;
    format-from-intent|recover-from-intent|existing-managed) ;;
    *) fail 'internal database interruption decision is invalid' ;;
  esac

  if [ "$database_action" = create-intent ] || [ "$database_action" = format-from-intent ]; then
    # The journal write is intentionally before this check; it makes an
    # interruption recoverable, while this immediately-pre-mkfs recheck makes
    # every identity and blankness assumption fail closed.
    format_blank_database_target \
      "$DATABASE_DEVICE" \
      "$canonical_database_device" \
      "$DATABASE_SIZE_BYTES" \
      "$database_major_minor" \
      "$DATABASE_MOUNT_POINT" \
      "$database_intent_uuid"
    database_collect_metadata "$canonical_database_device"
    filesystem_type=$DATABASE_FILESYSTEM_TYPE
    filesystem_uuid=$DATABASE_FILESYSTEM_UUID
    filesystem_label=$DATABASE_FILESYSTEM_LABEL
    partition_table=$DATABASE_PARTITION_TABLE
    signatures=$DATABASE_SIGNATURES
  fi

  [ "$filesystem_type" = 'ext4' ] || fail 'database filesystem is not ext4 after initialization or recovery'
  [ "$filesystem_label" = "$DATABASE_EXPECTED_LABEL" ] || fail 'database filesystem label differs from the reviewed label'
  valid_filesystem_uuid "$filesystem_uuid" || fail 'database filesystem UUID is invalid after initialization or recovery'
  [ -z "$partition_table" ] || fail 'database filesystem has an unexpected partition-table signature'
  [ "$signatures" = 'ext4' ] || fail 'database filesystem has additional or unexpected signatures'
  if [ "$database_action" != existing-managed ]; then
    [ "$filesystem_uuid" = "$database_intent_uuid" ] ||
      fail 'database filesystem UUID differs from the exact format-intent journal'
  fi

  # This standalone uniqueness proof is mandatory even when fstab is empty;
  # conflict scanning alone would have no UUID row to resolve in that case.
  database_verify_uuid_unique_for_canonical "$filesystem_uuid" "$canonical_database_device"

  database_needs_marker=false
  [ "$database_action" = existing-managed ] || database_needs_marker=true

  [ ! -L "$DATABASE_MOUNT_POINT" ] || fail 'database mount point is a symbolic link'
  if [ ! -e "$DATABASE_MOUNT_POINT" ]; then
    # mkdir creates a new directory and fails if another actor wins the race;
    # unlike install -d it cannot chmod/chown a concurrently mounted root.
    mkdir -m 0700 "$DATABASE_MOUNT_POINT" ||
      fail 'cannot create the unmounted database mount point safely'
  fi
  [ -d "$DATABASE_MOUNT_POINT" ] || fail 'database mount point is not a directory'
  if database_mountpoint_is_mounted "$DATABASE_MOUNT_POINT"; then
    database_verify_mounted_target_identity \
      "$DATABASE_MOUNT_POINT" \
      "$canonical_database_device" \
      "$database_major_minor" \
      "$filesystem_uuid"
  else
    database_verify_unmounted_mountpoint_empty "$DATABASE_MOUNT_POINT"
  fi
  ensure_database_fstab "$filesystem_uuid" "$DATABASE_DEVICE" "$canonical_database_device" "$database_major_minor" "$DATABASE_MOUNT_POINT"

  if database_mountpoint_is_mounted "$DATABASE_MOUNT_POINT"; then
    database_verify_mounted_target_identity \
      "$DATABASE_MOUNT_POINT" \
      "$canonical_database_device" \
      "$database_major_minor" \
      "$filesystem_uuid"
  else
    mount "$DATABASE_MOUNT_POINT"
  fi
  database_require_probe 'mounted database filesystem type' findmnt -nro FSTYPE -M "$DATABASE_MOUNT_POINT"
  mounted_type=$(database_required_single_value 'mounted database filesystem type' "$DATABASE_PROBE_OUTPUT")
  database_require_probe 'mounted database options' findmnt -nro OPTIONS -M "$DATABASE_MOUNT_POINT"
  mounted_options=$(database_required_single_value 'mounted database options' "$DATABASE_PROBE_OUTPUT")
  database_collect_metadata "$canonical_database_device"
  mounted_uuid=$DATABASE_FILESYSTEM_UUID
  [ "$mounted_type" = 'ext4' ] || fail 'database mount has an unexpected filesystem type'
  [ "$mounted_uuid" = "$filesystem_uuid" ] || fail 'database mount UUID does not match the reviewed disk'
  database_secure_verified_mountpoint \
    "$DATABASE_MOUNT_POINT" \
    "$canonical_database_device" \
    "$database_major_minor" \
    "$filesystem_uuid" \
    "$database_needs_marker"
  for required_mount_option in nodev nosuid noexec; do
    printf '%s\n' "$mounted_options" | tr ',' '\n' | grep -Fqx "$required_mount_option" ||
      fail "database mount is missing required option: $required_mount_option"
  done
  database_marker_is_valid "$DATABASE_MOUNT_POINT" "$filesystem_uuid" ||
    fail 'database volume marker failed final verification'
  verify_database_current || fail 'database disk failed final current-state verification'
  rm -f "$DATABASE_INTENT"
  write_gate_marker database-disk
  refresh_contract
}

gate_current_valid() {
  current_gate=$1
  gate_marker_valid "$current_gate" || return 1
  case "$current_gate" in
    protected-directories) verify_protected_directories ;;
    ssh-hardening)
      ssh_config_content_matches && sshd -t && verify_effective_ssh &&
        { systemctl is-active --quiet ssh.service || systemctl is-active --quiet ssh.socket; }
      ;;
    unattended-upgrades)
      apt_config_content_matches && apt-config dump >/dev/null &&
        systemctl is-enabled --quiet apt-daily.timer &&
        systemctl is-enabled --quiet apt-daily-upgrade.timer
      ;;
    ufw) verify_ufw_state ;;
    swap) verify_swap_current ;;
    database-disk) verify_database_current && [ ! -e "$DATABASE_INTENT" ] && [ ! -L "$DATABASE_INTENT" ] ;;
    *) return 1 ;;
  esac
}

contract_matches_current_state() {
  [ -f "$CONTRACT" ] && [ ! -L "$CONTRACT" ] || return 1
  [ "$(stat -c '%U:%G:%a' "$CONTRACT" 2>/dev/null || true)" = 'root:root:600' ] || return 1
  verify_baseline_evidence || return 1
  if gate_marker_valid swap; then
    verify_swap_current || return 1
    check_swap_contract=swap-configured-and-verified
  else
    [ ! -e "$(marker_path swap)" ] && [ ! -L "$(marker_path swap)" ] || return 1
    check_swap_contract=swap-unconfigured
  fi
  if gate_marker_valid database-disk; then
    verify_database_current || return 1
    [ ! -e "$DATABASE_INTENT" ] && [ ! -L "$DATABASE_INTENT" ] || return 1
    check_database_contract=database-disk-mounted-and-verified
  else
    [ ! -e "$(marker_path database-disk)" ] && [ ! -L "$(marker_path database-disk)" ] || return 1
    check_database_contract=database-disk-unformatted
  fi
  check_expected_contract="existing-instance-baseline-remediated
runtime-deployment-pending
$check_swap_contract
$check_database_contract
cloudflare-tunnel-unconfigured"
  [ "$(cat "$CONTRACT" 2>/dev/null || true)" = "$check_expected_contract" ]
}

check_status() {
  printf 'Saveswitch existing-instance remediation status (read-only)\n'
  if [ "$(id -u)" -ne 0 ]; then
    for check_gate in protected-directories ssh-hardening unattended-upgrades ufw swap database-disk contract; do
      printf '  %-24s inaccessible-requires-root-read-check\n' "$check_gate"
    done
    printf '%s\n' 'No inaccessible evidence was reported as absent.'
    return 0
  fi

  for check_gate in protected-directories ssh-hardening unattended-upgrades ufw swap database-disk; do
    check_marker=$(marker_path "$check_gate")
    if [ -e "$check_marker" ] || [ -L "$check_marker" ]; then
      if gate_current_valid "$check_gate"; then
        printf '  %-24s complete-and-current\n' "$check_gate"
      else
        printf '  %-24s stale-invalid-or-drifted\n' "$check_gate"
      fi
    else
      printf '  %-24s absent\n' "$check_gate"
    fi
  done
  if [ -e "$CONTRACT" ] || [ -L "$CONTRACT" ]; then
    if contract_matches_current_state; then
      printf '  %-24s exact-and-current\n' contract
    else
      printf '  %-24s stale-invalid-or-drifted\n' contract
    fi
  else
    printf '  %-24s absent\n' contract
  fi
  printf '%s\n' 'Markers are accepted only with exact metadata, exact content, and current configuration evidence.'
}

if [ "${SAVESWITCH_LIBRARY_ONLY:-0}" = 1 ]; then
  return 0 2>/dev/null || exit 0
fi

if [ "$#" -gt 0 ]; then
  MODE=$1
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --gate)
      [ "$#" -ge 2 ] || fail '--gate requires a value'
      [ -z "$GATE" ] || fail 'only one --gate is allowed'
      GATE=$2
      shift 2
      ;;
    --admin-cidr)
      [ "$#" -ge 2 ] || fail '--admin-cidr requires a value'
      append_admin_cidr "$2"
      shift 2
      ;;
    --confirm-ufw-reset)
      [ "$#" -ge 2 ] || fail '--confirm-ufw-reset requires a value'
      [ -z "$CONFIRM_UFW" ] || fail '--confirm-ufw-reset may be supplied only once'
      CONFIRM_UFW=$2
      shift 2
      ;;
    --swap-file)
      [ "$#" -ge 2 ] || fail '--swap-file requires a value'
      [ -z "$SWAP_FILE" ] || fail '--swap-file may be supplied only once'
      SWAP_FILE=$2
      shift 2
      ;;
    --swap-size-mib)
      [ "$#" -ge 2 ] || fail '--swap-size-mib requires a value'
      [ -z "$SWAP_SIZE_MIB" ] || fail '--swap-size-mib may be supplied only once'
      SWAP_SIZE_MIB=$2
      shift 2
      ;;
    --confirm-swap)
      [ "$#" -ge 2 ] || fail '--confirm-swap requires a value'
      [ -z "$CONFIRM_SWAP" ] || fail '--confirm-swap may be supplied only once'
      CONFIRM_SWAP=$2
      shift 2
      ;;
    --database-device)
      [ "$#" -ge 2 ] || fail '--database-device requires a value'
      [ -z "$DATABASE_DEVICE" ] || fail '--database-device may be supplied only once'
      DATABASE_DEVICE=$2
      shift 2
      ;;
    --database-size-bytes)
      [ "$#" -ge 2 ] || fail '--database-size-bytes requires a value'
      [ -z "$DATABASE_SIZE_BYTES" ] || fail '--database-size-bytes may be supplied only once'
      DATABASE_SIZE_BYTES=$2
      shift 2
      ;;
    --database-mount-point)
      [ "$#" -ge 2 ] || fail '--database-mount-point requires a value'
      [ -z "$DATABASE_MOUNT_POINT" ] || fail '--database-mount-point may be supplied only once'
      DATABASE_MOUNT_POINT=$2
      shift 2
      ;;
    --confirm-database)
      [ "$#" -ge 2 ] || fail '--confirm-database requires a value'
      [ -z "$CONFIRM_DATABASE" ] || fail '--confirm-database may be supplied only once'
      CONFIRM_DATABASE=$2
      shift 2
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

case "$MODE" in
  help)
    [ -z "$GATE$ADMIN_CIDRS$CONFIRM_UFW$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
      fail 'help mode accepts no gate options'
    usage
    ;;
  check)
    [ -z "$GATE$ADMIN_CIDRS$CONFIRM_UFW$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
      fail 'check mode accepts no gate options'
    check_status
    ;;
  apply)
    require_root
    [ -n "$GATE" ] || fail 'apply mode requires exactly one --gate'
    for common_command in awk cat chown chmod cmp grep id install mktemp mv readlink rm sort stat systemctl; do
      require_command "$common_command"
    done
    case "$GATE" in
      protected-directories)
        [ -z "$ADMIN_CIDRS$CONFIRM_UFW$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
          fail 'protected-directories gate accepts no unrelated options'
        gate_protected_directories
        ;;
      ssh-hardening)
        [ -z "$ADMIN_CIDRS$CONFIRM_UFW$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
          fail 'ssh-hardening gate accepts no unrelated options'
        gate_ssh_hardening
        ;;
      unattended-upgrades)
        [ -z "$ADMIN_CIDRS$CONFIRM_UFW$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
          fail 'unattended-upgrades gate accepts no unrelated options'
        gate_unattended_upgrades
        ;;
      ufw)
        [ -z "$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
          fail 'ufw gate accepts no swap or database options'
        gate_ufw
        ;;
      swap)
        [ -z "$ADMIN_CIDRS$CONFIRM_UFW$DATABASE_DEVICE$DATABASE_SIZE_BYTES$DATABASE_MOUNT_POINT$CONFIRM_DATABASE" ] ||
          fail 'swap gate accepts no UFW or database options'
        gate_swap
        ;;
      database-disk)
        [ -z "$ADMIN_CIDRS$CONFIRM_UFW$SWAP_FILE$SWAP_SIZE_MIB$CONFIRM_SWAP" ] ||
          fail 'database-disk gate accepts no UFW or swap options'
        gate_database_disk
        ;;
      *) fail "unknown gate: $GATE" ;;
    esac
    printf 'Gate completed and verified: %s\n' "$GATE"
    ;;
  *) fail "unknown mode: $MODE" ;;
esac

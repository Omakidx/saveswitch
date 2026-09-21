#!/bin/sh
# Offline regression checks only. Do not execute the operational remediation
# script: parsing and contract inspection intentionally avoid the developer host.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
TEMPLATE=$ROOT/templates/bootstrap-user-data.sh.tftpl
REMEDIATION=$ROOT/scripts/remediate-existing-instance.sh
VALIDATOR=$ROOT/scripts/validate-user-data.sh

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

require_fixed() {
  needle=$1
  file=$2
  grep -Fq -- "$needle" "$file" || fail "missing required contract in $file: $needle"
}

reject_regex() {
  pattern=$1
  file=$2
  if grep -Eq -- "$pattern" "$file"; then
    fail "forbidden pattern in $file: $pattern"
  fi
}

sh "$VALIDATOR" "$TEMPLATE"
sh -n "$REMEDIATION"
if command -v dash >/dev/null 2>&1; then
  dash -n "$REMEDIATION"
fi

fixture_root=$(mktemp -d /tmp/saveswitch-bootstrap-fixtures.XXXXXX)
cleanup_fixtures() {
  case "$fixture_root" in
    /tmp/saveswitch-bootstrap-fixtures.*) rm -rf -- "$fixture_root" ;;
    *) fail 'refusing to clean an unexpected fixture path' ;;
  esac
}
trap cleanup_fixtures EXIT HUP INT TERM

# An attacker-controlled PATH must be replaced before the first external
# command. Help mode is the only operational-script entrypoint executed here;
# it cannot inspect or mutate host state.
mkdir "$fixture_root/attacker-bin"
cat >"$fixture_root/attacker-bin/cat" <<'FAKE_CAT_EOF'
#!/bin/sh
: >"$SAVESWITCH_PATH_SENTINEL"
exec /bin/cat "$@"
FAKE_CAT_EOF
chmod 0755 "$fixture_root/attacker-bin/cat"
SAVESWITCH_PATH_SENTINEL=$fixture_root/path-hijacked \
PATH=$fixture_root/attacker-bin \
  "$REMEDIATION" help >/dev/null
[ ! -e "$fixture_root/path-hijacked" ] || fail 'remediation resolved a command through attacker-controlled PATH'
if "$REMEDIATION" help --gate swap >/dev/null 2>&1; then
  fail 'help mode accepted a mutation gate'
fi

# Source pure helpers without entering argument parsing or any operational gate.
SAVESWITCH_LIBRARY_ONLY=1 . "$REMEDIATION"

# UFW CIDR contracts must validate every physical line, including an
# unterminated final line. The stat function is a fixture-only metadata stub;
# no host file or real UFW command is touched.
ufw_contract_validation_fixture=$fixture_root/ufw-contract-validation
stat() {
  if [ "$1" = '-c' ] && [ "$2" = '%U:%G:%a' ]; then
    printf '%s\n' 'root:root:600'
    return 0
  fi
  command stat "$@"
}
UFW_CIDR_CONTRACT=$ufw_contract_validation_fixture
printf '%s\n' '198.51.100.10/32' >"$ufw_contract_validation_fixture"
ufw_contract_valid || fail 'valid UFW /32 contract was rejected'
printf '%s\n' '198.51.100.10' >"$ufw_contract_validation_fixture"
if ufw_contract_valid; then
  fail 'UFW contract accepted a bare final host line with a trailing newline'
fi
printf '%s' '198.51.100.10' >"$ufw_contract_validation_fixture"
if ufw_contract_valid; then
  fail 'UFW contract accepted a bare unterminated final host line'
fi
unset -f stat 2>/dev/null || true
UFW_CIDR_CONTRACT=/etc/saveswitch/ufw-admin-cidrs

# fstab candidate fixtures: empty, missing final newline, malformed input, and
# source/target conflict detection. Only temporary files are touched.
empty_fstab=$fixture_root/fstab-empty
no_newline_fstab=$fixture_root/fstab-no-newline
malformed_fstab=$fixture_root/fstab-malformed
conflict_fstab=$fixture_root/fstab-conflict
candidate_fstab=$fixture_root/fstab-candidate
: >"$empty_fstab"
saveswitch_build_validated_fstab_candidate "$empty_fstab" "$candidate_fstab" 'proc /proc proc defaults 0 0' ||
  fail 'empty fstab candidate did not validate'
grep -Fqx 'proc /proc proc defaults 0 0' "$candidate_fstab" || fail 'empty fstab lost reviewed entry'
printf '%s' 'proc /proc proc defaults 0 0' >"$no_newline_fstab"
saveswitch_build_validated_fstab_candidate "$no_newline_fstab" "$candidate_fstab" 'tmpfs /tmp tmpfs defaults 0 0' ||
  fail 'no-final-newline fstab candidate did not validate'
grep -Fqx 'tmpfs /tmp tmpfs defaults 0 0' "$candidate_fstab" || fail 'fstab entry was concatenated without a separator'
printf '%s\n' 'this is malformed' >"$malformed_fstab"
malformed_before=$(sha256sum "$malformed_fstab" | awk '{print $1}')
if saveswitch_build_validated_fstab_candidate "$malformed_fstab" "$candidate_fstab" 'proc /proc proc defaults 0 0'; then
  fail 'malformed fstab candidate unexpectedly validated'
fi
[ "$(sha256sum "$malformed_fstab" | awk '{print $1}')" = "$malformed_before" ] ||
  fail 'failed fstab validation modified the original'
printf '%s\n' 'UUID=wrong /srv/saveswitch/postgres ext4 defaults 0 2' >"$conflict_fstab"
[ -n "$(saveswitch_fstab_related_lines "$conflict_fstab" 'UUID=reviewed' '/srv/saveswitch/postgres')" ] ||
  fail 'conflicting fstab target was not detected'
if saveswitch_build_validated_fstab_candidate "$fixture_root/missing-fstab" "$candidate_fstab" 'proc /proc proc defaults 0 0' 2>/dev/null; then
  fail 'missing fstab source was accepted for candidate replacement'
fi

# Dormant swap rows must be rejected even when /proc/swaps would be empty.
printf '%s\n' '/oldswap none swap sw 0 0' >"$fixture_root/fstab-dormant-swap"
FSTAB_FILE=$fixture_root/fstab-dormant-swap
if (validate_swap_fstab /swapfile 2>/dev/null); then
  fail 'dormant non-/swapfile fstab row was accepted'
fi
printf '%s\n' '/swapfile none swap sw 0 0' >"$fixture_root/fstab-reviewed-swap"
FSTAB_FILE=$fixture_root/fstab-reviewed-swap
(validate_swap_fstab /swapfile) || fail 'exact reviewed dormant swap row was rejected'
FSTAB_FILE=/etc/fstab

# A forced mid-gate failure after begin_gate must leave both old evidence files
# absent. The fixture redirects all state to the protected temporary tree.
GATE_DIRECTORY=$fixture_root/gates
CONTRACT=$fixture_root/bootstrap-contract
mkdir "$GATE_DIRECTORY"
printf '%s\n' 'ufw-complete' >"$GATE_DIRECTORY/ufw.complete"
printf '%s\n' 'stale-contract' >"$CONTRACT"
chmod 0600 "$GATE_DIRECTORY/ufw.complete" "$CONTRACT"
if (begin_gate ufw; false); then
  fail 'fault injection unexpectedly succeeded'
fi
[ ! -e "$GATE_DIRECTORY/ufw.complete" ] || fail 'stale gate marker survived fault injection'
[ ! -e "$CONTRACT" ] || fail 'stale aggregate contract survived fault injection'
printf '%s\n' 'wrong-content' >"$GATE_DIRECTORY/ufw.complete"
chmod 0600 "$GATE_DIRECTORY/ufw.complete"
if gate_marker_valid ufw; then
  fail 'gate marker accepted wrong content'
fi
printf '%s\n' 'ufw-complete' >"$GATE_DIRECTORY/ufw.complete"
chmod 0644 "$GATE_DIRECTORY/ufw.complete"
if gate_marker_valid ufw; then
  fail 'gate marker accepted unsafe mode'
fi
rm -f "$GATE_DIRECTORY/ufw.complete"

# UFW can canonicalize an IPv4 /32 source to a bare host address. The verifier
# must accept both complete-token display forms, but never a prefix/suffix
# match, a different protocol/port, or any extra inbound allow rule. These
# fixtures call the pure AWK parser directly; no real UFW binary is invoked.
ufw_contract_fixture=$fixture_root/ufw-admin-cidrs
printf '%s\n' '198.51.100.10/32' >"$ufw_contract_fixture"
ufw_status_common='Status: active
Logging: on (low)
Default: deny (incoming), allow (outgoing), disabled (routed)

To                         Action      From
--                         ------      ----
Anywhere on lo             ALLOW IN    Anywhere
Anywhere (v6) on lo        ALLOW IN    Anywhere (v6)'
printf '%s\n%s\n' "$ufw_status_common" '22/tcp                     ALLOW IN    198.51.100.10' |
  ufw_status_matches_contract "$ufw_contract_fixture" ||
  fail 'UFW verifier rejected canonical bare-host /32 display'
printf '%s\n%s\n' "$ufw_status_common" '22/tcp                     ALLOW IN    198.51.100.10/32' |
  ufw_status_matches_contract "$ufw_contract_fixture" ||
  fail 'UFW verifier rejected explicit /32 display'
printf '%s\n%s\n' "$ufw_status_common" '22/tcp                     ALLOW IN    198.51.100.10 # Saveswitch break-glass SSH' |
  ufw_status_matches_contract "$ufw_contract_fixture" ||
  fail 'UFW verifier rejected a reviewed UFW comment suffix'
if printf '%s\n%s\n' "$ufw_status_common" '22/tcp                     ALLOW IN    198.51.100.100' |
  ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted a near-match host token'
fi
if printf '%s\n%s\n' "$ufw_status_common" '22                         ALLOW IN    198.51.100.10' |
  ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted an unreviewed SSH protocol form'
fi
if {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '443/tcp                    ALLOW IN    198.51.100.10'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted an unreviewed inbound allow rule'
fi
if {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '443/tcp                    LIMIT IN    Anywhere'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted an unreviewed inbound limit rule'
fi
if {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '443/tcp                    ALLOW FWD   Anywhere'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted an unreviewed forwarding allow rule'
fi
if {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '443/tcp                    LIMIT FWD   Anywhere'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted an unreviewed forwarding limit rule'
fi
if {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.0/24'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted a broader IPv4 source rule'
fi
if {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '22/tcp (v6)                ALLOW IN    Anywhere (v6)'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier accepted a public IPv6 source rule'
fi
printf '%s\n' '198.51.100.10/32' '198.51.100.11/32' >"$ufw_contract_fixture"
if ! {
  printf '%s\n' "$ufw_status_common"
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.10'
  printf '%s\n' '22/tcp                     ALLOW IN    198.51.100.11/32'
} | ufw_status_matches_contract "$ufw_contract_fixture"; then
  fail 'UFW verifier rejected exact rules for multiple reviewed /32 contracts'
fi

# UFW recovery is exercised with a shell-function mock only. It must rebuild
# default deny, loopback, reviewed SSH, and enable state before propagating the
# failure status; no real ufw binary is invoked.
ufw_log=$fixture_root/ufw.log
ADMIN_CIDRS='198.51.100.10/32'
SAVESWITCH_UFW_RECOVERY_ACTIVE=true
ufw() {
  printf '%s' 'CALL' >>"$ufw_log"
  for mocked_ufw_arg in "$@"; do
    printf '|%s' "$mocked_ufw_arg" >>"$ufw_log"
  done
  printf '\n' >>"$ufw_log"
  return 0
}
set +e
(ufw_recover 77)
ufw_recovery_status=$?
set -e
[ "$ufw_recovery_status" -eq 77 ] || fail 'mock UFW recovery did not preserve failure status'
grep -Fqx 'CALL|--force|reset' "$ufw_log" || fail 'mock UFW recovery omitted reset'
grep -Fqx 'CALL|default|deny|incoming' "$ufw_log" || fail 'mock UFW recovery omitted default deny'
grep -Fq '|from|198.51.100.10/32|' "$ufw_log" || fail 'mock UFW recovery omitted reviewed SSH /32'
grep -Fqx 'CALL|--force|enable' "$ufw_log" || fail 'mock UFW recovery omitted enable'
[ ! -e "$GATE_DIRECTORY/ufw.complete" ] || fail 'UFW recovery recreated stale gate evidence'
[ ! -e "$CONTRACT" ] || fail 'UFW recovery recreated stale aggregate evidence'
unset -f ufw 2>/dev/null || true

ufw_fault_log=$fixture_root/ufw-fault.log
ufw_fail_once=$fixture_root/ufw-fail-once
ufw() {
  printf 'CALL' >>"$ufw_fault_log"
  for mocked_ufw_arg in "$@"; do
    printf '|%s' "$mocked_ufw_arg" >>"$ufw_fault_log"
  done
  printf '\n' >>"$ufw_fault_log"
  if [ "$1" = allow ] && [ "${2:-}" = out ] && [ ! -e "$ufw_fail_once" ]; then
    : >"$ufw_fail_once"
    return 42
  fi
  return 0
}
set +e
(
  set -e
  SAVESWITCH_UFW_RECOVERY_ACTIVE=true
  trap 'ufw_recover $?' 0
  trap 'ufw_recover 129' 1
  trap 'ufw_recover 130' 2
  trap 'ufw_recover 143' 15
  configure_ufw_from_admin_cidrs
  SAVESWITCH_UFW_RECOVERY_ACTIVE=false
  trap - 0 1 2 15
)
ufw_fault_status=$?
set -e
[ "$ufw_fault_status" -eq 42 ] || fail 'mock mid-UFW failure did not propagate its status'
[ "$(grep -Fc 'CALL|--force|reset' "$ufw_fault_log")" -eq 2 ] ||
  fail 'mock mid-UFW failure did not trigger one recovery reconstruction'
grep -Fqx 'CALL|--force|enable' "$ufw_fault_log" ||
  fail 'mock mid-UFW recovery did not re-enable firewall'
unset -f ufw 2>/dev/null || true

# Pure database interruption decisions and exact journal content checks model
# failure immediately before/after mkfs without touching any block device.
fixed_uuid=12345678-1234-4123-8123-123456789abc
valid_filesystem_uuid "$fixed_uuid" || fail 'fixed fixture UUID was rejected'
[ "$(database_interruption_decision true true '' false false false)" = format-from-intent ] ||
  fail 'blank exact-journal state is not recoverable'
[ "$(database_interruption_decision true true ext4 true true false)" = recover-from-intent ] ||
  fail 'matching ext4 exact-journal state is not recoverable'
[ "$(database_interruption_decision false false ext4 true false true)" = existing-managed ] ||
  fail 'managed ext4 marker state was rejected'
if database_interruption_decision false false ext4 true false false >/dev/null 2>&1; then
  fail 'arbitrary labeled ext4 without marker was accepted'
fi
if database_interruption_decision true false ext4 true true false >/dev/null 2>&1; then
  fail 'mismatched interruption journal was accepted'
fi
cat >"$fixture_root/database.intent" <<INTENT_EOF
version=1
stable_device=/dev/disk/by-id/reviewed
canonical_device=/dev/example
size_bytes=17179869184
major_minor=259:1
filesystem_label=saveswitch-postgres
filesystem_uuid=$fixed_uuid
INTENT_EOF
database_intent_content_matches \
  "$fixture_root/database.intent" \
  /dev/disk/by-id/reviewed \
  /dev/example \
  17179869184 \
  259:1 \
  "$fixed_uuid" || fail 'exact interruption journal fixture was rejected'
# The repaired script intentionally accepts the exact legacy overlength-label
# journal so the already-formatted, UUID-bound disk can resume without mkfs.
sed 's/filesystem_label=saveswitch-postgres/filesystem_label=saveswitch-postg/' \
  "$fixture_root/database.intent" >"$fixture_root/database-current.intent"
database_intent_content_matches \
  "$fixture_root/database-current.intent" \
  /dev/disk/by-id/reviewed \
  /dev/example \
  17179869184 \
  259:1 \
  "$fixed_uuid" || fail 'current ext4-safe interruption journal fixture was rejected'
[ "${#DATABASE_EXPECTED_LABEL}" -le 16 ] || fail 'reviewed ext4 label exceeds 16 bytes'
[ "$DATABASE_EXPECTED_LABEL" = saveswitch-postg ] || fail 'reviewed recovery label changed unexpectedly'
if database_intent_content_matches \
  "$fixture_root/database.intent" \
  /dev/disk/by-id/reviewed \
  /dev/different \
  17179869184 \
  259:1 \
  "$fixed_uuid"; then
  fail 'canonical-device journal mismatch was accepted'
fi

# Database-disk safety probes are exercised with shell-function mocks. These
# fixtures never reference a real block device: every rejection must happen
# before the mocked mkfs function can create its sentinel.
database_probe_sentinel=$fixture_root/mkfs-reached
database_fixture_uuid=12345678-1234-4123-8123-8123456789ab

[ "$(saveswitch_normalize_fstab_field 'LABEL=saveswitch\055postgres')" = 'LABEL=saveswitch-postgres' ] ||
  fail 'octal-escaped fstab label did not normalize canonically'
[ "$(saveswitch_normalize_fstab_field '"UUID=12345678-1234-4123-8123-8123456789ab"')" = "UUID=$database_fixture_uuid" ] ||
  fail 'whole-field quoted fstab UUID did not normalize canonically'
[ "$(saveswitch_normalize_fstab_field '/dev\057disk\057by-id\057mock')" = '/dev/disk/by-id/mock' ] ||
  fail 'octal-escaped fstab device did not normalize canonically'
[ "$(saveswitch_normalize_fstab_field '/srv\057saveswitch\057postgres')" = '/srv/saveswitch/postgres' ] ||
  fail 'octal-escaped fstab target did not normalize canonically'
if saveswitch_normalize_fstab_field 'LABEL=saveswitch\x2dpostgres' >/dev/null 2>&1; then
  fail 'unsupported fstab escape was normalized instead of rejected'
fi
database_symlink_real=$fixture_root/fstab-target-real
database_symlink_alias=$fixture_root/fstab-target-alias
mkdir "$database_symlink_real"
ln -s "$database_symlink_real" "$database_symlink_alias"
database_symlink_line="tmpfs $database_symlink_alias/postgres tmpfs defaults 0 0"
[ "$(database_fstab_device_conflicts \
  "$database_symlink_line" \
  /dev/disk/by-id/mock \
  /dev/mock \
  259:7 \
  "$database_symlink_real/postgres")" = "$database_symlink_line" ] ||
  fail 'fstab target symlink component evaded canonical target matching'

database_fixture_identity() {
  database_stable_identity_is_link() { return 0; }
  database_block_device_exists() { return 0; }
  database_holders_directory_available() { return 0; }
  device_is_active_swap() { return 0; }
  find() { return 0; }
  top_level_disk() {
    case "$1" in
      /dev/root) printf '%s\n' /dev/root-disk ;;
      *) printf '%s\n' /dev/mock-disk ;;
    esac
  }
  readlink() { printf '%s\n' /dev/mock; }
  findmnt() {
    [ "$1" = -nro ] && [ "$2" = SOURCE ] && [ "$3" = / ] && {
      printf '%s\n' /dev/root
      return 0
    }
    return 43
  }
  lsblk() {
    case "$2" in
      TYPE) printf '%s\n' disk ;;
      NAME) printf '%s\n' /dev/mock ;;
      MAJ:MIN) printf '%s\n' 259:7 ;;
      *) return 44 ;;
    esac
  }
  blockdev() {
    case "$1" in
      --getro) printf '%s\n' 0 ;;
      --getsize64) printf '%s\n' 17179869184 ;;
      *) return 45 ;;
    esac
  }
}

database_fixture_blank_metadata() {
  blkid() { return 2; }
  wipefs() { return 0; }
  lsblk() {
    [ "$2" = PTTYPE ] && return 0
    return 46
  }
}

# blkid status 2 with empty output is an allowed no-identifier result only when
# the independent PTTYPE and wipefs probes also succeed and stay empty.
if (
  database_fixture_blank_metadata
  database_collect_metadata /dev/mock
); then :; else
  fail 'blank blkid status 2 fixture was rejected'
fi
if (
  blkid() { return 3; }
  wipefs() { return 0; }
  lsblk() { [ "$2" = PTTYPE ] && return 0; return 46; }
  database_collect_metadata /dev/mock
); then
  fail 'unsupported blkid failure was accepted as a blank disk'
fi
if (
  blkid() { return 0; }
  wipefs() { return 0; }
  lsblk() { [ "$2" = PTTYPE ] && return 0; return 46; }
  database_collect_metadata /dev/mock
); then
  fail 'empty successful blkid output was accepted as a blank disk'
fi
if (
  blkid() { printf '%s\n' 'USAGE=filesystem'; return 0; }
  wipefs() { return 0; }
  lsblk() { [ "$2" = PTTYPE ] && return 0; return 46; }
  database_collect_metadata /dev/mock
); then
  fail 'unrecognized successful blkid metadata was accepted as a blank disk'
fi
if (
  blkid() { printf '%s\n' 'TYPE=ext4'; return 2; }
  wipefs() { return 0; }
  lsblk() { [ "$2" = PTTYPE ] && return 0; return 46; }
  database_collect_metadata /dev/mock
); then
  fail 'nonempty blkid status-2 output was accepted as a blank disk'
fi
if (
  blkid() { return 2; }
  lsblk() { [ "$2" = PTTYPE ] && return 47; return 46; }
  wipefs() { return 0; }
  database_collect_metadata /dev/mock
); then
  fail 'lsblk PTTYPE failure was accepted as no partition table'
fi
if (
  blkid() { return 2; }
  lsblk() { [ "$2" = PTTYPE ] && return 0; return 46; }
  wipefs() { return 48; }
  database_collect_metadata /dev/mock
); then
  fail 'wipefs failure was accepted as no signature'
fi

# No mount is accepted only when both independently successful graphs agree.
if (
  findmnt() { return 49; }
  lsblk() { [ "$2" = MOUNTPOINTS ] && return 0; return 46; }
  database_collect_mount_state /dev/mock /srv/saveswitch/postgres
); then
  fail 'findmnt graph failure was accepted as no mount'
fi
if (
  findmnt() { return 0; }
  lsblk() { [ "$2" = MOUNTPOINTS ] && return 50; return 46; }
  database_collect_mount_state /dev/mock /srv/saveswitch/postgres
); then
  fail 'lsblk MOUNTPOINTS failure was accepted as no mount'
fi
if (
  findmnt() { return 0; }
  lsblk() { [ "$2" = MOUNTPOINTS ] && { printf '%s\n' /unexpected; return 0; }; return 46; }
  database_collect_mount_state /dev/mock /srv/saveswitch/postgres
); then
  fail 'mount graph disagreement was accepted'
fi
if (
  awk() { return 58; }
  device_is_active_swap /dev/mock
); then
  fail 'active-swap probe failure was accepted as no swap use'
fi
if (
  stat() {
    [ "$1" = -c ] && { printf '%s\n' root:root:700; return 0; }
    return 57
  }
  find() { return 59; }
  database_verify_unmounted_mountpoint_empty /srv/saveswitch/postgres
); then
  fail 'mountpoint emptiness find failure was accepted as an empty directory'
fi
if (
  stat() {
    [ "$1" = -c ] && { printf '%s\n' root:root:755; return 0; }
    return 57
  }
  find() { return 0; }
  database_verify_unmounted_mountpoint_empty /srv/saveswitch/postgres
); then
  fail 'unsafe unmounted mountpoint ownership/mode was accepted'
fi
if (
  printf() { return 60; }
  saveswitch_build_validated_fstab_candidate "$empty_fstab" "$candidate_fstab" 'proc /proc proc defaults 0 0'
); then
  fail 'candidate fstab append printf failure was accepted'
fi

# The format wrapper is the only code path that calls mkfs for a blank disk.
# Each pre-format fault below must leave its mocked mkfs sentinel absent.
assert_format_recheck_blocks_mkfs() {
  database_fault_name=$1
  rm -f "$database_probe_sentinel"
  if (
    database_fixture_identity
    fstab_active_lines() { :; }
    database_mkfs_ext4() { : >"$database_probe_sentinel"; }
    case "$database_fault_name" in
      readlink)
        readlink() { return 51; }
        ;;
      rebind)
        readlink() { printf '%s\n' /dev/rebound; }
        ;;
      size)
        blockdev() {
          case "$1" in
            --getro) printf '%s\n' 0 ;;
            --getsize64) printf '%s\n' 1 ;;
            *) return 45 ;;
          esac
        }
        ;;
      major-minor)
        lsblk() {
          case "$2" in
            TYPE) printf '%s\n' disk ;;
            NAME) printf '%s\n' /dev/mock ;;
            MAJ:MIN) printf '%s\n' malformed ;;
            *) return 44 ;;
          esac
        }
        ;;
      findmnt)
        findmnt() {
          [ "$1" = -nro ] && [ "$2" = SOURCE ] && [ "$3" = / ] && {
            printf '%s\n' /dev/root
            return 0
          }
          return 49
        }
        lsblk() {
          case "$2" in
            TYPE) printf '%s\n' disk ;;
            NAME) printf '%s\n' /dev/mock ;;
            MAJ:MIN) printf '%s\n' 259:7 ;;
            MOUNTPOINTS) return 0 ;;
            *) return 44 ;;
          esac
        }
        ;;
      mountpoints)
        findmnt() {
          [ "$1" = -nro ] && [ "$2" = SOURCE ] && [ "$3" = / ] && {
            printf '%s\n' /dev/root
            return 0
          }
          [ "$1" = -rn ] && [ "$2" = -o ] && [ "$3" = SOURCE,TARGET ] && return 0
          return 49
        }
        lsblk() {
          case "$2" in
            TYPE) printf '%s\n' disk ;;
            NAME) printf '%s\n' /dev/mock ;;
            MAJ:MIN) printf '%s\n' 259:7 ;;
            MOUNTPOINTS) return 50 ;;
            *) return 44 ;;
          esac
        }
        ;;
      blkid|pttype|wipefs)
        database_collect_mount_state() { DATABASE_MOUNTED_TARGETS=; }
        case "$database_fault_name" in
          blkid) blkid() { return 3; } ;;
          pttype) blkid() { return 2; } ;;
          wipefs) blkid() { return 2; } ;;
        esac
        lsblk() {
          case "$2" in
            TYPE) printf '%s\n' disk ;;
            NAME) printf '%s\n' /dev/mock ;;
            MAJ:MIN) printf '%s\n' 259:7 ;;
            PTTYPE)
              [ "$database_fault_name" = pttype ] && return 47
              return 0
              ;;
            *) return 44 ;;
          esac
        }
        wipefs() {
          [ "$database_fault_name" = wipefs ] && return 48
          return 0
        }
        ;;
      fstab)
        database_collect_mount_state() { DATABASE_MOUNTED_TARGETS=; }
        database_collect_metadata() {
          DATABASE_FILESYSTEM_TYPE=
          DATABASE_FILESYSTEM_UUID=
          DATABASE_FILESYSTEM_LABEL=
          DATABASE_PARTITION_TABLE=
          DATABASE_SIGNATURES=
        }
        fstab_active_lines() { return 73; }
        ;;
      alias|label|label-octal|label-quoted|uuid-octal|dev-octal|target-octal|target-quoted|target-trailing|target-double-slash|target-dot|target-resolver)
        database_collect_mount_state() { DATABASE_MOUNTED_TARGETS=; }
        database_collect_metadata() {
          DATABASE_FILESYSTEM_TYPE=
          DATABASE_FILESYSTEM_UUID=
          DATABASE_FILESYSTEM_LABEL=
          DATABASE_PARTITION_TABLE=
          DATABASE_SIGNATURES=
        }
        case "$database_fault_name" in
          label)
            fstab_active_lines() { printf '%s\n' 'LABEL=saveswitch-postgres /unreviewed ext4 defaults 0 2'; }
            ;;
          label-octal)
            fstab_active_lines() { printf '%s\n' 'LABEL=saveswitch\055postgres /unreviewed ext4 defaults 0 2'; }
            ;;
          label-quoted)
            fstab_active_lines() { printf '%s\n' '"LABEL=saveswitch-postgres" /unreviewed ext4 defaults 0 2'; }
            ;;
          uuid-octal)
            fstab_active_lines() { printf '%s\n' 'UUID=12345678\0551234-4123-8123-8123456789ab /unreviewed ext4 defaults 0 2'; }
            blkid() { printf '%s\n' /dev/mock; }
            ;;
          dev-octal)
            fstab_active_lines() { printf '%s\n' '/dev\057disk\057by-id\057mock /unreviewed ext4 defaults 0 2'; }
            ;;
          target-octal)
            fstab_active_lines() { printf '%s\n' 'tmpfs /srv\057saveswitch\057postgres tmpfs defaults 0 0'; }
            ;;
          target-quoted)
            fstab_active_lines() { printf '%s\n' 'tmpfs "/srv/saveswitch/postgres" tmpfs defaults 0 0'; }
            ;;
          target-trailing)
            fstab_active_lines() { printf '%s\n' 'tmpfs /srv/saveswitch/postgres/ tmpfs defaults 0 0'; }
            ;;
          target-double-slash)
            fstab_active_lines() { printf '%s\n' 'tmpfs /srv//saveswitch/postgres tmpfs defaults 0 0'; }
            ;;
          target-dot)
            fstab_active_lines() { printf '%s\n' 'tmpfs /srv/saveswitch/./postgres tmpfs defaults 0 0'; }
            ;;
          target-resolver)
            fstab_active_lines() { printf '%s\n' 'tmpfs /srv/saveswitch/postgres/ tmpfs defaults 0 0'; }
            database_readlink_m() { return 65; }
            ;;
          *)
            fstab_active_lines() { printf '%s\n' '/dev/disk/by-path/alternate /unreviewed ext4 defaults 0 2'; }
            ;;
        esac
        ;;
      type)
        lsblk() {
          case "$2" in
            TYPE) printf '%s\n' part ;;
            *) return 44 ;;
          esac
        }
        ;;
      read-only)
        blockdev() {
          case "$1" in
            --getro) printf '%s\n' 1 ;;
            --getsize64) printf '%s\n' 17179869184 ;;
            *) return 45 ;;
          esac
        }
        ;;
      children)
        lsblk() {
          case "$2" in
            TYPE) printf '%s\n' disk ;;
            NAME) printf '%s\n' /dev/mock /dev/mockp1 ;;
            *) return 44 ;;
          esac
        }
        ;;
      holders)
        find() { printf '%s\n' holder; }
        ;;
      root)
        top_level_disk() { printf '%s\n' /dev/same; }
        ;;
      swap)
        device_is_active_swap() { return 1; }
        ;;
      *)
        database_collect_mount_state() { DATABASE_MOUNTED_TARGETS=; }
        database_collect_metadata() {
          DATABASE_FILESYSTEM_TYPE=
          DATABASE_FILESYSTEM_UUID=
          DATABASE_FILESYSTEM_LABEL=
          DATABASE_PARTITION_TABLE=
          DATABASE_SIGNATURES=
        }
        ;;
    esac
    format_blank_database_target \
      /dev/disk/by-id/mock \
      /dev/mock \
      17179869184 \
      259:7 \
      /srv/saveswitch/postgres \
      "$database_fixture_uuid"
  ); then
    fail "database $database_fault_name fault reached format wrapper successfully"
  fi
  [ ! -e "$database_probe_sentinel" ] ||
    fail "database $database_fault_name fault reached mocked mkfs"
}

for database_fault in readlink rebind size major-minor findmnt mountpoints blkid pttype wipefs fstab alias label label-octal label-quoted uuid-octal dev-octal target-octal target-quoted target-trailing target-double-slash target-dot target-resolver type read-only children holders root swap; do
  assert_format_recheck_blocks_mkfs "$database_fault"
done

rm -f "$database_probe_sentinel"
(
  database_fixture_identity
  database_collect_mount_state() { DATABASE_MOUNTED_TARGETS=; }
  database_collect_metadata() {
    DATABASE_FILESYSTEM_TYPE=
    DATABASE_FILESYSTEM_UUID=
    DATABASE_FILESYSTEM_LABEL=
    DATABASE_PARTITION_TABLE=
    DATABASE_SIGNATURES=
  }
  fstab_active_lines() { :; }
  database_mkfs_ext4() { : >"$database_probe_sentinel"; }
  format_blank_database_target \
    /dev/disk/by-id/mock \
    /dev/mock \
    17179869184 \
    259:7 \
    /srv/saveswitch/postgres \
    "$database_fixture_uuid"
) || fail 'clean blank database fixture was rejected before mocked mkfs'
[ -f "$database_probe_sentinel" ] || fail 'clean blank database fixture did not reach mocked mkfs after immediate recheck'
rm -f "$database_probe_sentinel"

# A matching UUID alone is insufficient: a clone must not satisfy the mounted
# identity check when the UUID lookup resolves more than one device.
if (
  database_block_device_exists() { return 0; }
  findmnt() {
    [ "$1" = -nro ] && [ "$2" = SOURCE ] && [ "$3" = -M ] && {
      printf '%s\n' /dev/mock
      return 0
    }
    return 54
  }
  readlink() {
    case "$2" in
      /dev/mock) printf '%s\n' /dev/mock ;;
      /dev/clone) printf '%s\n' /dev/clone ;;
      *) return 55 ;;
    esac
  }
  lsblk() {
    [ "$2" = MAJ:MIN ] && { printf '%s\n' 259:7; return 0; }
    return 56
  }
  blkid() {
    [ "$1" = -o ] && { printf '%s\n' /dev/mock /dev/clone; return 0; }
    return 57
  }
  database_verify_mounted_target_identity \
    /srv/saveswitch/postgres /dev/mock 259:7 "$database_fixture_uuid"
); then
  fail 'same-UUID clone set was accepted for the mounted database disk'
fi

# A nonblank/recovery filesystem must not be allowed to retain another stable
# alias for the same major:minor identity in fstab.
if (
  fstab_active_lines() { printf '%s\n' '/dev/disk/by-path/alternate /unreviewed ext4 defaults 0 2'; }
  database_block_device_exists() { return 0; }
  readlink() { printf '%s\n' /dev/mock; }
  lsblk() {
    [ "$2" = MAJ:MIN ] && { printf '%s\n' 259:7; return 0; }
    return 61
  }
  ensure_database_fstab "$database_fixture_uuid" /dev/disk/by-id/mock /dev/mock 259:7 /srv/saveswitch/postgres
); then
  fail 'recovery fstab alternate alias was accepted'
fi

# A duplicated UUID must fail before fstab append or mount preparation.  The
# all-device lookup is deliberately used instead of blkid -U/list-one.
database_fstab_append_sentinel=$fixture_root/database-fstab-appended
rm -f "$database_fstab_append_sentinel"
if (
  fstab_active_lines() {
    printf '%s\n' "UUID=$database_fixture_uuid /unreviewed ext4 defaults 0 2"
  }
  blkid() {
    [ "$1" = -o ] && [ "$2" = device ] && {
      printf '%s\n' /dev/mock /dev/clone
      return 0
    }
    return 62
  }
  database_block_device_exists() { return 0; }
  append_fstab_line() { : >"$database_fstab_append_sentinel"; }
  ensure_database_fstab "$database_fixture_uuid" /dev/disk/by-id/mock /dev/mock 259:7 /srv/saveswitch/postgres
); then
  fail 'duplicate-UUID fstab source was accepted'
fi
[ ! -e "$database_fstab_append_sentinel" ] ||
  fail 'duplicate-UUID fstab source reached append mutation'

# The managed filesystem label is also a reserved alias.  Rejecting it in the
# blank format fixture above and in this recovery fixture prevents a second
# UUID entry from coexisting with LABEL=saveswitch-postgres elsewhere.
rm -f "$database_fstab_append_sentinel"
if (
  fstab_active_lines() {
    printf '%s\n' 'LABEL=saveswitch-postgres /unreviewed ext4 defaults 0 2'
  }
  append_fstab_line() { : >"$database_fstab_append_sentinel"; }
  ensure_database_fstab "$database_fixture_uuid" /dev/disk/by-id/mock /dev/mock 259:7 /srv/saveswitch/postgres
); then
  fail 'managed LABEL fstab source was accepted during recovery'
fi
[ ! -e "$database_fstab_append_sentinel" ] ||
  fail 'managed LABEL fstab source reached append mutation'

assert_encoded_recovery_fstab_conflict() {
  encoded_conflict_name=$1
  encoded_conflict_line=$2
  rm -f "$database_fstab_append_sentinel"
  if (
    fstab_active_lines() { printf '%s\n' "$encoded_conflict_line"; }
    blkid() {
      [ "$1" = -o ] && [ "$2" = device ] && { printf '%s\n' /dev/mock; return 0; }
      return 63
    }
    database_block_device_exists() { return 0; }
    readlink() { printf '%s\n' /dev/mock; }
    lsblk() {
      [ "$2" = MAJ:MIN ] && { printf '%s\n' 259:7; return 0; }
      return 64
    }
    append_fstab_line() { : >"$database_fstab_append_sentinel"; }
    ensure_database_fstab "$database_fixture_uuid" /dev/disk/by-id/mock /dev/mock 259:7 /srv/saveswitch/postgres
  ); then
    fail "encoded recovery fstab conflict was accepted: $encoded_conflict_name"
  fi
  [ ! -e "$database_fstab_append_sentinel" ] ||
    fail "encoded recovery fstab conflict reached append mutation: $encoded_conflict_name"
}

assert_encoded_recovery_fstab_conflict label-octal \
  'LABEL=saveswitch\055postgres /unreviewed ext4 defaults 0 2'
assert_encoded_recovery_fstab_conflict label-whole-field-quoted \
  '"LABEL=saveswitch-postgres" /unreviewed ext4 defaults 0 2'
assert_encoded_recovery_fstab_conflict uuid-octal \
  'UUID=12345678\0551234-4123-8123-8123456789ab /unreviewed ext4 defaults 0 2'
assert_encoded_recovery_fstab_conflict device-separators-octal \
  '/dev\057disk\057by-id\057mock /unreviewed ext4 defaults 0 2'
assert_encoded_recovery_fstab_conflict target-separators-octal \
  'tmpfs /srv\057saveswitch\057postgres tmpfs defaults 0 0'
assert_encoded_recovery_fstab_conflict target-whole-field-quoted \
  'tmpfs "/srv/saveswitch/postgres" tmpfs defaults 0 0'
assert_encoded_recovery_fstab_conflict target-trailing-slash \
  'tmpfs /srv/saveswitch/postgres/ tmpfs defaults 0 0'
assert_encoded_recovery_fstab_conflict target-double-slash \
  'tmpfs /srv//saveswitch/postgres tmpfs defaults 0 0'
assert_encoded_recovery_fstab_conflict target-dot-segment \
  'tmpfs /srv/saveswitch/./postgres tmpfs defaults 0 0'

# Even an empty fstab cannot bypass UUID uniqueness before append.  Model the
# exact operational sequence and prove the all-device lookup runs first.
database_uuid_probe_sentinel=$fixture_root/database-uuid-probed
rm -f "$database_uuid_probe_sentinel" "$database_fstab_append_sentinel"
if (
  fstab_active_lines() { :; }
  blkid() {
    : >"$database_uuid_probe_sentinel"
    printf '%s\n' /dev/mock /dev/clone
  }
  readlink() { printf '%s\n' /dev/mock; }
  append_fstab_line() { : >"$database_fstab_append_sentinel"; }
  database_verify_uuid_unique_for_canonical "$database_fixture_uuid" /dev/mock
  ensure_database_fstab "$database_fixture_uuid" /dev/disk/by-id/mock /dev/mock 259:7 /srv/saveswitch/postgres
); then
  fail 'empty-fstab duplicate UUID was accepted before append'
fi
[ -e "$database_uuid_probe_sentinel" ] ||
  fail 'empty-fstab path did not perform UUID uniqueness lookup'
[ ! -e "$database_fstab_append_sentinel" ] ||
  fail 'empty-fstab duplicate UUID reached append mutation'

# Order-sensitive mounted-root contract: the reusable finalizer must prove
# canonical path, major:minor, and UUID uniqueness before any ownership, mode,
# or marker mutation.  This fixture fails if those calls are reordered.
database_mount_order=$fixture_root/database-mount-order
: >"$database_mount_order"
(
  database_verify_mounted_target_identity() { printf '%s\n' verify >>"$database_mount_order"; }
  chown() { printf '%s\n' chown >>"$database_mount_order"; }
  chmod() { printf '%s\n' chmod >>"$database_mount_order"; }
  write_database_marker() { printf '%s\n' marker >>"$database_mount_order"; }
  database_secure_verified_mountpoint \
    /srv/saveswitch/postgres /dev/mock 259:7 "$database_fixture_uuid" true
) || fail 'mounted-root ordered finalizer fixture failed'
database_expected_order='verify
chown
chmod
marker'
[ "$(cat "$database_mount_order")" = "$database_expected_order" ] ||
  fail 'mounted database filesystem mutation preceded identity verification'

# The operational gate must perform its pre-existing-mount proof before fstab
# mutation and must never use install -d on a possibly mounted root.
database_gate_body=$fixture_root/database-gate-body
awk '
  /^gate_database_disk\(\) \{/ { in_gate = 1 }
  in_gate { print }
  in_gate && /^gate_current_valid\(\) \{/ { exit }
' "$REMEDIATION" >"$database_gate_body"
database_gate_first_identity=$(awk '/database_verify_mounted_target_identity/ { print NR; exit }' "$database_gate_body")
database_gate_uuid_uniqueness=$(awk '/database_verify_uuid_unique_for_canonical/ { print NR; exit }' "$database_gate_body")
database_gate_fstab_mutation=$(awk '/ensure_database_fstab/ { print NR; exit }' "$database_gate_body")
[ -n "$database_gate_first_identity" ] && [ -n "$database_gate_fstab_mutation" ] &&
  [ "$database_gate_first_identity" -lt "$database_gate_fstab_mutation" ] ||
  fail 'operational gate can mutate fstab before verifying an existing mounted target'
[ -n "$database_gate_uuid_uniqueness" ] &&
  [ "$database_gate_uuid_uniqueness" -lt "$database_gate_fstab_mutation" ] ||
  fail 'operational gate can mutate fstab before standalone UUID uniqueness proof'
if grep -Eq 'install -d.*\$DATABASE_MOUNT_POINT|chown root:root "\$DATABASE_MOUNT_POINT"|chmod 0700 "\$DATABASE_MOUNT_POINT"|write_database_marker "\$DATABASE_MOUNT_POINT"' "$database_gate_body"; then
  fail 'operational gate contains a direct mounted-root mutation outside the verified finalizer'
fi

# Mountpoint occupancy itself is safety-critical: unexpected probe statuses or
# a successful empty result may not be interpreted as an unmounted directory.
if (
  findmnt() { return 2; }
  database_mountpoint_is_mounted /srv/saveswitch/postgres
); then
  fail 'mountpoint probe error was accepted as a mounted target'
fi
if (
  findmnt() { return 0; }
  database_mountpoint_is_mounted /srv/saveswitch/postgres
); then
  fail 'empty successful mountpoint probe was accepted as mounted'
fi

bad_cloud_config=$fixture_root/bad-cloud-config
bad_bash=$fixture_root/bad-bash
bad_disk=$fixture_root/bad-disk
validation_error=$fixture_root/validation-error

printf '%s\n' '#cloud-config' 'write_files:' '  - path: /tmp/example' >"$bad_cloud_config"
if sh "$VALIDATOR" "$bad_cloud_config" 2>"$validation_error"; then
  fail 'validator accepted the original cloud-config-as-shell failure mode'
fi
grep -Fq 'cloud-config YAML is incompatible' "$validation_error" ||
  fail 'cloud-config regression did not fail for the expected reason'

printf '%s\n' 'set -eu' '[[ -n "$value" ]]' >"$bad_bash"
if sh "$VALIDATOR" "$bad_bash" >/dev/null 2>&1; then
  fail 'validator accepted Bash-only syntax'
fi

printf '%s\n' 'set -eu' 'mkfs.ext4 /dev/example' >"$bad_disk"
if sh "$VALIDATOR" "$bad_disk" >/dev/null 2>&1; then
  fail 'validator accepted disk initialization in first-boot user data'
fi

reject_regex '(^|[[:space:]])\[\[[[:space:]]|[[:space:]]\]\]($|[[:space:]])|^[[:space:]]*(local|function|source|declare)[[:space:]]|pipefail|<<<|<\(|>\(|\$BASH_|&>' "$REMEDIATION"
reject_regex '/dev/nvme[0-9]|vol-[A-Za-z0-9]+' "$REMEDIATION"
reject_regex '^[[:space:]]*(apt|apt-get|snap)[[:space:]].*install|^[[:space:]]*(curl|wget|terraform|aws|ssh|scp)[[:space:]]' "$REMEDIATION"

require_fixed 'MODE=help' "$REMEDIATION"
require_fixed 'check_status' "$REMEDIATION"
require_fixed 'apply --gate protected-directories' "$REMEDIATION"
require_fixed 'apply --gate ssh-hardening' "$REMEDIATION"
require_fixed 'apply --gate unattended-upgrades' "$REMEDIATION"
require_fixed 'apply --gate ufw' "$REMEDIATION"
require_fixed 'apply --gate swap' "$REMEDIATION"
require_fixed 'apply --gate database-disk' "$REMEDIATION"
require_fixed 'RESET-UFW-TO-REVIEWED-SSH-RULES' "$REMEDIATION"
require_fixed 'CREATE-BOUNDED-SWAP' "$REMEDIATION"
require_fixed 'FORMAT-BLANK-SAVESWITCH-DATABASE-DISK' "$REMEDIATION"
require_fixed 'RECOVER-INTENT-MATCHED-SAVESWITCH-DATABASE-DISK' "$REMEDIATION"
require_fixed 'recovery-only confirmation refuses every state except exact intent-matched ext4 recovery' "$REMEDIATION"
require_fixed '/dev/disk/by-id/*|/dev/disk/by-path/*' "$REMEDIATION"
require_fixed '17179869184' "$REMEDIATION"
require_fixed 'refusing to operate on the root disk' "$REMEDIATION"
require_fixed 'database disk has child devices or an ambiguous block graph' "$REMEDIATION"
require_fixed 'database disk is mounted at an unexpected, ambiguous, or graph-inconsistent target' "$REMEDIATION"
require_fixed 'blank candidate unexpectedly has a filesystem or RAID signature' "$REMEDIATION"
require_fixed 'blank database candidate has a pre-existing fstab reference' "$REMEDIATION"
require_fixed 'database_capture_probe' "$REMEDIATION"
require_fixed 'empty blkid -p status-2 outcome' "$REMEDIATION"
require_fixed 'database_collect_mount_state' "$REMEDIATION"
require_fixed 'verify_database_format_target_unchanged' "$REMEDIATION"
require_fixed 'format_blank_database_target' "$REMEDIATION"
require_fixed 'database stable identity rebound before formatting' "$REMEDIATION"
database_mounted_identity_call_count=$(grep -Fc 'database_verify_mounted_target_identity' "$REMEDIATION")
[ "$database_mounted_identity_call_count" -ge 2 ] ||
  fail 'mounted database identity verifier is not invoked from the operational gate'
require_fixed 'database_verify_unmounted_mountpoint_empty' "$REMEDIATION"
require_fixed 'alternate or conflicting fstab reference' "$REMEDIATION"
require_fixed 'UUID=$filesystem_uuid' "$REMEDIATION"
require_fixed 'database mount is missing required option' "$REMEDIATION"
require_fixed 'database disk is neither blank, exact intent-matched recovery, nor an already managed filesystem' "$REMEDIATION"
require_fixed 'database filesystem label differs from the reviewed label' "$REMEDIATION"
require_fixed 'DATABASE_EXPECTED_LABEL=saveswitch-postg' "$REMEDIATION"
require_fixed 'saveswitch-postgres-volume-v1' "$REMEDIATION"
require_fixed 'PATH=/usr/sbin:/usr/bin:/sbin:/bin' "$TEMPLATE"
require_fixed 'PATH=/usr/sbin:/usr/bin:/sbin:/bin' "$REMEDIATION"
require_fixed 'saveswitch_ufw_contract_valid "$saveswitch_ufw_candidate"' "$TEMPLATE"
require_fixed 'while IFS= read -r saveswitch_contract_cidr || [ -n "$saveswitch_contract_cidr" ]; do' "$TEMPLATE"
require_fixed 'while IFS= read -r contract_cidr || [ -n "$contract_cidr" ]; do' "$REMEDIATION"
require_fixed 'findmnt --verify --tab-file' "$REMEDIATION"
require_fixed 'database-disk-format.intent' "$REMEDIATION"
require_fixed 'command mkfs.ext4 "$@"' "$REMEDIATION"
require_fixed 'trap '\''ufw_recover $?'\'' 0' "$REMEDIATION"
require_fixed 'an unexpected dormant swap entry exists in fstab' "$REMEDIATION"
require_fixed 'refusing non-regular target' "$TEMPLATE"
require_fixed '/run/sshd' "$TEMPLATE"
require_fixed '/run/sshd' "$REMEDIATION"
require_fixed 'swap gate permits exactly 256 or 512 MiB' "$REMEDIATION"
require_fixed 'existing-instance-baseline-remediated' "$REMEDIATION"

printf 'PASS: bootstrap and existing-instance remediation regression contracts validated\n'

#!/bin/sh
# Offline validator for the Lightsail user-data template. It performs no
# Terraform, provider, AWS, SSH, package, disk, service, or network action.
set -eu

PROGRAM=${0##*/}

fail() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

[ "$#" -eq 1 ] || fail 'usage: validate-user-data.sh TEMPLATE'
TEMPLATE=$1
[ -f "$TEMPLATE" ] || fail "template is not a regular file: $TEMPLATE"

if grep -Eq '^[[:space:]]*#cloud-config([[:space:]]|$)' "$TEMPLATE"; then
  fail 'cloud-config YAML is incompatible with the Lightsail /bin/sh wrapper'
fi
if grep -Eq '^[[:space:]]*(write_files|runcmd|packages|package_update|package_upgrade|bootcmd):[[:space:]]*' "$TEMPLATE"; then
  fail 'cloud-config YAML directive is incompatible with the Lightsail /bin/sh wrapper'
fi
if grep -Eq '^#!' "$TEMPLATE"; then
  fail 'template must not rely on a shebang because Lightsail prepends its own launcher'
fi

first_command=$(awk '
  /^[[:space:]]*$/ { next }
  /^[[:space:]]*#/ { next }
  { print; exit }
' "$TEMPLATE")
[ "$first_command" = 'set -eu' ] || fail 'first executable template line must be exactly: set -eu'
set_line=$(grep -nF 'set -eu' "$TEMPLATE" | awk -F: 'NR == 1 { print $1 }')
path_line=$(grep -nF 'PATH=/usr/sbin:/usr/bin:/sbin:/bin' "$TEMPLATE" | awk -F: 'NR == 1 { print $1 }')
export_line=$(grep -nF 'export PATH' "$TEMPLATE" | awk -F: 'NR == 1 { print $1 }')
[ "$path_line" -eq $((set_line + 1)) ] && [ "$export_line" -eq $((path_line + 1)) ] ||
  fail 'trusted PATH must be assigned and exported immediately after shell options'

if grep -Eq '(^|[[:space:]])\[\[[[:space:]]|[[:space:]]\]\]($|[[:space:]])|^[[:space:]]*(local|function|source|declare)[[:space:]]|pipefail|<<<|<\(|>\(|\$BASH_|&>' "$TEMPLATE"; then
  fail 'Bash-only syntax is forbidden in Lightsail /bin/sh user data'
fi

if grep -Eiq '^[[:space:]]*(apt|apt-get|snap)[[:space:]].*install|^[[:space:]]*(curl|wget|git[[:space:]]+clone)[[:space:]]|^[[:space:]]*(mkfs(\.[A-Za-z0-9_-]+)?|mount|mkswap|swapon)[[:space:]]' "$TEMPLATE"; then
  fail 'user data must not install/fetch packages or initialize disks/swap'
fi
if grep -Eiq '(BEGIN[[:space:]]+(RSA[[:space:]]+|OPENSSH[[:space:]]+|EC[[:space:]]+)?PRIVATE[[:space:]]+KEY|postgres(ql)?://|cloudinary://|DATABASE_URL|TUNNEL_TOKEN|SECRET_VALUE)' "$TEMPLATE"; then
  fail 'secret-bearing or data-bearing material is forbidden in user data'
fi

for required_contract in \
  '00-saveswitch-hardening.conf' \
  'PermitRootLogin no' \
  'PasswordAuthentication no' \
  'AllowTcpForwarding no' \
  'AllowAgentForwarding no' \
  'install -d -o root -g root -m 0755 /run/sshd' \
  'systemctl is-active --quiet ssh.service' \
  'systemctl is-active --quiet ssh.socket' \
  'ufw --force reset' \
  "trap 'saveswitch_ufw_recover \$?' 0" \
  'SAVESWITCH_UFW_RECOVERY_ACTIVE=false' \
  'ufw default deny incoming' \
  'apt-daily-upgrade.timer' \
  'lightsail-shell-baseline-complete' \
  'database-disk-unformatted' \
  'swap-unconfigured'; do
  grep -Fq -- "$required_contract" "$TEMPLATE" || fail "missing required user-data contract: $required_contract"
done

marker_line=$(grep -nF 'lightsail-shell-baseline-complete' "$TEMPLATE" | awk -F: 'NR == 1 { print $1 }')
ufw_line=$(grep -nF 'ufw --force enable' "$TEMPLATE" | awk -F: 'NR == 1 { print $1 }')
ssh_activation_line=$(grep -nF 'systemctl reload ssh.service' "$TEMPLATE" | awk -F: 'NR == 1 { print $1 }')
[ "$marker_line" -gt "$ufw_line" ] && [ "$marker_line" -gt "$ssh_activation_line" ] ||
  fail 'completion marker must be written only after firewall and SSH activation checks'

rendered=$(mktemp /tmp/saveswitch-user-data-rendered.XXXXXX)
trap 'rm -f "$rendered"' EXIT HUP INT TERM
sed \
  -e '/^[[:space:]]*%{[[:space:]]*for[[:space:]]/d' \
  -e '/^[[:space:]]*%{[[:space:]]*endfor[[:space:]]*~*}/d' \
  -e 's/${cidr}/192.0.2.10\/32/g' \
  "$TEMPLATE" >"$rendered"
if grep -Eq '\$\{[^}]+\}' "$rendered"; then
  fail 'unhandled Terraform interpolation prevents offline shell syntax validation'
fi
sh -n "$rendered"
if command -v dash >/dev/null 2>&1; then
  dash -n "$rendered"
fi

printf 'PASS: Lightsail user data is POSIX-shell-shaped and rejects cloud-config semantics (%s)\n' "$TEMPLATE"

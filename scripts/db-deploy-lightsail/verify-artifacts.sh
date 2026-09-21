#!/usr/bin/env bash
# Verifies every repository input before a production load. No network or DB
# access is performed by this script.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

[[ "$-" != *x* ]] || { printf '%s\n' 'db-deploy-lightsail: refusing xtrace' >&2; exit 1; }
(cd "$script_dir" && sha256sum -c artifacts.sha256 --status)

# The manifest deliberately points outside this new root, so prove it cannot
# be redirected by a symlink before accepting its checksum.
while IFS='  ' read -r expected path; do
  [[ -n "$expected" && -n "$path" ]] || continue
  [[ "$path" != *".."* ]] || { printf '%s\n' 'db-deploy-lightsail: invalid manifest path' >&2; exit 1; }
  [[ -f "$script_dir/$path" && ! -L "$script_dir/$path" ]] || { printf '%s\n' "db-deploy-lightsail: invalid artifact: $path" >&2; exit 1; }
done <"$script_dir/artifacts.sha256"

printf '%s\n' 'db-deploy-lightsail repository artifacts: verified'

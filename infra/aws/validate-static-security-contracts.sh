#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
waf_file="${script_dir}/production/waf.tf"

grep -Fq 'name = "x-saveswitch-xoomshare-path"' "${waf_file}" || {
  echo 'WAF logging must redact the active Xoomshare capability header' >&2
  exit 1
}

if grep -Fq 'name = "x-saveswitch-session"' "${waf_file}"; then
  echo 'WAF logging still references the retired Xoomshare header' >&2
  exit 1
fi

grep -Fq 'query_string {}' "${waf_file}" || {
  echo 'WAF logging must redact query strings' >&2
  exit 1
}

grep -Fq 'uri_path {}' "${waf_file}" || {
  echo 'WAF logging must redact URI paths containing Xoomshare capabilities' >&2
  exit 1
}

echo 'AWS static security contracts passed'

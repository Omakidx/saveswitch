#!/bin/sh
# Encrypt one verified PostgreSQL dump, upload it to Cloudinary as an opaque
# raw asset, download it again, and verify an end-to-end decrypt/hash round trip.
set -eu

credential_dir=/etc/saveswitch/runtime/cloudinary-backup
backup_root=/srv/saveswitch/postgres/backups
max_upload_bytes=94371840

fail() { echo "cloudinary backup upload: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"; }

[ "$(id -u)" -eq 0 ] || fail 'must run as root'
[ "$#" -eq 1 ] || fail 'exactly one dump path is required'
need curl
need gpg
need jq
need openssl
need sha256sum
need stat

dump=$1
case "$dump" in "$backup_root"/*.dump) ;; *) fail 'dump path is outside the protected backup directory' ;; esac
[ -f "$dump" ] && [ ! -L "$dump" ] || fail 'dump must be a regular non-symlink file'
[ "$(stat -c %u "$dump")" -eq 0 ] || fail 'dump must be root-owned'
[ "$(stat -c %a "$dump")" = 600 ] || fail 'dump must have mode 0600'

[ -d "$credential_dir" ] && [ ! -L "$credential_dir" ] || fail 'credential directory is missing or unsafe'
[ "$(stat -c %u "$credential_dir")" -eq 0 ] || fail 'credential directory must be root-owned'
[ "$(stat -c %a "$credential_dir")" = 700 ] || fail 'credential directory must have mode 0700'

read_credential() {
  name=$1
  file=$credential_dir/$name
  [ -f "$file" ] && [ ! -L "$file" ] || fail "credential file is missing or unsafe: $name"
  [ "$(stat -c %u "$file")" -eq 0 ] || fail "credential must be root-owned: $name"
  [ "$(stat -c %a "$file")" = 600 ] || fail "credential must have mode 0600: $name"
  [ -s "$file" ] || fail "credential is empty: $name"
  value=$(cat "$file")
  [ -n "$value" ] || fail "credential is empty: $name"
  case "$value" in *[!A-Za-z0-9_.~:/+=-]*) fail "credential contains unsupported characters: $name" ;; esac
  printf '%s' "$value"
}

check_secret_file() {
  name=$1
  file=$credential_dir/$name
  [ -f "$file" ] && [ ! -L "$file" ] || fail "credential file is missing or unsafe: $name"
  [ "$(stat -c %u "$file")" -eq 0 ] || fail "credential must be root-owned: $name"
  [ "$(stat -c %a "$file")" = 600 ] || fail "credential must have mode 0600: $name"
  [ -s "$file" ] || fail "credential is empty: $name"
  ! LC_ALL=C grep -q '[[:space:]]' "$file" || fail "credential contains whitespace: $name"
}

cloud_name=$(read_credential cloud-name)
api_key=$(read_credential api-key)
api_secret=$(read_credential api-secret)
passphrase_file=$credential_dir/encryption-passphrase
# Validate the passphrase file without reading it into a shell variable.
check_secret_file encryption-passphrase

case "$cloud_name" in *[!A-Za-z0-9_-]*|'') fail 'cloud name is invalid' ;; esac
case "$api_key" in *[!0-9]*|'') fail 'API key is invalid' ;; esac
[ "$(stat -c %s "$dump")" -le "$max_upload_bytes" ] || fail 'dump exceeds the reviewed direct-upload size limit'

umask 077
work=$(mktemp -d "$backup_root/.cloudinary-upload.XXXXXX")
gnupg=$work/gnupg
mkdir -m 0700 "$gnupg"
encrypted=$work/backup.dump.gpg
downloaded=$work/downloaded.dump.gpg
decrypted=$work/roundtrip.dump
response=$work/response.json
cleanup() { rm -rf -- "$work"; }
trap cleanup EXIT HUP INT TERM

original_sha=$(sha256sum "$dump" | awk '{print $1}')
GNUPGHOME=$gnupg gpg --no-options --batch --yes --pinentry-mode loopback \
  --passphrase-file "$passphrase_file" --symmetric --cipher-algo AES256 \
  --output "$encrypted" "$dump" >/dev/null 2>&1 || fail 'encryption failed'
encrypted_sha=$(sha256sum "$encrypted" | awk '{print $1}')
encrypted_bytes=$(stat -c %s "$encrypted")

timestamp=$(date -u +%s)
basename=${dump##*/}
stem=${basename%.dump}
case "$stem" in *[!A-Za-z0-9_.-]*|'') fail 'dump filename is unsafe' ;; esac
public_id="saveswitch/database-backups/$stem-${encrypted_sha%${encrypted_sha#????????????????}}"
signed_parameters="overwrite=false&public_id=$public_id&timestamp=$timestamp"
signature=$(printf '%s' "$signed_parameters$api_secret" | openssl dgst -sha256 -r | awk '{print $1}')
unset api_secret signed_parameters

# Keep the one-hour upload signature out of process arguments. Every value
# below is generated locally or validated against a narrow character set.
{
  printf 'url = "https://api.cloudinary.com/v1_1/%s/raw/upload"\n' "$cloud_name"
  printf 'output = "%s"\n' "$response"
  printf '%s\n' 'fail' 'silent' 'show-error' 'proto = "=https"' 'tlsv1.2'
  printf 'form = "file=@%s;type=application/octet-stream"\n' "$encrypted"
  printf 'form-string = "api_key=%s"\n' "$api_key"
  printf 'form-string = "timestamp=%s"\n' "$timestamp"
  printf 'form-string = "signature=%s"\n' "$signature"
  printf 'form-string = "public_id=%s"\n' "$public_id"
  printf '%s\n' 'form-string = "overwrite=false"'
} | curl --config - || fail 'Cloudinary upload failed'

uploaded_id=$(jq -er '.public_id | strings' "$response") || fail 'upload response has no public_id'
uploaded_bytes=$(jq -er '.bytes | numbers' "$response") || fail 'upload response has no byte count'
secure_url=$(jq -er '.secure_url | strings | select(startswith("https://"))' "$response") || fail 'upload response has no HTTPS URL'
version=$(jq -er '.version | numbers' "$response") || fail 'upload response has no version'
# Cloudinary raw assets include the source file extension in their public ID.
# The encrypted upload is always named backup.dump.gpg, so fail closed unless
# the only server-side normalization is the documented `.gpg` suffix.
expected_uploaded_id=$public_id.gpg
[ "$uploaded_id" = "$expected_uploaded_id" ] || fail 'upload response public_id mismatch'
public_id=$uploaded_id
[ "$uploaded_bytes" -eq "$encrypted_bytes" ] || fail 'upload response byte-count mismatch'

curl --fail --silent --show-error --proto '=https' --tlsv1.2 --output "$downloaded" "$secure_url" \
  || fail 'uploaded backup could not be downloaded for verification'
[ "$(sha256sum "$downloaded" | awk '{print $1}')" = "$encrypted_sha" ] \
  || fail 'downloaded encrypted backup checksum mismatch'
GNUPGHOME=$gnupg gpg --no-options --batch --yes --pinentry-mode loopback \
  --passphrase-file "$passphrase_file" --decrypt --output "$decrypted" "$downloaded" >/dev/null 2>&1 \
  || fail 'downloaded backup could not be decrypted'
[ "$(sha256sum "$decrypted" | awk '{print $1}')" = "$original_sha" ] \
  || fail 'downloaded backup plaintext checksum mismatch'

manifest=$dump.cloudinary.json
[ ! -e "$manifest" ] && [ ! -L "$manifest" ] || fail 'refusing to replace an existing backup manifest'
jq -n \
  --arg public_id "$public_id" \
  --arg secure_url "$secure_url" \
  --arg plaintext_sha256 "$original_sha" \
  --arg encrypted_sha256 "$encrypted_sha" \
  --argjson bytes "$encrypted_bytes" \
  --argjson version "$version" \
  --arg verified_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{provider:"cloudinary", resource_type:"raw", public_id:$public_id, version:$version, bytes:$bytes, secure_url:$secure_url, plaintext_sha256:$plaintext_sha256, encrypted_sha256:$encrypted_sha256, verified_at:$verified_at}' \
  >"$manifest"
chmod 0600 "$manifest"
echo 'cloudinary backup upload: encrypted upload and round-trip verification completed'

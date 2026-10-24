#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# The only place LINA Probe is signed. build.sh calls it; nothing else should
# run codesign on the app.
#
#   sign.sh APP IDENTITY
#
# IDENTITY is one of
#   local    self-signed "LINA Probe Local Signing" certificate, created once in
#            its own keychain under ~/Library/Application Support/LINA Probe/signing/
#   adhoc    ad-hoc signature (CI build checks only; TCC grants do not survive a rebuild)
#   NAME     any code-signing identity name or SHA-1 in the keychain search list,
#            for example "Developer ID Application: Name (TEAMID)". Signed with the
#            hardened runtime and a secure timestamp. LINA_PROBE_KEYCHAIN may name
#            the keychain that holds it.
#
# TCC grants follow the designated requirement printed at the end. It stays the
# same across rebuilds with the same IDENTITY. Changing IDENTITY changes it, so
# the Accessibility and Screen Recording switches must be turned on again once.
set -euo pipefail

fail() { printf 'sign.sh: %s\n' "$*" >&2; exit 1; }
[ "$#" -eq 2 ] || fail 'usage: sign.sh APP IDENTITY (local | adhoc | identity name or SHA-1)'
app=$1 identity=$2
[ -d "$app" ] || fail "$app is not an app bundle"
[ -n "$identity" ] || fail 'empty IDENTITY'
bundle_id=dev.lina.probe
local_name='LINA Probe Local Signing'
signing="$HOME/Library/Application Support/LINA Probe/signing"
keychain="$signing/signing.keychain-db"
keychain_pass="$signing/keychain-password"

has_local_identity() {
  [ -f "$keychain" ] && security find-identity -p codesigning "$keychain" 2>/dev/null | grep -q "\"$local_name\""
}

# Create the self-signed code-signing identity once, in its own keychain, so the
# login keychain and its search list are never touched. The private key is
# generated here and never leaves this Mac.
init_local_identity() {
  has_local_identity && return
  [ ! -e "$keychain" ] || fail "$keychain exists without \"$local_name\"; move it aside before re-creating (existing grants will need to be switched on again)"
  mkdir -p "$signing"; chmod 700 "$signing"
  local work pass p12pass
  work=$(mktemp -d); trap 'rm -rf "$work"' RETURN
  cat > "$work/cert.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$local_name
[ext]
basicConstraints=critical,CA:false
keyUsage=critical,digitalSignature
extendedKeyUsage=critical,codeSigning
CNF
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$work/cert.cnf" \
    -keyout "$work/key.pem" -out "$work/cert.pem" 2>/dev/null
  p12pass=$(/usr/bin/openssl rand -hex 16)
  /usr/bin/openssl pkcs12 -export -inkey "$work/key.pem" -in "$work/cert.pem" \
    -out "$work/id.p12" -passout "pass:$p12pass"
  pass=$(/usr/bin/openssl rand -hex 24)
  (umask 077; printf '%s' "$pass" > "$keychain_pass")
  security create-keychain -p "$pass" "$keychain"
  security set-keychain-settings "$keychain"
  security unlock-keychain -p "$pass" "$keychain"
  security import "$work/id.p12" -k "$keychain" -P "$p12pass" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$pass" "$keychain" >/dev/null
  has_local_identity || fail 'identity was not imported'
  printf 'sign.sh: created signing identity "%s" in %s\n' "$local_name" "$keychain" >&2
}

case "$identity" in
  adhoc)
    codesign --force --sign - --identifier "$bundle_id" "$app" ;;
  local)
    init_local_identity
    security unlock-keychain -p "$(cat "$keychain_pass")" "$keychain"
    codesign --force --sign "$local_name" --keychain "$keychain" --identifier "$bundle_id" "$app" ;;
  *)
    args=(--force --sign "$identity" --identifier "$bundle_id" --options runtime --timestamp)
    [ -z "${LINA_PROBE_KEYCHAIN:-}" ] || args+=(--keychain "$LINA_PROBE_KEYCHAIN")
    codesign "${args[@]}" "$app" ;;
esac
codesign --verify --strict "$app"
codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p'

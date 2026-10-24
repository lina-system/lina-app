#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Build and sign LINA Probe, the single executable that holds the Accessibility
# and Screen Recording grants for the launcher baseline (#91).
#
# The grant survives rebuilds because the path, bundle ID and designated
# requirement stay fixed: every build is signed by the same locally generated
# certificate. Ad-hoc signing (LINA_PROBE_SIGN=adhoc, used by CI) ties TCC to
# the cdhash, so a rebuilt ad-hoc app loses its grants.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
app=${LINA_PROBE_APP:-/Applications/LINA Probe.app}
sign=${LINA_PROBE_SIGN:-local}
bundle_id=dev.lina.probe
identity='LINA Probe Local Signing'
signing="$HOME/Library/Application Support/LINA Probe/signing"
keychain="$signing/signing.keychain-db"
keychain_pass="$signing/keychain-password"

fail() { printf 'build.sh: %s\n' "$*" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] || fail 'macOS only'
case "$sign" in local|adhoc) ;; *) fail "LINA_PROBE_SIGN must be local or adhoc, not $sign" ;; esac

has_identity() {
  [ -f "$keychain" ] && security find-identity -p codesigning "$keychain" 2>/dev/null | grep -q "\"$identity\""
}

# Provenance for the evidence manifest is written to
# ~/Library/Application Support/LINA Probe/build.json.

# Create the self-signed code-signing identity once, in its own keychain, so the
# login keychain and its search list are never touched. The private key is
# generated here and never leaves this Mac.
init_identity() {
  has_identity && return
  [ ! -e "$keychain" ] || fail "$keychain exists without \"$identity\"; move it aside before re-creating (existing grants will need to be switched on again)"
  mkdir -p "$signing"; chmod 700 "$signing"
  local work pass p12pass
  work=$(mktemp -d); trap 'rm -rf "$work"' RETURN
  cat > "$work/cert.cnf" <<CNF
[req]
distinguished_name=dn
x509_extensions=ext
prompt=no
[dn]
CN=$identity
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
  has_identity || fail 'identity was not imported'
  printf 'build.sh: created signing identity "%s" in %s\n' "$identity" "$keychain" >&2
}

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
staged="$work/LINA Probe.app"
mkdir -p "$staged/Contents/MacOS"
cp "$here/Info.plist" "$staged/Contents/Info.plist"
xcrun swiftc -O -o "$staged/Contents/MacOS/LINA Probe" "$here"/*.swift

if [ "$sign" = local ]; then
  init_identity
  security unlock-keychain -p "$(cat "$keychain_pass")" "$keychain"
  codesign --force --sign "$identity" --keychain "$keychain" --identifier "$bundle_id" "$staged"
else
  codesign --force --sign - --identifier "$bundle_id" "$staged"
fi
codesign --verify --strict "$staged"

mkdir -p "$(dirname "$app")"
rm -rf "$app.previous"
[ ! -e "$app" ] || mv "$app" "$app.previous"
mv "$staged" "$app"
rm -rf "$app.previous"

executable="$app/Contents/MacOS/LINA Probe"
requirement=$(codesign -d -r- "$app" 2>&1 | sed -n 's/^designated => //p')
cdhash=$(codesign -dvvv "$app" 2>&1 | sed -n 's/^CDHash=//p')
revision=$(git -C "$here" rev-parse HEAD 2>/dev/null || echo unknown)
dirty=$(git -C "$here" status --porcelain -- . 2>/dev/null | grep -q . && echo true || echo false)
jq -n --arg app "$app" --arg bundle_id "$bundle_id" --arg sign "$sign" \
  --arg requirement "$requirement" --arg cdhash "$cdhash" \
  --arg sha256 "$(shasum -a 256 "$executable" | cut -d' ' -f1)" \
  --arg revision "$revision" --argjson dirty "$dirty" \
  --arg swift "$(xcrun swiftc --version 2>&1 | head -1)" --arg sdk "$(xcrun --show-sdk-version)" \
  --arg built_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  '{app:$app,bundle_id:$bundle_id,signing:$sign,designated_requirement:$requirement,cdhash:$cdhash,
    executable_sha256:$sha256,source_revision:$revision,source_dirty:$dirty,swift:$swift,sdk:$sdk,
    codesign_verify_strict:"passed",built_at:$built_at}' | tee "$signing/../build.json"

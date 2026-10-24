# LINA protocol

Generated Core types, exact JSON, schema validation and the native Unix/TCP
client. No Flutter runtime dependency and no canonical-state storage.

See [the app host contract](../../docs/policy/host-protocol.md) for the pinned
snapshot, generator choice, receive semantics and compatibility limits.

```sh
node scripts/verify/protocol.mjs --check
cd packages/lina_protocol
flutter test --no-pub test/conformance_test.dart test/connection_test.dart
# Synthetic read-only socket peer for one app connection; prints its address:
dart run bin/fixture_peer.dart
# Optional real Core check on a Core-supported Linux host, with isolated state:
dart run bin/core_smoke.dart /absolute/path/to/lina
```

The fake uses canonical fixtures and executes no effects. It grants no
conversation capability and refuses non-hello requests. It is not a production
Core or authentication proof. All fixture identities are synthetic.

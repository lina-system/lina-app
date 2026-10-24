// SPDX-License-Identifier: Apache-2.0
import '../generated/protocol.dart';

class ProtocolReceiver {
  ProtocolReceiver({this.tolerant = true});
  final bool tolerant;
  int accepted = 0, malformed = 0, unknownKinds = 0;
  Map<String, int> get counters => {
    'accepted': accepted,
    'malformed': malformed,
    'unknown_kinds': unknownKinds,
  };
  Envelope? receive(String frame) {
    try {
      final value = exactDecode(frame);
      if (value is! Map<String, dynamic>)
        throw const FormatException('envelope is not an object');
      if (!tolerant) {
        final result = Envelope.fromJson(value);
        accepted++;
        return result;
      }
      final root = protocolSchema.root;
      protocolSchema.check(value, {
        ...root,
        'properties': {
          ...root['properties'] as Map<String, dynamic>,
          'kind': {'type': 'string', 'minLength': 1},
        },
        'allOf': (root['allOf'] as List)
            .where((rule) => !_mentionsPayload(rule))
            .toList(),
      });
      final kinds = root['properties']['kind']['enum'] as List;
      if (!kinds.contains(value['kind'])) {
        unknownKinds++;
        return null;
      }
      final rule = (root['allOf'] as List).cast<Map>().firstWhere(
        (s) => s['if']?['properties']?['kind']?['const'] == value['kind'],
      );
      value['payload'] = protocolSchema.project(
        value['payload'],
        rule['then']['properties']['payload'],
      );
      final result = Envelope.fromJson(value);
      accepted++;
      return result;
    } on FormatException {
      malformed++;
      rethrow;
    }
  }
}

// Keep common envelope constraints even when the payload kind is unknown.
// Payload-dependent constraints run only after projecting a known payload.
bool _mentionsPayload(Object? node) => switch (node) {
  Map value =>
    value.containsKey('payload') || value.values.any(_mentionsPayload),
  List value => value.any(_mentionsPayload),
  _ => false,
};

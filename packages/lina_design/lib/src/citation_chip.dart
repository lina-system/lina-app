// SPDX-License-Identifier: Apache-2.0
import 'package:flutter/material.dart';

import '../generated/icons.dart';
import '../generated/tokens.dart';
import 'icon.dart';
import 'text.dart';

/// Presentation data, not a replacement for Core's generated protocol schema.
/// Pass the original anchor through the callback; never resolve a new revision.
@immutable
class PassageAnchor {
  const PassageAnchor({
    required this.assetId,
    required this.revision,
    required this.address,
    required this.contentHash,
    required this.capturedAt,
    this.sourceUrl,
  });
  final String assetId;
  final String revision;
  final String address;
  final String contentHash;
  final DateTime capturedAt;
  final Uri? sourceUrl;
}

class CitationChip extends StatelessWidget {
  const CitationChip({
    super.key,
    required this.source,
    required this.anchor,
    required this.onOpen,
    this.unavailableLabel,
  });
  final String source;
  final PassageAnchor anchor;
  final ValueChanged<PassageAnchor> onOpen;

  /// Revoked/deleted/disconnected evidence stays visible and cannot be opened.
  final String? unavailableLabel;
  @override
  Widget build(BuildContext context) {
    final t = LinaTokens.of(context);
    return Semantics(
      link: true,
      child: TextButton(
        onPressed: unavailableLabel == null ? () => onOpen(anchor) : null,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            LinaIcon(
              LinaIconName.citation,
              color: unavailableLabel == null ? t.colorAccent : t.colorDisabled,
            ),
            SizedBox(width: t.spaceInline),
            Flexible(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  LinaText(source),
                  LinaText(
                    anchor.address,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                  if (unavailableLabel case final label?) LinaText(label),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

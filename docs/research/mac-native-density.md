# Mac-native density, motion and panel principles

Research for [#90](https://github.com/lina-system/lina-app/issues/90) and
[#89](https://github.com/lina-system/lina-app/issues/89); input to the owner
decision in [#4](https://github.com/lina-system/lina-app/issues/4) and the panel
question in [#2](https://github.com/lina-system/lina-app/issues/2). Recorded on
2026-10-24 on the reference M2 Pro Mac (macOS 27.0.1).

These are LINA's own principles and value ranges. They come from static
inspection of installed reference apps (a native to-do app, a native launcher
and Apple's built-in apps), done locally and without running or driving those
apps. No code, asset, string, color value or name from another product is
reproduced here. The raw inspection notes stay off this repository.

Status: **research input, not tokens.** Nothing here changes `DESIGN.md` or
`design/tokens/`. Values that would change tokens are listed under
[Open questions](#open-questions) for #4.

## What was and was not observed

| Kind of evidence | Status |
| --- | --- |
| Bundle structure, linked frameworks, window/panel classes | Observed statically |
| Layout and motion constants returned by app code | Observed statically (decompiled return values) |
| Asset-catalog colors | Observed statically |
| Rendered pixels, real spacing on screen, motion timing | **Not observed** (no live capture in this session) |
| Hotkey → panel latency, lost keys, memory | **Not observed**; owned by #91 |

A static constant shows what an app asks for, not what the user sees after
layout, text scaling or system overrides. Treat every range below as a starting
point to verify in #92's side-by-side capture.

## Density

| Element | LINA range | Note |
| --- | --- | --- |
| Single-line list row | 28–36 pt | Dense lists sit near 28; launcher results near 36 |
| Two-line or row with secondary text | 38–58 pt | Use the lower end for title + one meta line |
| Section header row | 36–40 pt | Taller than a row, never a full card |
| Small gap row between groups | 14–16 pt | Spacing, not a divider line |
| Sidebar width | 190 pt minimum, 240 pt default | Content area keeps at least 400 pt |
| Launcher panel width | 680–760 pt | Results area about 6–8 rows tall before scrolling |
| Launcher header / footer | 52–66 pt / 40–44 pt | Header holds the query field only |
| Row icon | 16 pt compact, 22 pt standard | On LINA's 24 pt grid, scaled |
| Spacing scale | 2, 4, 6, 8, 12, 16, 24, 32 pt | Rounded to whole pixels after zoom |

LINA's current `control.minimum` (48 px) is a touch-target floor. Pointer-first
Mac lists in the reference apps run well below it (28–38 pt). See open
question 1.

## Type

- System-native feel comes from the platform UI font at 13 pt body, 11 pt
  secondary, 16–18 pt for the launcher query, 24 pt+ only for page titles.
- Weights used: regular for body, medium/semibold for titles and selected
  rows, bold rarely. No light weight for UI text.
- LINA keeps Pretendard for Korean content (DESIGN.md). Whether the Mac shell
  chrome (sidebar, launcher field) should use the platform font is open
  question 2.

## Color

- **One accent.** The native to-do app and Apple's built-in apps each ship a
  single accent color in their asset catalogs, with at most a dark-mode
  variant; everything else is neutral system color. (The launcher's colors are
  theme data injected at runtime and were not observable statically.) LINA's
  single cobalt (#90 recommendation A) is consistent with this; no change
  proposed.
- Selection is a low-alpha tint of the foreground (about 5% hover, 10%
  selected), not a filled accent bar. LINA's opaque `color.selection` is a
  stronger treatment; see open question 3.
- Window backgrounds are system materials (vibrancy) rather than a flat canvas
  on the launcher.

## Corners and shadow

| Element | LINA range |
| --- | --- |
| Small control / chip | 4–6 pt |
| Row selection highlight | 6–10 pt |
| Popover / card | 10–12 pt |
| Launcher panel | Follow the OS window radius (macOS 27: about 20 pt); do not hard-code |
| Panel shadow | Layered, soft, low opacity (largest layer about 64 pt blur, ≤20% black); no hard border on macOS |

## Motion

| Motion | LINA range |
| --- | --- |
| Hover / color fade | 100–150 ms, ease-out |
| Small reveal (hint, toast) | 150–250 ms, ease-out; delay hints about 400 ms |
| Sidebar collapse / pane resize | about 300 ms |
| Expand-in-place (row → editor) | about 400 ms |
| Spring for layout changes | damping ratio 0.8–0.9 (no visible overshoot) |
| Spring for small playful feedback only | damping ratio 0.55–0.65 |
| Ease-out curve | strong ease-out (expo-like), e.g. cubic-bezier(0.16, 1, 0.3, 1) |

LINA's current spring (mass 1, stiffness 260, damping 28) is a damping ratio of
about 0.87 and settles in about 290 ms. It is inside the layout-spring range;
no change proposed. Reduced motion keeps the rule in DESIGN.md: static state or
the reduced duration.

## Launcher panel and shortcut (for #89 and #2)

Observed architecture choices worth testing in the spike, not copying:

- **Global shortcut**: both native references link the Carbon hot-key API
  (`RegisterEventHotKey`); in the to-do app the decompiled shortcut
  registration calls it directly, and an event-tap monitor exists separately
  for shortcut recording. The Carbon path needs no Accessibility permission
  for a plain hotkey. The spike should start there and keep event taps opt-in.
- **Panel class**: the launcher's main window is an `NSPanel` subclass hosting
  a web view; the to-do app's quick-entry window is a floating panel
  (floating level, joins all Spaces, does not hide on deactivate). Whether each
  uses the non-activating style flag was not confirmed statically. #89 must
  measure focus behavior directly rather than assume it.
- **Shell + rendered UI**: the launcher draws its whole UI in a web view inside a
  native panel, with extensions running in Node worker threads (a small heap
  cap per worker) whose React tree is sent to the view as messages. It still feels native
  because density, type, materials and motion match the platform. This supports
  #2's plan: Flutter renders the panel content; platform code owns the shortcut,
  the panel window and the pasteboard.
- **Input**: the launcher keeps a dedicated input-capture path on the panel and
  manages the keyboard input source. #89's Korean-input check (Enter during
  composition, keys typed during the show animation) should be part of the
  pass/fail, not a follow-up.
- **Prewarm**: the launcher carries explicit warm-up state for its panel and
  prewarms its worker pool, so a shortcut likely only orders an existing panel
  front. Measure cold vs warm separately in #91.

## Open questions

For the owner in #4; none are applied by this note.

1. Mac pointer lists at 28–36 pt rows, with the 48 px `control.minimum` kept
   for touch and primary buttons only?
2. Platform UI font for Mac shell chrome, Pretendard for content?
3. Selection as a low-alpha foreground tint on Mac lists instead of the opaque
   `color.selection`, keeping 3:1 for the focus ring?

## Method and limits

Static inspection used REA 6.7.0 (MIT) with Ghidra 12.1.4 on the reference Mac:
bundle/plist/signature inspection, asset-catalog metadata, compiled Interface
Builder decoding, inert JavaScript/CSS parsing, Objective-C metadata and
decompiled return values of layout-default methods. No app was launched,
attached or automated for this note. Rendered screens, effective spacing after
layout, real motion curves and focus behavior are unverified and belong to #92
(capture), #89 (panel spike) and #91 (launcher baseline).

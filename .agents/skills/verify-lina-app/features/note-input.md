# Note input

Note input is the `Note` text field on Home. A person can type in it with any keyboard, including Korean composed through an input method, and the text they finish composing is what the field keeps.

## Platforms

- `web`: shipped.
- `mac`: planned (M1).
- `iphone`: planned (M1).

## Intended behavior

- The field is a textbox with the accessible name `Note`.
- Latin text typed key by key is kept as typed.
- Korean composed with an input method keeps only the finished syllables: composing `ㅎ`, `하`, `한` leaves `한`, never `ㅎ하한` or a doubled syllable.
- Focusing the field on a phone keeps it in view above the on-screen keyboard.

## Sub-features

- `note-type` keeps typed Latin text.
- `note-compose` keeps Korean composed with an input method.
- `note-keyboard` keeps the field visible above the on-screen keyboard.

## How to get to it (user POV)

- Open Home and choose the `Note` field.

## Driving it with verify.mjs

Preconditions:

- `verify.mjs doctor` reports `"healthy": true` for this run.
- `Note` is empty on a fresh page load.

- **Type Latin text.** Choose `Note` and type `hello`, 50 ms per key. Run `node .agents/skills/verify-lina-app/scripts/verify.mjs drive note-input`. The textbox `Note` holds `hello`.
- **Compose Korean.** Clear `Note`, then compose `ㅎ`, `하`, `한` and finish the composition. The driver sends `compositionstart`, three composing `input` events and `compositionend`, as an input method does. The textbox `Note` holds `한`.
- **Proof.** `verify-runs/$VERIFY_RUN_ID/evidence/note-input/note-input-1280.json` and `note-input-390.json` record each value; the screenshots show `한` in the field.

## Gotchas

- Headless Chromium has no real input method. The driver replays the events an input method sends; Safari on iOS and macOS still needs a person, or the Mac and iPhone runs, to prove `note-compose` with a real keyboard.
- `note-keyboard` needs a real phone keyboard and is not driven headless. Report it as unreached with that reason.
- Keys sent with no delay between them can lose characters (`hello world` became `hlowrd`). The driver types at 50 ms per key, a person's pace; a run that sees lost characters at that pace reports a defect.
- `page.fill` skips composition events. Use the driver's composition step, not `fill`, to prove `note-compose`.

## Not goals

- The note is not saved or sent anywhere yet.
- The field does not check spelling or limit length.

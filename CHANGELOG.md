# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the
[lina-system alpha rule](https://github.com/lina-system/.github/blob/main/POLICY.md) `0.0.1-alpha.YYYYMMDD.N`.

## [Unreleased]

- A report reads as a document (lina-app#114): its title, agent, time and goal over the body at a reading width in three text sizes, headings under the title, tables whose number columns align right under a header row that stays and whose rows fold into cards when narrow, and only the report's own images (also inside folds, callouts and table cells), read with the page's credentials (the session token header on a loopback core, the sign-in cookie behind the gate) and drawn from object addresses that are read again when the report changes (also when only its images do) and released once replaced or when the viewer changes, wide, side by side, captioned and large on a tap over the whole window with previous and next.
- A report's body draws charts (`lina:chart` bar, line, share, stacked, and a stat row; a share chart refuses a negative value), Mermaid diagrams in the app's colours with zoom (a fit that shows the whole diagram, steps that stop at either end) and a sideways drag, quiet callouts and folds that mark a decision or warning inside them; a block that does not parse shows its source and one error line (lina-app#83). Adds the `mermaid` dependency, loaded only when a report holds a diagram.
- A chat message's report reference shows one report card, also in its work card's detail; it opens the report beside the conversation in a resizable inspector on a wide window and in a half-height sheet on a phone, which follows the agent's edits with an `업데이트됨` mark, lists every version with its own time, and closes with Escape (lina-app#50). `&reports=demo` adds synthetic reports to the synthetic scene.
- A hub card (`hermes:<id>`) stopped on a decision or feedback with no `waitingOn` reads `다른 일 대기` unless its question is in the work inbox (G138).
- A card's `기록` reads one line per step the core serves (`plain.history`), `time · what it did`; a round's verdict is a small mark beside its step, and a card with no steps keeps its old record in one closed `이전 기록` fold (G138, lina-app#269).

## [0.0.1-alpha.20261102.1] - 2026-11-02

### Added

- Repository start.

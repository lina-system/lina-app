# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow the
[lina-system alpha rule](https://github.com/lina-system/.github/blob/main/POLICY.md) `0.0.1-alpha.YYYYMMDD.N`.

## [Unreleased]

- A work-only install (`VITE_LINA_MODE=work`, `npm run build:work`) is the owner's goals / to-do app: 대화, 상태 and agent-ops (running cards, worker runs, retry, work-card inbox) are gone from the UI and are not called; the default build is unchanged. Switching dist does not restore the other product's on-device snapshot.
- A hub card (`hermes:<id>`) stopped on a decision or feedback with no `waitingOn` reads `다른 일 대기` unless its question is in the work inbox (G138).
- A card's `기록` reads one line per step the core serves (`plain.history`), `time · what it did`; a round's verdict is a small mark beside its step, and a card with no steps keeps its old record in one closed `이전 기록` fold (G138, lina-app#269).

## [0.0.1-alpha.20261102.1] - 2026-11-02

### Added

- Repository start.

# new-music-fridays

[![CI](https://github.com/mattroe/new-music-fridays/actions/workflows/ci.yml/badge.svg)](https://github.com/mattroe/new-music-fridays/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)

A weekly "New Music Friday" digest based on your Last.fm listening history. Runs as an Anthropic-hosted Claude Code routine and emails a curated digest of new releases to you each Friday.

## How it works

Claude executes `SKILL.md` every Friday via an Anthropic-hosted routine. The prompt:

1. Pulls your Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web in two passes — discovery across the tier-1 and genre-routed tier-2 sources in `config/release-sources.yaml`, then an endorsement check against `config/review-sources.yaml` — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Verifies kept candidates against the open [MusicBrainz](https://musicbrainz.org) database (`config/musicbrainz.yaml`) — confirming they exist and reading each release-group's first-release-date to confirm genuinely-new releases and demote reissues, and (optionally) enriching each with its authoritative label and producer/engineer credits that overlap your taste (a signal, not a filter; needs `musicbrainz.org` on the allowlist, and no-ops harmlessly until it's added)
5. Composes a digest — Top 5 picks, Section A (up to 10 known-artist releases), Section B (up to 5 discovery picks), and Worth a Second Look — with the three sections mutually exclusive so no pick repeats, plus endorsement citations where picks earned them
6. Delivers the digest — by default emails it via Resend's REST API; set `method: none` in `config/delivery.yaml` to skip the send and rely on the downloadable file published to your state repo instead (see [Other delivery options](docs/delivery.md)). Either way it writes the rendered email + run metadata to `runs/<today>/` — ephemeral on the routine VM, so the email (or published digest) and the run's session transcript are the durable record
7. Appends a distilled, redacted record of the run (kept/skipped candidates and the final picks — never raw listening data) to an append-only `history.jsonl` in a **separate private state repo**, so picks survive the discarded VM and can inform later weeks (de-duplicating Worth a Second Look, and an implicit "did I actually play it?" lookback that steers curation toward the past picks you played). Production runs only; see [Durable run history](docs/setup.md#durable-run-history)

## Documentation

- **[Run your own](docs/setup.md)** — prerequisites, the Claude Code bootstrap, manual repo + routine setup, and durable run history.
- **[Other delivery options](docs/delivery.md)** — swap email for another provider, a push notification, or none; and how to get the digest as a downloadable file.
- **[Customizing for your taste](docs/customizing.md)** — tune sources, templates, and model; and how to provide feedback that steers the picks.
- **[Testing and development](docs/testing.md)** — cloud test runs, local CI checks, the test routine, and the optional on-merge smoke-test.
- **[Troubleshooting](docs/troubleshooting.md)** — common failure modes and fixes.

Forward-looking work lives in the repo's [open issues](https://github.com/mattroe/new-music-fridays/issues), not in a roadmap doc.

## Layout

- `SKILL.md` — orchestrator prompt; reads the configs and templates below
- `CLAUDE.md` — developer context for editing the repo (distinct from `SKILL.md`)
- `config/delivery.yaml.example` — template; copy to `config/delivery.yaml` and fill in
- `config/lastfm.yaml` — Last.fm query periods, limits, similar-artist fan-out
- `config/release-sources.yaml` — discovery sweep (tier-1 always; tier-2 genre-routed)
- `config/review-sources.yaml` — endorsement signals + citation allowlist for the email
- `config/musicbrainz.yaml` — MusicBrainz verification switch (`enabled`) + match-score floor (`min_score`) + Phase 2 enrichment switches (`enrich_labels`, `enrich_credits`)
- `templates/email.html` and `templates/email.txt` — email scaffolds with `{{placeholders}}`
- `scripts/send-email.mjs` — sends the rendered email via Resend's REST API
- `scripts/musicbrainz.mjs` — resolves kept candidates against the MusicBrainz API to verify they exist and read each release-group's first-release-date, and optionally enrich them with the authoritative label and distilled personnel credits (zero-dependency; fail-soft; one hardcoded host)
- `scripts/run-state.sh` — emits run-state values (date, run mode, timestamps, duration) for `SKILL.md`
- `scripts/write-delivery.sh` — materializes `config/delivery.yaml` from `NMF_*` env vars at run start
- `scripts/history.sh` — reads recent run records back and appends one per production run to the private state repo's `history.jsonl` (best-effort; production-only; see [Durable run history](docs/setup.md#durable-run-history))
- `scripts/publish-digest.sh` — copies the rendered `email.html`/`email.txt` into `digests/<date>/` in the private state repo and pushes them each production run, for a durable downloadable artifact (best-effort; production-only; no-op without a state repo; see [Getting the digest as a downloadable file](docs/delivery.md#getting-the-digest-as-a-downloadable-file))
- `scripts/bootstrap.sh` — first-time setup helper: `preflight` reports toolchain/repo/config readiness, `validate` sanity-checks `config/delivery.yaml`, `state-repo` creates + seeds the private state repo in one command (used by the bootstrap prompt in [Run your own](docs/setup.md))
- `runs/<YYYY-MM-DD>/` — per-run artifacts; filename prefix indicates mode (`email.html`, `test-email.html`). Gitignored and ephemeral — not persisted after a cloud run.
- `history.jsonl` — the durable per-run corpus; lives in a **separate private state repo**, never this one (gitignored here as defense-in-depth).

For editing conventions and the change-gating workflow, see `CLAUDE.md` and [Testing and development](docs/testing.md).

## License

Copyright (C) 2026 Matt Roe. Licensed under the [GNU AGPL-3.0](LICENSE).

You're free to run, study, modify, and share this; if you run a modified version as a network service, the AGPL asks that you offer your users its source too. A copyleft choice — derivatives stay open.

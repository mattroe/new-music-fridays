# Roadmap

> Forward-looking only. Rewrite on phase ship; past context lives in git history. See `CLAUDE.md`.

The repo runs a working Friday digest via `SKILL.md`. This file tracks what's planned next and why.

## Current state

- `SKILL.md` is a thin orchestrator reading config from `config/*` and templates from `templates/*`
- Pre-send validation catches `from`/`to`/`subject` mismatches and unfilled placeholders
- Per-run artifacts (`listening-profile.json`, `candidates.md`, `email.html`, `email.txt`, `meta.json`) written to `runs/<YYYY-MM-DD>/` for local audit; filename prefix indicates mode (`fast-`, `test-`, or unprefixed for production). The whole `runs/` tree is gitignored
- Three run modes via env vars: production (scheduled fire, no flags), test (`NMF_TEST=1`, `[TEST]` subject prefix, full data path), fast (`NMF_FAST=1`, `[TEST][FAST]` prefix, trimmed Last.fm + stubbed candidates). All modes send via Resend; the prefix makes test sends obvious. The `scripts/nmf` wrapper exposes this as `--test` / `--fast` flags
- Scheduled production runs are disruption-proof: they fire in a fresh process with no env vars, so manual test/fast invocations can never leak into Friday morning
- `CLAUDE.md` codifies dev-side conventions, distinct from the runtime `SKILL.md`
- Repo is clone-and-run friendly: `config/delivery.yaml` is gitignored with an `.example` template, and the README walks a new user through Last.fm MCP + Resend MCP + scheduling on their own machine

## Most important next: verify on a real run

The next scheduled Friday run (2026-05-22) will be the first to exercise the new mode-detection + filename-prefix logic. Before relying on these affordances for further development:

1. **Fast-mode smoke test:** `./scripts/nmf --fast`. Confirm artifacts land at `runs/<today>/fast-*` with `mode: "fast"` in `fast-meta.json`, the email arrives with `[TEST][FAST]` prefix, and total wall time is under two minutes.
2. **Live production verification:** let the scheduled Friday run go through and inspect `runs/2026-05-22/` afterwards. Confirm artifacts are unprefixed (`email.html`, `meta.json`, etc.), the email arrives with no subject prefix, and `meta.json.mode == "production"`, `sent == true`, `resend_message_id` present.

If anything is off — missing artifact, validation mismatch, wrong mode detected, scheduled run picking up stray env vars — fix forward in `SKILL.md` before further changes.

## Phase 4 — output-shape validation (deferred until mode detection is verified)

Extend pre-send validation beyond `from`/`to`/`subject`:

- Section sizes reasonable (`top_5` has 5 items, `section_b` ≤ 5, etc.)
- Required fields present per release (title, label, date, why-it-fits)

Best done **after** a few runs of `candidates.md` and `email.html`/`txt` exist — real outputs will show which failure modes actually occur. Designing this up front is guesswork.

## Phase 5 — prompt-quality refinements (deferred)

- Refine the "fit to taste" rubric (what does "tightness of fit" mean concretely?)
- Use `candidates.md` from real runs to identify rejection patterns worth encoding

## Phase 6 — model selection optimization (deferred)

`SKILL.md` currently pins `model: opus` and `effort: max`. Revisit after 4–8 weeks of `meta.json` cost data accumulates: compare Opus + max against Sonnet and Haiku on curation quality vs per-run cost. The decision becomes evidence-driven once real numbers exist.

## Phase 7 — distribution polish (after first external user)

The initial clone-and-run path is in place, but it's untested by a second user. Hold off on changes here until at least one outside person follows the README end-to-end. Then iterate on whatever actually tripped them up — likely candidates:

- Smoother MCP onboarding if the Last.fm or Resend setup is the snag
- A non-Resend delivery path baked into `SKILL.md` (currently described in README prose only) if multiple users want to skip Resend

Resist designing this in advance — real friction is more informative than imagined friction.

## Explicitly NOT planned

- **Multi-stage prompt split** (separate `prompts/01-…`, `prompts/02-…`). `SKILL.md` is short enough; splitting adds files for unclear gain.
- **Synthetic fixtures as a separate concept.** Fast mode already exercises the plumbing with stub candidates; real production runs serve as the realistic-data fixture.

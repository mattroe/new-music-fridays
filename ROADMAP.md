# Roadmap

> Forward-looking only. Rewrite on phase ship; past context lives in git history. See `CLAUDE.md`.

The repo runs a working Friday digest via `SKILL.md`. This file tracks what's planned next and why.

## Current state

- `SKILL.md` is a thin orchestrator reading config from `config/*` and templates from `templates/*`
- Pre-send validation catches `from`/`to`/`subject` mismatches and unfilled placeholders
- Per-run artifacts (`listening-profile.json`, `candidates.md`, `email.html`, `email.txt`, `meta.json`) written to `runs/<YYYY-MM-DD>/` for local audit; the whole `runs/` tree is gitignored to keep listening history and recipient addresses out of the repo
- Dry-run mode available via `NMF_DRY_RUN=1` env var or `.dry-run` file at repo root
- `CLAUDE.md` codifies dev-side conventions, distinct from the runtime `SKILL.md`
- Repo is forkable: `config/delivery.yaml` is gitignored with an `.example` template, and the README walks a new user through Last.fm MCP + Resend MCP + scheduling on their own machine

## Most important next: verify Phase 3 on a real run

The next scheduled Friday run (2026-05-22) will be the first to exercise the new run-logging and dry-run instructions. Before relying on dry-run for further development:

1. **Live verification:** let the next scheduled run go through and inspect `runs/2026-05-22/` afterwards. Confirm all five artifacts are written and the email still arrives normally (`meta.json.sent == true`, `resend_message_id` present).
2. **Manual dry-run smoke test:** before Friday, trigger the routine with `NMF_DRY_RUN=1` (or drop a `.dry-run` file at the repo root). Confirm all artifacts are written, no email is sent, and `meta.json.sent == false`.

If anything is off — missing artifact, validation false negative, dry-run gate ignored — fix forward in `SKILL.md` before treating dry-run as a reliable dev affordance.

## Phase 4 — output-shape validation (deferred until Phase 3 is verified)

Extend pre-send validation beyond `from`/`to`/`subject`:

- Section sizes reasonable (`top_5` has 5 items, `section_b` ≤ 5, etc.)
- Required fields present per release (title, label, date, why-it-fits)

Best done **after** a few runs of `candidates.md` and `email.html`/`txt` exist — real outputs will show which failure modes actually occur. Designing this up front is guesswork.

## Phase 5 — prompt-quality refinements (deferred)

- Refine the "fit to taste" rubric (what does "tightness of fit" mean concretely?)
- Use `candidates.md` from real runs to identify rejection patterns worth encoding

## Phase 6 — model selection optimization (deferred)

`SKILL.md` currently pins `model: opus` and `effort: max`. Revisit after 4–8 weeks of `meta.json` cost data accumulates: compare Opus + max against Sonnet and Haiku on curation quality vs per-run cost. The decision becomes evidence-driven once real numbers exist.

## Phase 7 — distribution polish (after first external fork)

The initial fork-and-run path is in place, but it's untested by a second user. Hold off on changes here until at least one outside person follows the README end-to-end. Then iterate on whatever actually tripped them up — likely candidates:

- Smoother MCP onboarding if the Last.fm or Resend setup is the snag
- A non-Resend delivery path baked into `SKILL.md` (currently described in README prose only) if multiple users want to skip Resend

Resist designing this in advance — real friction is more informative than imagined friction.

## Explicitly NOT planned

- **Multi-stage prompt split** (separate `prompts/01-…`, `prompts/02-…`). `SKILL.md` is short enough; splitting adds files for unclear gain.
- **Synthetic fixtures.** Once Phase 3 logs exist, real run snapshots serve as fixtures naturally.

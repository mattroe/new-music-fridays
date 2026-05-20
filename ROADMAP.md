# Roadmap

> Forward-looking only. Rewrite on phase ship; past context lives in git history. See `CLAUDE.md`.

The repo runs a working Friday digest via `SKILL.md`. This file tracks what's planned next and why.

## Current state

- `SKILL.md` is a thin orchestrator reading config from `config/*` and templates from `templates/*`
- Pre-send validation catches `from`/`to`/`subject` mismatches and unfilled placeholders
- Per-run artifacts (`listening-profile.json`, `candidates.md`, `email.html`, `email.txt`, `meta.json`) written to `runs/<YYYY-MM-DD>/` for audit
- Dry-run mode available via `NMF_DRY_RUN=1` env var or `.dry-run` file at repo root
- `CLAUDE.md` codifies dev-side conventions, distinct from the runtime `SKILL.md`

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

## Explicitly NOT planned

- **Multi-stage prompt split** (separate `prompts/01-…`, `prompts/02-…`). `SKILL.md` is short enough; splitting adds files for unclear gain.
- **Synthetic fixtures.** Once Phase 3 logs exist, real run snapshots serve as fixtures naturally.

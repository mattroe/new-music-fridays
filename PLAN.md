# Roadmap

> **Convention:** this file is always a fresh, forward-looking roadmap. When a phase ships, rewrite this file to reflect what's next — don't leave it as a historical handoff or stack of completed phases. Past context lives in git history and PR descriptions.

The repo runs a working Friday digest via `SKILL.md`. This file tracks what's planned next and why.

## Current state

- `SKILL.md` is a thin orchestrator reading config from `config/*` and templates from `templates/*`
- Validation step catches `from`/`to`/`subject` mismatches before send
- No audit trail of per-run state (next phase addresses this)

## Next up — cleanup pass

Small follow-ups before Phase 3 begins:

- Add `CLAUDE.md` with dev-side context (distinct from `SKILL.md`, which is the runtime prompt)
- Trim `config/sources.txt` to 5 sources: Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, NPR
- Delete `config/genres.txt` — genre signal is already in the listening profile (top artists + recs + similar). Update `SKILL.md` to drop the reference.
- Add `templates/email.txt` — plain-text companion to `email.html` with the same `{{placeholders}}`. The Resend `send-email` connector requires `text` when `html` is provided; today it's generated inline at compose time, which pushes templating logic back into the prompt.
- Update `SKILL.md` to fill both templates, pass `text:` alongside `html:`, and extend the pre-send validation to confirm `text` is non-empty.

## Phase 3 — run logging + dry-run

Write per-run artifacts to `runs/<YYYY-MM-DD>/` so every run is inspectable after the fact:

- `listening-profile.json` — Last.fm snapshot (top artists × 3 periods, recommendations, similar-artist fan-out)
- `candidates.md` — release candidates considered, with kept/skipped notes
- `email.html` / `email.txt` — final rendered bodies
- `meta.json` — timestamp, dry-run flag, Resend message ID (if sent), validation status

**Dry-run:** set `NMF_DRY_RUN=1` (or drop a `.dry-run` file in the repo root) to write all artifacts but skip the Resend send step. Same code path; just gated.

**Why this first:** today there's no audit after a run; dry-run also falls out for free once logs are written before the send step.

`runs/` should be gitignored.

## Phase 4 — output-shape validation (deferred)

Extend pre-send validation beyond `from`/`to`/`subject`:

- All four placeholders filled (no literal `{{…}}` left in body)
- Section sizes reasonable (`top_5` has 5, `section_b` ≤ 5, etc.)
- Required fields present per release (title, label, date, why-it-fits)

Defer until Phase 3 logs surface concrete failure modes worth catching.

## Phase 5 — prompt-quality refinements (deferred)

- Tighten skip-list semantics ("major release worth skipping" vs. just irrelevant)
- Refine the "fit to taste" rubric
- Revisit after a few runs of logged candidates show real patterns

## Explicitly NOT planned

- **Multi-stage prompt split** (separate `prompts/01-…`, `prompts/02-…`). `SKILL.md` is short enough; splitting adds files for unclear gain.
- **Synthetic fixtures.** Once Phase 3 logs exist, real run snapshots are better fixtures than hand-crafted ones.

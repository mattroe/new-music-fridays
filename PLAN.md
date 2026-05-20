# Phase 2 plan

This file briefs a fresh Claude Code session on the state of the `new-music-fridays` repo and what to work on next. Read this before doing anything.

## Where we are (Phase 1 complete)

- Repo lives at `~/code/new-music-fridays`, pushed to `mattroe/new-music-fridays` (private) on GitHub
- Symlinked into the scheduled-task runtime: `~/.claude/scheduled-tasks/new-music-fridays` → `~/code/new-music-fridays`
- Manual trigger of the routine has been confirmed working through the symlink
- Commits are SSH-signed (verified by GitHub)
- `SKILL.md` is unchanged from the original scheduled-task version — it's still the monolithic prompt

The routine itself works end-to-end (last run sent successfully from `digest@example.com` to `you@example.com`). Phase 2 is purely a refactor for maintainability — **do not change observable behavior**.

## Phase 2 goals

Decompose the monolithic `SKILL.md` so that:

1. **Configuration is data, not prose.** The genres, editorial sources, email addresses, subject-line format, and Last.fm query parameters are all currently inlined in the prompt. They should live in editable config files so changing them doesn't require editing the prompt logic.
2. **The email template is versioned separately.** The HTML email body should live as its own file so design iterations show up as clean diffs, not as buried prose edits in a prompt.
3. **`SKILL.md` becomes a thin orchestrator** that references the config and template files by path.

After Phase 2, behavior should be identical. The win is editability and review-ability.

## Proposed structure

```
new-music-fridays/
├── SKILL.md                   # thin orchestrator; references files below
├── config/
│   ├── delivery.yaml          # from, to, subject_template
│   ├── genres.txt             # genres in the listening profile (one per line)
│   ├── sources.txt            # editorial sources to consult (one per line)
│   └── lastfm.yaml            # query periods, limits, top-N for similar-artist fan-out
├── templates/
│   ├── email.html             # HTML email body with placeholders
│   └── email.txt              # plain-text fallback with placeholders
└── PLAN.md                    # this file
```

## What to extract from current SKILL.md

Read `SKILL.md` end-to-end before extracting. Specifically:

- **Last.fm calls** in lines ~10–15: the periods (`3month`, `12month`, `overall`), the limits (50/50/100), the recommendation limit (50), and the top-20 similar-artist fan-out → `config/lastfm.yaml`
- **Genre list** in line ~18: "ECM/contemporary jazz, ambient, indie folk, experimental hip-hop, world/folk, modern composition, indie rock" → `config/genres.txt`
- **Source list** in line ~18: "NPR Music New Music Friday, Bandcamp Daily Essential Releases, Pitchfork Best New Music, Paste Magazine, Stereogum, Resident Advisor, The Wire, Jazzwise, Presto Music jazz roundup, AllMusic, Qobuz..." → `config/sources.txt`
- **Delivery details** in line ~30: from address (`digest@example.com`), to address (`you@example.com`), subject format (`New Music Friday - MM-DD-YYYY`), and the "plain email string, no display-name wrapper" constraint on the `from` field → `config/delivery.yaml`
- **Email body structure** (Top 5 → Section A → Section B → Skip) — this is the template. Decide whether to put the HTML structure into `templates/email.html` as a literal HTML scaffold with `{{placeholders}}`, or to keep the structural instructions in `SKILL.md` and only template the styling. See "Decision points" below.

## Decision points to raise with the user before extracting

1. **Config format**: YAML or JSON? YAML is friendlier to edit by hand; JSON is more rigid. Both work since Claude reads them. Recommend YAML for `delivery.yaml` and `lastfm.yaml`, plain text for the lists (`genres.txt`, `sources.txt`).

2. **Template approach**: Two options for the email body:
   - **(a) Literal HTML file with `{{placeholders}}`** — the file contains the full styled HTML scaffold; Claude's job is to fill in the dynamic content (Top 5 list, Section A, Section B, Skip list). Cleanest separation; design iteration is purely visual.
   - **(b) Structural prose in SKILL.md, styles only in template** — `templates/email.html` is just CSS + boilerplate `<head>`; SKILL.md still describes the section structure. More flexible if section structure changes often.

   Recommend (a). Section structure has been stable across runs and is unlikely to change frequently.

3. **Should the validation step (verify `from`/`to` match config before sending) be added in Phase 2 or wait for Phase 5?** It's a one-line addition to the prompt and would have caught the bug from the run dated 2026-05-19. Recommend doing it now since it's trivial.

4. **Skip-list logic**: currently `SKILL.md` doesn't define what qualifies as a "major release worth skipping" vs. just an irrelevant release. This isn't a Phase 2 issue (it's about prompt quality, not structure), but flag it if it surfaces during extraction.

## Out of scope for Phase 2 (don't drift into these)

- **Phase 3**: splitting the prompt into stages (`prompts/01-listening-profile.md`, `02-release-scan.md`, etc.) and writing intermediate state to `runs/<date>/`. Tempting to combine with Phase 2 but explicitly separated to keep the diff readable.
- **Phase 4**: dry-run scripts and fixtures (`fixtures/sample-profile.json`)
- **Phase 5**: validation, run logging, error handling improvements (except the trivial `from`/`to` check called out above)

## How to start

1. Open this repo (`cd ~/code/new-music-fridays`)
2. Read `SKILL.md` end-to-end to see what's being extracted
3. Confirm the four decision points above with the user
4. Extract config and template, update `SKILL.md` to reference them
5. Manually trigger the scheduled task to verify behavior is unchanged
6. Commit with a descriptive message; push

## Reference: full original task brief

The original task brief (before any rewrites) is preserved in git history. The current `SKILL.md` includes one small post-Phase-1 edit: the last line was updated to specify the `from` address explicitly and warn against display-name wrappers. That edit fixed a real bug from the 2026-05-19 run.

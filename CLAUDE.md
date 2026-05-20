# Developer context for new-music-fridays

This file is for Claude when **editing** the repo. The runtime prompt the scheduled task executes is `SKILL.md` — keep the two distinct.

## What this repo is

A weekly "New Music Friday" digest based on Last.fm listening history, sent every Friday via Resend. See `README.md` for the user-facing overview and `PLAN.md` for the current roadmap.

## Wire-up

This repo is symlinked into the Claude Code scheduled-task runtime:

```
~/.claude/scheduled-tasks/new-music-fridays → ~/code/new-music-fridays
```

Edits in `~/code/new-music-fridays` are picked up by the next scheduled run. No build step.

## Conventions

- **`PLAN.md` is always a fresh, forward-looking roadmap.** When a phase ships, rewrite this file to reflect what's next. Don't leave it as a historical handoff or a stack of completed phases. Past phase context belongs in commit messages and PR descriptions.
- **Behavior should remain stable across refactors.** When changing `SKILL.md`, configs, or templates, the email's structure and recipients should not silently drift. Validation steps in the prompt catch the obvious cases (`from`/`to`/`subject`/template-fill); the rest comes down to careful review.
- **Configuration is data.** Sources, delivery details, and Last.fm parameters live in `config/*` and `templates/*`, not inlined in `SKILL.md`. If you find yourself adding prose to `SKILL.md` that's really a setting, extract it.

## How to test changes

There's no automated test suite. To verify a change before committing, trigger the routine manually through the scheduled-task runtime and confirm:

1. The email arrives at the expected address from the expected sender
2. The pre-send validation passes (it aborts on `from`/`to`/`subject`/template-fill mismatches)
3. Both `html` and `text` Resend args are populated

Dry-run mode (`NMF_DRY_RUN=1` or a `.dry-run` file in the repo root) writes all per-run artifacts to `runs/<YYYY-MM-DD>/` but skips the Resend send — useful for verifying rendering and candidate selection without actually sending.

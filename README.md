# new-music-fridays

A weekly "New Music Friday" summary based on my Last.fm listening history. Runs as a Claude Code scheduled task; emails a curated digest of new releases to me each Friday.

## How it works

Claude (via the scheduled-task runtime) executes `SKILL.md` every Friday. The prompt:

1. Pulls my Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, and NPR Music — plus genre-specific blogs and label sites — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks, Skip list)
5. Sends the email via the Resend MCP connector

## Wire-up

This repo is symlinked into the Claude Code scheduled-tasks directory:

```
~/.claude/scheduled-tasks/new-music-fridays -> ~/code/new-music-fridays
```

Edits here are picked up by the next scheduled run.

## Layout

- `SKILL.md` — orchestrator prompt; reads the configs and templates below
- `CLAUDE.md` — developer context (loaded when editing the repo, distinct from `SKILL.md`)
- `config/delivery.yaml` — sender, recipient, subject format
- `config/lastfm.yaml` — Last.fm query periods, limits, similar-artist fan-out
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` — HTML email scaffold with `{{placeholders}}`
- `templates/email.txt` — plain-text email scaffold with the same `{{placeholders}}`

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions and `PLAN.md` for the current roadmap.

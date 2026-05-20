# new-music-fridays

A weekly "New Music Friday" summary based on my Last.fm listening history. Runs as a Claude Code scheduled task; emails a curated digest of new releases to me each Friday.

## How it works

Claude (via the scheduled-task runtime) executes `SKILL.md` every Friday. The prompt:

1. Pulls my Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, and NPR Music — plus genre-specific blogs and label sites — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks)
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

## Customizing for your setup

If you're forking this for your own weekly digest, the things to change are:

- **`config/delivery.yaml`** — set `from` to a verified sender on your Resend domain and `to` to your own address. Adjust `subject_template` if you want a different subject line.
- **`config/lastfm.yaml`** — tune the Last.fm query periods, limits, and similar-artist fan-out. The Last.fm username itself is read from the Last.fm MCP server's auth, not this file.
- **`config/sources.txt`** — replace the editorial sources with whatever publications, blogs, or label sites match your taste. One URL per line.
- **`templates/email.html`** and **`templates/email.txt`** — adjust the email scaffold and copy. Keep the `{{placeholders}}` aligned across both files.
- **`SKILL.md` frontmatter** — `model: opus` and `effort: max` are the defaults. Override for cost or latency:
  - `model: sonnet` (or `haiku`) for cheaper, faster runs at the cost of curation depth
  - `effort: high` (or `medium`, `low`) to cap reasoning tokens. See the [Claude Code skills docs](https://code.claude.com/docs/en/skills) for the full list per model.
- **MCP servers** — this routine relies on the Last.fm and Resend MCP connectors being configured in your Claude Code setup. Without those, the run will fail at the data-fetch or send step.

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions and `ROADMAP.md` for what's next.

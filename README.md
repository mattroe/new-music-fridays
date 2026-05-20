# new-music-fridays

A weekly "New Music Friday" summary based on my Last.fm listening history. Runs as a Claude Code scheduled task; emails a curated digest of new releases to me each Friday.

## How it works

Claude (via the scheduled-task runtime) executes `SKILL.md` every Friday. The prompt:

1. Pulls my Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across NPR Music, Bandcamp Daily, Pitchfork, Paste, Stereogum, RA, The Wire, Jazzwise, Presto, AllMusic, Qobuz, etc. for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks, Skip list)
5. Sends the email via the Resend MCP connector

## Wire-up

This repo is symlinked into the Claude Code scheduled-tasks directory:

```
~/.claude/scheduled-tasks/new-music-fridays -> ~/code/new-music-fridays
```

Edits here are picked up by the next scheduled run.

## Development

Currently the entire routine lives in `SKILL.md`. Future phases will split it into modular prompts, extract config and templates, and add dry-run / fixture-based dev affordances. See conversation history for the planned phases.

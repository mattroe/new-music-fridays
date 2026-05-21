---
name: new-music-fridays
description: Provide me a new music summary weekly based on my listening history
model: opus
effort: max
---

This routine produces my "New Music Friday" summary covering new music released in the last calendar week (the past 7 days). The release window is the past 7 days regardless of which day the run is triggered — Fridays for the scheduled run, any day for manual triggers or dry-runs.

## Read configuration first

- `config/delivery.yaml` — sender, recipient, subject template
- `config/lastfm.yaml` — Last.fm query parameters
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` — HTML email scaffold with placeholders
- `templates/email.txt` — plain-text email scaffold with the same placeholders

## Set up run state

Determine today's date in `YYYY-MM-DD` format — call this `<today>`.

Check for dry-run mode: dry-run is **on** if either the `NMF_DRY_RUN` environment variable is set to any non-empty value, or a file named `.dry-run` exists at the repo root. Otherwise dry-run is **off**.

Set the per-run artifact directory `<run_dir>`:

- Dry-run **off** (real run): `<run_dir>` = `runs/<today>/`
- Dry-run **on**: `<run_dir>` = `runs/.dry/<today>/`

The whole `runs/` tree is gitignored — artifacts are local-only for both real and dry runs, since they can incidentally contain personal data (Last.fm history, recipient address, etc.). The dry/real split is preserved purely for local separation.

Create `<run_dir>` (relative to the repo root) if it doesn't already exist. The dry-run flag also gates the final Resend send step.

Record the current UTC timestamp (ISO 8601, e.g. via `date -u +"%Y-%m-%dT%H:%M:%SZ"`) as `<started_at>` — used in the finalize step to compute total run duration.

## Data gathering (call in parallel)

Use the Last.fm MCP tools (the server may be registered under a friendly name like `Last-fm` or a UUID-prefixed identifier — match the tool by its function name suffix):

- `lastfm_auth_status` — confirm auth
- `get_top_artists` once per entry in `lastfm.yaml::top_artists`, using the `period` and `limit` from each entry
- `get_music_recommendations` with `limit` from `lastfm.yaml::recommendations.limit` (seeds discovery picks alongside listening history)
- For the top `lastfm.yaml::similar_artists.top_n` artists from the 3-month chart and overall chart, also call `get_similar_artists` with `limit` from `lastfm.yaml::similar_artists.limit` to widen the discovery pool

> **Log:** write the raw Last.fm responses (top-artist charts × 3 periods, recommendations, similar-artist fan-out) to `<run_dir>/listening-profile.json` as a single JSON document keyed by call name.

## New release research

Search the web for albums released in the past 7 days across the genres represented in my listening profile (derived from the top-artist charts, recommendations, and similar-artist fan-out above). Draw from the sources in `config/sources.txt` plus any genre-specific blogs or label sites relevant to that week's releases.

When searching Pitchfork, scope to `site:pitchfork.com` (the whole site, not just `/best-new-music`) — general aggregator queries return poor results for editorial coverage.

Cross-reference everything against the listening data AND the `get_music_recommendations` output before including it.

> **Log:** write `<run_dir>/candidates.md` listing the release candidates you considered. For each: artist, album title, release date, source where you found it, and a one-line note on whether it was kept (and for which section) or skipped (and why). Include both kept and skipped candidates — the value is in the rejection reasoning.

## Compose three content blocks

These fill placeholders in both `templates/email.html` and `templates/email.txt`. The same content goes into each, formatted appropriately: HTML markup (links as `<a>`) for the HTML template, plain text (links as raw URLs) for the text template.

- `{{top_5}}` — **Top 5 Picks of the Week**. Lead with this. Five releases across both known and discovery artists, sorted by tightness of fit to my tastes. One sentence each on why.

- `{{section_a}}` — **Artists I've already listened to**. Artists appearing in any of my top-artist charts or loved tracks. For each: album title, label, release date, why it's relevant (which charts they appear on, play count if notable, producer/collaborator overlap with other artists I listen to). Sort by tightness of fit.

- `{{section_b}}` — **Discovery picks**. Maximum 5. Artists NOT in my listening history, matched via: (i) `get_music_recommendations` output, (ii) similar-artist overlap with my top artists, or (iii) genre/label/collaborator overlap. For each: album title, label, release date, one-line "why this fits" tied to a specific artist or genre from my profile. Sort by tightness of fit.

Also substitute `{{date}}` with today's date formatted as MM-DD-YYYY.

> **Log:** write the fully-templated bodies to `<run_dir>/email.html` and `<run_dir>/email.txt`. These should match exactly what you'd pass as `html` and `text` to the Resend connector.

## Validate before sending

Before calling the resend connector, verify each of:

- The `from` argument you will pass exactly equals `delivery.yaml::from`
- The `to` argument exactly equals `delivery.yaml::to`
- The `subject` argument exactly equals `delivery.yaml::subject_template` with `{date}` replaced by today's date in MM-DD-YYYY format
- The `html` and `text` arguments are both non-empty and contain no unfilled `{{placeholder}}` strings

If any check fails, abort and report the mismatch rather than sending.

## Send

If dry-run mode is **on**, skip the Resend call entirely.

Otherwise, send via the `resend` connector:

- `to`: from `delivery.yaml::to`
- `from`: from `delivery.yaml::from` — pass as a plain email string with no display-name wrapper (the `from` field does not accept "Name <email>" format)
- `subject`: the rendered subject from `subject_template`
- `html`: the fully-filled `templates/email.html`
- `text`: the fully-filled `templates/email.txt` (the resend connector requires this when `html` is provided)

## Finalize run log

Either way (sent or skipped), write `<run_dir>/meta.json` capturing cost-tracking metrics alongside the existing run status.

First, capture `<finished_at>` as the current UTC timestamp (ISO 8601), and compute `<duration_seconds>` = `<finished_at>` − `<started_at>`.

Then run `scripts/sum-tokens.sh` (from the repo root) to capture real API token usage from this session's JSONL. Parse its JSON output for the `tokens` field below. If the script returns an `error` object (no JSONL found), set `tokens` to `null` and add a note explaining why.

Count tool calls deterministically:

- `lastfm.auth` = 1
- `lastfm.top_artists` = number of entries in `lastfm.yaml::top_artists`
- `lastfm.recommendations` = 1
- `lastfm.similar_artists` = number of unique top-`top_n` artists actually fanned out (`top_n` × 2 charts, minus chart overlap)
- `lastfm.total` = sum of the above
- `web_searches` = count of WebSearch calls made during the New release research phase

Write `<run_dir>/meta.json`:

```json
{
  "started_at": "<started_at>",
  "finished_at": "<finished_at>",
  "duration_seconds": <integer>,
  "dry_run": <bool>,
  "validation_passed": <bool>,
  "sent": <bool>,
  "resend_message_id": "<string or null>",
  "tool_calls": {
    "lastfm": {
      "auth": <int>,
      "top_artists": <int>,
      "recommendations": <int>,
      "similar_artists": <int>,
      "total": <int>
    },
    "web_searches": <int>
  },
  "tokens": {
    "input": <int>,
    "output": <int>,
    "cache_read": <int>,
    "cache_create": <int>,
    "total": <int>
  },
  "notes": []
}
```

The `tokens` numbers are parsed from `scripts/sum-tokens.sh`; they exclude tokens spent on the meta.json write itself and any messages after the scrape (the JSONL is appended to as the session progresses).

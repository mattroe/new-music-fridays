---
name: new-music-fridays
description: Provide me a new music summary weekly based on my listening history
---

Today is Friday. Produce my "New Music Friday" summary covering new music released today or in the last calendar week (the past 7 days).

## Read configuration first

- `config/delivery.yaml` — sender, recipient, subject template
- `config/lastfm.yaml` — Last.fm query parameters
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` — HTML email scaffold with placeholders
- `templates/email.txt` — plain-text email scaffold with the same placeholders

## Set up run state

Determine today's date in `YYYY-MM-DD` format — call this `<today>`. Create the directory `runs/<today>/` (relative to the repo root) if it doesn't already exist; this is where per-run artifacts go.

Check for dry-run mode: dry-run is **on** if either the `NMF_DRY_RUN` environment variable is set to any non-empty value, or a file named `.dry-run` exists at the repo root. Otherwise dry-run is **off**. This gates the final Resend send step.

## Data gathering (call in parallel)

- `mcp__Last-fm__lastfm_auth_status` — confirm auth
- `mcp__Last-fm__get_top_artists` once per entry in `lastfm.yaml::top_artists`, using the `period` and `limit` from each entry
- `mcp__Last-fm__get_music_recommendations` with `limit` from `lastfm.yaml::recommendations.limit` (seeds discovery picks alongside listening history)
- For the top `lastfm.yaml::similar_artists.top_n` artists from the 3-month chart and overall chart, also call `mcp__Last-fm__get_similar_artists` with `limit` from `lastfm.yaml::similar_artists.limit` to widen the discovery pool

> **Log:** write the raw Last.fm responses (top-artist charts × 3 periods, recommendations, similar-artist fan-out) to `runs/<today>/listening-profile.json` as a single JSON document keyed by call name.

## New release research

Search the web for albums released in the past 7 days across the genres represented in my listening profile (derived from the top-artist charts, recommendations, and similar-artist fan-out above). Draw from the sources in `config/sources.txt` plus any genre-specific blogs or label sites relevant to that week's releases. Cross-reference everything against the listening data AND the `get_music_recommendations` output before including it.

> **Log:** write `runs/<today>/candidates.md` listing the release candidates you considered. For each: artist, album title, release date, source where you found it, and a one-line note on whether it was kept (and for which section) or skipped (and why). Include both kept and skipped candidates — the value is in the rejection reasoning.

## Compose four content blocks

These fill placeholders in both `templates/email.html` and `templates/email.txt`. The same content goes into each, formatted appropriately: HTML markup (links as `<a>`) for the HTML template, plain text (links as raw URLs) for the text template.

- `{{top_5}}` — **Top 5 Picks of the Week**. Lead with this. Five releases across both known and discovery artists, sorted by tightness of fit to my tastes. One sentence each on why.

- `{{section_a}}` — **Artists I've already listened to**. Artists appearing in any of my top-artist charts or loved tracks. For each: album title, label, release date, why it's relevant (which charts they appear on, play count if notable, producer/collaborator overlap with other artists I listen to). Sort by tightness of fit.

- `{{section_b}}` — **Discovery picks**. Maximum 5. Artists NOT in my listening history, matched via: (i) `get_music_recommendations` output, (ii) similar-artist overlap with my top artists, or (iii) genre/label/collaborator overlap. For each: album title, label, release date, one-line "why this fits" tied to a specific artist or genre from my profile. Sort by tightness of fit.

- `{{skip_list}}` — **Skip / low priority**. Brief list of major releases that week that don't fit my taste, so I know what I'm consciously passing on.

Also substitute `{{date}}` with today's date formatted as MM-DD-YYYY.

> **Log:** write the fully-templated bodies to `runs/<today>/email.html` and `runs/<today>/email.txt`. These should match exactly what you'd pass as `html` and `text` to the Resend connector.

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

Either way (sent or skipped), write `runs/<today>/meta.json` with:

- `timestamp` — ISO 8601 UTC of when the run finished
- `dry_run` — `true` or `false`
- `validation_passed` — `true` or `false`
- `sent` — `true` if Resend was called and succeeded, `false` otherwise
- `resend_message_id` — the message ID returned by Resend, or `null` if not sent

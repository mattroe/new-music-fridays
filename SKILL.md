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

## Data gathering (call in parallel)

- `mcp__Last-fm__lastfm_auth_status` — confirm auth
- `mcp__Last-fm__get_top_artists` once per entry in `lastfm.yaml::top_artists`, using the `period` and `limit` from each entry
- `mcp__Last-fm__get_music_recommendations` with `limit` from `lastfm.yaml::recommendations.limit` (seeds discovery picks alongside listening history)
- For the top `lastfm.yaml::similar_artists.top_n` artists from the 3-month chart and overall chart, also call `mcp__Last-fm__get_similar_artists` with `limit` from `lastfm.yaml::similar_artists.limit` to widen the discovery pool

## New release research

Search the web for albums released in the past 7 days across the genres represented in my listening profile (derived from the top-artist charts, recommendations, and similar-artist fan-out above). Draw from the sources in `config/sources.txt` plus any genre-specific blogs or label sites relevant to that week's releases. Cross-reference everything against the listening data AND the `get_music_recommendations` output before including it.

## Compose four content blocks

These fill placeholders in both `templates/email.html` and `templates/email.txt`. The same content goes into each, formatted appropriately: HTML markup (links as `<a>`) for the HTML template, plain text (links as raw URLs) for the text template.

- `{{top_5}}` — **Top 5 Picks of the Week**. Lead with this. Five releases across both known and discovery artists, sorted by tightness of fit to my tastes. One sentence each on why.

- `{{section_a}}` — **Artists I've already listened to**. Artists appearing in any of my top-artist charts or loved tracks. For each: album title, label, release date, why it's relevant (which charts they appear on, play count if notable, producer/collaborator overlap with other artists I listen to). Sort by tightness of fit.

- `{{section_b}}` — **Discovery picks**. Maximum 5. Artists NOT in my listening history, matched via: (i) `get_music_recommendations` output, (ii) similar-artist overlap with my top artists, or (iii) genre/label/collaborator overlap. For each: album title, label, release date, one-line "why this fits" tied to a specific artist or genre from my profile. Sort by tightness of fit.

- `{{skip_list}}` — **Skip / low priority**. Brief list of major releases that week that don't fit my taste, so I know what I'm consciously passing on.

Also substitute `{{date}}` with today's date formatted as MM-DD-YYYY.

## Validate before sending

Before calling the resend connector, verify each of:

- The `from` argument you will pass exactly equals `delivery.yaml::from`
- The `to` argument exactly equals `delivery.yaml::to`
- The `subject` argument exactly equals `delivery.yaml::subject_template` with `{date}` replaced by today's date in MM-DD-YYYY format
- The `html` and `text` arguments are both non-empty and contain no unfilled `{{placeholder}}` strings

If any check fails, abort and report the mismatch rather than sending.

## Send

Send via the `resend` connector:

- `to`: from `delivery.yaml::to`
- `from`: from `delivery.yaml::from` — pass as a plain email string with no display-name wrapper (the `from` field does not accept "Name <email>" format)
- `subject`: the rendered subject from `subject_template`
- `html`: the fully-filled `templates/email.html`
- `text`: the fully-filled `templates/email.txt` (the resend connector requires this when `html` is provided)

---
name: new-music-fridays
description: Provide me a new music summary weekly based on my listening history
model: opus
effort: max
---

This routine produces my "New Music Friday" summary covering new music released in the last calendar week (the past 7 days). The release window is the past 7 days regardless of which day the run is triggered — Fridays for the scheduled production run, any day for manual test or fast runs.

## Read configuration first

- `config/delivery.yaml` — sender, recipient, subject template
- `config/lastfm.yaml` — Last.fm query parameters
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` — HTML email scaffold with placeholders
- `templates/email.txt` — plain-text email scaffold with the same placeholders

## Set up run state

Determine today's date in `YYYY-MM-DD` format — call this `<today>`.

Detect the run mode by inspecting environment variables only. File markers are intentionally NOT used so a leftover manual flag can never disrupt the scheduled production run:

- **Fast mode** is on iff the `NMF_FAST` environment variable is set to any non-empty value.
- **Test mode** is on iff the `NMF_TEST` environment variable is set OR fast mode is on (fast implies test).
- **Production mode** is the default when neither env var is set — this is what the scheduled Friday run uses.

Set `<mode>` to the most-specific applicable label: `"fast"` if fast is on, otherwise `"test"` if test is on, otherwise `"production"`.

Set the filename prefix `<fname_prefix>` from `<mode>`:

- `"production"` → `""` (no prefix)
- `"test"` → `"test-"`
- `"fast"` → `"fast-"`

All artifacts go to `<run_dir>` = `runs/<today>/` regardless of mode. The whole `runs/` tree is gitignored — artifacts are local-only since they can incidentally contain personal data (Last.fm history, recipient address, etc.). The filename prefix is what distinguishes modes within the shared dated directory.

Create `<run_dir>` (relative to the repo root) if it doesn't already exist.

Record the current UTC timestamp (ISO 8601, e.g. via `date -u +"%Y-%m-%dT%H:%M:%SZ"`) as `<started_at>` — used in the finalize step to compute total run duration.

## Data gathering (call in parallel)

Use the Last.fm MCP tools (the server may be registered under a friendly name like `Last-fm` or a UUID-prefixed identifier — match the tool by its function name suffix).

**In fast mode**, the data-gathering loop is trimmed to a single sanity-check pass that confirms the MCP works and provides a seed list of artist names for the stub-candidates step below:

- `lastfm_auth_status` — confirm auth
- `get_top_artists` with `period: "3month"`, `limit: 10` — single call only
- Skip `get_music_recommendations`
- Skip the `get_similar_artists` fan-out

**In test or production mode**, do the full gathering:

- `lastfm_auth_status` — confirm auth
- `get_top_artists` once per entry in `lastfm.yaml::top_artists`, using the `period` and `limit` from each entry
- `get_music_recommendations` with `limit` from `lastfm.yaml::recommendations.limit` (seeds discovery picks alongside listening history)
- For the top `lastfm.yaml::similar_artists.top_n` artists from the 3-month chart and overall chart, also call `get_similar_artists` with `limit` from `lastfm.yaml::similar_artists.limit` to widen the discovery pool

> **Log:** write the raw Last.fm responses to `<run_dir>/<fname_prefix>listening-profile.json` as a single JSON document keyed by call name. In fast mode this will contain just the auth status and the single top-artists response.

## New release research

**In fast mode**, skip web research entirely. Synthesize ~10 stub candidates from the 10 artists returned by the trimmed Last.fm call above. For each stub, invent a plausible album title, label, and release date within the past 7 days. The stubs only need to be realistic enough that the three content blocks below have something plausible to fill — content quality is explicitly not the point of a fast run.

**In test or production mode**, do the full research:

Search the web for albums released in the past 7 days across the genres represented in my listening profile (derived from the top-artist charts, recommendations, and similar-artist fan-out above). Draw from the sources in `config/sources.txt` plus any genre-specific blogs or label sites relevant to that week's releases.

When searching Pitchfork, scope to `site:pitchfork.com` (the whole site, not just `/best-new-music`) — general aggregator queries return poor results for editorial coverage.

Cross-reference everything against the listening data AND the `get_music_recommendations` output before including it.

> **Log:** write `<run_dir>/<fname_prefix>candidates.md` listing the release candidates you considered. For each: artist, album title, release date, source where you found it (or "stub" in fast mode), and a one-line note on whether it was kept (and for which section) or skipped (and why). Include both kept and skipped candidates — the value is in the rejection reasoning.

## Compose three content blocks

These fill placeholders in both `templates/email.html` and `templates/email.txt`. The same content goes into each, formatted appropriately: HTML markup (links as `<a>`) for the HTML template, plain text (links as raw URLs) for the text template.

- `{{top_5}}` — **Top 5 Picks of the Week**. Lead with this. Five releases across both known and discovery artists, sorted by tightness of fit to my tastes. One sentence each on why.

- `{{section_a}}` — **Artists I've already listened to**. Artists appearing in any of my top-artist charts or loved tracks. For each: album title, label, release date, why it's relevant (which charts they appear on, play count if notable, producer/collaborator overlap with other artists I listen to). Sort by tightness of fit.

- `{{section_b}}` — **Discovery picks**. Maximum 5. Artists NOT in my listening history, matched via: (i) `get_music_recommendations` output, (ii) similar-artist overlap with my top artists, or (iii) genre/label/collaborator overlap. For each: album title, label, release date, one-line "why this fits" tied to a specific artist or genre from my profile. Sort by tightness of fit.

Also substitute `{{date}}` with today's date formatted as MM-DD-YYYY.

> **Log:** write the fully-templated bodies to `<run_dir>/<fname_prefix>email.html` and `<run_dir>/<fname_prefix>email.txt`. These should match exactly what you'd pass as `html` and `text` to the Resend connector.

## Validate before sending

First, compute the expected subject from `<mode>`:

1. Start with `delivery.yaml::subject_template` with `{date}` replaced by today's date in MM-DD-YYYY format. Call this `<base_subject>`.
2. Apply the mode prefix:
   - `<mode>` = `"production"` → `<expected_subject>` = `<base_subject>` (no prefix)
   - `<mode>` = `"test"` → `<expected_subject>` = `"[TEST] " + <base_subject>`
   - `<mode>` = `"fast"` → `<expected_subject>` = `"[TEST][FAST] " + <base_subject>`

Then verify each of:

- The `from` argument you will pass exactly equals `delivery.yaml::from`
- The `to` argument exactly equals `delivery.yaml::to`
- The `subject` argument exactly equals `<expected_subject>`
- The `html` and `text` arguments are both non-empty and contain no unfilled `{{placeholder}}` strings

If any check fails, abort and report the mismatch rather than sending.

## Send

Send via the `resend` connector in all modes — test and fast modes also send, so the developer can confirm Resend works end-to-end. The subject prefix makes the test send obvious in the inbox.

- `to`: from `delivery.yaml::to`
- `from`: from `delivery.yaml::from` — pass as a plain email string with no display-name wrapper (the `from` field does not accept "Name <email>" format)
- `subject`: `<expected_subject>` computed in the validation step (includes any mode prefix)
- `html`: the fully-filled `templates/email.html`
- `text`: the fully-filled `templates/email.txt` (the resend connector requires this when `html` is provided)

## Finalize run log

Write `<run_dir>/<fname_prefix>meta.json` capturing run status alongside cost-tracking metrics.

First, capture `<finished_at>` as the current UTC timestamp (ISO 8601), and compute `<duration_seconds>` = `<finished_at>` − `<started_at>`.

Then run `scripts/sum-tokens.sh` (from the repo root) to capture real API token usage from this session's JSONL. Parse its JSON output for the `tokens` field below. If the script returns an `error` object (no JSONL found), set `tokens` to `null` and add a note explaining why.

Count tool calls deterministically (counts reflect what actually happened — in fast mode, `recommendations`, `similar_artists`, and `web_searches` will all be 0):

- `lastfm.auth` = 1
- `lastfm.top_artists` = number of `get_top_artists` calls made (1 in fast mode; otherwise the length of `lastfm.yaml::top_artists`)
- `lastfm.recommendations` = 0 in fast mode, else 1
- `lastfm.similar_artists` = 0 in fast mode, else number of unique top-`top_n` artists actually fanned out (`top_n` × 2 charts, minus chart overlap)
- `lastfm.total` = sum of the above
- `web_searches` = count of WebSearch calls made during the New release research phase (0 in fast mode)

Write `<run_dir>/<fname_prefix>meta.json`:

```json
{
  "started_at": "<started_at>",
  "finished_at": "<finished_at>",
  "duration_seconds": <integer>,
  "mode": "<mode>",
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

`mode` is the string `"production"`, `"test"`, or `"fast"` from the run-state step. The `tokens` numbers are parsed from `scripts/sum-tokens.sh`; they exclude tokens spent on the meta.json write itself and any messages after the scrape (the JSONL is appended to as the session progresses).

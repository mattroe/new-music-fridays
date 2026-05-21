# new-music-fridays

A weekly "New Music Friday" digest based on your Last.fm listening history. Runs as a Claude Code scheduled task; emails a curated digest of new releases to you each Friday.

## How it works

Claude (via the scheduled-task runtime) executes `SKILL.md` every Friday. The prompt:

1. Pulls your Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, and NPR Music — plus genre-specific blogs and label sites — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks)
5. Sends the email via the Resend MCP connector (or, in dry-run, writes the rendered email to disk)

## Use this yourself

If you want your own weekly digest, you can fork this repo and run it on your own machine. Plan on about 20–30 minutes excluding DNS propagation.

### Prerequisites

- Claude Code with scheduled tasks enabled
- A Last.fm account
- A way to receive the email. The default path uses [Resend](https://resend.com/) with a verified sending domain, but the routine is just "render two strings and hand them to a connector" — see [Other delivery options](#other-delivery-options) below if Resend isn't a fit.

### Step 1: Add the Last.fm MCP

Sign up at [lastfm-mcp.com](https://lastfm-mcp.com/) and follow their instructions to connect it to Claude Code as a remote MCP. Confirm it's wired up by invoking one of its tools manually from Claude Code once (e.g. `lastfm_auth_status`).

### Step 2: Add the Resend MCP

Skip this step if you're going to use [another delivery option](#other-delivery-options).

1. Sign up at [resend.com](https://resend.com/) and create an API key.
2. Verify a sending domain following Resend's [DNS walkthrough](https://resend.com/docs/dashboard/domains/introduction). You'll need to add a few DNS records and wait for propagation.
3. Install Resend's MCP in Claude Code with your API key.

### Step 3: Clone and configure

```bash
git clone git@github.com:mattroe/new-music-fridays.git
cd new-music-fridays
cp config/delivery.yaml.example config/delivery.yaml
```

Edit `config/delivery.yaml`:

- `from` — a Resend-verified address (e.g. `digest@your-domain.example`)
- `to` — wherever you want the email delivered
- `subject_template` — optional; `{date}` is replaced with `MM-DD-YYYY`

Optional tuning:

- `config/sources.txt` — editorial publications consulted during research (one per line)
- `config/lastfm.yaml` — query periods, top-artist limits, similar-artist fan-out

### Step 4: Wire into Claude Code's scheduled tasks

```bash
ln -s "$(pwd)" ~/.claude/scheduled-tasks/new-music-fridays
```

Then add a weekly schedule in Claude Code's scheduled-task UI — typically Friday morning in your timezone.

### Step 5: Smoke test in dry-run mode

Before going live, trigger the routine in dry-run mode and inspect the output:

```bash
touch .dry-run
# trigger the task manually from Claude Code's scheduled-task UI
open runs/.dry/$(date +%Y-%m-%d)/email.html   # eyeball the rendered email
rm .dry-run   # when you're ready to go live
```

The dry-run writes the same per-run artifacts as a real run (`listening-profile.json`, `candidates.md`, `email.html`, `email.txt`, `meta.json`) but skips the Resend call.

## Other delivery options

The Resend integration is one option — you can swap in any transactional email service that has an MCP connector (Postmark, Mailgun, SendGrid, etc.) by adjusting the "Send" section of `SKILL.md` to call that connector's send tool instead. The rendered `html` and `text` bodies, the `from`, `to`, and `subject` come from the same `config/delivery.yaml`; only the tool name changes.

Or skip email entirely: leave dry-run on permanently and read `runs/<today>/email.html` directly each Friday. The full digest is rendered to disk regardless of whether anything is sent.

## Customizing for your taste

- `config/sources.txt` — swap in publications, blogs, and label sites that match your taste. One source per line.
- `config/lastfm.yaml` — tune query periods, top-artist limits, and the similar-artist fan-out depth.
- `templates/email.html` and `templates/email.txt` — edit the email scaffold and copy. Keep the `{{placeholders}}` aligned across both files.
- `SKILL.md` frontmatter — `model: opus` and `effort: max` are the defaults. Override for cost or latency:
  - `model: sonnet` (or `haiku`) for cheaper, faster runs at the cost of curation depth
  - `effort: high` (or `medium`, `low`) to cap reasoning tokens. See the [Claude Code skills docs](https://code.claude.com/docs/en/skills) for the full list per model.
- `SKILL.md` prompt body — the orchestration itself is editable. Add a section, tighten the rubric, or change what gets logged.

## Troubleshooting

- **Pre-send validation aborts with a `from`/`to`/`subject` mismatch.** Check `config/delivery.yaml` — the values must match exactly what the prompt is about to send. Inline YAML comments on the same line as a value can trip naive comparisons, so keep comments on their own lines.
- **"Tool not found" errors during the run.** Confirm both MCPs are connected and listed in Claude Code's MCP inventory. The Last.fm server may register under a friendly name or a UUID prefix — `SKILL.md` matches by function-name suffix so either form works.
- **Resend rejects the send.** Verify your sending domain's DNS has propagated (Resend's dashboard will tell you) and the `from` address matches a verified domain. Resend rejects "Name &lt;email&gt;" display-name wrappers in `from`; pass a plain address.
- **`meta.json` shows `sent: false` on a non-dry-run.** Either pre-send validation failed (look for the abort message in the run log) or the Resend call itself errored. The artifacts in the run directory are still useful for debugging.

## Layout

- `SKILL.md` — orchestrator prompt; reads the configs and templates below
- `CLAUDE.md` — developer context for editing the repo (distinct from `SKILL.md`)
- `config/delivery.yaml.example` — template; copy to `config/delivery.yaml` and fill in
- `config/lastfm.yaml` — Last.fm query periods, limits, similar-artist fan-out
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` — HTML email scaffold with `{{placeholders}}`
- `templates/email.txt` — plain-text email scaffold with the same `{{placeholders}}`
- `runs/<YYYY-MM-DD>/` (real) or `runs/.dry/<YYYY-MM-DD>/` (dry) — per-run artifacts, both local-only (`runs/` is gitignored)

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions and `ROADMAP.md` for what's next.

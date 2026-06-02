# new-music-fridays

A weekly "New Music Friday" digest based on your Last.fm listening history. Runs as a Claude Code routine — hosted on Anthropic's infrastructure, or locally as a Desktop scheduled task — and emails a curated digest of new releases to you each Friday.

## How it works

Claude executes `SKILL.md` every Friday (via an Anthropic-hosted routine, or the local Desktop scheduled-task runtime). The prompt:

1. Pulls your Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, and NPR Music — plus genre-specific blogs and label sites — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks)
5. Sends the email via the Resend connector and writes the rendered email + run metadata to `runs/<today>/` (local runs; the directory is ephemeral in a cloud routine — the email and the run's session transcript are the durable record)

## Run your own

Clone the repo and run your own weekly digest. Two ways to run it:

- **Path A — Cloud routine (recommended).** Runs on Anthropic-managed infrastructure on a schedule, so the Friday email fires whether or not your computer is on. Stays on your Claude subscription. Needs a Claude Pro/Max plan.
- **Path B — Local Desktop task (fallback).** Runs on your own machine via Claude Code Desktop; only fires while the app is open and the machine is awake. Handy as a fallback and for local testing.

Both share the prerequisites and repo config below, and differ only in how the Last.fm + Resend integrations are registered and how the schedule is wired. A full run takes about 5–15 minutes either way.

### Prerequisites (both paths)

- A Last.fm account.
- A way to send the email. The default uses [Resend](https://resend.com/); either send from a verified custom domain (one-time DNS setup, can take a while) or from Resend's sandbox sender for testing. Any transactional-email integration works in principle — see [Other delivery options](#other-delivery-options).
- **Path A also needs:** a Claude Pro/Max subscription (routines run on Anthropic's infrastructure), your GitHub account connected to Claude Code (a routine clones a repo each run), and a Resend **API key** — there's no Resend connector, so the routine sends via Resend's REST API (see Path A below).
- **Path B also needs:** Claude Code Desktop, v2.1.72 or later (`claude --version`).

### Configure the repo (both paths)

```bash
git clone git@github.com:mattroe/new-music-fridays.git   # or your own fork
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

Then copy the permission allow-list template so runs don't stall on prompts (used by the local path; Path A's permissions live on the routine instead):

```bash
cp .claude/settings.local.json.example .claude/settings.local.json
```

`.claude/settings.local.json` is gitignored (it differs per clone). Adjust its `mcp__lastfm__*` / `mcp__resend__*` entries to match how your MCPs actually register — `claude mcp list` shows the real prefixes, which vary by install.

### Path A — Cloud routine (recommended)

1. **Add the Last.fm connector** at [claude.ai/customize/connectors](https://claude.ai/customize/connectors): add the remote MCP (`https://lastfm-mcp.com/mcp`) and complete its OAuth once — the authorization carries into routine runs.

   **Resend is *not* a connector.** It ships only a local `npx` MCP, which a cloud routine can't reach, and there's no hosted Resend connector to add. The routine instead sends email via Resend's REST API from the committed `scripts/send-email.mjs`. (Your `.claude/settings.json` denies direct `curl`, so the send goes through that one allowlisted Node script, which only ever calls Resend's API — keeping the anti-exfil guard intact.) You'll set the API key in step 3.

2. **Get your repo + delivery config onto GitHub.** The routine clones a repo each run, and `config/delivery.yaml` is gitignored — so the clone won't have your delivery values unless you provide them. Either:
   - commit `config/delivery.yaml` to a **private** repo (it's gitignored by default, so force it in: `git add -f config/delivery.yaml`), **or**
   - keep it out of git: set the values as routine **environment variables** and add a one-line **setup script** to the routine's environment that writes the file before each run, e.g.
     ```bash
     printf 'from: %s\nto: %s\nsubject_template: "%s"\n' "$NMF_FROM" "$NMF_TO" "$NMF_SUBJECT" > config/delivery.yaml
     ```

3. **Create the routine** at [claude.ai/code/routines](https://claude.ai/code/routines) (or `/schedule` from the CLI):
   - **Repository:** the repo from step 2.
   - **Prompt:** `Follow the instructions in SKILL.md at the repository root exactly. It is the runtime prompt for this routine.`
   - **Model:** Opus for the best curation (or Sonnet/Haiku for cheaper, faster runs). The `model:`/`effort:` frontmatter in `SKILL.md` is ignored by routines — pick the model here.
   - **Schedule:** Weekly → Friday, a morning time. Routines run on a UTC-based clock, so choose a time that still falls on Friday in UTC; otherwise the release window (`last Friday → this Friday`) can shift by a day.
   - **Connectors:** enable Last.fm.
   - **Environment variables:** set `RESEND_API_KEY` (a Resend **Sending-access** key for your domain) so `scripts/send-email.mjs` can send. If you used the setup-script option in step 2, add `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT` here too.

4. **Test it.** Use **Run now** to fire the routine — note this sends a real, unprefixed production email. Open the run as a session from the routines list to see what it did and its token usage. (`runs/<date>/` artifacts don't persist in the cloud, and `meta.json.tokens` will be `null` — that's expected.) To smoke-test without a production send, run Path B's `./scripts/nmf --fast` locally first.

### Path B — Local Desktop task (fallback)

1. **Add the Last.fm MCP.** Run once from any terminal:
   ```bash
   claude mcp add -s user --transport http lastfm https://lastfm-mcp.com/mcp
   ```
   The `-s user` scope makes it available to all your Claude Code sessions, including scheduled tasks. Verify with `claude mcp list`. The first Last.fm tool call prompts a browser OAuth; the token is cached afterward. To force it now, ask Claude to "run `lastfm_auth_status`".

2. **Add the Resend MCP** (skip if using [another delivery option](#other-delivery-options)):
   ```bash
   claude mcp add -s user resend -e RESEND_API_KEY=re_xxxxxxxxx -- npx -y resend-mcp
   ```
   Recommended API-key scope: **Sending access** (not Full), restricted to the domain in `config/delivery.yaml::from`. Verify with `claude mcp list`. To send from your own domain, verify it at [resend.com/domains](https://resend.com/domains) and add the DNS records.

3. **Wire into Claude Code Desktop's scheduled tasks.** Two pieces of state — the prompt (`SKILL.md`) and the schedule + folder + permissions (stored by the app):
   - **Symlink the repo** into the scheduled-tasks directory so the task fires the `SKILL.md` you edit:
     ```bash
     ln -s "$(pwd)" ~/.claude/scheduled-tasks/new-music-fridays
     ```
   - **Create the Routines entry:** Desktop → **Routines** → **New routine** → **Local**. **Name**: `new-music-fridays` (must exactly match the symlink directory). **Folder**: the real repo path (e.g. `/Users/you/code/new-music-fridays`, *not* the `~/.claude/...` symlink) — this is the runtime cwd; if it's wrong, `.claude/settings.local.json` won't load (permission prompts every fire) and `scripts/sum-tokens.sh` can't find the session JSONL (`meta.json.tokens` ends up `null`). **Schedule**: Weekly → Friday → a morning time in your local timezone. Leave Description/Instructions blank (the routine reads `SKILL.md` via the symlink). Save.
   - **Approve permissions** on the first **Run now** (or pre-populate `.claude/settings.local.json` from the example in [Configure the repo](#configure-the-repo-both-paths)). Note **Run now** runs in production mode and sends a real, unprefixed email — skip it and use the smoke test below if you'd rather not.

### Smoke test (both paths)

Confirm the pipeline end-to-end (Last.fm responds, template fills, Resend sends) with the wrapper script. It uses the local CLI, so it's a good way to validate a fork regardless of which path you'll run in production:

```bash
./scripts/nmf --fast
```

Fast mode trims the slow parts — one Last.fm call, no web research, stub candidates — and finishes in roughly 2–5 minutes (Opus at max effort isn't snappy even trimmed). The email arrives with subject `[TEST][FAST] New Music Friday - <date>`; artifacts land in `runs/<today>/` with a `fast-` prefix. For the full Last.fm fan-out + web-research path without a production send, use `./scripts/nmf --test` (`[TEST]` subject, `test-` prefix, same 5–15 minutes as a real run).

First-time CLI invocation may fail with `401 Invalid authentication credentials` — the `~/.local/bin/claude` binary authenticates separately from Desktop. Run `claude` once interactively, type `/login`, complete the OAuth flow, exit, then retry. (If your shell sets `ANTHROPIC_API_KEY` to an empty string in an rc file, unset it — it takes precedence over OAuth and forces 401s.)

The scheduled Friday run — the Path A routine or the Path B task — always runs in production mode with no env vars set, regardless of any local state, so leftover `./scripts/nmf` invocations can't disrupt it.

## Other delivery options

Resend is one option — swap in any transactional-email provider (Postmark, Mailgun, SendGrid, etc.) by editing the "Send" section of `SKILL.md` (and, for the cloud path, the endpoint and payload in `scripts/send-email.mjs`). The `html`, `text`, `from`, `to`, and `subject` all still come from `config/delivery.yaml` and `templates/`.

If you don't want any email at all, leave the schedule paused and read `runs/<today>/email.html` directly each Friday by triggering a local run with `./scripts/nmf --fast` or `--test`. The digest renders to disk every local run.

## Customizing for your taste

- `config/sources.txt` — swap in publications, blogs, and label sites that match your taste. One source per line.
- `config/lastfm.yaml` — tune query periods, top-artist limits, and the similar-artist fan-out depth.
- `templates/email.html` and `templates/email.txt` — edit the email scaffold and copy. Keep the `{{placeholders}}` aligned across both files.
- **Model + effort.** For a local run (Path B), `SKILL.md` frontmatter sets the defaults — `model: opus`, `effort: max`; override with `model: sonnet` (or `haiku`) for cheaper, faster runs at the cost of curation depth, or `effort: high`/`medium`/`low` to cap reasoning tokens (see the [Claude Code skills docs](https://code.claude.com/docs/en/skills)). For a cloud routine (Path A), the frontmatter is ignored — set the model on the routine itself.
- `SKILL.md` prompt body — the orchestration itself is editable. Add a section, tighten the rubric, or change what gets logged.

## Troubleshooting

- **Pre-send validation aborts with a `from`/`to`/`subject` mismatch.** Check `config/delivery.yaml` — the values must match exactly what the prompt is about to send. Inline YAML comments on the same line as a value can trip naive comparisons, so keep comments on their own lines.
- **Cloud routine sends nothing.** There's no Resend connector — the cloud send uses `scripts/send-email.mjs`. Confirm `RESEND_API_KEY` is set on the routine's environment and that running the script is permitted (it's allowlisted in `.claude/settings.local.json.example`). The script prints the Resend error and exits non-zero on failure, so check the run's session transcript.
- **Cloud routine aborts validation with empty `from`/`to`.** The fresh clone is missing `config/delivery.yaml` (it's gitignored). Provide it via Path A step 2 (commit to a private repo, or a setup script that writes it from env vars).
- **"Tool not found" errors during the run.** Confirm Last.fm is connected — `claude mcp list` (local) or the routine's Connectors tab (cloud). The Last.fm server may register under a friendly name or a UUID prefix — `SKILL.md` matches by function-name suffix so either form works. (Resend isn't a tool on the cloud path — it's the `scripts/send-email.mjs` send.)
- **Resend rejects the send.** Verify your sending domain's DNS has propagated (Resend's dashboard will tell you) and the `from` address matches a verified domain or Resend's sandbox sender. Resend rejects "Name &lt;email&gt;" display-name wrappers in `from`; pass a plain address.
- **Run now from the Routines UI sent a real production email.** That's expected — it runs in production mode regardless of any local env vars. Use `./scripts/nmf --fast` (or `--test`) for smoke tests; those set the env vars before invoking SKILL.md.
- **`meta.json` shows `sent: false`.** Either pre-send validation failed (look for the abort message in the run log) or the send call itself errored. The artifacts in the run directory are still useful for debugging.
- **Local scheduled run prompts for permission on every tool / runs much slower than usual.** Check the Routines UI's **Folder** field — it must be the project's real path (e.g. `/Users/you/code/new-music-fridays`), not `~/.claude/scheduled-tasks/...`. The Folder is the cwd at runtime, and `.claude/settings.local.json` only loads when cwd matches the project. If the UI refuses to save a Folder change, quit Claude Code Desktop and edit the `cwd` field in `~/Library/Application Support/Claude/claude-code-sessions/<ids>/scheduled-tasks.json` directly, then relaunch.
- **`meta.json` shows `tokens: null`.** Expected for a cloud routine (no local session JSONL — read usage from the run's session transcript instead). For a local run, it's usually the same Folder issue above — `scripts/sum-tokens.sh` derives the JSONL path from cwd; fix the Folder and `tokens` populates next run.
- **`./scripts/nmf --fast` (or `--test`) returns `401 Invalid authentication credentials`.** The CLI binary at `~/.local/bin/claude` authenticates separately from the Desktop app. Run `claude` interactively, type `/login`, complete the OAuth flow, exit. The token persists afterwards. If your shell has `ANTHROPIC_API_KEY` set to an empty string in rc files, unset it — it takes precedence over OAuth and forces 401s.

## What's next

Forward-looking work lives in [open issues](https://github.com/mattroe/new-music-fridays/issues), not in the repo. The current set:

- [#10](https://github.com/mattroe/new-music-fridays/issues/10) — move the scheduled run off the local machine. Addressed by the cloud routine (Path A above); cutover from the local Desktop task is in progress.
- [#4](https://github.com/mattroe/new-music-fridays/issues/4) — feedback loop: explicit + implicit signal to steer next week's picks
- [#5](https://github.com/mattroe/new-music-fridays/issues/5) — typed source data with genre routing and endorsement attribution
- [#6](https://github.com/mattroe/new-music-fridays/issues/6) — extend pre-send validation to cover output shape
- [#7](https://github.com/mattroe/new-music-fridays/issues/7) — concrete "fit to taste" rubric in `SKILL.md`
- [#8](https://github.com/mattroe/new-music-fridays/issues/8) — revisit model + effort choice once cost data has accumulated
- [#9](https://github.com/mattroe/new-music-fridays/issues/9) — polish distribution after a first external user follows the README

## Layout

- `SKILL.md` — orchestrator prompt; reads the configs and templates below
- `CLAUDE.md` — developer context for editing the repo (distinct from `SKILL.md`)
- `config/delivery.yaml.example` — template; copy to `config/delivery.yaml` and fill in
- `config/lastfm.yaml` — Last.fm query periods, limits, similar-artist fan-out
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` and `templates/email.txt` — email scaffolds with `{{placeholders}}`
- `.claude/settings.local.json.example` — permission allow-list template; copy to `.claude/settings.local.json` (gitignored)
- `scripts/nmf` — wrapper for manual test and fast runs (`./scripts/nmf --test` or `--fast`)
- `scripts/send-email.mjs` — sends the rendered email via Resend's REST API; used by the cloud routine (the local path uses the Resend MCP instead)
- `scripts/sum-tokens.sh` — aggregates this session's API token usage from the JSONL; called by SKILL.md at finalize time (local runs only)
- `runs/<YYYY-MM-DD>/` — per-run artifacts; filename prefix indicates mode (`email.html`, `test-email.html`, `fast-email.html`). All local-only — `runs/` is gitignored, and not persisted by cloud routines.

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions.

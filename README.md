# new-music-fridays

A weekly "New Music Friday" digest based on your Last.fm listening history. Runs as a Claude Code scheduled task; emails a curated digest of new releases to you each Friday.

## How it works

Claude (via the scheduled-task runtime) executes `SKILL.md` every Friday. The prompt:

1. Pulls your Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, and NPR Music — plus genre-specific blogs and label sites — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks)
5. Sends the email via the Resend MCP connector and writes the rendered email + run metadata to `runs/<today>/`

## Use this yourself

If you want your own weekly digest, you can fork this repo and run it on your own machine. Plan on about 5–10 minutes end to end.

### Prerequisites

- Claude Code Desktop, v2.1.72 or later (`claude --version`). Desktop scheduled tasks require this version.
- A Last.fm account.
- A way to send the email. The default uses [Resend](https://resend.com/); either send from a verified custom domain (one-time DNS setup, can take a while) or from Resend's sandbox sender for testing. Any transactional-email MCP works in principle — see [Other delivery options](#other-delivery-options).

### Step 1: Add the Last.fm MCP

Run this once from any terminal:

```bash
claude mcp add -s user --transport http lastfm https://lastfm-mcp.com/mcp
```

The `-s user` scope makes the MCP available to all your Claude Code sessions, including the Desktop app's scheduled tasks. Verify with `claude mcp list` from any directory — `lastfm` should appear (after the first OAuth completes).

The first time a Last.fm tool is invoked from a Claude Code session, the server prompts you to authenticate against your Last.fm account in the browser. After that, every tool call uses the cached token. To force the OAuth flow now, ask Claude in any session to "run `lastfm_auth_status`".

### Step 2: Add the Resend MCP

Skip this section entirely if you're going to use [another delivery option](#other-delivery-options).

1. Create an API key at [resend.com/api-keys](https://resend.com/api-keys). Recommended scope: **Sending access** (not Full access), restricted to the specific domain you'll send from (matches `config/delivery.yaml::from`). The routine only calls `send-email`; tighter scope means a smaller blast radius if the key leaks.
2. Add the MCP under user scope, substituting your real API key:
   ```bash
   claude mcp add -s user resend -e RESEND_API_KEY=re_xxxxxxxxx -- npx -y resend-mcp
   ```
3. Verify with `claude mcp list` — `resend` should appear.
4. **Optional — custom sending domain.** To send from your own domain (e.g. `digest@yourdomain.com`) instead of Resend's sandbox, verify a domain at [resend.com/domains](https://resend.com/domains). Follow Resend's DNS walkthrough, add the records, and wait for propagation. Skip this entirely if you're fine sending from Resend's default sandbox sender, or if `delivery.yaml::from` points at an address you've already verified.

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

Scheduled tasks in Claude Code Desktop have two pieces of state: the **prompt** (`SKILL.md`, on disk under `~/.claude/scheduled-tasks/<task-name>/`) and the **schedule + folder + permissions** (stored by the Desktop app itself, set through the Routines UI). You need both.

**a. Symlink the repo into the scheduled-tasks directory** so the SKILL.md the task fires is the one you can edit in your repo (and pull updates into):

```bash
ln -s "$(pwd)" ~/.claude/scheduled-tasks/new-music-fridays
```

**b. Create the Routines entry that points at it.** Open Claude Code Desktop → click **Routines** in the sidebar → **New routine** → choose **Local**. Fill in:

- **Name**: `new-music-fridays` (must match the directory name above)
- **Description**: anything, e.g. "Weekly new-music digest from Last.fm history"
- **Instructions**: leave blank, or paste in the contents of `SKILL.md`. Either way, the file the task actually reads is `~/.claude/scheduled-tasks/new-music-fridays/SKILL.md` (the symlink), so what you type here doesn't matter once the symlink is in place.
- **Folder**: select your cloned repo using the **real** path (e.g. `/Users/you/code/new-music-fridays`, not the `~/.claude/scheduled-tasks/...` symlink). Trust the folder when prompted. This controls the runtime working directory and is independent of the symlink in Step 4a — both are needed. If the Folder is wrong, `.claude/settings.local.json` won't load (the routine prompts for every tool), `scripts/sum-tokens.sh` can't resolve the session JSONL (so `meta.json.tokens` ends up `null`), and relative paths break.
- **Schedule**: Weekly → Friday → pick a morning time in your local timezone (e.g. 9:00 AM).
- Save.

**c. Approve permissions on the first run.** Click **Run now** on the task once, watch for permission prompts (Last.fm tools, Resend send, Read), and tick **always allow** on each so future scheduled fires run unattended. Heads-up: **Run now** runs in production mode and will send a real email. If you'd rather not send a production email right now, skip this step and do the smoke test in Step 5 instead — Step 5's fast-mode email is clearly marked `[TEST][FAST]` in the subject.

### Step 5: Smoke test in fast mode

Confirm the full pipeline works end-to-end (Last.fm MCP responds, template fills, Resend sends) with the wrapper script:

```bash
./scripts/nmf --fast
```

Fast mode trims the slow parts — only one Last.fm call, no web research, stub candidates — and finishes in roughly 2–5 minutes (Opus at max effort isn't snappy even on a trimmed pipeline). The email arrives in your inbox with subject `[TEST][FAST] New Music Friday - <date>` so it's obvious it's a test send. Artifacts land in `runs/<today>/` with a `fast-` filename prefix (`fast-email.html`, `fast-meta.json`, etc.).

First-time CLI invocation will fail with `401 Invalid authentication credentials` — your Desktop login doesn't carry over to the `~/.local/bin/claude` binary. Fix: run `claude` once interactively, type `/login`, complete the OAuth flow in your browser, exit, then retry `./scripts/nmf --fast`. The CLI's token persists after that.

> Note: the Routines UI's **Run now** button does **not** run in fast mode — it runs production and sends a real, unprefixed email. Use `./scripts/nmf --fast` for smoke tests.

If you also want to exercise the full Last.fm fan-out and web research path (without committing to a production send), use `./scripts/nmf --test`. That takes the same 5–15 minutes as a real run, with `[TEST]` in the subject and `test-` filename prefix. Useful if you've changed the research logic.

The scheduled Friday run is its own path — fired by Claude Code's scheduled-task runtime with no env vars set, it always runs in production mode regardless of any local state. Leftover `./scripts/nmf` invocations can't disrupt it.

## Other delivery options

The Resend integration is one option — swap in any transactional-email MCP (Postmark, Mailgun, SendGrid, etc.) by editing the "Send" section of `SKILL.md` to call that connector's send tool. The `html`, `text`, `from`, `to`, and `subject` all still come from `config/delivery.yaml` and `templates/`.

If you don't want any email at all, leave the schedule paused and read `runs/<today>/email.html` directly each Friday by triggering the routine manually with `./scripts/nmf --fast` or `--test`. The digest renders to disk every run.

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
- **"Tool not found" errors during the run.** Confirm both MCPs are connected and listed in `claude mcp list`. The Last.fm server may register under a friendly name or a UUID prefix — `SKILL.md` matches by function-name suffix so either form works.
- **Resend rejects the send.** Verify your sending domain's DNS has propagated (Resend's dashboard will tell you) and the `from` address matches a verified domain or Resend's sandbox sender. Resend rejects "Name &lt;email&gt;" display-name wrappers in `from`; pass a plain address.
- **Run now from the Routines UI sent a real production email.** That's expected — the UI runs in production mode regardless of any local env vars. Use `./scripts/nmf --fast` (or `--test`) for smoke tests; those set the env vars before invoking SKILL.md.
- **`meta.json` shows `sent: false`.** Either pre-send validation failed (look for the abort message in the run log) or the Resend call itself errored. The artifacts in the run directory are still useful for debugging.
- **Scheduled run prompts for permission on every tool / runs much slower than usual.** Check the Routines UI's **Folder** field for the task — it must be the project's real path (e.g. `/Users/you/code/new-music-fridays`), not `~/.claude/scheduled-tasks/...` or some other unrelated path. The Folder is the cwd at runtime, and `.claude/settings.local.json` only loads when cwd matches the project. If the Routines UI refuses to save a Folder change, quit Claude Code Desktop and edit the `cwd` field in `~/Library/Application Support/Claude/claude-code-sessions/<ids>/scheduled-tasks.json` directly, then relaunch.
- **`meta.json` shows `tokens: null` with a note about session JSONL elsewhere.** Same Folder issue — `scripts/sum-tokens.sh` derives the JSONL path from cwd. The script has defensive fallbacks (`$CLAUDE_PROJECT_DIR` + recent-mtime discovery), but the root cause is usually a mismatched Folder. Fix that and `tokens` populates on the next run.
- **`./scripts/nmf --fast` (or `--test`) returns `401 Invalid authentication credentials`.** The CLI binary at `~/.local/bin/claude` authenticates separately from the Desktop app. Run `claude` interactively, type `/login`, complete the OAuth flow, exit. The token persists afterwards. If your shell has `ANTHROPIC_API_KEY` set to an empty string in rc files, unset it — it takes precedence over OAuth and forces 401s.

## Layout

- `SKILL.md` — orchestrator prompt; reads the configs and templates below
- `CLAUDE.md` — developer context for editing the repo (distinct from `SKILL.md`)
- `config/delivery.yaml.example` — template; copy to `config/delivery.yaml` and fill in
- `config/lastfm.yaml` — Last.fm query periods, limits, similar-artist fan-out
- `config/sources.txt` — editorial sources to consult (one per line)
- `templates/email.html` and `templates/email.txt` — email scaffolds with `{{placeholders}}`
- `scripts/nmf` — wrapper for manual test and fast runs (`./scripts/nmf --test` or `--fast`)
- `scripts/sum-tokens.sh` — aggregates this session's API token usage from the JSONL; called by SKILL.md at finalize time
- `runs/<YYYY-MM-DD>/` — per-run artifacts; filename prefix indicates mode (`email.html`, `test-email.html`, `fast-email.html`). All local-only — `runs/` is gitignored.

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions and `ROADMAP.md` for what's next.

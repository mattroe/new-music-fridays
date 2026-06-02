# new-music-fridays

A weekly "New Music Friday" digest based on your Last.fm listening history. Runs as an Anthropic-hosted Claude Code routine and emails a curated digest of new releases to you each Friday.

## How it works

Claude executes `SKILL.md` every Friday via an Anthropic-hosted routine. The prompt:

1. Pulls your Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web across Pitchfork, Qobuz, Bandcamp Daily, Resident Advisor, and NPR Music — plus genre-specific blogs and label sites — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks)
5. Sends the email via Resend's REST API and writes the rendered email + run metadata to `runs/<today>/` — ephemeral on the routine VM, so the email and the run's session transcript are the durable record

## Run your own

Clone the repo and run your own weekly digest. It runs as a cloud routine on Anthropic-managed infrastructure on a schedule, so the Friday email fires whether or not your computer is on, and it stays on your Claude subscription. A full run takes about 5–15 minutes.

### Prerequisites

- A Last.fm account.
- A way to send the email. The default uses [Resend](https://resend.com/); either send from a verified custom domain (one-time DNS setup, can take a while) or from Resend's sandbox sender for testing. Any transactional-email integration works in principle — see [Other delivery options](#other-delivery-options).
- A Claude Pro/Max subscription (routines run on Anthropic's infrastructure).
- Your GitHub account connected to Claude Code (a routine clones a repo each run).
- A Resend **API key** — there's no Resend connector, so the routine sends via Resend's REST API (configured below).

### Bootstrap with Claude Code (recommended)

This repo assumes you have Claude Code — so let it drive the setup. Clone the repo (or your fork), open Claude Code in the repo root, and paste the prompt below. It runs a local preflight, writes and validates `config/delivery.yaml`, sorts out the GitHub side, and then hands you a checklist — with your values already filled in — for the few steps that only exist in the browser (the Last.fm connector OAuth, your Resend sender, and creating the routine). The `scripts/bootstrap.sh` helper it calls is read-only: `preflight` reports readiness and `validate` sanity-checks your delivery config.

```text
Set up the "new-music-fridays" weekly digest for me as an Anthropic-hosted Claude
Code routine. Do everything that can be done locally, and prepare exact values for
the steps I can only finish in the browser. Skim README.md first (and SKILL.md if
you need detail on run modes or env vars).

1. Run `bash scripts/bootstrap.sh preflight` and walk me through whatever it flags
   (Node, git, gh, repo visibility, delivery config).

2. Delivery config. Ask me for my "from" address (a Resend-verified sender — a
   plain address, no "Name <email>" wrapper), my "to" address, and the subject
   line (default `New Music Friday - {date}`, where `{date}` becomes MM-DD-YYYY).
   Copy `config/delivery.yaml.example` to `config/delivery.yaml` if it's missing,
   write my answers in, then run `bash scripts/bootstrap.sh validate` and fix
   anything it reports. Never put my Resend API key in this file or anywhere in
   the repo.

3. GitHub. The routine clones a repo each run and `config/delivery.yaml` is
   gitignored, so settle how the clone will get my delivery values:
   - Recommended — commit it to a PRIVATE repo. If origin isn't already my own
     private repo, help me create or point to one, then `git add -f
     config/delivery.yaml`, commit, and push (confirm with me before pushing).
   - Alternative — keep it out of git and set `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT`
     as routine env vars instead (SKILL.md writes delivery.yaml from them at run
     start). If I pick this, don't commit delivery.yaml; just hold the three
     values for the next step.
   Never push my delivery.yaml to a public repo, and don't push without asking.

4. Browser-only handoff. These can't be scripted — print them as a checklist with
   my values filled in:
   - Last.fm connector: add the remote MCP `https://lastfm-mcp.com/mcp` at
     claude.ai/customize/connectors and complete its OAuth once.
   - Resend: confirm a verified sender for my "from" address and a Sending-access
     API key.
   - Create the routine at claude.ai/code/routines —
       Repository: <my repo from step 3>
       Prompt:     Follow the instructions in SKILL.md at the repository root
                   exactly. It is the runtime prompt for this routine.
       Model:      Opus
       Schedule:   weekly, Friday morning (a time still on Friday in UTC)
       Connectors: enable Last.fm
       Env vars:   RESEND_API_KEY (plus NMF_FROM / NMF_TO / NMF_SUBJECT if I chose
                   the env-var path in step 3)
       Setup script: leave empty
   - Network access: routine environment -> Network access -> Custom, add
     `api.resend.com`, and check "Also include default list of common package
     managers" (without it the send fails with a proxy 403).
   - Offer to also prep a second "new-music-fridays (test)" routine — same repo,
     no schedule, `NMF_FAST=1` — for safe smoke tests.

End with a summary of what's done and the exact list of clicks I still owe.
```

Prefer to set it up by hand — or want to see exactly what the bootstrap does? The next two sections are the manual equivalent.

### Configure the repo

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

### Set up the routine

1. **Add the Last.fm connector** at [claude.ai/customize/connectors](https://claude.ai/customize/connectors): add the remote MCP (`https://lastfm-mcp.com/mcp`) and complete its OAuth once — the authorization carries into routine runs.

   **Resend is *not* a connector.** There's no hosted Resend connector to add — the routine sends email via Resend's REST API from the committed `scripts/send-email.mjs`. (Your `.claude/settings.json` denies direct `curl`, so the send goes through that one allowlisted Node script, which only ever calls Resend's API — keeping the anti-exfil guard intact.) You'll set the API key in step 3.

2. **Get your repo + delivery config onto GitHub.** The routine clones a repo each run, and `config/delivery.yaml` is gitignored — so the clone won't have your delivery values unless you provide them. Either:
   - commit `config/delivery.yaml` to a **private** repo (it's gitignored by default, so force it in: `git add -f config/delivery.yaml`), **or**
   - keep it out of git: set `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT` as routine **environment variables** (step 3). At the start of each run `SKILL.md` calls `scripts/write-delivery.sh`, which writes `config/delivery.yaml` from them — done *during* the run, in the repo root. (An environment **setup script** can't do this: it runs before the repo is cloned, so there's no `config/` to write into.)

3. **Create the routine** at [claude.ai/code/routines](https://claude.ai/code/routines) (or `/schedule` from the CLI):
   - **Repository:** the repo from step 2.
   - **Prompt:** `Follow the instructions in SKILL.md at the repository root exactly. It is the runtime prompt for this routine.`
   - **Model:** Opus for the best curation (or Sonnet/Haiku for cheaper, faster runs). The `model:`/`effort:` frontmatter in `SKILL.md` is ignored by routines — pick the model here.
   - **Schedule:** Weekly → Friday, a morning time. Routines run on a UTC-based clock, so choose a time that still falls on Friday in UTC; otherwise the release window (`last Friday → this Friday`) can shift by a day.
   - **Connectors:** enable Last.fm.
   - **Environment variables:** set `RESEND_API_KEY` (a Resend **Sending-access** key for your domain) so `scripts/send-email.mjs` can send. For the keep-it-out-of-git option (step 2), also add `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT`. Leave the environment's **Setup script** empty — delivery config is written during the run, not at setup.

4. **Test it.** Use **Run now** to fire the routine — note this sends a real, unprefixed production email. Open the run as a session from the routines list to see what it did and its token usage in the transcript. (`runs/<date>/` artifacts don't persist in the cloud, and `meta.json.tokens` is `null` — that's expected; read usage from the transcript.) To check the pipeline without a production send, do a marked test run first — see [Testing a fork](#testing-a-fork).

### Testing a fork

To smoke-test without sending a production email, do a marked test run in the cloud. The run mode is driven by the `NMF_FAST` / `NMF_TEST` environment variables:

- Create a second routine (e.g. "new-music-fridays (test)") bound to the same repo, with **no schedule**, and set `NMF_FAST=1` in its environment. Fire it with **Run now**.
- `NMF_FAST=1` trims the slow parts — one Last.fm call, no web research, stub candidates — and finishes in roughly 2–5 minutes. The email arrives with subject `[TEST][FAST] New Music Friday - <date>`.
- For the full Last.fm fan-out + web-research path without a production send, use `NMF_TEST=1` instead (`[TEST]` subject, same 5–15 minutes as a real run).

Verify from the run's session transcript and the delivered email. The scheduled Friday run has no env vars set, so it always runs in production mode regardless of any test routine.

## Other delivery options

Resend is one option — swap in any transactional-email provider (Postmark, Mailgun, SendGrid, etc.) by editing the "Send" section of `SKILL.md` and the endpoint and payload in `scripts/send-email.mjs`. The `html`, `text`, `from`, `to`, and `subject` all still come from `config/delivery.yaml` and `templates/`.

If you don't want any email at all, replace the Send step in `SKILL.md` with one that skips sending — the rendered digest is still written under `runs/<today>/` during the run and is visible in the session transcript.

## Customizing for your taste

- `config/sources.txt` — swap in publications, blogs, and label sites that match your taste. One source per line.
- `config/lastfm.yaml` — tune query periods, top-artist limits, and the similar-artist fan-out depth.
- `templates/email.html` and `templates/email.txt` — edit the email scaffold and copy. Keep the `{{placeholders}}` aligned across both files.
- **Model + effort.** The model is set on the routine itself — Opus for the best curation, or Sonnet/Haiku for cheaper, faster runs at the cost of curation depth. The `model:`/`effort:` frontmatter in `SKILL.md` is ignored by routines; it documents the intended default (see the [Claude Code skills docs](https://code.claude.com/docs/en/skills) for what the fields mean).
- `SKILL.md` prompt body — the orchestration itself is editable. Add a section, tighten the rubric, or change what gets logged.

## Troubleshooting

- **Pre-send validation aborts with a `from`/`to`/`subject` mismatch.** Check `config/delivery.yaml` — the values must match exactly what the prompt is about to send. Inline YAML comments on the same line as a value can trip naive comparisons, so keep comments on their own lines.
- **Routine sends nothing.** The send uses `scripts/send-email.mjs`. Confirm `RESEND_API_KEY` is set on the routine's environment. The script prints the Resend error and exits non-zero on failure, so check the run's session transcript.
- **Cloud routine aborts validation with empty `from`/`to`.** The fresh clone is missing `config/delivery.yaml` (it's gitignored). Either commit it to your private repo (`git add -f`), or set `NMF_FROM`/`NMF_TO`/`NMF_SUBJECT` env vars so `scripts/write-delivery.sh` (run by `SKILL.md`) materializes it. Don't put this in the environment's *setup script* — that runs before the repo is cloned, so `config/` doesn't exist yet.
- **"Tool not found" errors during the run.** Confirm Last.fm is enabled on the routine's Connectors tab. The connector may register under a friendly name or a UUID prefix — `SKILL.md` matches by function-name suffix so either form works. (Resend isn't a tool — it's the `scripts/send-email.mjs` send.)
- **Resend rejects the send.** Verify your sending domain's DNS has propagated (Resend's dashboard will tell you) and the `from` address matches a verified domain or Resend's sandbox sender. Resend rejects "Name &lt;email&gt;" display-name wrappers in `from`; pass a plain address.
- **Run now sent a real production email.** That's expected — the production routine runs in production mode. For smoke tests, use a separate test routine with `NMF_FAST=1` (or `NMF_TEST=1`) set — see [Testing a fork](#testing-a-fork).
- **`meta.json` shows `sent: false`.** Either pre-send validation failed (look for the abort message in the run log) or the send call itself errored. The artifacts in the run directory are still useful for debugging.
- **`meta.json` shows `tokens: null`.** Expected — a routine run can't read its own token usage. Review per-run usage in the run's session transcript, and aggregate spend at [claude.ai/settings/usage](https://claude.ai/settings/usage).

## What's next

Forward-looking work lives in [open issues](https://github.com/mattroe/new-music-fridays/issues), not in the repo. The current set:

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
- `scripts/send-email.mjs` — sends the rendered email via Resend's REST API
- `scripts/run-state.sh` — emits run-state values (date, run mode, timestamps, duration) for `SKILL.md`
- `scripts/write-delivery.sh` — materializes `config/delivery.yaml` from `NMF_*` env vars at run start
- `scripts/bootstrap.sh` — first-time setup helper: `preflight` reports toolchain/repo/config readiness, `validate` sanity-checks `config/delivery.yaml` (used by the bootstrap prompt above)
- `runs/<YYYY-MM-DD>/` — per-run artifacts; filename prefix indicates mode (`email.html`, `test-email.html`, `fast-email.html`). Gitignored and ephemeral — not persisted after a cloud run.

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions.

# new-music-fridays

A weekly "New Music Friday" digest based on your Last.fm listening history. Runs as an Anthropic-hosted Claude Code routine and emails a curated digest of new releases to you each Friday.

## How it works

Claude executes `SKILL.md` every Friday via an Anthropic-hosted routine. The prompt:

1. Pulls your Last.fm listening profile (3-month, 12-month, overall top artists; recommendations; similar-artist fan-out for top 20)
2. Searches the web in two passes — discovery across the tier-1 and genre-routed tier-2 sources in `config/release-sources.yaml`, then an endorsement check against `config/review-sources.yaml` — for releases in the past 7 days
3. Cross-references candidates against the listening profile
4. Composes a digest (Top 5, Section A: known artists, Section B: discovery picks, and Worth a Second Look) with endorsement citations where picks earned them
5. Sends the email via Resend's REST API and writes the rendered email + run metadata to `runs/<today>/` — ephemeral on the routine VM, so the email and the run's session transcript are the durable record
6. Appends a distilled, redacted record of the run (kept/skipped candidates and the final picks — never raw listening data) to an append-only `history.jsonl` in a **separate private state repo**, so picks survive the discarded VM and can inform later weeks (e.g. de-duplicating Worth a Second Look). Production runs only; see [Durable run history](#durable-run-history)

## Run your own

Clone the repo and run your own weekly digest. It runs as a cloud routine on Anthropic-managed infrastructure on a schedule, so the Friday email fires whether or not your computer is on, and it stays on your Claude subscription. A full run takes about 5–15 minutes.

### Prerequisites

- A Last.fm account.
- A way to deliver the digest. The default emails it via [Resend](https://resend.com/) — either from a verified custom domain (one-time DNS setup, can take a while) or from Resend's sandbox sender for testing. But delivery is just the run's last step: any transactional-email provider, a push notification, or no notification at all (keep the rendered file) works too — see [Other delivery options](#other-delivery-options).
- A Claude Pro/Max subscription (routines run on Anthropic's infrastructure).
- Your GitHub account connected to Claude Code (a routine clones a repo each run).
- A Resend **API key** — *only if you're using the default Resend delivery.* There's no Resend connector, so the routine sends via Resend's REST API (configured below). Swap in a different delivery method or skip notifications entirely (see [Other delivery options](#other-delivery-options)) and you won't need one.

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
       Model:      Sonnet
       Schedule:   weekly, Friday morning (a time still on Friday in UTC)
       Connectors: enable Last.fm
       Env vars:   RESEND_API_KEY (plus NMF_FROM / NMF_TO / NMF_SUBJECT if I chose
                   the env-var path in step 3)
       Setup script: leave empty
   - Network access: routine environment -> Network access -> Custom, add
     `api.resend.com`, and check "Also include default list of common package
     managers" (without it the send fails with a proxy 403).
   - Offer to also prep a second `new-music-fridays-test` routine — same repo,
     no schedule, `NMF_TEST=1` — for safe smoke tests.
   - Optional — durable run history: offer to create a private
     `new-music-fridays-state` repo (seed an empty `history.jsonl` on `main`), add
     it as a SECOND repo on the routine, and enable "Allow unrestricted branch
     pushes" on that state repo only (leave the code repo on the default). Skipping
     this just means no cross-run history is kept. See "Durable run history".

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

- `config/release-sources.yaml` — where to look for releases (tier-1 always; tier-2 routed by genre)
- `config/review-sources.yaml` — endorsement signals and the citation allowlist for the email
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
   - **Model:** Sonnet is the default — sufficient curation for this digest at a fraction of the token cost (Opus is available for deeper curation, Haiku for cheaper/faster runs). The `model:` frontmatter in `SKILL.md` is ignored by routines — pick the model here. (There's no effort control on a routine.)
   - **Schedule:** Weekly → Friday, a morning time. Routines run on a UTC-based clock, so choose a time that still falls on Friday in UTC; otherwise the release window (`last Friday → this Friday`) can shift by a day.
   - **Connectors:** enable Last.fm.
   - **Environment variables:** set `RESEND_API_KEY` (a Resend **Sending-access** key for your domain) so `scripts/send-email.mjs` can send. For the keep-it-out-of-git option (step 2), also add `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT`. Leave the environment's **Setup script** empty — delivery config is written during the run, not at setup.

4. **Test it.** Use **Run now** to fire the routine — note this sends a real, unprefixed production email. Open the run as a session from the routines list to see what it did and its token usage in the transcript. (`runs/<date>/` artifacts don't persist in the cloud, and `meta.json.tokens` is `null` — that's expected; read usage from the transcript.) To check the pipeline without a production send, do a marked test run first — see [Testing a fork](#testing-a-fork).

### Durable run history

Each production run distils what it considered into one JSON line — kept/skipped candidates, the genre profile, and the final picks — and appends it to an append-only `history.jsonl`. Because the routine VM is discarded after every run, this can't live on disk and must not live in the shared code repo (it's per-user and private). Instead it lives in a **separate private state repo** that the routine clones alongside the code repo.

This step is **optional and best-effort**: if you don't set up a state repo, runs still send normally — they just don't keep history. Set it up when you want the cross-week features that build on it (today: de-duplicating Worth a Second Look; next: the implicit feedback lookback in [#25](https://github.com/mattroe/new-music-fridays/issues/25)).

To enable it:

1. **Create a private repo** named `new-music-fridays-state` (any name works — the routine finds it by sibling clone). Seed it with an empty `history.jsonl` committed to `main`:
   ```bash
   gh repo create new-music-fridays-state --private
   git clone git@github.com:<you>/new-music-fridays-state.git
   cd new-music-fridays-state
   touch history.jsonl && git add history.jsonl && git commit -m "seed history" && git push
   ```
2. **Add it as a second repository on the routine** (routines accept more than one repo; each is cloned from its default branch at the start of every run).
3. **Enable "Allow unrestricted branch pushes" on the state repo only.** By default a routine can push only to `claude/`-prefixed branches, but it clones every repo from its default branch — so history written to a `claude/…` branch would never be read back the next week. Enabling unrestricted pushes lets `SKILL.md` commit `history.jsonl` straight to `main`, where next week's clone sees it. Leave your **code** repo on the safe default — the setting is per-repository, and only the pure-data state repo needs it. (Conservative alternative: keep the default and set `NMF_STATE_BRANCH=claude/history` so history accumulates on a long-lived `claude/` branch instead.)

No extra secret or network-access change is needed: the routine's existing GitHub auth reaches any repo your account can see, and git traffic uses the dedicated GitHub proxy. `SKILL.md` reads the record back as untrusted data and refuses to persist anything but production runs, so test runs never pollute the corpus.

### Testing a fork

To smoke-test without sending a production email, do a marked test run in the cloud. The run mode is driven by a single environment variable, `NMF_TEST`:

- Create a second routine (e.g. `new-music-fridays-test`, mirroring the `new-music-fridays-state` suffix convention) bound to the same repo, with **no schedule**, and set `NMF_TEST=1` in its environment. Fire it with **Run now**.
- `NMF_TEST=1` runs the full path — Last.fm fan-out, web research, feedback, Worth a Second Look — exactly as production does, on the same model, but with trimmed breadth so it finishes faster than a production run (subject `[TEST] New Music Friday - <date>`). It exercises every code path a `cloud-test`-labeled PR is likely to change.
- **A test run doesn't email you.** It still POSTs to Resend end-to-end — exercising auth, the `api.resend.com` allowlist, and payload acceptance — but addressed to Resend's delivery-simulation sink (`delivered@resend.dev`), so the send returns a real `resend_message_id` (visible in the Resend dashboard) without landing in your inbox. Only production sends reach the real recipient.

Verify from the run's session transcript: `<mode>` is `test`, `validation_passed: true`, `sent: true` with a `resend_message_id`, and both `html`/`text` bodies are populated. Review the rendered digest itself in the transcript (the `email.html`/`email.txt` bodies are logged there) or in the Resend dashboard — there's no inbox copy on a test run. The scheduled Friday run has no env var set, so it always runs in production mode regardless of any test routine.

### Local checks (CI)

Separate from the cloud smoke test, a GitHub Actions workflow (`.github/workflows/ci.yml`) gates every pull request and push to `main` with fast, deterministic checks that need no cloud, Last.fm connector, or Resend key:

- a contract linter (`scripts/check-contract.mjs`) that verifies `SKILL.md` still lines up with the scripts, configs, and templates it drives — and that `scripts/send-email.mjs` stays zero-dependency with its single hardcoded endpoint;
- unit tests (`node --test test/*.test.mjs`) covering the send script's exit codes and Resend payload, plus the run-state and write-delivery scripts.

Run them locally before pushing:

    node scripts/check-contract.mjs && node --test test/*.test.mjs

These catch mechanical breakage (a renamed script, a dropped config key, an unfilled template placeholder). They can't exercise the connector, the real send, or the model — the cloud test run above remains the only end-to-end check.

## Other delivery options

Email is just the run's last step. The digest is fully rendered (`html` + `text`, from `config/delivery.yaml` and `templates/`) *before* anything is sent, so how it reaches you is a localized swap in the **Send** section of `SKILL.md` — it doesn't have to be email at all. Fork the repo and change that step:

- **A different email provider.** Swap Resend for any transactional-email service (Postmark, Mailgun, SendGrid, etc.) by editing the endpoint and payload in `scripts/send-email.mjs`. Drop `RESEND_API_KEY` and use that provider's key instead.
- **A push notification.** Point the Send step at a small script that POSTs to a push service (Pushover, ntfy, Telegram, a phone webhook, etc.) — typically the digest title plus a link back to the run. Remove the Resend pieces.
- **No notification — just the file.** Skip the send entirely. The rendered digest is still written under `runs/<today>/` during the run and is visible in the session transcript. To turn that into a real downloadable file, see below.

### Getting the digest as a downloadable file

There's no "download this file" button on a cloud routine session, and the run's VM is discarded when it finishes — so anything under `runs/<today>/` is gone, and only **text** survives in the session transcript. The reliable way to get a durable, downloadable artifact is the same mechanism the run history already uses: **commit it to a Git repo.** A file committed to GitHub is permanent and downloadable (raw link, `git clone`, or the UI's download button).

This is built in and automatic. If you've set up the private state repo for [Durable run history](#durable-run-history), every production run also calls `scripts/publish-digest.sh`, which copies the rendered **`email.html`/`email.txt`** into `digests/<date>/` in that repo and commits-and-pushes them — reusing the `scripts/history.sh` git plumbing, so there's no new secret or network-access change (GitHub auth and the dedicated git proxy already reach it). It's **best-effort** (a failed publish is logged to `meta.json.notes` and never blocks the send), **production-only** (test runs are refused, so the repo stays clean), and a no-op if you haven't set up a state repo (nothing to publish to, the run just carries on). The push targets `main` by default — the state repo's "Allow unrestricted branch pushes" setting is what makes a clean "latest digest on `main`" possible; the conservative alternative is `NMF_STATE_BRANCH=claude/digests` (or whatever you already use for history), which lands the digests on a long-lived `claude/` branch instead.

It publishes the **rendered digest only** — not the whole `runs/<today>/` tree. Even though the state repo is private, it's deliberately scoped to distilled, redacted records: `SKILL.md`'s persist step never stores the raw Last.fm responses, listening profile, play counts, or recipient address (it's why `runs/` is gitignored). The rendered email bodies carry none of that, so they're safe to commit; the full run directory is not. Keeping raw listening data out of durable storage bounds the blast radius if the private repo's access is ever widened or leaked.

Zero-setup fallback: open the run from the routines list and copy the rendered bodies out of the transcript's **Log** step. Text-only and manual, but it needs nothing beyond the run itself.

## Customizing for your taste

- `config/release-sources.yaml` — swap in publications, blogs, and label sites for discovery. Tier-1 sources are consulted every run; tier-2 only when their `genres` overlap that week's listening profile.
- `config/review-sources.yaml` — the review outlets whose endorsements decorate picks, plus the exact citation strings allowed in the email.
- `config/lastfm.yaml` — tune query periods, top-artist limits, and the similar-artist fan-out depth.
- `templates/email.html` and `templates/email.txt` — edit the email scaffold and copy. Keep the `{{placeholders}}` aligned across both files.
- **Model.** The model is set on the routine itself — Sonnet is the default (sufficient curation for this digest at a fraction of the token cost), with Opus available for deeper curation and Haiku for cheaper, faster runs. The `model:` frontmatter in `SKILL.md` is ignored by routines; it documents the intended default (see the [Claude Code skills docs](https://code.claude.com/docs/en/skills) for what the field means). Routines expose no effort control, so there's nothing to set there.
- `SKILL.md` prompt body — the orchestration itself is editable. Add a section, tighten the rubric, or change what gets logged.

## Providing feedback

The digest steers toward your taste over time from a single trusted file, `config/feedback.md` — append-only prose where you react to each week's picks (what you loved, want more of, or want pulled back, by artist, genre, or scene). Each Friday run reads it before searching, weights the last ~12 weeks most heavily, biases its research toward what you've liked and away from what you haven't, and notes the influence in that run's `candidates.md`. An empty or missing file is fine — runs proceed normally until you start adding reactions. (This is the *explicit* half of the feedback loop; the implicit "did I actually play it?" signal is tracked in [#25](https://github.com/mattroe/new-music-fridays/issues/25), built on the [#17](https://github.com/mattroe/new-music-fridays/issues/17) history corpus.)

Two ways to add a reaction, both landing in the same file:

- **Edit it directly.** Append a bullet under a `## YYYY-MM-DD` heading and commit:
  ```markdown
  ## 2026-06-05
  - Loved Big Thief — Double Infinity. More along that axis.
  - Three weeks of shoegaze — pull back.
  ```
- **Tell the run.** Reopen the week's run (Routines → New Music Fridays → Runs → that run) and react in the conversation — the email footer reminds you of this. The session distills the steer, shows you the exact line it will add, and after you confirm, opens a PR against `config/feedback.md` for you to merge (one click). It commits to a `claude/feedback-*` branch, never straight to `main` — the merge is a human gate that keeps the production routine read-only on the repo. See `SKILL.md`'s "Capturing feedback (post-run)" for the protocol.

Keep `config/feedback.md` to taste signal about the picks only; questions and unrelated asks stay in conversation.

## Troubleshooting

- **Pre-send validation aborts with a `from`/`to`/`subject` mismatch.** Check `config/delivery.yaml` — the values must match exactly what the prompt is about to send. Inline YAML comments on the same line as a value can trip naive comparisons, so keep comments on their own lines.
- **Routine sends nothing.** The send uses `scripts/send-email.mjs`. Confirm `RESEND_API_KEY` is set on the routine's environment. The script prints the Resend error and exits non-zero on failure, so check the run's session transcript.
- **Cloud routine aborts validation with empty `from`/`to`.** The fresh clone is missing `config/delivery.yaml` (it's gitignored). Either commit it to your private repo (`git add -f`), or set `NMF_FROM`/`NMF_TO`/`NMF_SUBJECT` env vars so `scripts/write-delivery.sh` (run by `SKILL.md`) materializes it. Don't put this in the environment's *setup script* — that runs before the repo is cloned, so `config/` doesn't exist yet.
- **"Tool not found" errors during the run.** Confirm Last.fm is enabled on the routine's Connectors tab. The connector may register under a friendly name or a UUID prefix — `SKILL.md` matches by function-name suffix so either form works. (Resend isn't a tool — it's the `scripts/send-email.mjs` send.)
- **Resend rejects the send.** Verify your sending domain's DNS has propagated (Resend's dashboard will tell you) and the `from` address matches a verified domain or Resend's sandbox sender. Resend rejects "Name &lt;email&gt;" display-name wrappers in `from`; pass a plain address.
- **Run now sent a real production email.** That's expected — the production routine runs in production mode. For smoke tests, use a separate test routine with `NMF_TEST=1` set — see [Testing a fork](#testing-a-fork).
- **`meta.json` shows `sent: false`.** Either pre-send validation failed (look for the abort message in the run log) or the send call itself errored. The artifacts in the run directory are still useful for debugging.
- **`meta.json` shows `tokens: null`.** Expected — a routine run can't read its own token usage. Review per-run usage in the run's session transcript, and aggregate spend at [claude.ai/settings/usage](https://claude.ai/settings/usage).
- **Run history isn't being saved (`meta.json.notes` mentions `history not persisted`).** Persistence is best-effort and never blocks the send, so the email still arrives. Check the `reason`: `state-repo-not-found` means no state repo is set up or the routine isn't cloning it (see [Durable run history](#durable-run-history), or set `NMF_STATE_DIR`); `git-push-failed` usually means "Allow unrestricted branch pushes" isn't enabled on the state repo, so the push to `main` was rejected (enable it, or set `NMF_STATE_BRANCH=claude/history`). Only production runs persist — test runs are excluded by design.

## What's next

Forward-looking work lives in [open issues](https://github.com/mattroe/new-music-fridays/issues), not in the repo. Durable per-run persistence ([#17](https://github.com/mattroe/new-music-fridays/issues/17)) has shipped — see [Durable run history](#durable-run-history) — so the data-driven work below now has a corpus to build on. The current set, in suggested tackle order (roughly by dependency; the validation and rubric work come last because they need several weeks of accumulated runs to mine):

1. [#24](https://github.com/mattroe/new-music-fridays/issues/24) — verify the just-shipped *explicit* feedback loop (see [Providing feedback](#providing-feedback)) end-to-end in a cloud run; gates relying on it
2. [#25](https://github.com/mattroe/new-music-fridays/issues/25) — feedback loop, *implicit* half: a Last.fm "did I actually play it?" lookback that reads prior picks back from the #17 history
3. [#8](https://github.com/mattroe/new-music-fridays/issues/8) — evaluate the model choice (one-week A/B); independent of the rest, so settle it early
4. [#9](https://github.com/mattroe/new-music-fridays/issues/9) — independent run-through: set up from the README alone and report friction
5. [#19](https://github.com/mattroe/new-music-fridays/issues/19) — open-source the repo: license, rulesets, and pre-public cleanup (extend the pre-public gitignore audit to the history paths; run data lives only in the private state repo)
6. [#6](https://github.com/mattroe/new-music-fridays/issues/6) — extend pre-send validation to cover output shape (data-driven half; needs the #17 corpus)
7. [#7](https://github.com/mattroe/new-music-fridays/issues/7) — refine the "fit to taste" rubric in `SKILL.md` (needs the #17 corpus)

## Layout

- `SKILL.md` — orchestrator prompt; reads the configs and templates below
- `CLAUDE.md` — developer context for editing the repo (distinct from `SKILL.md`)
- `config/delivery.yaml.example` — template; copy to `config/delivery.yaml` and fill in
- `config/lastfm.yaml` — Last.fm query periods, limits, similar-artist fan-out
- `config/release-sources.yaml` — discovery sweep (tier-1 always; tier-2 genre-routed)
- `config/review-sources.yaml` — endorsement signals + citation allowlist for the email
- `templates/email.html` and `templates/email.txt` — email scaffolds with `{{placeholders}}`
- `scripts/send-email.mjs` — sends the rendered email via Resend's REST API
- `scripts/run-state.sh` — emits run-state values (date, run mode, timestamps, duration) for `SKILL.md`
- `scripts/write-delivery.sh` — materializes `config/delivery.yaml` from `NMF_*` env vars at run start
- `scripts/history.sh` — reads recent run records back and appends one per production run to the private state repo's `history.jsonl` (best-effort; production-only; see [Durable run history](#durable-run-history))
- `scripts/publish-digest.sh` — copies the rendered `email.html`/`email.txt` into `digests/<date>/` in the private state repo and pushes them each production run, for a durable downloadable artifact (best-effort; production-only; no-op without a state repo; see [Getting the digest as a downloadable file](#getting-the-digest-as-a-downloadable-file))
- `scripts/bootstrap.sh` — first-time setup helper: `preflight` reports toolchain/repo/config readiness, `validate` sanity-checks `config/delivery.yaml` (used by the bootstrap prompt above)
- `runs/<YYYY-MM-DD>/` — per-run artifacts; filename prefix indicates mode (`email.html`, `test-email.html`). Gitignored and ephemeral — not persisted after a cloud run.
- `history.jsonl` — the durable per-run corpus; lives in a **separate private state repo**, never this one (gitignored here as defense-in-depth).

## Development

Edit configs or templates directly; the orchestrator picks them up on the next run. See `CLAUDE.md` for editing conventions.

Changes are gated by two layers — set up both before modifying `SKILL.md`, the configs, or the templates:

- **Local checks (CI)** — `node scripts/check-contract.mjs && node --test test/*.test.mjs` before every push. Catches mechanical drift only; see [Local checks (CI)](#local-checks-ci).
- **A dedicated test routine** — the only way to exercise the connector, the real send, the model, and the research logic, none of which CI can reach. **Necessary for development.** (Just running your own digest without modifying it? This is optional — the production routine alone suffices.)

### Set up a test routine

A second cloud routine (name it `new-music-fridays-test`, after the `new-music-fridays-state` suffix convention) on the same code repo with **no schedule**, so your Friday production send stays untouched while you iterate. Match your production routine's Repository, Prompt, Model, and Last.fm connector. The rest lives on this routine's **own cloud environment** (separate from production's, so configure it here — it isn't inherited) and on its triggers and permissions:

- **Run-mode flag — required.** Set `NMF_TEST=1` as an environment variable. It runs the full Last.fm + web-research path (trimmed for speed) and marks the run as a test. See [Testing a fork](#testing-a-fork) for what it does.

  > **This flag is what makes it a *test* routine.** With it unset, every run — **Run now** *and* the on-merge trigger below — executes in **production mode**: a real, unprefixed email *and* a persisted history record. The `[TEST]` subject and skipped persistence come entirely from the flag, so a test routine missing it is just a second production sender.

- **Other environment variables:** `RESEND_API_KEY` for the send, plus the delivery values `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT` only if you use the env-var delivery path instead of a committed `config/delivery.yaml` (it's the same repo, so a committed one is already present).
- **Network access (on its environment):** Custom + `api.resend.com` + "include default package managers" — a test run still sends through Resend (to the sink address), so without this the send fails with a proxy 403.
- **Trigger:** no schedule needed — fire it with **Run now**. If the form requires a trigger to save, attach an **API trigger** (a one-off `/fire` endpoint, nothing recurring) or the on-merge trigger below. `/schedule` from the CLI only creates *scheduled* routines, so add API or GitHub triggers from the web UI.
- **State repo:** not needed. History persistence is production-only, so test runs never touch it.
- **Permissions:** leave **Allow unrestricted branch pushes** off (the default) — test runs push nothing.

Verify from the run's session transcript and the delivered, subject-prefixed email.

#### Optional: smoke-test on labeled merges

To run a cloud smoke-test when a behavior-affecting change lands, add a GitHub-event trigger to the **test** routine (never the production one — it would send a real email and persist history on every matching merge). On the test routine's edit form, **Add another trigger → GitHub event**, pick the **PR merged** preset (`pull_request.closed` filtered to merged), and add filters:

- **Labels** include `cloud-test` — the opt-in gate.
- **Base branch** is `main` — optional, scopes it to the default branch.

Merging a PR that carries the `cloud-test` label then fires one test run. The label keeps the smoke-test opt-in: tag PRs that touch `SKILL.md`, configs, or templates, and skip docs-only changes, so routine runs and test emails aren't spent on merges that can't change the digest.

It fires *post-merge* by design: a routine clones the repository's **default branch**, so it can only exercise a change once that change is in `main` — a trigger on an *open* PR would clone `main` and miss the unmerged change entirely. To exercise a change before it merges, use **Run now** (or check out the branch and run locally).

It is **not a merge gate**: the run happens after the merge and reports no pass/fail commit status — a green run only means the session didn't crash, not that the digest was correct — so branch protection can't require it. That is what [Local checks (CI)](#local-checks-ci) are for; this is a post-merge canary. Requires the Claude GitHub App installed on the repo (the trigger setup prompts for it) — and if the form still warns the App isn't installed when it already is, reconnect GitHub from the claude.ai side: installing the App on GitHub and linking that installation to your claude.ai account are separate steps.

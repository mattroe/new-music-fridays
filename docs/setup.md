# Run your own

Clone the repo and run your own weekly digest. It runs as a cloud routine on Anthropic-managed infrastructure on a schedule, so the Friday email fires whether or not your computer is on, and it stays on your Claude subscription. A full run takes about 5–15 minutes.

**You don't need the Claude desktop app.** Claude Code in your terminal does all the local work (clone, preflight, `config/delivery.yaml`, git), and the cloud steps live on **claude.ai in any browser** — the desktop app only wraps the same flows. The few browser steps below (the Last.fm connector OAuth, the routine's environment settings, your Resend dashboard) can't be driven from the CLI; everything else can. You can even scaffold the routine itself from the terminal with `/schedule` — see [Set up the routine](#set-up-the-routine).

## Prerequisites

- A Last.fm account.
- A way to deliver the digest. The default emails it via [Resend](https://resend.com/) — either from a verified custom domain (one-time DNS setup, can take a while) or from Resend's sandbox sender for testing. But delivery is just the run's last step: any transactional-email provider, a push notification, or no notification at all (keep the rendered file) works too — see [Other delivery options](delivery.md).
- A Claude Pro/Max subscription (routines run on Anthropic's infrastructure).
- Your GitHub account connected to Claude Code (a routine clones a repo each run).
- A Resend **API key** — *only if you're using the default Resend delivery.* There's no Resend connector, so the routine sends via Resend's REST API (configured below). Swap in a different delivery method or skip notifications entirely (see [Other delivery options](delivery.md)) and you won't need one.

## Bootstrap with Claude Code (recommended)

This repo assumes you have Claude Code — so let it drive the setup. Clone the repo (or your fork), open Claude Code in the repo root, and paste the prompt below. It runs a local preflight, writes and validates `config/delivery.yaml`, sorts out the GitHub side, and then hands you a checklist — with your values already filled in — for the few steps that only exist in the browser (the Last.fm connector OAuth, your Resend sender, and creating the routine). The `scripts/bootstrap.sh` helper it calls is read-only: `preflight` reports readiness and `validate` sanity-checks your delivery config.

```text
Set up the "new-music-fridays" weekly digest for me as an Anthropic-hosted Claude
Code routine. Do everything that can be done locally, and prepare exact values for
the steps I can only finish in the browser. Skim README.md and docs/setup.md first
(and SKILL.md if you need detail on run modes or env vars).

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
   - Create the routine. I don't need the desktop app — either scaffold it from
     the terminal with `/schedule` in Claude Code (creates the scheduled routine
     and attaches the repo; I'll still finish connector + env vars + network
     access in the web settings, which the CLI can't set), or create it in the
     browser at claude.ai/code/routines. Either way it needs:
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
   - Optional — durable run history: if I want it, just run
     `bash scripts/bootstrap.sh state-repo` for me — it creates the private state
     repo and seeds `history.jsonl` automatically (don't make me do the gh/git by
     hand). Then the only manual part left is the routine setting: add it as a
     SECOND repo on the routine and enable "Allow unrestricted branch pushes" on
     that state repo only (leave the code repo on the default). Skipping the whole
     thing just means no cross-run history is kept. See "Durable run history".

End with a summary of what's done and the exact list of clicks I still owe.
```

Prefer to set it up by hand — or want to see exactly what the bootstrap does? The next two sections are the manual equivalent.

## Configure the repo

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

## Set up the routine

1. **Add the Last.fm connector** at [claude.ai/customize/connectors](https://claude.ai/customize/connectors): add the remote MCP (`https://lastfm-mcp.com/mcp`) and complete its OAuth once — the authorization carries into routine runs.

   **Resend is *not* a connector.** There's no hosted Resend connector to add — the routine sends email via Resend's REST API from the committed `scripts/send-email.mjs`. (Your `.claude/settings.json` denies direct `curl`, so the send goes through that one allowlisted Node script, which only ever calls Resend's API — keeping the anti-exfil guard intact.) You'll set the API key in step 3.

2. **Get your repo + delivery config onto GitHub.** The routine clones a repo each run, and `config/delivery.yaml` is gitignored — so the clone won't have your delivery values unless you provide them. Either:
   - commit `config/delivery.yaml` to a **private** repo (it's gitignored by default, so force it in: `git add -f config/delivery.yaml`), **or**
   - keep it out of git: set `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT` as routine **environment variables** (step 3). At the start of each run `SKILL.md` calls `scripts/write-delivery.sh`, which writes `config/delivery.yaml` from them — done *during* the run, in the repo root. (An environment **setup script** can't do this: it runs before the repo is cloned, so there's no `config/` to write into.)

3. **Create the routine** at [claude.ai/code/routines](https://claude.ai/code/routines) — or scaffold it from the terminal with `/schedule` in Claude Code (no desktop app needed). `/schedule` creates the scheduled routine and attaches the repo, but the connector toggle, environment variables, and network-access allowlist below can only be set in the web routine settings, so finish those there regardless:
   - **Repository:** the repo from step 2.
   - **Prompt:** `Follow the instructions in SKILL.md at the repository root exactly. It is the runtime prompt for this routine.`
   - **Model:** Sonnet is the default — sufficient curation for this digest at a fraction of the token cost (Opus is available for deeper curation, Haiku for cheaper/faster runs). The `model:` frontmatter in `SKILL.md` is ignored by routines — pick the model here. (There's no effort control on a routine.)
   - **Schedule:** Weekly → Friday, a morning time. Routines run on a UTC-based clock, so choose a time that still falls on Friday in UTC; otherwise the release window (`last Friday → this Friday`) can shift by a day.
   - **Connectors:** enable Last.fm.
   - **Environment variables:** set `RESEND_API_KEY` (a Resend **Sending-access** key for your domain) so `scripts/send-email.mjs` can send. For the keep-it-out-of-git option (step 2), also add `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT`. Leave the environment's **Setup script** empty — delivery config is written during the run, not at setup.

4. **Test it.** Use **Run now** to fire the routine — note this sends a real, unprefixed production email. Open the run as a session from the routines list to see what it did and its token usage in the transcript. (`runs/<date>/` artifacts don't persist in the cloud, and `meta.json.tokens` is `null` — that's expected; read usage from the transcript.) To check the pipeline without a production send, do a marked test run first — see [Testing a fork](testing.md#testing-a-fork).

## Durable run history

Each production run distils what it considered into one JSON line — kept/skipped candidates, the genre profile, and the final picks — and appends it to an append-only `history.jsonl`. Because the routine VM is discarded after every run, this can't live on disk and must not live in the shared code repo (it's per-user and private). Instead it lives in a **separate private state repo** that the routine clones alongside the code repo.

This step is **optional and best-effort**: if you don't set up a state repo, runs still send normally — they just don't keep history. Set it up when you want the cross-week features that build on it (today: de-duplicating Worth a Second Look; next: the implicit feedback lookback in [#25](https://github.com/mattroe/new-music-fridays/issues/25)).

To enable it:

1. **Create + seed the private state repo** — one command, no manual gh/git dance (idempotent: a no-op if the repo already exists, and it only seeds `history.jsonl` when missing):
   ```bash
   bash scripts/bootstrap.sh state-repo          # or: bash scripts/bootstrap.sh state-repo my-custom-name
   ```
   It creates a **private** repo (default name `new-music-fridays-state`), seeds an empty `history.jsonl` on `main`, and prints the one browser step it can't do (step 3 below). Needs the `gh` CLI authenticated (`gh auth login`).

   <details><summary>What it does under the hood, if you'd rather run it by hand</summary>

   ```bash
   gh repo create new-music-fridays-state --private
   git clone git@github.com:<you>/new-music-fridays-state.git
   cd new-music-fridays-state
   touch history.jsonl && git add history.jsonl && git commit -m "seed history" && git push
   ```
   </details>
2. **Add it as a second repository on the routine** (routines accept more than one repo; each is cloned from its default branch at the start of every run).
3. **Enable "Allow unrestricted branch pushes" on the state repo only.** By default a routine can push only to `claude/`-prefixed branches, but it clones every repo from its default branch — so history written to a `claude/…` branch would never be read back the next week. Enabling unrestricted pushes lets `SKILL.md` commit `history.jsonl` straight to `main`, where next week's clone sees it. Leave your **code** repo on the safe default — the setting is per-repository, and only the pure-data state repo needs it. (Conservative alternative: keep the default and set `NMF_STATE_BRANCH=claude/history` so history accumulates on a long-lived `claude/` branch instead.)

No extra secret or network-access change is needed: the routine's existing GitHub auth reaches any repo your account can see, and git traffic uses the dedicated GitHub proxy. `SKILL.md` reads the record back as untrusted data and refuses to persist anything but production runs, so test runs never pollute the corpus.

The same state repo also holds your published digests (`digests/<date>/`) and your **feedback file** (`feedback.md`) — the personal taste reactions that steer the picks (see [Providing feedback](customizing.md#providing-feedback)). Feedback lives here, not in the public code repo, so your reactions stay private; copy `config/feedback.example.md` into the state repo as `feedback.md` when you want to start steering. Wiring up the state repo is what unlocks all three.

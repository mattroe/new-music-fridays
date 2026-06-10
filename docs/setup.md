# Run your own

Clone the repo and run your own weekly digest. It runs as a cloud routine on Anthropic-managed infrastructure on a schedule, so the Friday email fires whether or not your computer is on, and it stays on your Claude subscription. A full run takes about 5–15 minutes.

**You don't need the Claude desktop app — but you're welcome to use it.** Claude Code does all the local work (clone, preflight, `config/delivery.yaml`, git) in your terminal *or* the desktop app, and the cloud steps are claude.ai pages you can open in a browser *or* the desktop app — so neither is required, and either works for both halves. The handful of steps below that aren't scriptable — the Last.fm connector OAuth and the routine's environment settings (both on claude.ai, browser or desktop app), plus your Resend dashboard if you email via Resend (a separate site) — are the only manual pieces; everything else Claude Code can do for you. You can even scaffold the routine itself with `/schedule` — see [Set up the routine](#set-up-the-routine).

## Prerequisites

- A Last.fm account.
- A Claude Pro/Max subscription (routines run on Anthropic's infrastructure).
- Your GitHub account connected to Claude Code (a routine clones a repo each run).
- The [`gh` CLI](https://cli.github.com), authenticated (`gh auth login`) — optional, but the bootstrap needs it to verify your repo's visibility, push a private code mirror, and run `bootstrap.sh state-repo`. Without it those steps fall back to manual.
- **A way to get the digest.** Pick one — both are first-class, set with the `method` field in `config/delivery.yaml`:
  - **Email it (`method: resend`, the default).** The routine sends via [Resend](https://resend.com/) — from a verified custom domain (one-time DNS setup, can take a while) or Resend's sandbox sender (`onboarding@resend.dev`) for testing. **The sandbox sender only delivers to the email address on your own Resend account, so your `to` must be that address** — a mismatch passes local `validate` but fails the first cloud send with a Resend 4xx. Needs a Resend **API key** and the `api.resend.com` network-allowlist entry (both configured below). There's no Resend connector, so it sends via Resend's REST API.
  - **Just the downloadable file (`method: none`).** Skip email entirely — no Resend account, key, sender, or allowlist. Each run commits the rendered digest to your private state repo as a downloadable file, so this path **requires the state repo** ([Durable run history](#durable-run-history)). See [Other delivery options](delivery.md) for this and for swapping in another email provider or a push notification.

## Bootstrap with Claude Code (recommended)

This repo assumes you have Claude Code — so let it drive the setup. Clone the repo (or your fork), open Claude Code in the repo root, and paste the **bootstrap prompt** into it. Print the prompt with:

```bash
bash scripts/bootstrap.sh prompt
```

(or open [`docs/bootstrap-prompt.md`](bootstrap-prompt.md) and copy it — the prompt lives in that one versioned file so it's diffed and CI-checked like the rest of the repo, rather than copy-pasted around). It asks how you want the digest delivered (email via Resend, or just the downloadable file), runs a local preflight, writes and validates `config/delivery.yaml`, sorts out the GitHub side, and then hands you a checklist — with your values already filled in — for the few steps that only exist in the browser (the Last.fm connector OAuth, your Resend sender if you chose email, and creating the routine). The `scripts/bootstrap.sh` helper it calls is read-only here: `preflight` reports readiness and `validate` sanity-checks your delivery config.

Prefer to set it up by hand — or want to see exactly what the bootstrap does? The next two sections are the manual equivalent.

## Configure the repo

```bash
git clone git@github.com:mattroe/new-music-fridays.git   # or your own fork
cd new-music-fridays
cp config/delivery.yaml.example config/delivery.yaml
```

Edit `config/delivery.yaml`:

- `method` — optional; `resend` (default) emails the digest, `none` skips the send and delivers only the file published to your state repo (see [Other delivery options](delivery.md)). The two notes below assume `resend`; under `none`, `from`/`to` are just display text in the rendered digest and need no Resend verification.
- `from` — a Resend-verified address (e.g. `digest@your-domain.example`)
- `to` — wherever you want the email delivered
- `subject_template` — optional; `{date}` is replaced with `MM-DD-YYYY`

Optional tuning:

- `config/release-sources.yaml` — where to look for releases (tier-1 always; tier-2 routed by genre)
- `config/review-sources.yaml` — endorsement signals and the citation allowlist (a ranking signal; endorsements aren't shown in the email)
- `config/lastfm.yaml` — query periods, top-artist limits, similar-artist fan-out

## Set up the routine

1. **Add the Last.fm connector** at [claude.ai/customize/connectors](https://claude.ai/customize/connectors): add the remote MCP (`https://lastfm-mcp.com/mcp`) and complete its OAuth once — the authorization carries into routine runs.

   **Resend is *not* a connector** (skip this if you set `method: none`). There's no hosted Resend connector to add — the routine sends email via Resend's REST API from the committed `scripts/send-email.mjs`. (Your `.claude/settings.json` denies direct `curl`, so the send goes through that one allowlisted Node script, which only ever calls Resend's API — keeping the anti-exfil guard intact.) You'll set the API key in step 3. With `method: none` there's no send at all — no API key, no verified sender, and no `api.resend.com` allowlist entry; the digest is delivered as the file published to your state repo ([Durable run history](#durable-run-history), required for that method).

2. **Get your repo + delivery config onto GitHub.** The routine clones a repo each run, and `config/delivery.yaml` is gitignored — so the clone won't have your delivery values unless you provide them. Either:
   - commit `config/delivery.yaml` to a **private** repo (it's gitignored by default, so force it in: `git add -f config/delivery.yaml`), **or**
   - keep it out of git: set `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT` as routine **environment variables** (step 3). At the start of each run `SKILL.md` calls `scripts/write-delivery.sh`, which writes `config/delivery.yaml` from them — done *during* the run, in the repo root. (An environment **setup script** can't do this: it runs before the repo is cloned, so there's no `config/` to write into.)

3. **Create the routine** at [claude.ai/code/routines](https://claude.ai/code/routines) — or scaffold it from the terminal with `/schedule` in Claude Code (no desktop app needed). `/schedule` creates the scheduled routine and attaches the repo, but the connector toggle, environment variables, and network-access allowlist below can only be set in the web routine settings, so finish those there regardless. Two `/schedule` surprises to check afterward: it may attach **every connector on your account** rather than just Last.fm — open the routine and prune to Last.fm only (extra connectors are needless blast radius on a routine that reads untrusted web content); and the **first scheduled fire can land before you've finished this checklist** (scaffold on a Wednesday and `next_run_at` is this Friday). That early run is harmless — with no Last.fm connector yet it aborts and sends nothing — but you can create the routine disabled and enable it once setup is done.
   - **Repository:** the repo from step 2.
   - **Prompt:** `Follow the instructions in SKILL.md at the repository root exactly. It is the runtime prompt for this routine.`
   - **Model:** Sonnet is the default — sufficient curation for this digest at a fraction of the token cost (Opus is available for deeper curation, Haiku for cheaper/faster runs). The `model:` frontmatter in `SKILL.md` is ignored by routines — pick the model here. (There's no effort control on a routine.)
   - **Schedule:** Weekly → Friday, a morning time. The digest's date and release window are anchored to your timezone (`scripts/run-state.sh` forces `TZ`, default `America/Los_Angeles`), so a Friday fire is dated Friday even if it lands on Saturday in UTC — no more day-shift from the VM's UTC clock. If your Friday isn't Pacific, set an `NMF_TZ` environment variable (an IANA zone like `America/New_York`) in step 3.
   - **Connectors:** enable Last.fm — and **only** Last.fm; remove anything else `/schedule` attached.
   - **Environment variables:** for `method: resend`, set `RESEND_API_KEY` (a Resend **Sending-access** key for your domain) so `scripts/send-email.mjs` can send; for `method: none` no API key is needed. For the keep-it-out-of-git option (step 2), also add `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT` (and `NMF_DELIVERY=none` if you're on the file-only method). If your Friday isn't Pacific time, set `NMF_TZ` to your IANA zone (e.g. `America/New_York`) so the digest is dated to your local day. Leave the environment's **Setup script** empty — delivery config is written during the run, not at setup.

4. **Test it.** Use **Run now** to fire the routine — note this sends a real, unprefixed production email (with `method: none` nothing is sent; the run publishes the digest to your state repo instead). Open the run as a session from the routines list to see what it did and its token usage in the transcript. (`runs/<date>/` artifacts don't persist in the cloud, and `meta.json.tokens` is `null` — that's expected; read usage from the transcript.) To check the pipeline without a production send, do a marked test run first — see [Testing a fork](testing.md#testing-a-fork).

## Optional: Spotify as the taste source

By default the digest personalizes from Last.fm. If your listening lives in Spotify instead, swap the taste backend (issue #50) — discovery and delivery are unchanged, and you skip the Last.fm connector (step 1 above) entirely. Honest tradeoffs first: Spotify exposes no play counts (the implicit play-back signal runs in a weaker positive-only form), no similar-artist/recommendations feed (discovery leans harder on the web research), and it sees only Spotify plays. For a Spotify-primary listener that's complete; if you scrobble from multiple apps, Last.fm stays the richer signal.

1. **Create a Spotify app** at [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard). Development mode is all you need — no review process; add your own Spotify account under the app's **User Management** (a dev-mode app allows ~25 manually-added users, plenty for self-hosting). Give it a redirect URI you control; `http://127.0.0.1:8888/callback` works fine — nothing needs to be listening there, you only copy a code off the redirected URL.
2. **Mint a refresh token** (one time, locally). With `SPOTIFY_CLIENT_ID` exported in your shell:

       node scripts/spotify.mjs auth-url --redirect-uri http://127.0.0.1:8888/callback

   Open the printed URL in a browser, approve the read-only scopes, and copy the `code` parameter from the URL you're redirected to (the page itself failing to load is fine). Then, with `SPOTIFY_CLIENT_SECRET` also exported (the code is single-use and expires in minutes, so do this right away):

       node scripts/spotify.mjs exchange --code <code> --redirect-uri http://127.0.0.1:8888/callback

   It prints `SPOTIFY_REFRESH_TOKEN=...`. Spotify refresh tokens are long-lived (they survive until you revoke the app), so this is genuinely one-time. Treat it like a password — it goes in the routine's environment, never in git.
3. **Configure the routine:** set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REFRESH_TOKEN` as routine environment variables (alongside `RESEND_API_KEY`), and add **both** `accounts.spotify.com` and `api.spotify.com` to the same Custom Network-access allowlist as `api.resend.com` — the token exchange and the data reads are different hosts, and missing either one makes the run abort with `spotify_error=host-not-allowlisted`.
4. **Flip the selector:** set `source: spotify` in `config/taste.yaml` and commit. Tunables (top-item limits, library caps, test-mode trims) live in `config/spotify.yaml`; the defaults are sensible.

If the taste backend fails on a run — a revoked token, a missing allowlist host — the run aborts loudly with a `spotify_error=` marker in the transcript rather than sending a generic, unpersonalized digest. `auth-failed` means re-mint the token (step 2); `host-not-allowlisted` means fix the allowlist (step 3).

## Durable run history

**What the state repo is.** A single **private repo, separate from this shared code repo**, that holds everything per-user and durable a run produces — the things that can't live on the routine's throwaway VM *or* in the public code repo. It carries three things, and setting it up once unlocks all of them:

- **`history.jsonl`** — the cross-week run history (kept/skipped candidates, genre profile, final picks), so each run can learn from the last.
- **`digests/<date>/`** — the rendered digest from every production run, committed as a durable, downloadable file. This is the **sole delivery** under `method: none`.
- **`feedback.md`** — your private taste reactions that steer future picks (see [Providing feedback](customizing.md#providing-feedback)).

The routine clones it alongside the code repo at the start of each run. The rest of this section sets it up.

Each production run distils what it considered into one JSON line — kept/skipped candidates, the genre profile, and the final picks — and appends it to an append-only `history.jsonl`. Because the routine VM is discarded after every run, this can't live on disk and must not live in the shared code repo (it's per-user and private). Instead it lives in the separate private state repo described above.

This step is **optional and best-effort** under `method: resend`: if you don't set up a state repo, runs still send normally — they just don't keep history. Set it up when you want the cross-week features that build on it (today: de-duplicating Worth a Second Look; next: the implicit feedback lookback in [#25](https://github.com/mattroe/new-music-fridays/issues/25)). Under `method: none` it's **required** — the published digest is your only delivery, so without a state repo the run produces nothing durable (the digest survives only in the session transcript).

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

Beyond history, the same repo holds your published digests (`digests/<date>/`) and your **feedback file** (`feedback.md`), as described at the top of this section. To start steering the picks, copy `config/feedback.example.md` into the state repo as `feedback.md` — it stays here, not in the public code repo, so your reactions remain private (see [Providing feedback](customizing.md#providing-feedback)).

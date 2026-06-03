# Testing and development

## Testing a fork

To smoke-test without sending a production email, do a marked test run in the cloud. The run mode is driven by a single environment variable, `NMF_TEST`:

- Create a second routine (e.g. `new-music-fridays-test`, mirroring the `new-music-fridays-state` suffix convention) bound to the same repo, with **no schedule**, and set `NMF_TEST=1` in its environment. Fire it with **Run now**.
- `NMF_TEST=1` runs the full path — Last.fm fan-out, web research, feedback, Worth a Second Look — exactly as production does, on the same model, but with trimmed breadth so it finishes faster than a production run (subject `[TEST] New Music Friday - <date>`). It exercises every code path a `cloud-test`-labeled PR is likely to change. Its release window **anchors to the most recent NMF Friday** (not the empty mid-week gap), so a run fired on any weekday still has a complete slate to curate and reaches the send step rather than aborting on zero in-window picks.
- **A test run doesn't email you.** It still POSTs to Resend end-to-end — exercising auth, the `api.resend.com` allowlist, and payload acceptance — but addressed to Resend's delivery-simulation sink (`delivered@resend.dev`), so the send returns a real `resend_message_id` (visible in the Resend dashboard) without landing in your inbox. Only production sends reach the real recipient.

Verify from the run's session transcript: `<mode>` is `test`, `validation_passed: true`, `sent: true` with a `resend_message_id`, and both `html`/`text` bodies are populated. Review the rendered digest itself in the transcript (the `email.html`/`email.txt` bodies are logged there) or in the Resend dashboard — there's no inbox copy on a test run. The scheduled Friday run has no env var set, so it always runs in production mode regardless of any test routine.

## Local checks (CI)

Separate from the cloud smoke test, a GitHub Actions workflow (`.github/workflows/ci.yml`) gates every pull request and push to `main` with fast, deterministic checks that need no cloud, Last.fm connector, or Resend key:

- a contract linter (`scripts/check-contract.mjs`) that verifies `SKILL.md` still lines up with the scripts, configs, and templates it drives — and that `scripts/send-email.mjs` stays zero-dependency with its single hardcoded endpoint;
- unit tests (`node --test test/*.test.mjs`) covering the send script's exit codes and Resend payload, plus the run-state and write-delivery scripts.

Run them locally before pushing:

    node scripts/check-contract.mjs && node --test test/*.test.mjs

These catch mechanical breakage (a renamed script, a dropped config key, an unfilled template placeholder). They can't exercise the connector, the real send, or the model — the cloud test run above remains the only end-to-end check.

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

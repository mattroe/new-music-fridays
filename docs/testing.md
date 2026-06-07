# Testing and development

## Testing a fork

To smoke-test without sending a production email, do a marked test run in the cloud. The run mode is driven by a single environment variable, `NMF_TEST`:

- Create a second routine (e.g. `new-music-fridays-test`, mirroring the `new-music-fridays-state` suffix convention) bound to the same repo, with **no schedule**, and set `NMF_TEST=1` in its environment. Fire it with **Run now**.
- `NMF_TEST=1` runs the full path — Last.fm fan-out, web research, feedback, Worth a Second Look — exactly as production does (same code paths), but on Sonnet rather than production's Opus and with trimmed breadth so it finishes faster than a production run (subject `[TEST] New Music Friday - <date>`). It exercises every code path a `routine-test`-labeled PR is likely to change. The test exercises plumbing, not curation quality, so it doesn't need Opus — see the model bullet in `CLAUDE.md` for the full rationale. Its release window **anchors to the most recent NMF Friday** (not the empty mid-week gap), so a run fired on any weekday still has a complete slate to curate and reaches the send step rather than aborting on zero in-window picks.
- **A test run doesn't email you.** It still POSTs to Resend end-to-end — exercising auth, the `api.resend.com` allowlist, and payload acceptance — but addressed to Resend's delivery-simulation sink (`delivered@resend.dev`), so the send returns a real `resend_message_id` (visible in the Resend dashboard) without landing in your inbox. Only production sends reach the real recipient.

Verify from the run's session transcript: `<mode>` is `test`, `validation_passed: true`, `sent: true` with a `resend_message_id`, and both `html`/`text` bodies are populated. Review the rendered digest itself in the transcript (the `email.html`/`email.txt` bodies are logged there) or in the Resend dashboard — there's no inbox copy on a test run. The scheduled Friday run has no env var set, so it always runs in production mode regardless of any test routine.

The checks above assume the default `method: resend`. If your `config/delivery.yaml` sets `method: none`, a test run has no send to verify — expect `sent: null` and no `resend_message_id`, and confirm the rendered `html`/`text` bodies in the transcript instead. (Publishing to the state repo is production-only, so a test run won't write `digests/` either — the transcript is the artifact.)

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
- **Network access (on its environment):** Custom + `api.resend.com` + "include default package managers" — a test run still sends through Resend (to the sink address), so without this the send fails with a proxy 403. When it does, the run records `send_error=host-not-allowlisted` and the reconciler posts a `config-fail` comment ("fix the allowlist") rather than a `transient-fail` one ("re-run") — so a missing host reads as the config error it is, not a flaky run (issue #66).
- **Trigger:** no schedule needed — fire it with **Run now**. If the form requires a trigger to save, attach an **API trigger** (a one-off `/fire` endpoint, nothing recurring) or the on-merge trigger below. `/schedule` from the CLI only creates *scheduled* routines, so add API or GitHub triggers from the web UI.
- **State repo:** add it as a second repository on this routine **if you want the on-merge smoke-test to report back on the PR** (see [Closing the loop](#optional-report-the-result-back-on-the-pr) below). The test run records its pass/fail to the state repo's `test-runs/`, which the reconciler reads back. Without it, the test run still runs end-to-end — it just can't report onto the PR (`report-test.sh` no-ops with `state-repo-not-found`).
- **Permissions:** if you added the state repo for reporting, it needs **Allow unrestricted branch pushes** ON (already required for production history) so the run can push the result to `main`; the **code** repo stays on the safe `claude/`-only default. If you skip reporting, leave unrestricted pushes off everywhere.

Verify from the run's session transcript and the delivered, subject-prefixed email.

#### Optional: smoke-test on labeled merges

To run a routine smoke-test when a behavior-affecting change lands, add a GitHub-event trigger to the **test** routine (never the production one — it would send a real email and persist history on every matching merge). On the test routine's edit form, **Add another trigger → GitHub event**, pick the **PR merged** preset (`pull_request.closed` filtered to merged), and add filters:

- **Labels** include `routine-test` — the opt-in gate.
- **Base branch** is `main` — optional, scopes it to the default branch.

> **Gotcha — the label lives in two systems that must agree.** This trigger's label filter is configured in the claude.ai routine UI, *not* in the repo, so it can silently drift from the `routine-test` label and the workflow's references in git. If the filter names a label no merged PR carries (e.g. it was left at an old name after a rename), the trigger **matches nothing and fires no run — with no error anywhere**. So if a labeled merge produces no test run, first check the routine's trigger filter spells the label exactly `routine-test` before debugging anything else.

Merging a PR that carries the `routine-test` label then fires one test run. The label keeps the smoke-test opt-in: tag PRs that touch `SKILL.md`, configs, or templates, and skip docs-only changes, so routine runs and test emails aren't spent on merges that can't change the digest.

It fires *post-merge* by design: a routine clones the repository's **default branch**, so it can only exercise a change once that change is in `main` — a trigger on an *open* PR would clone `main` and miss the unmerged change entirely. To exercise a change before it merges, use **Run now** (or check out the branch and run locally).

It is **not a merge gate**: the run happens after the merge, so branch protection can't require it — that is what [Local checks (CI)](#local-checks-ci) are for. This is a post-merge canary. But a green run *can* now be **reported back onto the PR** (and a hard failure can open a revert PR) — see [Closing the loop](#optional-report-the-result-back-on-the-pr) below. Requires the Claude GitHub App installed on the repo (the trigger setup prompts for it) — and if the form still warns the App isn't installed when it already is, reconnect GitHub from the claude.ai side: installing the App on GitHub and linking that installation to your claude.ai account are separate steps.

#### Optional: report the result back on the PR

By itself the on-merge smoke-test only lives in the run's session transcript. To close the loop — so a passing run is **documented on the PR** and a failing one is **flagged or reverted** — wire up the reconciler. It is the same producer/reconciler split the run already uses for history and digests: the cloud run writes via Git (no API egress, no token on the run side), and a trusted GitHub Action in this repo does all the GitHub-API work.

How it flows:

1. **The run records its outcome.** In test mode, `SKILL.md`'s **Report the test outcome** step writes a small result file and `scripts/report-test.sh` pushes it to the state repo at `test-runs/<merge-sha>.json` — the merge SHA being the join key back to the PR. (Mirror image of the production history/digest writes: it refuses any non-`test` mode.)
2. **A scheduled Action reconciles it.** `.github/workflows/routine-test-report.yml` runs on a ~10-minute cron in the trusted `main` context, clones the state repo, classifies each result (`scripts/classify-test-run.mjs`), maps the SHA to its merged PR, and acts **once** per PR (idempotent on the outcome label):
   - **pass** → ✅ comment + `routine-test-passed` label. (The comment is explicit that this confirms the wiring, *not* that the digest content is good — that judgment stays human, in the transcript.)
   - **transient-fail** (send/connector blip, zero in-window picks, a body didn't render) → comment + `routine-test-failed` label + assign owner. **No revert** — the cloud run hits live Last.fm / web search / Resend, so a single red is often a flake; reverting on noise trains you to ignore the bot. Re-run the test routine.
   - **config-fail** (`send_error=host-not-allowlisted` — the egress proxy refused `api.resend.com`) → comment + `routine-test-failed` label + assign owner. **No revert**, like transient-fail, but the comment says *fix the Network access allowlist*, not *re-run* — re-running won't help until the environment has the host (issue #66).
   - **hard-fail** (`validation_passed` was false — a genuine render/security-boundary regression) → the above **plus a `git revert` PR** for one-click human merge to restore `main`. It is never auto-merged.

Setup (one-time):

- **State repo on the test routine**, with unrestricted pushes ON (see the bullets above).
- **A read token for the reconciler.** Add a repository **secret `STATE_REPO_TOKEN`** to *this* code repo (Settings → Secrets and variables → Actions) — a fine-grained PAT with **contents: read** on the private `new-music-fridays-state` repo, and nothing else. *Why a separate token:* the Action's built-in `GITHUB_TOKEN` is scoped to the repo it runs in (this public code repo) and cannot read a *different* private repo, so the reconciler needs its own read-only credential just to clone the state repo and read the results back. All the code-repo writes (comment / label / revert PR) still use the built-in `GITHUB_TOKEN`. **Nothing private touches this repo:** the token *value* lives only in GitHub's encrypted Actions secret store (and is masked in logs); the repo contains only the secret *name* `STATE_REPO_TOKEN` as a `${{ secrets.* }}` reference. Keep your own copy of the PAT in 1Password for rotation — that's your personal vault per the secrets rule, not something the repo or workflow reads. If the state repo lives elsewhere, set the repo **variable `STATE_REPO`** to `<owner>/<name>` to override the default.
- Nothing else: the workflow is a no-op if `STATE_REPO_TOKEN` is unset, and only runs on the canonical repo (not forks).

Caveat: a revert PR is opened by `GITHUB_TOKEN`, so CI may not auto-run on it — push an empty commit or close/reopen to trigger CI before merging. And a "pass" is still only a *mechanical* pass (the run completed and the boundary held); content quality is reviewed in the transcript.

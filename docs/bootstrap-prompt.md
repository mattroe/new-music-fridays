Set up the "new-music-fridays" weekly digest for me as an Anthropic-hosted Claude
Code routine. Do everything that can be done locally, and prepare exact values for
the steps I can only finish in the browser. Skim README.md and docs/setup.md first
(and SKILL.md if you need detail on run modes or env vars). Confirm with me before
any push, and never put my Resend API key or config/delivery.yaml into a public repo.

1. Run `bash scripts/bootstrap.sh preflight` and walk me through whatever it flags
   (Node, git, gh, repo visibility, delivery config). If it can't verify my repo's
   visibility (no authenticated gh CLI), confirm with me that origin is PRIVATE
   before any `git add -f config/delivery.yaml`.

2. Delivery config. First ask how I want the digest delivered, and lay out the
   tradeoff — don't pick for me:
   - `resend` (default) — email it via Resend. Needs a Resend API key + a verified
     sender (or the sandbox sender `onboarding@resend.dev`, which skips DNS but
     only delivers to the email on my own Resend account — so `to` must be that
     address) + the `api.resend.com` allowlist (browser steps below). No state
     repo needed.
   - `none` — skip email; deliver only the downloadable file committed to my
     private state repo each run. No Resend at all, but it REQUIRES the state repo
     (step 4). Tell me this if I pick `none`.
   Then ask for my "from" address, "to" address, and subject (default
   `New Music Friday - {date}`, where `{date}` becomes MM-DD-YYYY). For `resend`,
   "from" must be a plain Resend-verified address (no "Name <email>" wrapper); for
   `none` it's just display text in the rendered digest. Copy
   config/delivery.yaml.example to config/delivery.yaml if it's missing, write my
   answers in (including `method:`), run `bash scripts/bootstrap.sh validate`, and
   fix anything it reports.

3. GitHub. The routine clones a repo each run and config/delivery.yaml is
   gitignored, so settle how the clone will get my delivery values:
   - Recommended — commit it to a PRIVATE repo. If origin isn't already my own
     private repo, help me create or point to one, then `git add -f
     config/delivery.yaml`, commit, and push (confirm with me before pushing).
   - Alternative — keep it out of git and set `NMF_FROM` / `NMF_TO` / `NMF_SUBJECT`
     as routine env vars (add `NMF_DELIVERY=none` if I chose `none`). If I pick
     this, don't commit delivery.yaml; just hold the values for step 6.
   Never push delivery.yaml to a public repo, and don't push without asking.

4. State repo — REQUIRED for `method: none` (it's where the downloadable file
   lands), optional for `resend` (durable run history). If I need or want it, run
   `bash scripts/bootstrap.sh state-repo` for me — don't make me do the gh/git by
   hand. The one manual part left is a routine setting: add it as a SECOND repo on
   the routine and enable "Allow unrestricted branch pushes" on that state repo
   only (leave the code repo on the default).

5. Routine. If you can, scaffold it from here with `/schedule` (weekly; a
   Friday-morning time that's still Friday in UTC; my repo; prompt "Follow the
   instructions in SKILL.md at the repository root exactly."; model Sonnet). Warn
   me about two `/schedule` surprises to fix in the routine settings afterward: it
   may attach EVERY connector on my account — prune to Last.fm ONLY (needless blast
   radius on a routine that reads untrusted web content); and the first scheduled
   fire can land before setup is done (harmless — with no Last.fm connector yet it
   aborts and sends nothing — but I can create it disabled and enable it once the
   checklist is finished).

6. Browser-only handoff — print these as a checklist with my values filled in. Skip
   the Resend-only items if I chose `none`:
   - Last.fm connector: add the remote MCP `https://lastfm-mcp.com/mcp` at
     claude.ai/customize/connectors and complete its OAuth once; enable it (and
     only it) on the routine.
   - Resend (only for `resend`): a verified sender for my "from" address plus a
     Sending-access API key, set as `RESEND_API_KEY` on the routine.
   - Routine env vars: `RESEND_API_KEY` for `resend` (plus `NMF_FROM` / `NMF_TO` /
     `NMF_SUBJECT` if I chose the env-var path in step 3); for `none`, no API key
     (add `NMF_DELIVERY=none` on the env-var path). Leave the environment's Setup
     script empty — delivery config is written during the run, not at setup.
   - Network access (only for `resend`): routine environment -> Network access ->
     Custom, add `api.resend.com`, and check "Also include default list of common
     package managers" (without it the send fails with a proxy 403). With `none`
     there's no send, so the default Trusted access is enough.

End with a summary of what's done and the exact list of clicks I still owe.

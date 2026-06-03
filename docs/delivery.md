# Other delivery options

Email is just the run's last step. The digest is fully rendered (`html` + `text`, from `config/delivery.yaml` and `templates/`) *before* anything is sent, so how it reaches you is a localized swap in the **Send** section of `SKILL.md` — it doesn't have to be email at all. Fork the repo and change that step:

- **A different email provider.** Swap Resend for any transactional-email service (Postmark, Mailgun, SendGrid, etc.) by editing the endpoint and payload in `scripts/send-email.mjs`. Drop `RESEND_API_KEY` and use that provider's key instead.
- **A push notification.** Point the Send step at a small script that POSTs to a push service (Pushover, ntfy, Telegram, a phone webhook, etc.) — typically the digest title plus a link back to the run. Remove the Resend pieces.
- **No notification — just the file.** Skip the send entirely. The rendered digest is still written under `runs/<today>/` during the run and is visible in the session transcript. To turn that into a real downloadable file, see below.

## Getting the digest as a downloadable file

There's no "download this file" button on a cloud routine session, and the run's VM is discarded when it finishes — so anything under `runs/<today>/` is gone, and only **text** survives in the session transcript. The reliable way to get a durable, downloadable artifact is the same mechanism the run history already uses: **commit it to a Git repo.** A file committed to GitHub is permanent and downloadable (raw link, `git clone`, or the UI's download button).

This is built in and automatic. If you've set up the private state repo for [Durable run history](setup.md#durable-run-history), every production run also calls `scripts/publish-digest.sh`, which copies the rendered **`email.html`/`email.txt`** into `digests/<date>/` in that repo and commits-and-pushes them — reusing the `scripts/history.sh` git plumbing, so there's no new secret or network-access change (GitHub auth and the dedicated git proxy already reach it). It's **best-effort** (a failed publish is logged to `meta.json.notes` and never blocks the send), **production-only** (test runs are refused, so the repo stays clean), and a no-op if you haven't set up a state repo (nothing to publish to, the run just carries on). The push targets `main` by default — the state repo's "Allow unrestricted branch pushes" setting is what makes a clean "latest digest on `main`" possible; the conservative alternative is `NMF_STATE_BRANCH=claude/digests` (or whatever you already use for history), which lands the digests on a long-lived `claude/` branch instead.

It publishes the **rendered digest only** — not the whole `runs/<today>/` tree. Even though the state repo is private, it's deliberately scoped to distilled, redacted records: `SKILL.md`'s persist step never stores the raw Last.fm responses, listening profile, play counts, or recipient address (it's why `runs/` is gitignored). The rendered email bodies carry none of that, so they're safe to commit; the full run directory is not. Keeping raw listening data out of durable storage bounds the blast radius if the private repo's access is ever widened or leaked.

Zero-setup fallback: open the run from the routines list and copy the rendered bodies out of the transcript's **Log** step. Text-only and manual, but it needs nothing beyond the run itself.

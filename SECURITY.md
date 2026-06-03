# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[**Report a vulnerability**](https://github.com/mattroe/new-music-fridays/security/advisories/new)
flow (Security → Advisories) rather than opening a public issue. That keeps the
report private until a fix is out.

This is a personal-scale project maintained in spare time — expect a best-effort
response, not an SLA.

## Trust model

The interesting surface here is not a server but an **unattended agent**: a
Claude Code routine that, once a week, reads untrusted web pages *and* can send
email. The repo is built so that a prompt injection on the research step can't
escalate into exfiltration or a hijacked send. The guards, in the code rather
than only in prose:

- **The web-research and send steps are a prompt-injection boundary.** `SKILL.md`
  treats all `WebSearch`/`WebFetch` output as untrusted data and pins the email's
  `from`/`to`/`subject` to `config/delivery.yaml`, aborting the run on any
  mismatch. Research content can influence *which releases are picked*, never
  *who the mail goes to*.
- **Sending is a narrow, committed script — not a broad HTTP grant.**
  [`scripts/send-email.mjs`](scripts/send-email.mjs) only ever POSTs to Resend's
  single hardcoded endpoint, and the committed
  [`.claude/settings.json`](.claude/settings.json) `permissions.deny` list blocks
  the obvious exfiltration channels (`curl`, `wget`, `nc`, `ssh`, `scp`) plus
  macOS-control and privilege/persistence families. Deny rules override allow and
  are install-invariant, so they cap the blast radius even on the unattended fire,
  which carries a blanket `Bash` grant. It is defense-in-depth, not a sandbox: a
  blocklist can't enumerate every shell.
- **Run data lives in a separate private repo.** Per-run history and rendered
  digests are written to a dedicated *private* state repo, never this public one.
  This repo's `.gitignore` also ignores every run-data path
  (`config/delivery.yaml`, `runs/`, `history.jsonl`, `history/`, `digests/`) as a
  second line of defense, and CI asserts those stay ignored, so listening data,
  picks, or a recipient address can't be committed here even by accident.
- **The one secret never touches the repo.** `RESEND_API_KEY` lives only in the
  routine's environment; nothing else is required to run.

If you find a way around any of these boundaries — a path that lets web content
redirect the send, leak the recipient, reach the network outside the Resend
endpoint, or land run data in this repo — that's exactly the kind of report worth
filing.

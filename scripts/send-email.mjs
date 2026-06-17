#!/usr/bin/env node
// Send the rendered "New Music Friday" email via Resend's REST API.
//
// Why this exists: Resend ships no hosted connector for cloud routines, and the
// repo's `.claude/settings.json` denies direct `curl`/`wget` (anti-exfil
// defense-in-depth for an agent that reads untrusted web pages). This committed
// script is the narrow, reviewed alternative: it only ever POSTs to Resend's
// single hardcoded endpoint, so allowlisting `Bash(node scripts/send-email.mjs:*)`
// grants the send capability without reopening general outbound HTTP. Don't
// "simplify" this to a broad `curl` allow — that would reopen the exfiltration
// path the deny-list closes.
//
// SKILL.md still validates from/to/subject against config/delivery.yaml before
// invoking this; the body comes from the files SKILL.md renders in the run dir.
//
// Usage:
//   RESEND_API_KEY=re_xxx node scripts/send-email.mjs \
//     --from <from> --to <to> --subject <subject> \
//     --html-file <path> --text-file <path>
//
// Output: prints `resend_message_id=<id>` to stdout on success. On the one
// failure mode that is an ENVIRONMENT config error rather than a Resend/network
// problem — api.resend.com not being on the routine's Network access allowlist —
// it also prints `send_error=host-not-allowlisted` to stdout so the caller
// (SKILL.md) can record *which* kind of failure it was. That condition has two
// faces depending on how egress is enforced: the proxy answers with a 403, OR
// the host doesn't resolve (a *permanent* ENOTFOUND). Both are flagged — but a
// thrown DNS failure is flagged only after one automatic retry, so a transient
// DNS blip (a fleeting ENOTFOUND, or EAI_AGAIN — POSIX "try again later")
// self-heals into a normal send instead of a false config error (issues #77, #78).
// Exit codes: 0 sent, 1 send failed (network/Resend error), 2 bad usage/inputs.

import { readFile } from "node:fs/promises";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUIRED = ["from", "to", "subject", "html-file", "text-file"];

// Distinguish the egress proxy's allowlist refusal from a real Resend 4xx.
// The proxy returns a *non-JSON* 403 ("Host not in allowlist"); a genuine
// Resend error is always a JSON body (see CLAUDE.md's Network-access note). So a
// 403 whose body doesn't parse as JSON is the proxy block — and we also match an
// explicit allowlist phrase defensively, in case the proxy body shape changes.
function isProxyAllowlistBlock(status, body) {
  if (status !== 403) return false;
  const trimmed = (body ?? "").trim();
  try {
    JSON.parse(trimmed);
  } catch {
    return true; // non-JSON 403 → the proxy, not Resend
  }
  return /allowlist|not allowed|host not/i.test(trimmed);
}

// A DNS-resolution failure of any kind: the name didn't resolve — ENOTFOUND
// ("no such host") or EAI_AGAIN ("temporary failure, try again"). This is the
// *retry* trigger (see the send loop), not the flag trigger: resolution fails
// before any request bytes leave, so retrying one of these can never double-send
// the email — unlike a connection reset / timeout mid-request, which is why those
// are deliberately excluded here. Node's fetch wraps the cause, so check both the
// error and its `cause` (code or message).
function isDnsResolutionFailure(err) {
  const codes = ["ENOTFOUND", "EAI_AGAIN"];
  if (codes.includes(err?.code) || codes.includes(err?.cause?.code)) return true;
  const text = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  return /\bENOTFOUND\b|\bEAI_AGAIN\b|getaddrinfo/i.test(text);
}

// The non-403 face of "not allowlisted": a *permanent* DNS failure for
// api.resend.com — a known-good public host — means this environment genuinely
// can't reach it through the egress allowlist. Only ENOTFOUND ("no such host")
// counts: EAI_AGAIN is POSIX-defined as a *temporary* resolver failure ("try
// again later"), so it's a transient blip, not a config error (issue #78) — and
// the real #66 cloud failure was ENOTFOUND. We match ENOTFOUND specifically
// (not a bare "getaddrinfo", which an EAI_AGAIN message also contains) so the
// transient case is never misflagged. Applied only after the retry has also
// failed (the send loop), so a flagged failure is one that survived a retry.
function isHostUnresolvable(err) {
  if (err?.code === "ENOTFOUND" || err?.cause?.code === "ENOTFOUND") return true;
  const text = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  return /\bENOTFOUND\b/i.test(text);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const val = argv[i + 1];
    if (!key?.startsWith("--") || val === undefined) {
      fail(2, `malformed argument near "${key ?? ""}"`);
    }
    args[key.slice(2)] = val;
  }
  return args;
}

function fail(code, message) {
  console.error(`send-email: ${message}`);
  process.exit(code);
}

function postToResend(apiKey, payload) {
  return fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

// Terminal handler for a thrown (network-layer) send error, after any retry. A
// permanent unreachable host (ENOTFOUND surviving the retry) is the one config
// error we flag with the greppable marker — same as the 403 path — so the
// reconciler says "fix the allowlist", not "re-run" (#66). Everything else
// (EAI_AGAIN, timeout, reset) is left unflagged: a plausibly transient blip the
// reconciler should re-run, not a config error. Never returns (always exits).
function failFromSendThrow(err) {
  if (isHostUnresolvable(err)) {
    console.log("send_error=host-not-allowlisted");
    fail(
      1,
      `api.resend.com could not be reached (${err.cause?.message ?? err.message}) — it isn't reachable from ` +
        `this environment. Add it to the routine environment's Network access allowlist; this is a config error, not transient.`,
    );
  }
  fail(1, `request to Resend failed: ${err.message}`);
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    fail(2, "RESEND_API_KEY is not set in the environment");
  }

  const args = parseArgs(process.argv.slice(2));
  for (const name of REQUIRED) {
    if (!args[name]) fail(2, `missing required --${name}`);
  }

  const [html, text] = await Promise.all([
    readFile(args["html-file"], "utf8"),
    readFile(args["text-file"], "utf8"),
  ]).catch((err) => fail(2, `cannot read rendered body: ${err.message}`));

  if (!html.trim() || !text.trim()) {
    fail(2, "rendered html/text body is empty");
  }

  const payload = {
    from: args.from,
    to: args.to,
    subject: args.subject,
    html,
    text,
  };

  let res;
  try {
    res = await postToResend(apiKey, payload);
  } catch (err) {
    // Retry exactly once, but only on a DNS-resolution failure. Name resolution
    // fails before any request bytes are sent, so a retry here can never
    // double-send the email — and a flaky resolver is the surface behind the
    // false "host-not-allowlisted" config-fail reports on a known-good allowlist
    // (issue #77). A transient blip (EAI_AGAIN's POSIX "try again", or an
    // ENOTFOUND that clears) succeeds on the second attempt; a genuinely
    // unreachable host throws ENOTFOUND again and is flagged. A non-DNS throw
    // (timeout / reset) is NOT retried — it could double-send, and it's already
    // handled as a transient failure downstream.
    if (!isDnsResolutionFailure(err)) failFromSendThrow(err);
    try {
      res = await postToResend(apiKey, payload);
    } catch (retryErr) {
      failFromSendThrow(retryErr);
    }
  }

  const bodyText = await res.text();
  if (!res.ok) {
    if (isProxyAllowlistBlock(res.status, bodyText)) {
      // Environment config error, not a transient blip: api.resend.com is
      // missing from the routine's Network access allowlist, so the send will
      // keep failing until the env is fixed — retrying won't help. Emit a
      // stable, greppable marker on stdout (parallel to the success line) so
      // SKILL.md can record send_error=host-not-allowlisted and the reconciler
      // can say "fix the allowlist" instead of "looks transient, re-run".
      console.log("send_error=host-not-allowlisted");
      fail(
        1,
        `api.resend.com was refused by the egress proxy (HTTP ${res.status}: ${bodyText.trim()}). ` +
          `Add it to the routine environment's Network access allowlist — this is a config error, not transient.`,
      );
    }
    fail(1, `Resend returned HTTP ${res.status}: ${bodyText}`);
  }

  let id = "";
  try {
    id = JSON.parse(bodyText).id ?? "";
  } catch {
    // Unexpected non-JSON success body — still treat as sent, just no id.
  }
  console.log(`resend_message_id=${id}`);
}

main().catch((err) => fail(1, err?.message ?? String(err)));

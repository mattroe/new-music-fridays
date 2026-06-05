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
// the host simply doesn't resolve (a DNS failure / ENOTFOUND). Both are flagged.
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

// The non-403 face of "not allowlisted": a DNS-resolution failure for
// api.resend.com — a known-good public host — means this environment can't
// resolve it, i.e. it isn't reachable through the egress allowlist. Node's
// fetch wraps the cause, so check both the error and its `cause` (code or
// message). Connection-level errors (timeout / reset) are deliberately NOT
// included — those are plausibly a transient blip, not a config error.
function isHostUnresolvable(err) {
  const codes = ["ENOTFOUND", "EAI_AGAIN"];
  if (codes.includes(err?.code) || codes.includes(err?.cause?.code)) return true;
  const text = `${err?.message ?? ""} ${err?.cause?.message ?? ""}`;
  return /\bENOTFOUND\b|\bEAI_AGAIN\b|getaddrinfo/i.test(text);
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

  let res;
  try {
    res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: args.from,
        to: args.to,
        subject: args.subject,
        html,
        text,
      }),
    });
  } catch (err) {
    if (isHostUnresolvable(err)) {
      // Same environment config error as the 403 path, just surfaced as a DNS
      // failure instead of a proxy answer (this is how the real cloud run in
      // issue #66 failed). Same marker, so the reconciler still says "fix the
      // allowlist", not "looks transient, re-run".
      console.log("send_error=host-not-allowlisted");
      fail(
        1,
        `api.resend.com could not be reached (${err.cause?.message ?? err.message}) — it isn't reachable from ` +
          `this environment. Add it to the routine environment's Network access allowlist; this is a config error, not transient.`,
      );
    }
    fail(1, `request to Resend failed: ${err.message}`);
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

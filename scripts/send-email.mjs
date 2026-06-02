#!/usr/bin/env node
// Send the rendered "New Music Friday" email via Resend's REST API.
//
// Why this exists: an Anthropic-hosted cloud routine can't run the local
// `npx resend-mcp` stdio MCP, and the repo's `.claude/settings.json` denies
// direct `curl`/`wget` (anti-exfil defense-in-depth for an agent that reads
// untrusted web pages). This committed script is the narrow, reviewed
// alternative: it only ever POSTs to Resend's single hardcoded endpoint, so
// allowlisting `Bash(node scripts/send-email.mjs:*)` grants the send capability
// without reopening general outbound HTTP. Don't "simplify" this to a broad
// `curl` allow — that would reopen the exfiltration path the deny-list closes.
//
// SKILL.md still validates from/to/subject against config/delivery.yaml before
// invoking this; the body comes from the files SKILL.md renders in the run dir.
//
// Usage:
//   RESEND_API_KEY=re_xxx node scripts/send-email.mjs \
//     --from <from> --to <to> --subject <subject> \
//     --html-file <path> --text-file <path>
//
// Output: prints `resend_message_id=<id>` to stdout on success.
// Exit codes: 0 sent, 1 send failed (network/Resend error), 2 bad usage/inputs.

import { readFile } from "node:fs/promises";

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const REQUIRED = ["from", "to", "subject", "html-file", "text-file"];

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
    fail(1, `request to Resend failed: ${err.message}`);
  }

  const bodyText = await res.text();
  if (!res.ok) {
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

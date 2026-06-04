#!/usr/bin/env node
// Classify a routine-test run result into a verdict the reconciler acts on.
//
// This is the pure decision core of the routine-test feedback loop, kept out of the
// workflow YAML so it can be unit-tested in isolation (the gh side-effects in
// routine-test-report.yml are not). It reads one test-runs/<sha>.json result (the
// file scripts/report-test.sh pushes to the state repo) and emits a verdict plus
// the head_sha to join the PR on, in the same `key=value` form SKILL.md's scripts
// use so the workflow can parse it with a plain read loop.
//
// Verdicts:
//   pass          — the mechanical + security boundary held end to end. Comment + label.
//   hard-fail     — validation_passed is false: a real regression in the merged
//                   change broke the render/security boundary. Comment + label +
//                   open a revert PR (main goes back to known-good).
//   transient-fail— anything else not a pass (send error, zero in-window picks,
//                   a body didn't render): plausibly a live-integration blip on a
//                   flaky run, NOT necessarily a code bug. Comment + label + assign,
//                   but NO revert — reverting on noise trains the bot to be ignored.
//
// A test "passes" iff:
//   validation_passed                                  (security/render boundary held)
//   AND in_window_picks > 0                             (reached compose; didn't abort)
//   AND html_rendered AND text_rendered                (both bodies present)
//   AND the delivery outcome matches the method:
//       method "resend" -> sent === true AND a non-empty resend_message_id
//       method "none"   -> sent === null   (no send path is exercised)
//
// Usage: node scripts/classify-test-run.mjs <result-file>
// Output (stdout): head_sha=<sha> / verdict=<pass|hard-fail|transient-fail> / reason=<text>
// Exit: 0 always when the file parses; 2 on a usage/parse error (the reconciler
// treats a parse error as "skip this file", never as a verdict).

import { readFileSync } from "node:fs";

export function classify(result) {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return { verdict: "transient-fail", reason: "result is not an object" };
  }
  // A hard failure is the one signal we trust as a real regression: the run
  // reached the validation gate and it refused to send. Everything else that
  // isn't a clean pass is treated as possibly-transient.
  if (result.validation_passed === false) {
    return { verdict: "hard-fail", reason: "validation_passed is false (render/security boundary failed)" };
  }
  if (result.validation_passed !== true) {
    return { verdict: "transient-fail", reason: "validation_passed missing — run did not reach the validation gate" };
  }
  if (!(Number(result.in_window_picks) > 0)) {
    return { verdict: "transient-fail", reason: "no in-window picks — run aborted before composing" };
  }
  if (result.html_rendered !== true || result.text_rendered !== true) {
    return { verdict: "transient-fail", reason: "a rendered body was missing (html/text)" };
  }
  const method = result.delivery_method ?? "resend";
  if (method === "none") {
    if (result.sent !== null) {
      return { verdict: "transient-fail", reason: `method none but sent is ${JSON.stringify(result.sent)} (expected null)` };
    }
    return { verdict: "pass", reason: "file-only delivery (method: none); render + validation passed" };
  }
  // Default method: resend.
  if (result.sent !== true) {
    return { verdict: "transient-fail", reason: "send did not succeed (sent !== true)" };
  }
  if (typeof result.resend_message_id !== "string" || result.resend_message_id.length === 0) {
    return { verdict: "transient-fail", reason: "send reported success but no resend_message_id" };
  }
  return { verdict: "pass", reason: `sent ok (${result.resend_message_id})` };
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    process.stderr.write("usage: classify-test-run.mjs <result-file>\n");
    process.exit(2);
  }
  let result;
  try {
    result = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    process.stderr.write(`cannot read/parse ${file}: ${e.message}\n`);
    process.exit(2);
  }
  const { verdict, reason } = classify(result);
  const headSha = typeof result?.head_sha === "string" ? result.head_sha : "";
  process.stdout.write(`head_sha=${headSha}\n`);
  process.stdout.write(`verdict=${verdict}\n`);
  process.stdout.write(`reason=${reason}\n`);
}

// Run as a CLI; stay importable for the unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv);
}

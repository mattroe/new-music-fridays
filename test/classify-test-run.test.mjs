// Exercises scripts/classify-test-run.mjs — the pure verdict core of the
// routine-test reconciler. Covers the pass predicate for both delivery methods and
// the hard-fail vs transient-fail split that decides whether a failing run gets a
// revert PR (only a genuine validation regression does) or a flag-only nudge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../scripts/classify-test-run.mjs";

const execFileP = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLASSIFY = join(ROOT, "scripts/classify-test-run.mjs");

const passing = {
  mode: "test",
  validation_passed: true,
  sent: true,
  resend_message_id: "re_abc123",
  delivery_method: "resend",
  in_window_picks: 5,
  html_rendered: true,
  text_rendered: true,
  head_sha: "deadbeef",
};

test("a clean resend run passes", () => {
  assert.equal(classify(passing).verdict, "pass");
});

test("a clean method:none run passes (sent === null, no send path)", () => {
  const r = { ...passing, delivery_method: "none", sent: null, resend_message_id: null };
  assert.equal(classify(r).verdict, "pass");
});

test("validation_passed === false is a hard-fail (the revert trigger)", () => {
  const r = { ...passing, validation_passed: false };
  const v = classify(r);
  assert.equal(v.verdict, "hard-fail");
});

test("a send failure is transient-fail, not hard-fail (no revert on a blip)", () => {
  assert.equal(classify({ ...passing, sent: false }).verdict, "transient-fail");
  assert.equal(classify({ ...passing, sent: true, resend_message_id: "" }).verdict, "transient-fail");
});

test("a host-not-allowlisted send failure is config-fail, not transient (#66)", () => {
  const v = classify({ ...passing, sent: false, send_error: "host-not-allowlisted" });
  assert.equal(v.verdict, "config-fail");
  assert.match(v.reason, /allowlist/);
});

test("zero in-window picks is transient-fail (aborted before compose)", () => {
  assert.equal(classify({ ...passing, in_window_picks: 0 }).verdict, "transient-fail");
});

test("a missing rendered body is transient-fail", () => {
  assert.equal(classify({ ...passing, html_rendered: false }).verdict, "transient-fail");
  assert.equal(classify({ ...passing, text_rendered: false }).verdict, "transient-fail");
});

test("validation_passed missing (run never reached the gate) is transient-fail", () => {
  const r = { ...passing };
  delete r.validation_passed;
  assert.equal(classify(r).verdict, "transient-fail");
});

test("method:none that somehow sent is transient-fail", () => {
  const r = { ...passing, delivery_method: "none", sent: true };
  assert.equal(classify(r).verdict, "transient-fail");
});

test("CLI emits head_sha/verdict/reason in key=value form", async () => {
  const base = mkdtempSync(join(tmpdir(), "nmf-classify-"));
  const file = join(base, "r.json");
  writeFileSync(file, JSON.stringify(passing));
  const { stdout } = await execFileP("node", [CLASSIFY, file]);
  const map = Object.fromEntries(
    stdout.trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
  );
  assert.equal(map.head_sha, "deadbeef");
  assert.equal(map.verdict, "pass");
  assert.ok(map.reason.length > 0);
});

test("CLI exits 2 on a parse error (reconciler skips the file)", async () => {
  const base = mkdtempSync(join(tmpdir(), "nmf-classify-"));
  const file = join(base, "bad.json");
  writeFileSync(file, "{not json");
  await assert.rejects(execFileP("node", [CLASSIFY, file]), (e) => e.code === 2);
});

// Exercises scripts/report-test.sh — the producer half of the routine-test
// feedback loop. It drops one JSON result per TEST run into the private state
// repo and pushes it, so a trusted CI reconciler can report it on the PR. Same
// throwaway-remote pattern as the history.sh/publish-digest.sh tests: a push only
// "lands" if it reaches the bare remote's main, which a fresh re-clone confirms.
// The mirror-image guard (test-only, vs the others' production-only) and the
// fail-soft paths are asserted so a production result can never be recorded and
// reporting can never block the run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPORT = join(ROOT, "scripts/report-test.sh");

// head_sha is computed by the script from the code repo's HEAD (this repo).
const HEAD_SHA = (await execFileP("git", ["-C", ROOT, "rev-parse", "HEAD"])).stdout.trim();

function baseEnv(overrides = {}) {
  const env = { ...process.env };
  for (const k of ["NMF_TEST", "NMF_STATE_DIR", "NMF_STATE_BRANCH", "NMF_HISTORY_FILE", "NMF_TEST_RUNS_DIR"]) delete env[k];
  return { ...env, ...overrides };
}

function parseKV(stdout) {
  const map = {};
  for (const line of stdout.trim().split("\n")) {
    const i = line.indexOf("=");
    if (i >= 0) map[line.slice(0, i)] = line.slice(i + 1);
  }
  return map;
}

async function runBash(script, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileP("bash", [script, ...args], opts);
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

async function git(cwd, ...args) {
  return execFileP("git", ["-c", "user.name=t", "-c", "user.email=t@t.co", ...args], { cwd });
}

// A clone whose origin is a bare repo, with an empty history.jsonl committed on
// main (discovery keys on the history file, same as the real state repo).
async function makeStateRepo() {
  const base = mkdtempSync(join(tmpdir(), "nmf-testrun-"));
  const remote = join(base, "state.git");
  const stateDir = join(base, "nmf-state");
  await execFileP("git", ["init", "-q", "--bare", "-b", "main", remote]);
  await execFileP("git", ["clone", "-q", remote, stateDir]);
  writeFileSync(join(stateDir, "history.jsonl"), "");
  await git(stateDir, "add", "history.jsonl");
  await git(stateDir, "commit", "-q", "-m", "seed");
  await git(stateDir, "push", "-q", "origin", "HEAD:main");
  return { base, remote, stateDir };
}

// Write a result JSON to a temp file; returns its path. mode defaults to "test".
function writeResult(base, overrides = {}) {
  const obj = {
    mode: "test",
    validation_passed: true,
    sent: true,
    resend_message_id: "re_abc123",
    delivery_method: "resend",
    in_window_picks: 5,
    html_rendered: true,
    text_rendered: true,
    notes: [],
    started_at: "2026-06-05T09:00:00Z",
    ...overrides,
  };
  const file = join(base, "test-result.json");
  writeFileSync(file, JSON.stringify(obj));
  return file;
}

test("report lands a stamped result on the state repo's main", async () => {
  const { base, remote, stateDir } = await makeStateRepo();
  const file = writeResult(base);
  const out = await runBash(REPORT, [file], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.test_reported, "true");
  assert.equal(kv.test_run_path, `test-runs/${HEAD_SHA}.json`);

  // The default-branch trap is closed: a fresh clone sees the result, and the
  // script stamped head_sha + reported_at onto the run's own fields.
  const fresh = join(base, "fresh");
  await execFileP("git", ["clone", "-q", remote, fresh]);
  const written = JSON.parse(readFileSync(join(fresh, `test-runs/${HEAD_SHA}.json`), "utf8"));
  assert.equal(written.head_sha, HEAD_SHA);
  assert.equal(written.validation_passed, true);
  assert.equal(written.resend_message_id, "re_abc123");
  assert.equal(typeof written.reported_at, "string");
});

test("report refuses a non-test mode (the corpus stays test-free)", async () => {
  for (const mode of ["production", "bogus"]) {
    const { base, stateDir } = await makeStateRepo();
    const file = writeResult(base, { mode });
    const out = await runBash(REPORT, [file], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
    assert.equal(out.code, 0, `mode ${mode} should be fail-soft`);
    const kv = parseKV(out.stdout);
    assert.equal(kv.test_reported, "false");
    assert.equal(kv.reason, "non-test-skipped");
    assert.equal(existsSync(join(stateDir, "test-runs")), false);
  }
});

test("report is fail-soft on an invalid result (missing validation_passed)", async () => {
  const { base, stateDir } = await makeStateRepo();
  const file = writeResult(base);
  // Strip the required boolean.
  const obj = JSON.parse(readFileSync(file, "utf8"));
  delete obj.validation_passed;
  writeFileSync(file, JSON.stringify(obj));
  const out = await runBash(REPORT, [file], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.test_reported, "false");
  assert.equal(kv.reason, "invalid-result");
});

test("report is fail-soft when the result file is missing", async () => {
  const base = mkdtempSync(join(tmpdir(), "nmf-testrun-"));
  const out = await runBash(REPORT, [join(base, "nope.json")], { env: baseEnv() });
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.test_reported, "false");
  assert.equal(kv.reason, "result-file-missing");
});

test("report is fail-soft when the state repo is absent (never blocks the run)", async () => {
  const base = mkdtempSync(join(tmpdir(), "nmf-testrun-"));
  const file = writeResult(base);
  const out = await runBash(REPORT, [file], { env: baseEnv({ NMF_STATE_DIR: join(base, "absent") }) });
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.test_reported, "false");
  assert.equal(kv.reason, "state-repo-not-found");
});

test("report honors NMF_STATE_BRANCH for a conservative claude/ path", async () => {
  const { base, remote, stateDir } = await makeStateRepo();
  const file = writeResult(base);
  const env = baseEnv({ NMF_STATE_DIR: stateDir, NMF_STATE_BRANCH: "claude/test-runs" });
  const out = await runBash(REPORT, [file], { env });
  assert.equal(out.code, 0);
  assert.equal(parseKV(out.stdout).test_reported, "true");

  // It landed on claude/test-runs, not main — main is untouched (besides the seed).
  const fresh = join(base, "fresh");
  await execFileP("git", ["clone", "-q", "-b", "claude/test-runs", remote, fresh]);
  assert.ok(existsSync(join(fresh, `test-runs/${HEAD_SHA}.json`)));
  const onMain = join(base, "fresh-main");
  await execFileP("git", ["clone", "-q", "-b", "main", remote, onMain]);
  assert.equal(existsSync(join(onMain, "test-runs")), false);
});

// Exercises the two bash scripts SKILL.md calls on the run path: run-state.sh
// (the parseable key=value run-state contract + the integer guard that keeps an
// injected value out of `$(( ))`) and write-delivery.sh (materializing
// config/delivery.yaml from NMF_* env vars). write-delivery writes a relative
// config/ path, so every case runs in a throwaway cwd — never the repo root.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUN_STATE = join(ROOT, "scripts/run-state.sh");
const WRITE_DELIVERY = join(ROOT, "scripts/write-delivery.sh");

// Start from the real env (PATH etc.) but clear the NMF_* vars so each case sets
// a known run mode regardless of the developer's shell.
function baseEnv(overrides = {}) {
  const env = { ...process.env };
  for (const k of ["NMF_FAST", "NMF_TEST", "NMF_FROM", "NMF_TO", "NMF_SUBJECT"]) delete env[k];
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

test("run-state start emits the documented keys in parseable form", async () => {
  const { code, stdout } = await runBash(RUN_STATE, ["start"], { env: baseEnv() });
  assert.equal(code, 0);
  const kv = parseKV(stdout);
  for (const key of ["NMF_FAST", "NMF_TEST", "today", "weekday", "started_at", "started_epoch"]) {
    assert.ok(key in kv, `missing key ${key}`);
  }
  assert.match(kv.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(kv.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(kv.started_epoch, /^\d+$/);
  assert.match(kv.weekday, /^[A-Za-z]+$/);
});

test("run-state start passes the run-mode env vars through", async () => {
  const { stdout } = await runBash(RUN_STATE, ["start"], { env: baseEnv({ NMF_FAST: "1" }) });
  const kv = parseKV(stdout);
  assert.equal(kv.NMF_FAST, "1");
  assert.equal(kv.NMF_TEST, "");
});

test("run-state finish computes a duration from a valid epoch", async () => {
  const { code, stdout } = await runBash(RUN_STATE, ["finish", "100"], { env: baseEnv() });
  assert.equal(code, 0);
  const kv = parseKV(stdout);
  assert.match(kv.finished_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(kv.duration_seconds, /^\d+$/);
});

test("run-state finish rejects non-integer input (command-substitution guard)", async () => {
  for (const bad of ["9; rm -rf /tmp/nope", "$(date)", "1+1", "", "abc"]) {
    const { code, stderr } = await runBash(RUN_STATE, ["finish", bad], { env: baseEnv() });
    assert.equal(code, 2, `expected exit 2 for ${JSON.stringify(bad)}`);
    assert.match(stderr, /usage/i);
  }
});

test("write-delivery writes config/delivery.yaml when all NMF_* are set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-wd-"));
  const { code, stdout } = await runBash(WRITE_DELIVERY, [], {
    cwd: dir,
    env: baseEnv({ NMF_FROM: "a@b.co", NMF_TO: "c@d.co", NMF_SUBJECT: "New Music - {date}" }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /wrote config\/delivery\.yaml/);
  const written = readFileSync(join(dir, "config/delivery.yaml"), "utf8");
  assert.match(written, /^from: a@b\.co$/m);
  assert.match(written, /^to: c@d\.co$/m);
  assert.match(written, /^subject_template: "New Music - \{date\}"$/m);
});

test("write-delivery leaves an existing file untouched when NMF_* are unset", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-wd-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  const existing = 'from: keep@me.co\nto: keep@me.co\nsubject_template: "keep {date}"\n';
  writeFileSync(join(dir, "config/delivery.yaml"), existing);
  const { code, stdout } = await runBash(WRITE_DELIVERY, [], { cwd: dir, env: baseEnv() });
  assert.equal(code, 0);
  assert.match(stdout, /left config\/delivery\.yaml as-is/);
  assert.equal(readFileSync(join(dir, "config/delivery.yaml"), "utf8"), existing);
});

test("write-delivery is a no-op when only some NMF_* are set", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-wd-"));
  const { code, stdout } = await runBash(WRITE_DELIVERY, [], {
    cwd: dir,
    env: baseEnv({ NMF_FROM: "only@from.co" }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /left config\/delivery\.yaml as-is/);
  assert.equal(existsSync(join(dir, "config/delivery.yaml")), false);
});

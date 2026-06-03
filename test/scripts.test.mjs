// Exercises the bash scripts SKILL.md calls on the run path: run-state.sh (the
// parseable key=value run-state contract + the integer guard that keeps an
// injected value out of `$(( ))`), write-delivery.sh (materializing
// config/delivery.yaml from NMF_* env vars), and history.sh (the #17 durable
// per-run store — read-back + production-only append/commit/push). write-delivery
// writes a relative config/ path, so every case runs in a throwaway cwd — never
// the repo root.
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
const HISTORY = join(ROOT, "scripts/history.sh");

// Start from the real env (PATH etc.) but clear the NMF_* vars so each case sets
// a known run mode regardless of the developer's shell.
function baseEnv(overrides = {}) {
  const env = { ...process.env };
  for (const k of ["NMF_TEST", "NMF_FROM", "NMF_TO", "NMF_SUBJECT", "NMF_STATE_DIR", "NMF_STATE_BRANCH", "NMF_HISTORY_FILE"]) delete env[k];
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
  for (const key of ["NMF_TEST", "today", "weekday", "started_at", "started_epoch"]) {
    assert.ok(key in kv, `missing key ${key}`);
  }
  assert.match(kv.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(kv.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(kv.started_epoch, /^\d+$/);
  assert.match(kv.weekday, /^[A-Za-z]+$/);
});

test("run-state start passes the run-mode env var through", async () => {
  const set = await runBash(RUN_STATE, ["start"], { env: baseEnv({ NMF_TEST: "1" }) });
  assert.equal(parseKV(set.stdout).NMF_TEST, "1");
  const unset = await runBash(RUN_STATE, ["start"], { env: baseEnv() });
  assert.equal(parseKV(unset.stdout).NMF_TEST, "");
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

// --- history.sh (#17 durable per-run store) ------------------------------------
// Each case stands up a bare "remote" + a clone with history.jsonl seeded on main,
// then drives history.sh against it via NMF_STATE_DIR (so discovery is bypassed and
// nothing touches the real state repo). A push only "lands" if it reaches the bare
// remote's main, which the read-back assertions confirm.

async function git(cwd, ...args) {
  return execFileP("git", ["-c", "user.name=t", "-c", "user.email=t@t.co", ...args], { cwd });
}

// Returns { stateDir, remote } — a clone whose origin is a bare repo, with an
// empty history.jsonl committed on main and pushed.
async function makeStateRepo() {
  const base = mkdtempSync(join(tmpdir(), "nmf-hist-"));
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

const PROD_RECORD = JSON.stringify({
  date: "2026-06-05",
  mode: "production",
  genre_profile: ["folk"],
  candidates: [
    { artist: "X", title: "Y", release_date: "2026-06-05", source: "pitchfork", tier: 1, endorsements: ["Pitchfork BNM"], disposition: "kept", section: "top_5", reason: "fits" },
  ],
  picks: { top_5: [{ artist: "X", title: "Y", type: "album" }], section_a: [], section_b: [] },
});

test("history read reports no prior records on a seeded-empty store", async () => {
  const { stateDir } = await makeStateRepo();
  const { code, stdout } = await runBash(HISTORY, ["read", "8"], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(code, 0);
  assert.match(stdout, /# history: no prior records yet/);
});

test("history read is fail-soft when the state repo is absent", async () => {
  const { code, stdout } = await runBash(HISTORY, ["read", "8"], {
    env: baseEnv({ NMF_STATE_DIR: join(tmpdir(), "nmf-absent-xyz") }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /state repo not found/);
});

test("history read rejects a non-integer count", async () => {
  const { code, stderr } = await runBash(HISTORY, ["read", "9; rm -rf /tmp/nope"], { env: baseEnv() });
  assert.equal(code, 2);
  assert.match(stderr, /usage/i);
});

test("history append persists a production record as one compact line, then reads it back", async () => {
  const { base, remote, stateDir } = await makeStateRepo();
  const recFile = join(base, "rec.json");
  writeFileSync(recFile, JSON.stringify(JSON.parse(PROD_RECORD), null, 2)); // pretty -> must be compacted
  const env = baseEnv({ NMF_STATE_DIR: stateDir });

  const appended = await runBash(HISTORY, ["append", recFile], { env });
  assert.equal(appended.code, 0);
  assert.match(appended.stdout, /history_persisted=true/);

  // Read-back from the clone is a single compact line equal to the canonical JSON.
  const back = await runBash(HISTORY, ["read", "8"], { env });
  const lines = back.stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(lines[0], PROD_RECORD);

  // The default-branch trap is closed: the record reached the bare remote's main,
  // so next week's clone-from-default will see it.
  const fresh = join(base, "fresh");
  await execFileP("git", ["clone", "-q", remote, fresh]);
  assert.equal(readFileSync(join(fresh, "history.jsonl"), "utf8").trim(), PROD_RECORD);
});

test("history append refuses a non-production record (corpus stays clean)", async () => {
  const { base, stateDir } = await makeStateRepo();
  const recFile = join(base, "rec.json");
  writeFileSync(recFile, JSON.stringify({ date: "2026-06-05", mode: "test" }));
  const { code, stdout } = await runBash(HISTORY, ["append", recFile], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(code, 0);
  assert.match(stdout, /history_persisted=false/);
  assert.match(stdout, /reason=non-production-skipped/);
  // Nothing was written.
  assert.equal(readFileSync(join(stateDir, "history.jsonl"), "utf8"), "");
});

test("history append refuses an invalid-JSON record", async () => {
  const { base, stateDir } = await makeStateRepo();
  const recFile = join(base, "rec.json");
  writeFileSync(recFile, "{not json");
  const { code, stdout } = await runBash(HISTORY, ["append", recFile], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(code, 0);
  assert.match(stdout, /history_persisted=false/);
  assert.match(stdout, /reason=invalid-record/);
});

test("history append is fail-soft when the record file is missing", async () => {
  const { stateDir } = await makeStateRepo();
  const { code, stdout } = await runBash(HISTORY, ["append", join(tmpdir(), "nmf-no-such-rec.json")], {
    env: baseEnv({ NMF_STATE_DIR: stateDir }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /history_persisted=false/);
  assert.match(stdout, /reason=record-file-missing/);
});

test("history append is fail-soft when the state repo is absent (never blocks the send)", async () => {
  const base = mkdtempSync(join(tmpdir(), "nmf-hist-"));
  const recFile = join(base, "rec.json");
  writeFileSync(recFile, PROD_RECORD);
  const { code, stdout } = await runBash(HISTORY, ["append", recFile], {
    env: baseEnv({ NMF_STATE_DIR: join(base, "absent") }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /history_persisted=false/);
  assert.match(stdout, /reason=state-repo-not-found/);
});

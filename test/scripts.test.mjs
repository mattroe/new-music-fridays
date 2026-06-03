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
const FEEDBACK = join(ROOT, "scripts/feedback.sh");
const PHASE_TIMING = join(ROOT, "scripts/phase-timing.sh");

// Start from the real env (PATH etc.) but clear the NMF_* vars so each case sets
// a known run mode regardless of the developer's shell.
function baseEnv(overrides = {}) {
  const env = { ...process.env };
  for (const k of ["NMF_TEST", "NMF_FROM", "NMF_TO", "NMF_SUBJECT", "NMF_DELIVERY", "NMF_STATE_DIR", "NMF_STATE_BRANCH", "NMF_HISTORY_FILE", "NMF_FEEDBACK_FILE"]) delete env[k];
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
  for (const key of ["NMF_TEST", "today", "weekday", "last_friday", "started_at", "started_epoch"]) {
    assert.ok(key in kv, `missing key ${key}`);
  }
  assert.match(kv.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(kv.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.match(kv.started_epoch, /^\d+$/);
  assert.match(kv.weekday, /^[A-Za-z]+$/);
});

test("run-state start emits last_friday — a Friday on or before today, within the past week", async () => {
  const { stdout } = await runBash(RUN_STATE, ["start"], { env: baseEnv() });
  const kv = parseKV(stdout);
  assert.match(kv.last_friday, /^\d{4}-\d{2}-\d{2}$/);
  const lf = new Date(kv.last_friday + "T00:00:00Z");
  const today = new Date(kv.today + "T00:00:00Z");
  assert.equal(lf.getUTCDay(), 5, "last_friday must fall on a Friday");
  assert.ok(lf <= today, "last_friday must be on or before today");
  assert.ok((today - lf) / 86_400_000 <= 6, "last_friday must be within the past 7 days");
  // On a Friday the anchor is today itself (production's window is unchanged).
  if (today.getUTCDay() === 5) assert.equal(kv.last_friday, kv.today);
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

// --- phase-timing.sh (per-phase wall-clock for meta.json.phase_seconds) ---------
// Epochs are injected (the optional trailing arg) so deltas are deterministic
// without sleeping — the same test-injection seam run-state.sh finish uses.

test("phase-timing report attributes each gap to the earlier mark, plus a total", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-pt-"));
  const env = baseEnv();
  for (const [label, epoch] of [["gather", "1000"], ["research_pass1", "1010"], ["research_pass2", "1040"], ["compose", "1045"]]) {
    const m = await runBash(PHASE_TIMING, ["mark", dir, label, epoch], { env });
    assert.equal(m.code, 0);
  }
  const { code, stdout } = await runBash(PHASE_TIMING, ["report", dir, "1060"], { env });
  assert.equal(code, 0);
  const kv = parseKV(stdout);
  assert.equal(kv["phase.gather"], "10");          // 1010 - 1000
  assert.equal(kv["phase.research_pass1"], "30");  // 1040 - 1010
  assert.equal(kv["phase.research_pass2"], "5");   // 1045 - 1040
  assert.equal(kv["phase.compose"], "15");         // 1060(now) - 1045
  assert.equal(kv["phase.total"], "60");           // 1060 - 1000
});

test("phase-timing report sums durations for a repeated label", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-pt-"));
  const env = baseEnv();
  for (const [label, epoch] of [["gather", "100"], ["send", "110"], ["gather", "115"]]) {
    await runBash(PHASE_TIMING, ["mark", dir, label, epoch], { env });
  }
  const { stdout } = await runBash(PHASE_TIMING, ["report", dir, "120"], { env });
  const kv = parseKV(stdout);
  assert.equal(kv["phase.gather"], "15");  // (110-100) + (120-115)
  assert.equal(kv["phase.send"], "5");     // 115 - 110
  assert.equal(kv["phase.total"], "20");   // 120 - 100
});

test("phase-timing report is fail-soft when nothing was marked (never blocks finalize)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-pt-"));
  const { code, stdout } = await runBash(PHASE_TIMING, ["report", dir, "1060"], { env: baseEnv() });
  assert.equal(code, 0);
  assert.match(stdout, /# phase-timing: no marks recorded/);
});

test("phase-timing mark rejects a non-label / non-integer epoch (injection guard)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-pt-"));
  const env = baseEnv();
  const badLabel = await runBash(PHASE_TIMING, ["mark", dir, "evil; rm -rf /tmp/nope", "100"], { env });
  assert.equal(badLabel.code, 2);
  assert.match(badLabel.stderr, /usage/i);
  const badEpoch = await runBash(PHASE_TIMING, ["mark", dir, "gather", "$(date)"], { env });
  assert.equal(badEpoch.code, 2);
  assert.match(badEpoch.stderr, /usage/i);
  // Neither bad call left a marks file behind to corrupt a later report.
  assert.equal(existsSync(join(dir, "phase-timings.tsv")), false);
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
  // method defaults to resend when NMF_DELIVERY is unset.
  assert.match(written, /^method: resend$/m);
});

test("write-delivery writes method: none when NMF_DELIVERY=none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-wd-"));
  const { code, stdout } = await runBash(WRITE_DELIVERY, [], {
    cwd: dir,
    env: baseEnv({ NMF_FROM: "a@b.co", NMF_TO: "c@d.co", NMF_SUBJECT: "x {date}", NMF_DELIVERY: "none" }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /method: none/);
  assert.match(readFileSync(join(dir, "config/delivery.yaml"), "utf8"), /^method: none$/m);
});

test("write-delivery rejects an unknown NMF_DELIVERY value", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nmf-wd-"));
  const { code, stderr } = await runBash(WRITE_DELIVERY, [], {
    cwd: dir,
    env: baseEnv({ NMF_FROM: "a@b.co", NMF_TO: "c@d.co", NMF_SUBJECT: "x {date}", NMF_DELIVERY: "bogus" }),
  });
  assert.notEqual(code, 0);
  assert.match(stderr, /must be 'resend' or 'none'/);
  // It must not leave a half-written config behind.
  assert.equal(existsSync(join(dir, "config/delivery.yaml")), false);
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

// --- feedback.sh (#35 personal taste file, read from the private state repo) ---
// feedback.md was relocated out of the public code repo into the state repo. The
// run reads it via `feedback.sh read`. These cases use a throwaway state dir
// (NMF_STATE_DIR) so discovery is bypassed and nothing touches a real repo, and
// confirm the read prints the file and is fail-soft when the repo/file is absent.

// A directory with a seeded history.jsonl (so discovery keys on it, like the real
// state repo) plus a feedback.md. Not a git repo — feedback.sh only ever reads.
function makeFeedbackStateDir(feedbackContents) {
  const stateDir = mkdtempSync(join(tmpdir(), "nmf-fb-"));
  writeFileSync(join(stateDir, "history.jsonl"), "");
  if (feedbackContents !== null) writeFileSync(join(stateDir, "feedback.md"), feedbackContents);
  return stateDir;
}

test("feedback read prints the state repo's feedback.md verbatim", async () => {
  const body = "## 2026-06-05\n- more solo guitar like the Bill Orcutt pick\n";
  const stateDir = makeFeedbackStateDir(body);
  const { code, stdout } = await runBash(FEEDBACK, ["read"], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(code, 0);
  assert.equal(stdout, body);
});

test("feedback read is fail-soft when the feedback file is absent (fresh install)", async () => {
  const stateDir = makeFeedbackStateDir(null);
  const { code, stdout } = await runBash(FEEDBACK, ["read"], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(code, 0);
  assert.match(stdout, /# feedback: no feedback on file yet/);
});

test("feedback read is fail-soft when the state repo is absent (never blocks the run)", async () => {
  const { code, stdout } = await runBash(FEEDBACK, ["read"], {
    env: baseEnv({ NMF_STATE_DIR: join(tmpdir(), "nmf-fb-absent-xyz") }),
  });
  assert.equal(code, 0);
  assert.match(stdout, /state repo not found/);
});

test("feedback read honors NMF_FEEDBACK_FILE for the filename", async () => {
  const stateDir = makeFeedbackStateDir(null);
  const body = "## 2026-06-05\n- alt feedback file\n";
  writeFileSync(join(stateDir, "taste.md"), body);
  const { code, stdout } = await runBash(FEEDBACK, ["read"], {
    env: baseEnv({ NMF_STATE_DIR: stateDir, NMF_FEEDBACK_FILE: "taste.md" }),
  });
  assert.equal(code, 0);
  assert.equal(stdout, body);
});

test("feedback rejects an unknown subcommand", async () => {
  const { code, stderr } = await runBash(FEEDBACK, ["append"], { env: baseEnv() });
  assert.equal(code, 2);
  assert.match(stderr, /usage/i);
});

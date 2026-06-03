// Exercises scripts/publish-digest.sh — the #27 opt-in step that drops the
// rendered email bodies into the private state repo under digests/<date>/ and
// pushes them to its default branch. Same throwaway-remote pattern as the
// history.sh tests: a push only "lands" if it reaches the bare remote's main,
// which a fresh re-clone confirms. Production-only and fail-soft are asserted so
// the corpus stays clean and publishing can never block the (already-sent) digest.
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
const PUBLISH = join(ROOT, "scripts/publish-digest.sh");

function baseEnv(overrides = {}) {
  const env = { ...process.env };
  for (const k of ["NMF_TEST", "NMF_STATE_DIR", "NMF_STATE_BRANCH", "NMF_HISTORY_FILE", "NMF_DIGEST_DIR"]) delete env[k];
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
  const base = mkdtempSync(join(tmpdir(), "nmf-digest-"));
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

// Write a run dir with rendered bodies; returns { htmlFile, textFile }.
function writeRenderedBodies(base, prefix = "") {
  const html = `<html><body>digest ${prefix}</body></html>`;
  const text = `digest ${prefix}\n`;
  const htmlFile = join(base, `${prefix}email.html`);
  const textFile = join(base, `${prefix}email.txt`);
  writeFileSync(htmlFile, html);
  writeFileSync(textFile, text);
  return { html, text, htmlFile, textFile };
}

test("publish lands the rendered bodies on the state repo's main", async () => {
  const { base, remote, stateDir } = await makeStateRepo();
  const { html, text, htmlFile, textFile } = writeRenderedBodies(base);
  const env = baseEnv({ NMF_STATE_DIR: stateDir });

  const out = await runBash(PUBLISH, ["production", "2026-06-05", htmlFile, textFile], { env });
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.digest_published, "true");
  assert.equal(kv.digest_path, "digests/2026-06-05");

  // The default-branch trap is closed: a fresh clone from the bare remote sees
  // the bodies under digests/<date>/, so they're durable and downloadable.
  const fresh = join(base, "fresh");
  await execFileP("git", ["clone", "-q", remote, fresh]);
  assert.equal(readFileSync(join(fresh, "digests/2026-06-05/email.html"), "utf8"), html);
  assert.equal(readFileSync(join(fresh, "digests/2026-06-05/email.txt"), "utf8"), text);
});

test("publish refuses a non-production mode (corpus stays clean)", async () => {
  for (const mode of ["test", "", "bogus"]) {
    const { base, stateDir } = await makeStateRepo();
    const { htmlFile, textFile } = writeRenderedBodies(base, mode === "" ? "test-" : `${mode}-`);
    const args = mode === "" ? ["", "2026-06-05", htmlFile, textFile] : [mode, "2026-06-05", htmlFile, textFile];
    const out = await runBash(PUBLISH, args, { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
    // An empty mode is a missing required arg → usage error (exit 2); a present
    // but non-production mode is the fail-soft production-only skip (exit 0).
    if (mode === "") {
      assert.equal(out.code, 2, "empty mode should be a usage error");
      assert.match(out.stderr, /usage/i);
    } else {
      assert.equal(out.code, 0, `mode ${mode} should be fail-soft`);
      const kv = parseKV(out.stdout);
      assert.equal(kv.digest_published, "false");
      assert.equal(kv.reason, "non-production-skipped");
    }
    // Nothing was written to the state repo.
    assert.equal(existsSync(join(stateDir, "digests")), false);
  }
});

test("publish is fail-soft when a rendered body is missing", async () => {
  const { base, stateDir } = await makeStateRepo();
  const { htmlFile } = writeRenderedBodies(base);
  const out = await runBash(
    PUBLISH,
    ["production", "2026-06-05", htmlFile, join(base, "no-such-email.txt")],
    { env: baseEnv({ NMF_STATE_DIR: stateDir }) },
  );
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.digest_published, "false");
  assert.equal(kv.reason, "digest-file-missing");
});

test("publish is fail-soft when the state repo is absent (never blocks the send)", async () => {
  const base = mkdtempSync(join(tmpdir(), "nmf-digest-"));
  const { htmlFile, textFile } = writeRenderedBodies(base);
  const out = await runBash(
    PUBLISH,
    ["production", "2026-06-05", htmlFile, textFile],
    { env: baseEnv({ NMF_STATE_DIR: join(base, "absent") }) },
  );
  assert.equal(out.code, 0);
  const kv = parseKV(out.stdout);
  assert.equal(kv.digest_published, "false");
  assert.equal(kv.reason, "state-repo-not-found");
});

test("publish honors NMF_STATE_BRANCH for the conservative claude/ path", async () => {
  const { base, remote, stateDir } = await makeStateRepo();
  const { html, htmlFile, textFile } = writeRenderedBodies(base);
  const env = baseEnv({ NMF_STATE_DIR: stateDir, NMF_STATE_BRANCH: "claude/digests" });

  const out = await runBash(PUBLISH, ["production", "2026-06-05", htmlFile, textFile], { env });
  assert.equal(out.code, 0);
  assert.equal(parseKV(out.stdout).digest_published, "true");

  // It landed on claude/digests, not main — main is untouched.
  const fresh = join(base, "fresh");
  await execFileP("git", ["clone", "-q", "-b", "claude/digests", remote, fresh]);
  assert.equal(readFileSync(join(fresh, "digests/2026-06-05/email.html"), "utf8"), html);
  const onMain = join(base, "fresh-main");
  await execFileP("git", ["clone", "-q", "-b", "main", remote, onMain]);
  assert.equal(existsSync(join(onMain, "digests")), false);
});

test("publish requires all four arguments", async () => {
  const { stateDir } = await makeStateRepo();
  const out = await runBash(PUBLISH, ["production", "2026-06-05"], { env: baseEnv({ NMF_STATE_DIR: stateDir }) });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /usage/i);
});

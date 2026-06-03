// Exercises scripts/bootstrap.sh state-repo — the one bootstrap subcommand that
// writes (creates + seeds the private state repo). No network: a stub `gh` and
// `git` are placed on PATH ahead of the real ones, so we can assert the guard
// and the idempotency guarantee (an existing, already-seeded repo is left
// untouched and git is never invoked) without creating a real repo. The happy
// create+seed path hits real GitHub, so it's left to the live #9 run-through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BOOTSTRAP = join(ROOT, "scripts/bootstrap.sh");

async function runBash(args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileP("bash", [BOOTSTRAP, ...args], opts);
    return { code: 0, stdout, stderr };
  } catch (e) {
    return { code: typeof e.code === "number" ? e.code : 1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

// A throwaway PATH-prefix bin holding stub `gh` + `git`. The real PATH is kept
// appended so coreutils (mktemp, grep, sed, rm, ...) still resolve.
function stubBin({ ghScenario = {}, gitLog }) {
  const bin = mkdtempSync(join(tmpdir(), "nmf-stubbin-"));
  const gh = join(bin, "gh");
  // Stub gh: drive each branch the script takes off env vars.
  writeFileSync(gh, [
    "#!/usr/bin/env bash",
    'sub="$1"; act="$2"',
    'if [ "$sub" = auth ] && [ "$act" = status ]; then',
    '  [ "${FAKE_GH_NOAUTH:-0}" = 1 ] && exit 1 || exit 0',
    "fi",
    'if [ "$sub" = api ] && [ "$act" = user ]; then echo "tester"; exit 0; fi',
    'if [ "$sub" = repo ] && [ "$act" = view ]; then',
    '  [ "${FAKE_GH_REPO_EXISTS:-1}" = 1 ] && exit 0 || exit 1',
    "fi",
    'if [ "$sub" = repo ] && [ "$act" = create ]; then exit 0; fi',
    'if [ "$sub" = api ]; then  # repos/<slug>/contents/history.jsonl',
    '  [ "${FAKE_GH_HISTORY_PRESENT:-1}" = 1 ] && exit 0 || exit 1',
    "fi",
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(gh, 0o755);

  const git = join(bin, "git");
  // Stub git: record every invocation so we can assert it was NOT called on the
  // idempotent path. (command -v git in the guard does not execute it.)
  writeFileSync(git, [
    "#!/usr/bin/env bash",
    `echo "$@" >> "${gitLog}"`,
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(git, 0o755);

  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...ghScenario };
  return { env };
}

test("state-repo aborts when gh is not authenticated", async () => {
  const gitLog = join(mkdtempSync(join(tmpdir(), "nmf-gitlog-")), "git.log");
  writeFileSync(gitLog, "");
  const { env } = stubBin({ ghScenario: { FAKE_GH_NOAUTH: "1" }, gitLog });
  const { code, stderr } = await runBash(["state-repo"], { env });
  assert.equal(code, 1);
  assert.match(stderr, /not authenticated/);
});

test("state-repo is idempotent: an existing, already-seeded repo is left untouched and git is never invoked", async () => {
  const gitLog = join(mkdtempSync(join(tmpdir(), "nmf-gitlog-")), "git.log");
  writeFileSync(gitLog, "");
  const { env } = stubBin({
    ghScenario: { FAKE_GH_REPO_EXISTS: "1", FAKE_GH_HISTORY_PRESENT: "1" },
    gitLog,
  });
  const { code, stdout } = await runBash(["state-repo"], { env });
  assert.equal(code, 0);
  assert.match(stdout, /already exists/);
  assert.match(stdout, /not reseeding/);
  // The no-clobber guarantee: no clone/commit/push happened.
  assert.equal(readFileSync(gitLog, "utf8"), "");
});

test("an unknown subcommand prints usage and exits 2", async () => {
  const { code, stderr } = await runBash(["bogus"]);
  assert.equal(code, 2);
  assert.match(stderr, /usage:.*state-repo/);
});

// validate is method-aware (the file-only delivery path). Write a delivery.yaml
// into a temp cwd and run `validate` there.
function withDelivery(yaml) {
  const dir = mkdtempSync(join(tmpdir(), "nmf-validate-"));
  mkdirSync(join(dir, "config"), { recursive: true });
  writeFileSync(join(dir, "config/delivery.yaml"), yaml);
  return dir;
}

test("validate rejects an unknown method", async () => {
  const dir = withDelivery('from: a@b.co\nto: c@d.co\nsubject_template: "x {date}"\nmethod: bogus\n');
  const { code, stderr } = await runBash(["validate"], { cwd: dir });
  assert.equal(code, 1);
  assert.match(stderr, /method: must be 'resend' or 'none'/);
});

test("validate under method: none relaxes the Resend wrapper rule", async () => {
  // A "Name <email>" from is rejected under resend but fine under none (it's
  // just display text in the rendered digest, not a Resend API argument).
  const dir = withDelivery('from: Me <me@b.co>\nto: c@d.co\nsubject_template: "x {date}"\nmethod: none\n');
  const { code, stdout } = await runBash(["validate"], { cwd: dir });
  assert.equal(code, 0);
  assert.match(stdout, /method:\s+none/);
});

test("validate keeps the Resend wrapper rule under the default method", async () => {
  const dir = withDelivery('from: Me <me@b.co>\nto: c@d.co\nsubject_template: "x {date}"\n');
  const { code, stderr } = await runBash(["validate"], { cwd: dir });
  assert.equal(code, 1);
  assert.match(stderr, /Name <email>/);
});

// Drives the *unmodified* scripts/send-email.mjs as a subprocess with a preloaded
// fake `fetch` (test/helpers/fake-fetch.mjs), so every branch of the Resend send
// is exercised with no network and no real key. Guards the one irreversible step
// in the routine: exit codes and the exact payload posted to Resend.
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
const SCRIPT = join(ROOT, "scripts/send-email.mjs");
const PRELOAD = join(ROOT, "test/helpers/fake-fetch.mjs");

const FLAG = { from: "from", to: "to", subject: "subject", html: "html-file", text: "text-file" };

async function runSend({
  include = ["from", "to", "subject", "html", "text"],
  from = "sender@example.com",
  to = "rcpt@example.com",
  subject = "New Music Friday - 06-02-2026",
  htmlBody = "<p>picks</p>",
  textBody = "picks",
  apiKey = "re_test_key",
  fake = {},
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nmf-send-"));
  const htmlFile = join(dir, "email.html");
  const textFile = join(dir, "email.txt");
  writeFileSync(htmlFile, htmlBody);
  writeFileSync(textFile, textBody);
  const reqOut = join(dir, "req.json");

  const value = { from, to, subject, "html-file": htmlFile, "text-file": textFile };
  const args = [];
  for (const k of include) args.push(`--${FLAG[k]}`, value[FLAG[k]]);

  const env = { ...process.env };
  delete env.RESEND_API_KEY;
  if (apiKey !== null) env.RESEND_API_KEY = apiKey;
  env.FAKE_FETCH_OUT = reqOut;
  env.FAKE_FETCH_MODE = fake.mode ?? "ok";
  if (fake.status) env.FAKE_FETCH_STATUS = String(fake.status);
  if (fake.body) env.FAKE_FETCH_BODY = fake.body;

  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    const r = await execFileP(process.execPath, ["--import", PRELOAD, SCRIPT, ...args], { env });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (e) {
    code = typeof e.code === "number" ? e.code : 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }
  const req = existsSync(reqOut) ? JSON.parse(readFileSync(reqOut, "utf8")) : null;
  return { code, stdout, stderr, req };
}

test("happy path posts the expected payload to the Resend endpoint and prints the id", async () => {
  const { code, stdout, req } = await runSend();
  assert.equal(code, 0);
  assert.match(stdout, /resend_message_id=test-message-id/);
  assert.ok(req, "expected the outbound request to be captured");
  assert.equal(req.url, "https://api.resend.com/emails");
  assert.equal(req.options.method, "POST");
  assert.equal(req.options.headers.Authorization, "Bearer re_test_key");
  const body = JSON.parse(req.options.body);
  assert.deepEqual(
    { from: body.from, to: body.to, subject: body.subject },
    {
      from: "sender@example.com",
      to: "rcpt@example.com",
      subject: "New Music Friday - 06-02-2026",
    },
  );
  assert.equal(body.html, "<p>picks</p>");
  assert.equal(body.text, "picks");
});

test("missing required arg exits 2", async () => {
  const { code, stderr } = await runSend({ include: ["from", "subject", "html", "text"] });
  assert.equal(code, 2);
  assert.match(stderr, /missing required --to/);
});

test("missing RESEND_API_KEY exits 2", async () => {
  const { code, stderr } = await runSend({ apiKey: null });
  assert.equal(code, 2);
  assert.match(stderr, /RESEND_API_KEY is not set/);
});

test("empty rendered body exits 2", async () => {
  const { code, stderr } = await runSend({ htmlBody: "   " });
  assert.equal(code, 2);
  assert.match(stderr, /body is empty/);
});

test("Resend HTTP error exits 1 and surfaces the status", async () => {
  const { code, stderr } = await runSend({
    fake: { mode: "http-error", status: 422, body: '{"message":"nope"}' },
  });
  assert.equal(code, 1);
  assert.match(stderr, /Resend returned HTTP 422/);
});

test("network failure exits 1", async () => {
  const { code, stderr } = await runSend({ fake: { mode: "network-error" } });
  assert.equal(code, 1);
  assert.match(stderr, /request to Resend failed/);
});

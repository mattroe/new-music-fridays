// Preloaded via `node --import` ahead of scripts/send-email.mjs so the script's
// single outbound Resend POST can be exercised with no network and no real key —
// letting the tests drive the *unmodified* shipped script end-to-end. Steered
// entirely through env vars so send-email.mjs needs no test seam:
//   FAKE_FETCH_OUT     file path to write the captured { url, options } to
//   FAKE_FETCH_MODE    "ok" (default) | "http-error" | "network-error"
//   FAKE_FETCH_STATUS  HTTP status for the response (default 200)
//   FAKE_FETCH_BODY    response body string (default '{"id":"test-message-id"}')
//   FAKE_FETCH_ERROR_MESSAGE  thrown error message in network-error mode / for
//                             the first failing calls (default "simulated network failure")
//   FAKE_FETCH_ERROR_CODE     thrown error `.code` for those throws (e.g. ENOTFOUND)
//   FAKE_FETCH_FAIL_TIMES     throw on the first N calls (regardless of mode), then
//                             fall through to `mode` — lets a test drive the send's
//                             retry-once path (e.g. =1 with the default "ok" mode is
//                             "first attempt throws, retry succeeds"). Default 0.
import { writeFileSync } from "node:fs";

const out = process.env.FAKE_FETCH_OUT;
const mode = process.env.FAKE_FETCH_MODE ?? "ok";
const status = Number(process.env.FAKE_FETCH_STATUS ?? "200");
const body = process.env.FAKE_FETCH_BODY ?? '{"id":"test-message-id"}';
const failTimes = Number(process.env.FAKE_FETCH_FAIL_TIMES ?? "0");

function networkError() {
  const err = new Error(process.env.FAKE_FETCH_ERROR_MESSAGE ?? "simulated network failure");
  if (process.env.FAKE_FETCH_ERROR_CODE) err.code = process.env.FAKE_FETCH_ERROR_CODE;
  return err;
}

let calls = 0;
globalThis.fetch = async (url, options) => {
  if (out) writeFileSync(out, JSON.stringify({ url, options }));
  calls += 1;
  if (calls <= failTimes) throw networkError();
  if (mode === "network-error") throw networkError();
  return new Response(body, { status });
};

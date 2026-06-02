// Preloaded via `node --import` ahead of scripts/send-email.mjs so the script's
// single outbound Resend POST can be exercised with no network and no real key —
// letting the tests drive the *unmodified* shipped script end-to-end. Steered
// entirely through env vars so send-email.mjs needs no test seam:
//   FAKE_FETCH_OUT     file path to write the captured { url, options } to
//   FAKE_FETCH_MODE    "ok" (default) | "http-error" | "network-error"
//   FAKE_FETCH_STATUS  HTTP status for the response (default 200)
//   FAKE_FETCH_BODY    response body string (default '{"id":"test-message-id"}')
import { writeFileSync } from "node:fs";

const out = process.env.FAKE_FETCH_OUT;
const mode = process.env.FAKE_FETCH_MODE ?? "ok";
const status = Number(process.env.FAKE_FETCH_STATUS ?? "200");
const body = process.env.FAKE_FETCH_BODY ?? '{"id":"test-message-id"}';

globalThis.fetch = async (url, options) => {
  if (out) writeFileSync(out, JSON.stringify({ url, options }));
  if (mode === "network-error") throw new Error("simulated network failure");
  return new Response(body, { status });
};

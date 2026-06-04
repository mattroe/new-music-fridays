// Preloaded via `node --import` ahead of scripts/musicbrainz.mjs so the script's
// outbound MusicBrainz lookups run with no network — letting the tests drive the
// *unmodified* shipped script end-to-end. Steered entirely through env vars so
// musicbrainz.mjs needs no test seam:
//   FAKE_MB_OUT     file path to write the captured array of requested URLs to
//   FAKE_MB_MODE    "ok" (default) | "network-error" | "proxy-403"
//   FAKE_MB_BODIES  path to a JSON file: array of response bodies served in call
//                   order (call N returns bodies[N]); missing/extra calls get an
//                   empty { "release-groups": [] }. Ignored in error modes.
import { writeFileSync, readFileSync } from "node:fs";

const out = process.env.FAKE_MB_OUT;
const mode = process.env.FAKE_MB_MODE ?? "ok";
const bodies = process.env.FAKE_MB_BODIES
  ? JSON.parse(readFileSync(process.env.FAKE_MB_BODIES, "utf8"))
  : [];

let call = 0;
const urls = [];

globalThis.fetch = async (url) => {
  urls.push(url);
  if (out) writeFileSync(out, JSON.stringify(urls));
  if (mode === "network-error") throw new Error("simulated network failure");
  if (mode === "proxy-403") return new Response("Host not in allowlist", { status: 403 });
  const body = bodies[call++] ?? { "release-groups": [] };
  return new Response(JSON.stringify(body), { status: 200 });
};

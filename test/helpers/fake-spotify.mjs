// Preloaded via `node --import` ahead of scripts/spotify.mjs so the script's
// outbound Spotify calls run with no network — letting the tests drive the
// *unmodified* shipped script end-to-end. Routes by URL (token endpoint vs.
// each api.spotify.com read) and synthesizes plausible bodies, steered through
// env vars so spotify.mjs needs no test seam:
//   FAKE_SP_OUT             file path to write the captured requests to, as an
//                           array of { url, method, authorization, body }
//   FAKE_SP_MODE            "ok" (default) | "network-error" | "proxy-403"
//                           | "data-proxy-403"  (token ok, data host blocked)
//                           | "token-invalid-grant" | "rate-limit-once"
//                           | "fail-recent"     (recently-played 500)
//                           | "scope-403-recent" (recently-played: real
//                              Spotify JSON 403 — must fail-soft, not fatal)
//                           | "fail-top-artists" (every top-artists read 500)
//   FAKE_SP_LIBRARY_TOTAL   how many saved tracks/albums the fake account has
//                           (default 5; >50 exercises pagination)
//   FAKE_SP_FOLLOWED_TOTAL  how many followed artists (default 3)
import { writeFileSync } from "node:fs";

const out = process.env.FAKE_SP_OUT;
const mode = process.env.FAKE_SP_MODE ?? "ok";
const libraryTotal = Number(process.env.FAKE_SP_LIBRARY_TOTAL ?? 5);
const followedTotal = Number(process.env.FAKE_SP_FOLLOWED_TOTAL ?? 3);

const requests = [];
let apiCalls = 0;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });

// Raw-payload noise the distiller must drop — tests assert none of it leaks.
const artistNoise = (i) => ({
  id: `artistid${i}`,
  popularity: 70 + i,
  images: [{ url: "https://i.scdn.co/image/x", width: 64, height: 64 }],
  external_urls: { spotify: "https://open.spotify.com/artist/x" },
});

const topArtists = (range, limit) => ({
  items: Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
    name: `${range} Artist ${i + 1}`,
    genres: ["indie rock", "dream pop", "slowcore", "shoegaze", "noise pop", "lo-fi", "extra-tag-7"],
    ...artistNoise(i),
  })),
});

const topTracks = (range, limit) => ({
  items: Array.from({ length: Math.min(limit, 3) }, (_, i) => ({
    name: `${range} Track ${i + 1}`,
    artists: [{ name: `${range} Artist ${i + 1}`, id: `tid${i}` }],
    popularity: 50,
    preview_url: "https://p.scdn.co/mp3-preview/x",
  })),
});

const recentlyPlayed = () => ({
  items: [
    { track: { name: "Fresh Cut", artists: [{ name: "Recent Artist" }] }, played_at: "2026-06-09T08:00:00Z" },
    { track: { name: "Fresh Cut", artists: [{ name: "Recent Artist" }] }, played_at: "2026-06-08T08:00:00Z" },
    { track: { name: "Old Favorite", artists: [{ name: "Beloved Band" }] }, played_at: "2026-06-07T08:00:00Z" },
  ],
});

const savedPage = (offset, kind) => {
  const items = [];
  for (let i = offset; i < Math.min(offset + 50, libraryTotal); i++) {
    items.push(
      kind === "tracks"
        ? { track: { name: `Saved Track ${i + 1}`, artists: [{ name: `Saved Artist ${i + 1}` }] } }
        : { album: { name: `Saved Album ${i + 1}`, artists: [{ name: `Album Artist ${i + 1}` }] } },
    );
  }
  const next = offset + 50 < libraryTotal ? "https://api.spotify.com/v1/next" : null;
  return { items, total: libraryTotal, next };
};

const followedPage = (after) => {
  const start = after ? Number(after) : 0;
  const items = [];
  for (let i = start; i < Math.min(start + 50, followedTotal); i++) {
    items.push({ name: `Followed Artist ${i + 1}`, genres: ["folk"], ...artistNoise(i) });
  }
  const more = start + 50 < followedTotal;
  return { artists: { items, cursors: { after: more ? String(start + 50) : null }, next: more ? "x" : null } };
};

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  requests.push({
    url: u,
    method: init.method ?? "GET",
    authorization: init.headers?.Authorization ?? init.headers?.authorization ?? null,
    body: typeof init.body === "string" ? init.body : null,
  });
  if (out) writeFileSync(out, JSON.stringify(requests));

  if (mode === "network-error") {
    throw new TypeError("fetch failed", { cause: { code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" } });
  }
  if (mode === "proxy-403") return new Response("Host not in allowlist", { status: 403 });

  const isToken = u.startsWith("https://accounts.spotify.com/api/token");
  if (isToken) {
    if (mode === "token-invalid-grant") return json({ error: "invalid_grant" }, 400);
    const grant = new URLSearchParams(requests.at(-1).body ?? "");
    const body = { access_token: "AT-1", token_type: "Bearer", expires_in: 3600, scope: "user-top-read" };
    if (grant.get("grant_type") === "authorization_code") body.refresh_token = "RT-FAKE-1";
    return json(body);
  }

  // api.spotify.com from here on
  apiCalls++;
  if (mode === "data-proxy-403") return new Response("Host not in allowlist", { status: 403 });
  if (mode === "rate-limit-once" && apiCalls === 1) {
    return new Response("", { status: 429, headers: { "Retry-After": "0" } });
  }

  const q = new URL(u).searchParams;
  if (u.includes("/me/top/artists")) {
    if (mode === "fail-top-artists") return json({ error: { status: 500 } }, 500);
    return json(topArtists(q.get("time_range"), Number(q.get("limit"))));
  }
  if (u.includes("/me/top/tracks")) return json(topTracks(q.get("time_range"), Number(q.get("limit"))));
  if (u.includes("/me/player/recently-played")) {
    if (mode === "fail-recent") return json({ error: { status: 500 } }, 500);
    if (mode === "scope-403-recent") {
      return json({ error: { status: 403, message: "Insufficient client scope" } }, 403);
    }
    return json(recentlyPlayed());
  }
  if (u.includes("/me/tracks")) return json(savedPage(Number(q.get("offset") ?? 0), "tracks"));
  if (u.includes("/me/albums")) return json(savedPage(Number(q.get("offset") ?? 0), "albums"));
  if (u.includes("/me/following")) return json(followedPage(q.get("after")));
  return json({ error: { status: 404 } }, 404);
};

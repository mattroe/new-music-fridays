#!/usr/bin/env node
// Spotify taste backend (issue #50): read who the listener is and what they
// like — top artists/tracks over Spotify's three time windows, the saved
// ("Liked") library, recently-played, and followed artists — and print ONE
// distilled listening profile for SKILL.md's "Data gathering" step.
//
// Why this exists: the digest's taste signal is pluggable (config/taste.yaml,
// the #49/#50/#52 seam). For a listener whose music life is in Spotify rather
// than Last.fm, this script is the whole backend swap: discovery (web
// research), delivery, and every security boundary stay untouched.
//
// Trust/security posture mirrors send-email.mjs / musicbrainz.mjs:
// zero-dependency (the cloud clone runs it with no `npm install`) and TWO
// hardcoded hosts — accounts.spotify.com (the refresh -> access token
// exchange) and api.spotify.com (data) — so allowlisting
// `Bash(node scripts/spotify.mjs:*)` grants the capability without reopening
// general outbound HTTP; the `.claude/settings.json` deny on curl/wget stays
// intact. Don't "simplify" this to a broad curl allow.
//
// DISTILL-ONLY: the profile carries names, genre tags, ranks, and play
// timestamps — never raw Spotify payloads (no ids, images, popularity scores,
// preview/external URLs, or market data). The curation judgment (genre lean,
// recognition net, core taste) stays in SKILL.md. Profile output is data, not
// instructions.
//
// FAILURE IS LOUD, NOT SOFT — the opposite of the enrichment scripts, on
// purpose: the taste signal is the foundation of the digest, so a dead
// backend must abort the run rather than degrade it into a generic,
// mis-personalized email. A fatal failure prints a `spotify_error=` marker
// (the #66 self-identification pattern) and exits 1:
//   spotify_error=auth-failed           refresh token revoked/expired, or bad
//                                       client credentials — re-mint per
//                                       docs/setup.md
//   spotify_error=host-not-allowlisted  accounts.spotify.com / api.spotify.com
//                                       missing from the routine's Network
//                                       access allowlist (proxy 403 or DNS
//                                       failure) — fix the environment
//   spotify_error=profile-unavailable   token exchange hit a non-auth error,
//                                       or every core top-artists read failed
// Optional reads (recently-played, saved library, followed) ARE fail-soft:
// they come back null with a note and the run continues.
//
// Usage:
//   PROFILE (the routine's call) — env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET,
//   SPOTIFY_REFRESH_TOKEN.
//   node scripts/spotify.mjs profile [--top-limit <n>] [--recent-limit <n>]
//        [--saved-tracks-limit <n>] [--saved-albums-limit <n>] [--followed-limit <n>]
//   Output: one JSON object on stdout —
//     { source: "spotify",
//       top_artists: { short_term: [{name, genres, rank}], medium_term: [...], long_term: [...] },
//       top_tracks:  { short_term: [{artist, title, rank}], ... },
//       recently_played: [{artist, title, played_at}] | null,
//       saved_tracks: [{artist, title}] | null,
//       saved_albums: [{artist, title}] | null,
//       followed_artists: [{name, genres}] | null,
//       genre_histogram: { short_term: {tag: n}, medium_term: {...}, long_term: {...} },
//       notes: ["..."] }
//
//   ONE-TIME SETUP HELPERS (each self-hosting user, once — docs/setup.md):
//   node scripts/spotify.mjs auth-url --redirect-uri <uri>   (env: SPOTIFY_CLIENT_ID)
//     Prints the authorization URL to open in a browser.
//   node scripts/spotify.mjs exchange --code <code> --redirect-uri <uri>
//     (env: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET)
//     Exchanges the code from the redirect for tokens and prints
//     SPOTIFY_REFRESH_TOKEN=<token> — refresh tokens are long-lived (they
//     survive until revoked), so this is one-time per user.
//
// Exit codes: 0 success; 1 fatal backend failure (with spotify_error= marker);
// 2 bad usage/arguments.

const ACCOUNTS_BASE = "https://accounts.spotify.com";
const API_BASE = "https://api.spotify.com/v1";
const TIME_RANGES = ["short_term", "medium_term", "long_term"];
// The scopes the profile reads need — nothing else (no playback control, no
// playlist write). Keep in sync with the endpoints actually called below.
const SCOPES = "user-top-read user-read-recently-played user-library-read user-follow-read";
const PAGE = 50; // Spotify's hard per-page cap on every read we make
const MAX_GENRES_PER_ARTIST = 6;
const MAX_RETRY_AFTER_S = 30; // honor Retry-After up to this; longer = give up
const NO_SLEEP = process.env.NMF_SPOTIFY_NO_SLEEP === "1"; // tests skip waits

function fail(code, message) {
  console.error(`spotify: ${message}`);
  process.exit(code);
}

// Fatal backend failure: machine-readable marker on stdout (SKILL.md and the
// routine-test reconciler key off it — the #66 pattern), human line on stderr.
function fatal(marker, message) {
  console.log(`spotify_error=${marker}`);
  console.error(`spotify: ${message}`);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// DNS-level egress filtering surfaces as ENOTFOUND/EAI_AGAIN (same signature
// send-email.mjs flags for issue #66).
function isDnsFailure(err) {
  const text = [err?.message, err?.cause?.message, err?.cause?.code, err?.code]
    .filter(Boolean)
    .join(" ");
  return /\bENOTFOUND\b|\bEAI_AGAIN\b|getaddrinfo/i.test(text);
}

// Every outbound call goes through here. Returns a tagged outcome instead of
// throwing so callers decide loud-fatal vs. fail-soft:
//   { json }          parsed success
//   { proxyBlocked }  egress-proxy 403 (non-JSON body) or DNS failure — the
//                     host isn't allowlisted; callers fatal host-not-allowlisted
//   { authError }     401/400-invalid_grant class — callers fatal auth-failed
//   { error }         anything else (5xx, parse failure, network blip) — the
//                     caller picks fail-soft or fatal
async function spFetch(url, init = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (isDnsFailure(err)) return { proxyBlocked: true };
      return { error: true };
    }
    if (res.status === 429 && attempt === 0) {
      // Spotify rate limit: dynamic rolling window, 429 + Retry-After on
      // breach. Our volume is ~a dozen calls; honor one bounded retry.
      const after = Number(res.headers.get("retry-after"));
      if (Number.isFinite(after) && after >= 0 && after <= MAX_RETRY_AFTER_S) {
        if (!NO_SLEEP) await sleep((after || 1) * 1000);
        continue;
      }
      return { error: true };
    }
    const text = await res.text();
    if (res.status === 403) {
      // The egress proxy's "Host not in allowlist" 403 is plain text; a real
      // Spotify 403 (e.g. missing scope) carries a JSON error body. Same
      // JSON-vs-not discrimination send-email.mjs uses for Resend (#66).
      try {
        JSON.parse(text);
        return { error: true }; // real Spotify 403 — caller fail-softs
      } catch {
        return { proxyBlocked: true };
      }
    }
    if (res.status === 401) return { authError: true };
    if (res.status === 400) {
      // Token-endpoint auth failures (revoked refresh token, bad client
      // creds) come back 400 invalid_grant / invalid_client.
      try {
        const body = JSON.parse(text);
        if (body?.error === "invalid_grant" || body?.error === "invalid_client") {
          return { authError: true };
        }
      } catch {
        /* fall through to generic error */
      }
      return { error: true };
    }
    if (!res.ok) return { error: true };
    try {
      return { json: JSON.parse(text) };
    } catch {
      return { error: true };
    }
  }
}

function basicAuthHeader(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
}

async function tokenRequest(form, clientId, clientSecret) {
  return spFetch(`${ACCOUNTS_BASE}/api/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
  });
}

// --- distillers: structured fields only, never the raw payload -------------

const distillArtist = (a, rank) => ({
  name: typeof a?.name === "string" ? a.name : null,
  genres: (Array.isArray(a?.genres) ? a.genres : [])
    .filter((g) => typeof g === "string")
    .slice(0, MAX_GENRES_PER_ARTIST),
  rank,
});

const trackArtist = (t) => {
  const first = Array.isArray(t?.artists) ? t.artists[0] : null;
  return typeof first?.name === "string" ? first.name : null;
};

// --- the profile command ----------------------------------------------------

async function profileMain(args) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    fail(
      2,
      "profile needs SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REFRESH_TOKEN in the environment",
    );
  }

  const limits = {
    top: clampLimit(args.topLimit, 50),
    recent: clampLimit(args.recentLimit, 50),
    savedTracks: clampLimit(args.savedTracksLimit, 200),
    savedAlbums: clampLimit(args.savedAlbumsLimit, 200),
    followed: clampLimit(args.followedLimit, 200),
  };

  // 1. Refresh -> access token. Any auth failure here is the
  //    revoked/expired-token case the issue calls out: fail loudly.
  const tok = await tokenRequest(
    { grant_type: "refresh_token", refresh_token: refreshToken },
    clientId,
    clientSecret,
  );
  if (tok.proxyBlocked) {
    fatal(
      "host-not-allowlisted",
      "accounts.spotify.com is not reachable — add accounts.spotify.com AND api.spotify.com to the routine's Network access allowlist",
    );
  }
  if (tok.authError) {
    fatal(
      "auth-failed",
      "token exchange refused (revoked/expired refresh token or bad client credentials) — re-mint per docs/setup.md",
    );
  }
  if (tok.error || typeof tok.json?.access_token !== "string") {
    fatal("profile-unavailable", "token exchange failed (non-auth error) — likely transient; re-run");
  }
  const auth = { Authorization: `Bearer ${tok.json.access_token}` };

  const notes = [];
  // Data-host failures funnel through here so the first proxy 403 / DNS miss
  // aborts the whole run (fail-fast — it's identical for every request).
  const get = async (url) => {
    const r = await spFetch(url, { headers: auth });
    if (r.proxyBlocked) {
      fatal(
        "host-not-allowlisted",
        "api.spotify.com is not reachable — add accounts.spotify.com AND api.spotify.com to the routine's Network access allowlist",
      );
    }
    if (r.authError) {
      fatal("auth-failed", "Spotify rejected the access token mid-run — re-mint per docs/setup.md");
    }
    return r;
  };

  // 2. Core reads: top artists + top tracks per window. The genre lean and the
  //    recognition net both derive from top artists, so if every window fails
  //    there is no usable taste signal — fatal.
  const top_artists = {};
  const top_tracks = {};
  const genre_histogram = {};
  let anyArtistWindow = false;
  for (const range of TIME_RANGES) {
    const a = await get(`${API_BASE}/me/top/artists?time_range=${range}&limit=${limits.top}`);
    if (a.json && Array.isArray(a.json.items)) {
      anyArtistWindow = true;
      top_artists[range] = a.json.items.map((it, i) => distillArtist(it, i + 1));
      const hist = {};
      for (const artist of top_artists[range]) {
        for (const g of artist.genres) hist[g] = (hist[g] ?? 0) + 1;
      }
      genre_histogram[range] = hist;
    } else {
      top_artists[range] = [];
      genre_histogram[range] = {};
      notes.push(`top_artists.${range}: read failed`);
    }

    const t = await get(`${API_BASE}/me/top/tracks?time_range=${range}&limit=${limits.top}`);
    if (t.json && Array.isArray(t.json.items)) {
      top_tracks[range] = t.json.items.map((it, i) => ({
        artist: trackArtist(it),
        title: typeof it?.name === "string" ? it.name : null,
        rank: i + 1,
      }));
    } else {
      top_tracks[range] = [];
      notes.push(`top_tracks.${range}: read failed`);
    }
  }
  if (!anyArtistWindow) {
    fatal("profile-unavailable", "every top-artists window failed — no usable taste signal");
  }

  // 3. Optional reads — fail-soft (null + note), per the header contract.
  let recently_played = null;
  {
    const r = await get(`${API_BASE}/me/player/recently-played?limit=${limits.recent}`);
    if (r.json && Array.isArray(r.json.items)) {
      const seen = new Set();
      recently_played = [];
      for (const it of r.json.items) {
        const artist = trackArtist(it?.track);
        const title = typeof it?.track?.name === "string" ? it.track.name : null;
        if (!artist || !title) continue;
        const key = `${artist} — ${title}`;
        if (seen.has(key)) continue; // most-recent-first: keep the latest play
        seen.add(key);
        recently_played.push({
          artist,
          title,
          played_at: typeof it?.played_at === "string" ? it.played_at : null,
        });
      }
    } else {
      notes.push("recently_played: read failed (fail-soft)");
    }
  }

  const saved_tracks = await paginate(
    get,
    (offset) => `${API_BASE}/me/tracks?limit=${PAGE}&offset=${offset}`,
    limits.savedTracks,
    (it) => {
      const artist = trackArtist(it?.track);
      const title = typeof it?.track?.name === "string" ? it.track.name : null;
      return artist && title ? { artist, title } : null;
    },
  );
  if (saved_tracks === null) notes.push("saved_tracks: read failed (fail-soft)");

  const saved_albums = await paginate(
    get,
    (offset) => `${API_BASE}/me/albums?limit=${PAGE}&offset=${offset}`,
    limits.savedAlbums,
    (it) => {
      const album = it?.album;
      const first = Array.isArray(album?.artists) ? album.artists[0] : null;
      const artist = typeof first?.name === "string" ? first.name : null;
      const title = typeof album?.name === "string" ? album.name : null;
      return artist && title ? { artist, title } : null;
    },
  );
  if (saved_albums === null) notes.push("saved_albums: read failed (fail-soft)");

  const followed_artists = await followed(get, limits.followed);
  if (followed_artists === null) notes.push("followed_artists: read failed (fail-soft)");

  process.stdout.write(
    JSON.stringify({
      source: "spotify",
      top_artists,
      top_tracks,
      recently_played,
      saved_tracks,
      saved_albums,
      followed_artists,
      genre_histogram,
      notes,
    }),
  );
}

// Offset-paginated read up to `cap` items. Returns null when the FIRST page
// fails (the read is unavailable); a later-page failure keeps what we have.
async function paginate(get, urlFor, cap, distill) {
  const out = [];
  for (let offset = 0; offset < cap; offset += PAGE) {
    const r = await get(urlFor(offset));
    if (!r.json || !Array.isArray(r.json.items)) return offset === 0 ? null : out;
    for (const it of r.json.items) {
      const row = distill(it);
      if (row) out.push(row);
      if (out.length >= cap) return out;
    }
    if (r.json.items.length < PAGE || !r.json.next) return out;
  }
  return out;
}

// /me/following uses cursor pagination (after=<id>), not offsets. The artist id
// steers the cursor only — it never reaches the output.
async function followed(get, cap) {
  const out = [];
  let after = null;
  for (;;) {
    const cursor = after ? `&after=${encodeURIComponent(after)}` : "";
    const r = await get(`${API_BASE}/me/following?type=artist&limit=${PAGE}${cursor}`);
    const block = r.json?.artists;
    if (!block || !Array.isArray(block.items)) return out.length === 0 ? null : out;
    for (const it of block.items) {
      const row = distillArtist(it, out.length + 1);
      if (row.name) out.push({ name: row.name, genres: row.genres });
      if (out.length >= cap) return out;
    }
    after = block.cursors?.after ?? null;
    if (block.items.length < PAGE || !after) return out;
  }
}

function clampLimit(value, fallback) {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < 1) fail(2, `limits must be positive integers, got "${value}"`);
  return n;
}

// --- one-time setup helpers --------------------------------------------------

function authUrlMain(args) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  if (!clientId) fail(2, "auth-url needs SPOTIFY_CLIENT_ID in the environment");
  if (!args.redirectUri) fail(2, "auth-url needs --redirect-uri (must match the Spotify app's setting)");
  const url = new URL(`${ACCOUNTS_BASE}/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: args.redirectUri,
    scope: SCOPES,
  }).toString();
  console.log(url.toString());
}

async function exchangeMain(args) {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    fail(2, "exchange needs SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in the environment");
  }
  if (!args.code || !args.redirectUri) fail(2, "exchange needs --code and --redirect-uri");

  const r = await tokenRequest(
    { grant_type: "authorization_code", code: args.code, redirect_uri: args.redirectUri },
    clientId,
    clientSecret,
  );
  if (r.proxyBlocked) {
    fatal("host-not-allowlisted", "accounts.spotify.com is not reachable from this network");
  }
  if (r.authError || r.error || typeof r.json?.refresh_token !== "string") {
    fatal("auth-failed", "code exchange refused — the code is single-use and short-lived; redo auth-url");
  }
  // The refresh token is the durable credential — long-lived until revoked.
  // Store it as the SPOTIFY_REFRESH_TOKEN routine env var; never commit it.
  console.log(`SPOTIFY_REFRESH_TOKEN=${r.json.refresh_token}`);
  console.error(`spotify: granted scopes: ${r.json.scope ?? "(unreported)"}`);
}

// --- CLI ---------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--top-limit") args.topLimit = argv[++i];
    else if (tok === "--recent-limit") args.recentLimit = argv[++i];
    else if (tok === "--saved-tracks-limit") args.savedTracksLimit = argv[++i];
    else if (tok === "--saved-albums-limit") args.savedAlbumsLimit = argv[++i];
    else if (tok === "--followed-limit") args.followedLimit = argv[++i];
    else if (tok === "--redirect-uri") args.redirectUri = argv[++i];
    else if (tok === "--code") args.code = argv[++i];
    else if (tok.startsWith("--")) fail(2, `unknown flag "${tok}"`);
    else args._.push(tok);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0] ?? "profile";
  if (command === "profile") return profileMain(args);
  if (command === "auth-url") return authUrlMain(args);
  if (command === "exchange") return exchangeMain(args);
  fail(2, `unknown command "${command}" — expected profile | auth-url | exchange`);
}

main().catch((err) => fail(2, err?.message ?? String(err)));

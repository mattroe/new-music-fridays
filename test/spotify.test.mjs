// Drives the *unmodified* scripts/spotify.mjs as a subprocess with a preloaded
// fake `fetch` (test/helpers/fake-spotify.mjs), so every branch of the taste
// backend is exercised with no network. Guards the properties SKILL.md leans
// on: the distilled profile shape (names/genres/ranks only — no raw Spotify
// payload fields), the two-host containment, the loud-fatal failure contract
// (spotify_error= markers, issue #50/#66), and the fail-soft optional reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(ROOT, "scripts/spotify.mjs");
const PRELOAD = join(ROOT, "test/helpers/fake-spotify.mjs");

const CREDS = {
  SPOTIFY_CLIENT_ID: "client-id-1",
  SPOTIFY_CLIENT_SECRET: "client-secret-1",
  SPOTIFY_REFRESH_TOKEN: "refresh-token-1",
};

async function run(args, { mode = "ok", env = {}, creds = CREDS } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "nmf-sp-"));
  const reqOut = join(dir, "requests.json");
  const fullEnv = {
    ...process.env,
    ...creds,
    ...env,
    NMF_SPOTIFY_NO_SLEEP: "1",
    FAKE_SP_MODE: mode,
    FAKE_SP_OUT: reqOut,
  };
  let code = 0;
  let stdout = "";
  let stderr = "";
  try {
    const r = await execFileP(process.execPath, ["--import", PRELOAD, SCRIPT, ...args], {
      env: fullEnv,
    });
    stdout = r.stdout;
    stderr = r.stderr;
  } catch (e) {
    code = typeof e.code === "number" ? e.code : 1;
    stdout = e.stdout ?? "";
    stderr = e.stderr ?? "";
  }
  const requests = existsSync(reqOut) ? JSON.parse(readFileSync(reqOut, "utf8")) : [];
  let profile = null;
  try {
    profile = JSON.parse(stdout);
  } catch {
    /* error paths assert on the marker line instead */
  }
  return { code, stdout, stderr, requests, profile };
}

test("profile: distilled shape, Bearer auth, and Basic token exchange", async () => {
  const { code, requests, profile } = await run(["profile"]);
  assert.equal(code, 0);

  // Token exchange first: Basic client auth + the refresh grant.
  const token = requests[0];
  assert.ok(token.url.startsWith("https://accounts.spotify.com/api/token"));
  assert.equal(token.method, "POST");
  assert.match(token.authorization, /^Basic /);
  assert.match(token.body, /grant_type=refresh_token/);
  assert.match(token.body, /refresh_token=refresh-token-1/);

  // Every data call carries the minted Bearer token.
  for (const r of requests.slice(1)) {
    assert.equal(r.authorization, "Bearer AT-1", r.url);
  }

  // All three windows for both top reads.
  for (const range of ["short_term", "medium_term", "long_term"]) {
    assert.equal(profile.top_artists[range].length, 3);
    assert.equal(profile.top_artists[range][0].rank, 1);
    assert.equal(profile.top_tracks[range][0].artist, `${range} Artist 1`);
    // Genre histogram per window, computed from the artists' tags.
    assert.equal(profile.genre_histogram[range]["indie rock"], 3);
  }

  // Genres are capped (the fake serves 7 tags; the distiller keeps 6).
  assert.equal(profile.top_artists.short_term[0].genres.length, 6);

  // Recents dedup by artist+title, keeping the most recent play.
  assert.equal(profile.recently_played.length, 2);
  assert.equal(profile.recently_played[0].played_at, "2026-06-09T08:00:00Z");

  assert.equal(profile.saved_tracks.length, 5);
  assert.equal(profile.saved_albums[0].artist, "Album Artist 1");
  assert.equal(profile.followed_artists.length, 3);
  assert.deepEqual(profile.notes, []);
});

test("profile: distill-only — no raw Spotify payload fields leak", async () => {
  const { stdout } = await run(["profile"]);
  for (const leak of ["popularity", "images", "external_urls", "scdn.co", "artistid", "preview_url"]) {
    assert.ok(!stdout.includes(leak), `raw field "${leak}" leaked into the profile`);
  }
});

test("profile: only the two hardcoded Spotify hosts are ever contacted", async () => {
  const { requests } = await run(["profile"]);
  for (const r of requests) {
    assert.match(r.url, /^https:\/\/(accounts|api)\.spotify\.com\//, r.url);
  }
});

test("profile: saved-library reads paginate at 50 and honor the cap", async () => {
  const { profile, requests } = await run(
    ["profile", "--saved-tracks-limit", "120", "--saved-albums-limit", "60"],
    { env: { FAKE_SP_LIBRARY_TOTAL: "130" } },
  );
  assert.equal(profile.saved_tracks.length, 120);
  assert.equal(profile.saved_albums.length, 60);
  const offsets = requests
    .filter((r) => r.url.includes("/me/tracks"))
    .map((r) => new URL(r.url).searchParams.get("offset"));
  assert.deepEqual(offsets, ["0", "50", "100"]);
});

test("profile: followed-artists cursor pagination honors the cap", async () => {
  const { profile } = await run(["profile", "--followed-limit", "70"], {
    env: { FAKE_SP_FOLLOWED_TOTAL: "80" },
  });
  assert.equal(profile.followed_artists.length, 70);
  assert.equal(profile.followed_artists[69].name, "Followed Artist 70");
});

test("profile: revoked refresh token is a loud auth-failed (exit 1)", async () => {
  const { code, stdout } = await run(["profile"], { mode: "token-invalid-grant" });
  assert.equal(code, 1);
  assert.match(stdout, /^spotify_error=auth-failed$/m);
});

test("profile: proxy 403 on the token host self-identifies as host-not-allowlisted", async () => {
  const { code, stdout } = await run(["profile"], { mode: "proxy-403" });
  assert.equal(code, 1);
  assert.match(stdout, /^spotify_error=host-not-allowlisted$/m);
});

test("profile: DNS failure self-identifies as host-not-allowlisted (#66 pattern)", async () => {
  const { code, stdout } = await run(["profile"], { mode: "network-error" });
  assert.equal(code, 1);
  assert.match(stdout, /^spotify_error=host-not-allowlisted$/m);
});

test("profile: proxy 403 on the data host (token host allowlisted, data host missed)", async () => {
  const { code, stdout } = await run(["profile"], { mode: "data-proxy-403" });
  assert.equal(code, 1);
  assert.match(stdout, /^spotify_error=host-not-allowlisted$/m);
});

test("profile: every top-artists window failing is profile-unavailable, not a silent empty", async () => {
  const { code, stdout } = await run(["profile"], { mode: "fail-top-artists" });
  assert.equal(code, 1);
  assert.match(stdout, /^spotify_error=profile-unavailable$/m);
});

test("profile: an optional read failing is fail-soft (null + note), run continues", async () => {
  const { code, profile } = await run(["profile"], { mode: "fail-recent" });
  assert.equal(code, 0);
  assert.equal(profile.recently_played, null);
  assert.ok(profile.notes.some((n) => n.includes("recently_played")));
  assert.equal(profile.saved_tracks.length, 5); // later reads unaffected
});

test("profile: a real Spotify JSON 403 (missing scope) is fail-soft, never host-not-allowlisted", async () => {
  const { code, profile, stdout } = await run(["profile"], { mode: "scope-403-recent" });
  assert.equal(code, 0);
  assert.ok(!stdout.includes("spotify_error="));
  assert.equal(profile.recently_played, null);
});

test("profile: a 429 with Retry-After is honored and retried", async () => {
  const { code, profile, requests } = await run(["profile"], { mode: "rate-limit-once" });
  assert.equal(code, 0);
  assert.equal(profile.top_artists.short_term.length, 3);
  const topShort = requests.filter((r) => r.url.includes("time_range=short_term") && r.url.includes("top/artists"));
  assert.equal(topShort.length, 2); // 429 then the retry
});

test("profile: missing credentials is a usage error (exit 2), no network", async () => {
  const { code, requests } = await run(["profile"], {
    creds: { SPOTIFY_CLIENT_ID: "", SPOTIFY_CLIENT_SECRET: "", SPOTIFY_REFRESH_TOKEN: "" },
  });
  assert.equal(code, 2);
  assert.equal(requests.length, 0);
});

test("auth-url: prints the accounts.spotify.com authorize URL with the read-only scopes", async () => {
  const { code, stdout, requests } = await run(
    ["auth-url", "--redirect-uri", "http://127.0.0.1:8888/callback"],
  );
  assert.equal(code, 0);
  assert.equal(requests.length, 0); // no network — just builds the URL
  const url = new URL(stdout.trim());
  assert.equal(url.origin, "https://accounts.spotify.com");
  assert.equal(url.searchParams.get("client_id"), "client-id-1");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.match(url.searchParams.get("scope"), /user-top-read/);
  assert.match(url.searchParams.get("scope"), /user-library-read/);
});

test("exchange: prints the refresh token as an env-var line", async () => {
  const { code, stdout, requests } = await run([
    "exchange",
    "--code",
    "AC-1",
    "--redirect-uri",
    "http://127.0.0.1:8888/callback",
  ]);
  assert.equal(code, 0);
  assert.match(stdout, /^SPOTIFY_REFRESH_TOKEN=RT-FAKE-1$/m);
  assert.match(requests[0].body, /grant_type=authorization_code/);
  assert.match(requests[0].body, /code=AC-1/);
});

test("unknown command and unknown flag are usage errors", async () => {
  assert.equal((await run(["playlists"])).code, 2);
  assert.equal((await run(["profile", "--bogus"])).code, 2);
});

#!/usr/bin/env node
// Resolve kept candidates against the MusicBrainz API to verify they exist, pin
// down their release-group first-release-date (issue #51, Phase 1), and — when
// enrichment is enabled — read the canonical label (issue #58) and the personnel
// credits (issue #61) the digest can't get reliably anywhere else.
//
// Why this exists: the digest's discovery comes from untrusted web research, so a
// candidate can be hallucinated, mis-dated, or actually a reissue. MusicBrainz is
// the open, CC0 metadata database; resolving a candidate to a canonical MBID is a
// structured existence check, and the release-group first-release-date is the
// signal for "genuinely new this week" vs. "a reissue of an old record". The MBID
// is also the join key SKILL.md persists and reuses (history record, Worth-a-
// Second-Look dedup, the get_album_info play-back probe).
//
// Trust/security posture mirrors send-email.mjs: zero-dependency (the cloud clone
// runs it with no `npm install`) and ONE hardcoded host, so allowlisting
// `Bash(node scripts/musicbrainz.mjs:*)` grants the lookup capability without
// reopening general outbound HTTP — the `.claude/settings.json` deny on
// curl/wget stays intact. Don't "simplify" this to a broad curl allow.
//
// This is a PURE VERIFY/ENRICH step. It returns raw, distilled facts only:
//   - verification: mbid, first_release_date, primary_type
//   - labels (issue #58): an array of label/imprint NAMES
//   - credits (issue #61): an array of { name, role, mbid } — role is MusicBrainz's
//     controlled relationship type (e.g. "producer"), never free text
// and NOTHING else — never MusicBrainz free-text (annotation, disambiguation,
// tags, relationship attributes/credited-as). SKILL.md does the curation judgment
// (in-window vs reissue, which label to render, which credit overlaps your taste)
// with the context it already holds. MusicBrainz output is data, not instructions,
// and is never rendered as a citation.
//
// Resilience (this is why SKILL.md can keep the step enabled by default):
//   - Fail-soft: any network error / MB 5xx / parse failure marks that candidate
//     (or that enrichment field) unresolved/null and the run continues. The step
//     never blocks the weekly send.
//   - 403-fail-fast: a proxy "Host not in allowlist" 403 is identical for every
//     request, so the first one aborts the whole fan-out (~0.5s, not ~Ns of
//     paced 403s) and everything comes back unresolved.
//
// Usage (two modes):
//
//   VERIFY (default) — resolve known candidate titles:
//   node scripts/musicbrainz.mjs <candidates.json> [--min-score <n>]
//                                [--enrich-labels] [--enrich-credits]
//     <candidates.json>  JSON array of { "artist": "...", "title": "..." }
//     --min-score <n>    MB Lucene match-score floor to accept a hit (default 90)
//     --enrich-labels    +1 paced lookup per resolved candidate for the label
//     --enrich-credits   +1 paced lookup per resolved candidate for the credits
//
//   Output: a JSON array on stdout, one object per input candidate (input order):
//     { artist, title, resolved, mbid, first_release_date, primary_type,
//       labels, credits }
//     mbid/first_release_date/primary_type are null when resolved is false.
//     labels/credits are null when that enrichment wasn't requested (or the
//     candidate didn't resolve), [] when it was requested but MusicBrainz returned
//     nothing, and a populated array otherwise. (null = "didn't look", [] =
//     "looked, found none" — what the #61 coverage probe counts.)
//
//   ENUMERATE-BY-ARTIST (#71 item 3 / #61 groundwork) — given artists I already
//   listen to, find what each RELEASED in a window, editor-neutral. This is the
//   taste-graph-anchored coverage source: it can only fill gaps for artists I
//   already care about, never add noise. SKILL.md uses it diagnostically first
//   (the coverage-gap probe) to measure how many in-window known-artist releases
//   the editorial/web sweep missed.
//   node scripts/musicbrainz.mjs --enumerate-by-artist <artists.json>
//                                --window-start <YYYY-MM-DD> --window-end <YYYY-MM-DD>
//                                [--min-score <n>]
//     <artists.json>     JSON array of artist names (strings), or objects with a
//                        string `name`/`artist` field.
//     --window-start     exclusive lower bound; --window-end inclusive upper bound
//                        (releases with start < first-release-date <= end).
//
//   Output: a JSON array on stdout, one object per input artist (input order):
//     { artist, artist_mbid, resolved, releases: [ { title, mbid,
//       first_release_date, primary_type } ] }
//     resolved/artist_mbid reflect the artist match; `releases` holds only the
//     artist's in-window release-groups (full YYYY-MM-DD dates only — partial
//     dates can't be confirmed in-window). [] means resolved-but-nothing-new.
//
// Both modes are fail-soft (network/MB error → that row unresolved, exit 0) and
// 403-fail-fast (proxy host-not-allowlisted → first call aborts the fan-out).
// Distill-only in both: never any MusicBrainz free-text.
// Exit codes: 0 always for lookup outcomes (fail-soft); 2 for bad usage/inputs.

import { readFile } from "node:fs/promises";

const MB_BASE = "https://musicbrainz.org/ws/2";
// MusicBrainz blocks generic/missing User-Agents — identify the app + contact.
const USER_AGENT =
  "new-music-fridays/1.0 ( https://github.com/mattroe/new-music-fridays )";
// Anonymous MusicBrainz allows ~1 request/second sustained. Pace to it.
const RATE_LIMIT_MS = 1000;
const NO_SLEEP = process.env.NMF_MB_NO_SLEEP === "1"; // tests skip the real wait
// Cap distilled enrichment so one over-documented release-group can't bloat the
// record; the digest only ever renders one label and a few overlapping credits.
const MAX_LABELS = 4;
const MAX_CREDITS = 12;
// In-window release-groups per artist for enumerate mode. In practice this is 0
// or 1 — the cap just guards against a pathological artist with many same-window
// entries (deluxe/region variants) bloating the diagnostic.
const MAX_ENUM_RELEASES = 25;

function fail(code, message) {
  console.error(`musicbrainz: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--min-score") {
      args.minScore = argv[++i];
    } else if (tok === "--enrich-labels") {
      args.enrichLabels = true;
    } else if (tok === "--enrich-credits") {
      args.enrichCredits = true;
    } else if (tok === "--enumerate-by-artist") {
      args.enumerateByArtist = argv[++i];
    } else if (tok === "--window-start") {
      args.windowStart = argv[++i];
    } else if (tok === "--window-end") {
      args.windowEnd = argv[++i];
    } else if (tok.startsWith("--")) {
      fail(2, `unknown flag "${tok}"`);
    } else {
      args._.push(tok);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every outbound MusicBrainz call goes through here so the ~1 req/s pacing is
// shared across the search AND the enrichment lookups (otherwise a 3-call
// candidate would burst). Returns a tagged outcome instead of throwing so each
// caller decides fail-soft vs. fail-fast:
//   { json }          parsed success
//   { proxyBlocked }  egress-proxy 403 (host not allowlisted) — caller fail-fasts
//   { error }         network failure / MB 4xx-5xx / parse failure — fail-soft
let httpCalls = 0;
async function mbGet(url) {
  if (httpCalls > 0 && !NO_SLEEP) await sleep(RATE_LIMIT_MS);
  httpCalls++;
  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  } catch {
    return { error: true };
  }
  // The egress proxy returns 403 "Host not in allowlist" when musicbrainz.org
  // isn't allowlisted. It's identical for every request, so signal the caller to
  // abort the whole fan-out rather than pace through N of them.
  if (res.status === 403) return { proxyBlocked: true };
  if (!res.ok) return { error: true }; // real MB 4xx/5xx — fail-soft
  try {
    return { json: JSON.parse(await res.text()) };
  } catch {
    return { error: true };
  }
}

// Resolve one { artist, title } to MB facts, then optionally enrich. Returns the
// result row plus a `proxyBlocked` flag so the caller can fail-fast on a 403.
async function resolveOne(candidate, opts) {
  const row = {
    artist: candidate.artist,
    title: candidate.title,
    resolved: false,
    mbid: null,
    first_release_date: null,
    primary_type: null,
    // null = enrichment not requested (or candidate unresolved); set below.
    labels: null,
    credits: null,
  };

  const lucene = `releasegroup:"${escapeLucene(candidate.title)}" AND artist:"${escapeLucene(
    candidate.artist,
  )}"`;
  const search = await mbGet(
    `${MB_BASE}/release-group?query=${encodeURIComponent(lucene)}&fmt=json&limit=3`,
  );
  if (search.proxyBlocked) return { row, proxyBlocked: true };
  if (search.error) return { row, proxyBlocked: false };

  const groups = Array.isArray(search.json?.["release-groups"]) ? search.json["release-groups"] : [];
  // MB returns results score-sorted; take the top hit at/above the floor.
  const hit = groups.find((g) => Number(g?.score) >= opts.minScore);
  if (!hit || !hit.id) return { row, proxyBlocked: false };

  row.resolved = true;
  row.mbid = hit.id;
  // Release-group first-release-date = earliest release in the group, so an
  // in-window date means a genuinely new release-group and an old date means a
  // reissue/repress. SKILL.md classifies; we only pass the fact through.
  row.first_release_date = hit["first-release-date"] ?? null;
  row.primary_type = hit["primary-type"] ?? null;

  // Enrichment: one extra paced lookup per switch, fail-soft and 403-fail-fast.
  if (opts.enrichCredits) {
    const r = await enrichCredits(row.mbid);
    if (r.proxyBlocked) return { row, proxyBlocked: true };
    row.credits = r.value; // [] when requested-but-empty, populated otherwise
  }
  if (opts.enrichLabels) {
    const r = await enrichLabels(row.mbid);
    if (r.proxyBlocked) return { row, proxyBlocked: true };
    row.labels = r.value;
  }

  return { row, proxyBlocked: false };
}

// Pull the release-group's personnel relationships and distill to controlled
// fields only — { name, role, mbid }. Never the relationship's free-text
// attributes/credited-as/disambiguation. (Issue #61.)
async function enrichCredits(mbid) {
  const r = await mbGet(`${MB_BASE}/release-group/${mbid}?inc=artist-rels&fmt=json`);
  if (r.proxyBlocked) return { proxyBlocked: true };
  if (r.error) return { value: [] }; // fail-soft: looked, treat as none found
  const relations = Array.isArray(r.json?.relations) ? r.json.relations : [];
  const seen = new Set();
  const credits = [];
  for (const rel of relations) {
    const artist = rel?.artist;
    const name = typeof artist?.name === "string" ? artist.name : null;
    const role = typeof rel?.type === "string" ? rel.type : null;
    if (!name || !role) continue;
    const key = `${role} ${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push({ name, role, mbid: typeof artist?.id === "string" ? artist.id : null });
    if (credits.length >= MAX_CREDITS) break;
  }
  return { value: credits };
}

// Browse the release-group's releases for their label/imprint NAMES (labels live
// on the release, not the release-group). Distinct names only — no catalog
// numbers, no disambiguation. (Issue #58.)
async function enrichLabels(mbid) {
  const r = await mbGet(
    `${MB_BASE}/release?release-group=${mbid}&inc=labels&fmt=json&limit=25`,
  );
  if (r.proxyBlocked) return { proxyBlocked: true };
  if (r.error) return { value: [] }; // fail-soft: looked, treat as none found
  const releases = Array.isArray(r.json?.releases) ? r.json.releases : [];
  const seen = new Set();
  const labels = [];
  for (const rel of releases) {
    const infos = Array.isArray(rel?.["label-info"]) ? rel["label-info"] : [];
    for (const info of infos) {
      const name = info?.label?.name;
      if (typeof name !== "string" || !name || seen.has(name)) continue;
      seen.add(name);
      labels.push(name);
      if (labels.length >= MAX_LABELS) return { value: labels };
    }
  }
  return { value: labels };
}

// Escape Lucene special chars and embedded quotes so a title/artist can't break
// the query (or smuggle query syntax in from untrusted research content).
function escapeLucene(s) {
  return String(s).replace(/(["\\])/g, "\\$1");
}

// True iff a MusicBrainz first-release-date is a full YYYY-MM-DD that falls in
// (start, end]. Partial dates ("2026", "2026-06") can't be confirmed inside a
// 7-day window, so they're excluded — the enumerate probe wants high-confidence
// in-window releases, not maybes. Lexicographic compare is correct for ISO dates.
function inWindow(date, start, end) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return date > start && date <= end;
}

// ENUMERATE-BY-ARTIST: resolve one artist name to its MBID, then browse its
// release-groups and keep only the ones first released inside the window.
// Two paced calls (artist search + release-group browse), distill-only, with the
// same proxyBlocked fail-fast signal as resolveOne.
async function enumerateOne(name, opts) {
  const row = { artist: name, artist_mbid: null, resolved: false, releases: [] };

  const search = await mbGet(
    `${MB_BASE}/artist?query=${encodeURIComponent(`artist:"${escapeLucene(name)}"`)}&fmt=json&limit=3`,
  );
  if (search.proxyBlocked) return { row, proxyBlocked: true };
  if (search.error) return { row, proxyBlocked: false };

  const artists = Array.isArray(search.json?.artists) ? search.json.artists : [];
  const hit = artists.find((a) => Number(a?.score) >= opts.minScore);
  if (!hit || !hit.id) return { row, proxyBlocked: false };

  row.resolved = true;
  row.artist_mbid = hit.id;

  const browse = await mbGet(`${MB_BASE}/release-group?artist=${hit.id}&fmt=json&limit=100`);
  if (browse.proxyBlocked) return { row, proxyBlocked: true };
  if (browse.error) return { row, proxyBlocked: false }; // resolved artist, releases unread — fail-soft

  const groups = Array.isArray(browse.json?.["release-groups"]) ? browse.json["release-groups"] : [];
  for (const g of groups) {
    const date = g?.["first-release-date"] ?? null;
    if (!inWindow(date, opts.windowStart, opts.windowEnd)) continue;
    row.releases.push({
      title: typeof g?.title === "string" ? g.title : null,
      mbid: typeof g?.id === "string" ? g.id : null,
      first_release_date: date,
      primary_type: g?.["primary-type"] ?? null,
    });
    if (row.releases.length >= MAX_ENUM_RELEASES) break;
  }
  return { row, proxyBlocked: false };
}

async function enumerateMain(args, minScore) {
  const windowStart = args.windowStart;
  const windowEnd = args.windowEnd;
  const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(windowStart) || !isDate(windowEnd)) {
    fail(2, "--enumerate-by-artist requires --window-start and --window-end as YYYY-MM-DD");
  }

  let names;
  try {
    names = JSON.parse(await readFile(args.enumerateByArtist, "utf8"));
  } catch (err) {
    fail(2, `cannot read artists file: ${err.message}`);
  }
  if (!Array.isArray(names)) fail(2, "artists file must be a JSON array");

  const opts = { minScore, windowStart, windowEnd };
  const results = [];
  let blocked = false;
  for (let i = 0; i < names.length; i++) {
    const raw = names[i];
    const name = typeof raw === "string" ? raw : raw && (raw.name ?? raw.artist);
    if (typeof name !== "string" || !name) {
      fail(2, `artist ${i} must be a string (or an object with a string name/artist)`);
    }
    if (blocked) {
      results.push({ artist: name, artist_mbid: null, resolved: false, releases: [] });
      continue;
    }
    const { row, proxyBlocked } = await enumerateOne(name, opts);
    results.push(row);
    if (proxyBlocked) blocked = true; // fail-fast: skip the rest
  }

  process.stdout.write(JSON.stringify(results));
}

// An unresolved row in input shape — used for candidates skipped after a 403.
function unresolvedRow(c) {
  return {
    artist: c.artist,
    title: c.title,
    resolved: false,
    mbid: null,
    first_release_date: null,
    primary_type: null,
    labels: null,
    credits: null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const minScore = args.minScore === undefined ? 90 : Number(args.minScore);
  if (!Number.isFinite(minScore)) fail(2, `--min-score must be a number, got "${args.minScore}"`);

  // ENUMERATE-BY-ARTIST mode dispatches before the verify path (#71 item 3).
  if (args.enumerateByArtist !== undefined) {
    await enumerateMain(args, minScore);
    return;
  }

  const inputPath = args._[0];
  if (!inputPath) fail(2, "missing <candidates.json> argument");

  const opts = {
    minScore,
    enrichLabels: Boolean(args.enrichLabels),
    enrichCredits: Boolean(args.enrichCredits),
  };

  let candidates;
  try {
    candidates = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (err) {
    fail(2, `cannot read candidates file: ${err.message}`);
  }
  if (!Array.isArray(candidates)) fail(2, "candidates file must be a JSON array");

  const results = [];
  let blocked = false;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!c || typeof c.artist !== "string" || typeof c.title !== "string") {
      fail(2, `candidate ${i} must have string "artist" and "title"`);
    }

    if (blocked) {
      // Host-not-allowlisted already proven on an earlier request — don't retry.
      results.push(unresolvedRow(c));
      continue;
    }

    const { row, proxyBlocked } = await resolveOne(c, opts);
    results.push(row);
    if (proxyBlocked) blocked = true; // fail-fast: skip the rest
  }

  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => fail(2, err?.message ?? String(err)));

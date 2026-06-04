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
// Usage:
//   node scripts/musicbrainz.mjs <candidates.json> [--min-score <n>]
//                                [--enrich-labels] [--enrich-credits]
//     <candidates.json>  JSON array of { "artist": "...", "title": "..." }
//     --min-score <n>    MB Lucene match-score floor to accept a hit (default 90)
//     --enrich-labels    +1 paced lookup per resolved candidate for the label
//     --enrich-credits   +1 paced lookup per resolved candidate for the credits
//
// Output: a JSON array on stdout, one object per input candidate (input order):
//   { artist, title, resolved, mbid, first_release_date, primary_type,
//     labels, credits }
//   mbid/first_release_date/primary_type are null when resolved is false.
//   labels/credits are null when that enrichment wasn't requested (or the
//   candidate didn't resolve), [] when it was requested but MusicBrainz returned
//   nothing, and a populated array otherwise. (null = "didn't look", [] = "looked,
//   found none" — the distinction is what the #61 coverage probe counts.)
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
  const inputPath = args._[0];
  if (!inputPath) fail(2, "missing <candidates.json> argument");

  const minScore = args.minScore === undefined ? 90 : Number(args.minScore);
  if (!Number.isFinite(minScore)) fail(2, `--min-score must be a number, got "${args.minScore}"`);

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

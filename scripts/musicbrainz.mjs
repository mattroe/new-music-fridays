#!/usr/bin/env node
// Resolve kept candidates against the MusicBrainz API to verify they exist and
// pin down their release-group first-release-date (issue #51, Phase 1).
//
// Why this exists: the digest's discovery comes from untrusted web research, so a
// candidate can be hallucinated, mis-dated, or actually a reissue. MusicBrainz is
// the open, CC0 metadata database; resolving a candidate to a canonical MBID is a
// structured existence check, and the release-group first-release-date is the
// signal for "genuinely new this week" vs. "a reissue of an old record".
//
// Trust/security posture mirrors send-email.mjs: zero-dependency (the cloud clone
// runs it with no `npm install`) and ONE hardcoded host, so allowlisting
// `Bash(node scripts/musicbrainz.mjs:*)` grants the lookup capability without
// reopening general outbound HTTP — the `.claude/settings.json` deny on
// curl/wget stays intact. Don't "simplify" this to a broad curl allow.
//
// This is a PURE VERIFY step. It returns raw facts (mbid, first_release_date,
// primary_type) and NOTHING else — never MusicBrainz free-text (annotation,
// disambiguation, tags). SKILL.md does the curation judgment (in-window vs
// reissue vs unverified) with the release window it already holds, exactly as it
// reasons about every other date. MusicBrainz output is data, not instructions,
// and is never rendered as a citation.
//
// Resilience (this is why SKILL.md can keep the step enabled by default):
//   - Fail-soft: any network error / MB 5xx / parse failure marks that candidate
//     unresolved and the run continues. The step never blocks the weekly send.
//   - 403-fail-fast: a proxy "Host not in allowlist" 403 is identical for every
//     candidate, so the first one aborts the whole fan-out (~0.5s, not ~Ns of
//     paced 403s) and everything comes back unresolved.
//
// Usage:
//   node scripts/musicbrainz.mjs <candidates.json> [--min-score <n>]
//     <candidates.json>  JSON array of { "artist": "...", "title": "..." }
//     --min-score <n>    MB Lucene match-score floor to accept a hit (default 90)
//
// Output: a JSON array on stdout, one object per input candidate (input order):
//   { artist, title, resolved, mbid, first_release_date, primary_type }
//   (mbid/first_release_date/primary_type are null when resolved is false)
// Exit codes: 0 always for lookup outcomes (fail-soft); 2 for bad usage/inputs.

import { readFile } from "node:fs/promises";

const MB_BASE = "https://musicbrainz.org/ws/2";
// MusicBrainz blocks generic/missing User-Agents — identify the app + contact.
const USER_AGENT =
  "new-music-fridays/1.0 ( https://github.com/mattroe/new-music-fridays )";
// Anonymous MusicBrainz allows ~1 request/second sustained. Pace to it.
const RATE_LIMIT_MS = 1000;
const NO_SLEEP = process.env.NMF_MB_NO_SLEEP === "1"; // tests skip the real wait

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
    } else if (tok.startsWith("--")) {
      fail(2, `unknown flag "${tok}"`);
    } else {
      args._.push(tok);
    }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolve one { artist, title } to MB facts. Returns the result row plus a
// `proxyBlocked` flag so the caller can fail-fast on a 403 host-not-allowlisted.
async function resolveOne(candidate, minScore) {
  const unresolved = {
    artist: candidate.artist,
    title: candidate.title,
    resolved: false,
    mbid: null,
    first_release_date: null,
    primary_type: null,
  };

  const lucene = `releasegroup:"${escapeLucene(candidate.title)}" AND artist:"${escapeLucene(
    candidate.artist,
  )}"`;
  const url = `${MB_BASE}/release-group?query=${encodeURIComponent(lucene)}&fmt=json&limit=3`;

  let res;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  } catch {
    // Network failure — fail-soft for this candidate, keep going.
    return { row: unresolved, proxyBlocked: false };
  }

  // The egress proxy returns 403 "Host not in allowlist" when musicbrainz.org
  // isn't allowlisted. It's identical for every candidate, so signal the caller
  // to abort the whole fan-out rather than pace through N of them.
  if (res.status === 403) {
    return { row: unresolved, proxyBlocked: true };
  }
  if (!res.ok) {
    return { row: unresolved, proxyBlocked: false }; // real MB 4xx/5xx — fail-soft
  }

  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    return { row: unresolved, proxyBlocked: false };
  }

  const groups = Array.isArray(data?.["release-groups"]) ? data["release-groups"] : [];
  // MB returns results score-sorted; take the top hit at/above the floor.
  const hit = groups.find((g) => Number(g?.score) >= minScore);
  if (!hit || !hit.id) {
    return { row: unresolved, proxyBlocked: false };
  }

  return {
    row: {
      artist: candidate.artist,
      title: candidate.title,
      resolved: true,
      mbid: hit.id,
      // Release-group first-release-date = earliest release in the group, so an
      // in-window date means a genuinely new release-group and an old date means
      // a reissue/repress. SKILL.md classifies; we only pass the fact through.
      first_release_date: hit["first-release-date"] ?? null,
      primary_type: hit["primary-type"] ?? null,
    },
    proxyBlocked: false,
  };
}

// Escape Lucene special chars and embedded quotes so a title/artist can't break
// the query (or smuggle query syntax in from untrusted research content).
function escapeLucene(s) {
  return String(s).replace(/(["\\])/g, "\\$1");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args._[0];
  if (!inputPath) fail(2, "missing <candidates.json> argument");

  const minScore = args.minScore === undefined ? 90 : Number(args.minScore);
  if (!Number.isFinite(minScore)) fail(2, `--min-score must be a number, got "${args.minScore}"`);

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
      // Host-not-allowlisted already proven on an earlier candidate — don't retry.
      results.push({
        artist: c.artist,
        title: c.title,
        resolved: false,
        mbid: null,
        first_release_date: null,
        primary_type: null,
      });
      continue;
    }

    if (i > 0 && !NO_SLEEP) await sleep(RATE_LIMIT_MS);
    const { row, proxyBlocked } = await resolveOne(c, minScore);
    results.push(row);
    if (proxyBlocked) blocked = true; // fail-fast: skip the rest
  }

  process.stdout.write(JSON.stringify(results));
}

main().catch((err) => fail(2, err?.message ?? String(err)));

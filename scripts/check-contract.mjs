#!/usr/bin/env node
// Contract linter — a merge gate for the cloud routine's *mechanical* contract.
//
// The routine fires unattended once a week, so a refactor that silently breaks
// the wiring between SKILL.md and the files it drives (a renamed script, a
// dropped config key, a template placeholder SKILL.md never fills) wouldn't
// surface until Friday's email failed to arrive. This script asserts that
// contract so such a change fails CI on the PR instead.
//
// It checks STRUCTURE, not the prose semantics of SKILL.md: a behavior change
// that keeps every reference valid still needs human review (see CLAUDE.md,
// "behavior should remain stable across refactors").
//
// Run: `node scripts/check-contract.mjs`   (exit 0 = ok, 1 = one or more failures)

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const slurp = (rel) => {
  try {
    return readFileSync(join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
};

const failures = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};

// Paths SKILL.md references that are created at run time and so are absent from a
// clean checkout (config/delivery.yaml is materialized by write-delivery.sh).
const RUNTIME_MATERIALIZED = new Set(["config/delivery.yaml"]);

const skill = slurp("SKILL.md");
if (skill === null) {
  console.error("contract: SKILL.md is missing at the repo root");
  process.exit(1);
}

// 1. Every scripts/ , config/ , templates/ path named in SKILL.md exists.
const paths = [
  ...new Set(
    (skill.match(/(?:scripts|config|templates)\/[A-Za-z0-9._\-]+/g) ?? []).map((p) =>
      p.replace(/[.,:;)]+$/, ""),
    ),
  ),
];
for (const rel of paths) {
  if (RUNTIME_MATERIALIZED.has(rel)) continue;
  check(existsSync(join(ROOT, rel)), `SKILL.md references "${rel}", which does not exist`);
}

// 2. Template placeholders: email.html and email.txt must share one placeholder
//    set, and every placeholder must be one SKILL.md fills — otherwise it ships
//    literally and trips the pre-send validation abort.
const placeholders = (s) =>
  new Set([...s.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)].map((m) => m[1]));
const html = slurp("templates/email.html");
const txt = slurp("templates/email.txt");
check(html !== null, "templates/email.html is missing");
check(txt !== null, "templates/email.txt is missing");
if (html !== null && txt !== null) {
  const h = placeholders(html);
  const t = placeholders(txt);
  const same = h.size === t.size && [...h].every((x) => t.has(x));
  check(
    same,
    `template placeholders differ — email.html: {${[...h].sort()}}, email.txt: {${[...t].sort()}}`,
  );
  const filled = placeholders(skill);
  for (const p of h) {
    check(filled.has(p), `template placeholder {{${p}}} is never filled by SKILL.md`);
  }
}

// 3. config/lastfm.yaml carries the keys SKILL.md reads. Presence check, not a
//    full YAML parse — kept zero-dependency to match the repo.
const lastfm = slurp("config/lastfm.yaml");
check(lastfm !== null, "config/lastfm.yaml is missing");
if (lastfm !== null) {
  for (const key of ["top_artists:", "recommendations:", "similar_artists:", "top_n:", "playback_lookback:", "test_mode:"]) {
    check(lastfm.includes(key), `config/lastfm.yaml is missing the "${key}" key SKILL.md reads`);
  }
}

// 4. config/delivery.yaml.example documents from/to/subject_template plus the
//    optional method switch, and the subject template keeps its {date} token.
const example = slurp("config/delivery.yaml.example");
check(example !== null, "config/delivery.yaml.example is missing");
if (example !== null) {
  for (const key of ["from:", "to:", "subject_template:", "method:"]) {
    check(example.includes(key), `config/delivery.yaml.example is missing "${key}"`);
  }
  const line = (example.match(/^\s*subject_template:.*$/m) ?? [""])[0];
  check(line.includes("{date}"), "config/delivery.yaml.example subject_template must contain the {date} token");
}

// 5. write-delivery.sh emits the same keys (including the method switch), so the
//    file it materializes is exactly what SKILL.md validates and reads.
const writeDelivery = slurp("scripts/write-delivery.sh");
check(writeDelivery !== null, "scripts/write-delivery.sh is missing");
if (writeDelivery !== null) {
  for (const key of ["from:", "to:", "subject_template:", "method:"]) {
    check(writeDelivery.includes(key), `scripts/write-delivery.sh no longer emits "${key}"`);
  }
}

// 6. send-email.mjs stays zero-dependency (the cloud clone runs it with no
//    `npm install`) and keeps its single hardcoded Resend endpoint — the
//    anti-exfil property the deny-list and SKILL.md lean on.
const sendEmail = slurp("scripts/send-email.mjs");
check(sendEmail !== null, "scripts/send-email.mjs is missing");
if (sendEmail !== null) {
  const imports = [...sendEmail.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const spec of imports) {
    check(
      spec.startsWith("node:"),
      `scripts/send-email.mjs imports "${spec}" — only node: built-ins are allowed`,
    );
  }
  check(
    sendEmail.includes("https://api.resend.com/emails"),
    "scripts/send-email.mjs must keep the hardcoded Resend endpoint",
  );
}

// 7. .claude/settings.json parses and keeps the core anti-exfil deny rules.
const settingsRaw = slurp(".claude/settings.json");
check(settingsRaw !== null, ".claude/settings.json is missing");
if (settingsRaw !== null) {
  let settings;
  try {
    settings = JSON.parse(settingsRaw);
  } catch (e) {
    check(false, `.claude/settings.json is not valid JSON: ${e.message}`);
  }
  if (settings) {
    const deny = settings?.permissions?.deny ?? [];
    for (const rule of ["Bash(curl:*)", "Bash(wget:*)"]) {
      check(deny.includes(rule), `.claude/settings.json deny-list is missing ${rule}`);
    }
  }
}

// 8. publish-digest.sh (#27) runs on every production run. Existence is covered
//    by the path scan in check 1; here we assert the two invariants the redaction
//    and safety boundary rest on — the production-only guard (so test runs
//    can never write a digest) and the push to the state repo.
const publishDigest = slurp("scripts/publish-digest.sh");
check(publishDigest !== null, "scripts/publish-digest.sh is missing");
if (publishDigest !== null) {
  check(
    /mode.*!=.*"production"|"production".*!=.*mode/.test(publishDigest),
    "scripts/publish-digest.sh dropped its production-only guard",
  );
  check(
    publishDigest.includes("git push"),
    "scripts/publish-digest.sh no longer pushes to the state repo",
  );
}

// 9. .gitignore keeps every run-data path ignored (#17/#19/#35). Run history,
//    rendered digests, and the personal feedback file live in a separate PRIVATE
//    state repo; this is the public code repo. These paths must stay ignored here
//    so listening data, picks, a recipient address, or personal taste reactions
//    can never be committed upstream — by a refactor or by accident. Each entry is
//    matched as a whole gitignore line (anchored, so "runs/" won't match a
//    "runs/keep.md" exception line).
const gitignore = slurp(".gitignore");
check(gitignore !== null, ".gitignore is missing");
if (gitignore !== null) {
  const lines = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()));
  for (const path of ["config/delivery.yaml", "config/feedback.md", "runs/", "history.jsonl", "history/", "digests/"]) {
    check(lines.has(path), `.gitignore must keep run-data path "${path}" ignored (#17/#19/#35)`);
  }
}

// 10. feedback.sh (#35) reads the personal feedback file from the private state
//     repo. Existence is covered by the path scan in check 1; here we assert the
//     two invariants the trust and fail-soft boundary rest on — it stays READ-ONLY
//     (never writes/pushes, the property that lets capture stay a human-gated PR)
//     and emits the `# feedback:` fail-soft comment so a fresh install with no
//     feedback never blocks the run.
const feedback = slurp("scripts/feedback.sh");
check(feedback !== null, "scripts/feedback.sh is missing");
if (feedback !== null) {
  check(
    !/git\s+(push|commit|add)\b/.test(feedback),
    "scripts/feedback.sh must stay read-only — it must never git add/commit/push",
  );
  check(
    feedback.includes("# feedback:"),
    "scripts/feedback.sh dropped its `# feedback:` fail-soft comment",
  );
}
// 11. phase-timing.sh (the per-phase wall-clock instrument) keeps the contract
//    SKILL.md's Finalize step parses — the `phase.` key prefix on report output —
//    and the integer guard that keeps an injected epoch token out of arithmetic
//    (mirrors run-state.sh finish). Existence is covered by the path scan in check 1.
const phaseTiming = slurp("scripts/phase-timing.sh");
check(phaseTiming !== null, "scripts/phase-timing.sh is missing");
if (phaseTiming !== null) {
  check(
    phaseTiming.includes("phase.") && /\bmark\b/.test(phaseTiming) && /\breport\b/.test(phaseTiming),
    "scripts/phase-timing.sh must keep its mark/report commands and `phase.` report prefix (SKILL.md parses it)",
  );
  check(
    phaseTiming.includes("^[0-9]+$"),
    "scripts/phase-timing.sh dropped the integer guard on epoch input",
  );
}

// 12. Test-mode window anchoring: run-state.sh emits `last_friday` and SKILL.md
//     keys its release window off `<release_anchor>` / `<last_friday>`. Without
//     this wiring a mid-week test run evaluates the empty `(last Friday, today]`
//     gap, surfaces zero in-window picks, and aborts before the send — so the
//     smoke test can never verify delivery. Lock the contract.
const runState = slurp("scripts/run-state.sh");
check(runState !== null, "scripts/run-state.sh is missing");
if (runState !== null) {
  check(
    runState.includes("last_friday="),
    "scripts/run-state.sh no longer emits last_friday (SKILL.md anchors the test window to it)",
  );
}
check(
  skill.includes("<release_anchor>") && skill.includes("<last_friday>"),
  "SKILL.md no longer anchors its release window to <release_anchor>/<last_friday>",
);

// 13. musicbrainz.mjs (#51) stays zero-dependency (the cloud clone runs it with
//     no `npm install`) and keeps its single hardcoded MusicBrainz host plus a
//     descriptive User-Agent (MB rejects generic agents) — the same narrow-endpoint
//     / anti-exfil property as send-email.mjs. Existence is covered by check 1.
const musicbrainz = slurp("scripts/musicbrainz.mjs");
check(musicbrainz !== null, "scripts/musicbrainz.mjs is missing");
if (musicbrainz !== null) {
  const imports = [...musicbrainz.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const spec of imports) {
    check(
      spec.startsWith("node:"),
      `scripts/musicbrainz.mjs imports "${spec}" — only node: built-ins are allowed`,
    );
  }
  check(
    musicbrainz.includes("https://musicbrainz.org/ws/2"),
    "scripts/musicbrainz.mjs must keep the hardcoded MusicBrainz host",
  );
  check(
    /User-Agent/.test(musicbrainz),
    "scripts/musicbrainz.mjs must send a descriptive User-Agent (MusicBrainz rejects generic agents)",
  );
}

// 14. config/musicbrainz.yaml (#51, #58, #61) carries the keys SKILL.md reads.
//     Presence check, not a full YAML parse — kept zero-dependency to match the
//     repo. The Phase 2 enrichment switches (enrich_labels / enrich_credits) gate
//     the extra per-candidate lookups SKILL.md drives in *Verify candidates*.
const mbConfig = slurp("config/musicbrainz.yaml");
check(mbConfig !== null, "config/musicbrainz.yaml is missing");
if (mbConfig !== null) {
  for (const key of ["enabled:", "min_score:", "enrich_labels:", "enrich_credits:", "coverage_probe:"]) {
    check(mbConfig.includes(key), `config/musicbrainz.yaml is missing the "${key}" key SKILL.md reads`);
  }
}

// 15. report-test.sh (the routine-test feedback loop's producer) runs on every
//     TEST run. Existence is covered by the path scan in check 1; here we assert
//     the two invariants its safety boundary rests on — the MIRROR-IMAGE guard
//     (test-only, so a production run can never write a test result, the inverse
//     of publish-digest.sh's production-only guard) and the push to the state repo.
const reportTest = slurp("scripts/report-test.sh");
check(reportTest !== null, "scripts/report-test.sh is missing");
if (reportTest !== null) {
  check(
    /mode\s*!==?\s*"test"|"test"\s*!==?\s*mode/.test(reportTest),
    "scripts/report-test.sh dropped its test-only guard",
  );
  check(
    reportTest.includes("git push"),
    "scripts/report-test.sh no longer pushes to the state repo",
  );
}

// 16. The config-fail verdict (issue #66) must stay wired end to end: the
//     classifier emits it from send_error=host-not-allowlisted, and the reconciler
//     workflow must have a matching case — otherwise a refused-send result falls
//     through to the "unknown verdict; skipping" branch and reports nothing.
const classify = slurp("scripts/classify-test-run.mjs");
const reportWorkflow = slurp(".github/workflows/routine-test-report.yml");
if (classify !== null && reportWorkflow !== null) {
  const emitsConfigFail = classify.includes('verdict: "config-fail"');
  check(emitsConfigFail, "classify-test-run.mjs no longer emits the config-fail verdict (#66)");
  check(
    classify.includes("host-not-allowlisted"),
    "classify-test-run.mjs no longer keys config-fail on send_error=host-not-allowlisted (#66)",
  );
  check(
    !emitsConfigFail || /\bconfig-fail\)/.test(reportWorkflow),
    "routine-test-report.yml is missing a config-fail) case for the verdict classify-test-run.mjs can emit (#66)",
  );
}

// 17. config/blocklist.yaml (#55) carries the keys SKILL.md's "Apply the
//     blocklist" step reads. Presence check, not a full YAML parse — kept
//     zero-dependency to match the repo. Existence is covered by the path scan in
//     check 1; this asserts the two list keys the hard-filter step depends on.
const blocklist = slurp("config/blocklist.yaml");
check(blocklist !== null, "config/blocklist.yaml is missing");
if (blocklist !== null) {
  for (const key of ["artists:", "tracks:"]) {
    check(blocklist.includes(key), `config/blocklist.yaml is missing the "${key}" key SKILL.md reads`);
  }
}

// 18. The pluggable taste seam (#50). config/taste.yaml carries the `source`
//     selector SKILL.md branches on; config/spotify.yaml carries the keys the
//     spotify branch reads; and scripts/spotify.mjs keeps the same containment
//     contract as send-email.mjs/musicbrainz.mjs — zero-dependency, only its
//     two hardcoded Spotify hosts — plus the loud-failure `spotify_error=`
//     marker SKILL.md's abort path and meta notes key off.
const taste = slurp("config/taste.yaml");
check(taste !== null, "config/taste.yaml is missing");
if (taste !== null) {
  check(taste.includes("source:"), 'config/taste.yaml is missing the "source:" key SKILL.md reads');
}
check(skill.includes("<taste_source>"), "SKILL.md no longer branches on <taste_source> (#50)");
const spotifyConfig = slurp("config/spotify.yaml");
check(spotifyConfig !== null, "config/spotify.yaml is missing");
if (spotifyConfig !== null) {
  for (const key of ["top_items:", "recently_played:", "saved_library:", "followed_artists:", "test_mode:"]) {
    check(spotifyConfig.includes(key), `config/spotify.yaml is missing the "${key}" key SKILL.md reads`);
  }
}
const spotify = slurp("scripts/spotify.mjs");
check(spotify !== null, "scripts/spotify.mjs is missing");
if (spotify !== null) {
  const imports = [...spotify.matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const spec of imports) {
    check(
      spec.startsWith("node:"),
      `scripts/spotify.mjs imports "${spec}" — only node: built-ins are allowed`,
    );
  }
  for (const host of ["https://accounts.spotify.com", "https://api.spotify.com"]) {
    check(spotify.includes(host), `scripts/spotify.mjs must keep the hardcoded host ${host}`);
  }
  check(
    spotify.includes("spotify_error="),
    "scripts/spotify.mjs dropped its spotify_error= failure marker (SKILL.md aborts on it)",
  );
}

if (failures.length > 0) {
  console.error(`contract check FAILED — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`contract check passed (${paths.length} referenced paths resolved)`);

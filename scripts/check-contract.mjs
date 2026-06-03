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
  for (const key of ["top_artists:", "recommendations:", "similar_artists:", "top_n:", "test_mode:"]) {
    check(lastfm.includes(key), `config/lastfm.yaml is missing the "${key}" key SKILL.md reads`);
  }
}

// 4. config/delivery.yaml.example documents from/to/subject_template, and the
//    subject template keeps its {date} token.
const example = slurp("config/delivery.yaml.example");
check(example !== null, "config/delivery.yaml.example is missing");
if (example !== null) {
  for (const key of ["from:", "to:", "subject_template:"]) {
    check(example.includes(key), `config/delivery.yaml.example is missing "${key}"`);
  }
  const line = (example.match(/^\s*subject_template:.*$/m) ?? [""])[0];
  check(line.includes("{date}"), "config/delivery.yaml.example subject_template must contain the {date} token");
}

// 5. write-delivery.sh emits the same three keys, so the file it materializes is
//    exactly what SKILL.md validates and reads.
const writeDelivery = slurp("scripts/write-delivery.sh");
check(writeDelivery !== null, "scripts/write-delivery.sh is missing");
if (writeDelivery !== null) {
  for (const key of ["from:", "to:", "subject_template:"]) {
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

// 9. .gitignore keeps every run-data path ignored (#17/#19). Run history and
//    rendered digests live in a separate PRIVATE state repo; this is the public
//    code repo. These paths must stay ignored here so listening data, picks, or a
//    recipient address can never be committed upstream — by a refactor or by
//    accident. Each entry is matched as a whole gitignore line (anchored, so
//    "runs/" won't match a "runs/keep.md" exception line).
const gitignore = slurp(".gitignore");
check(gitignore !== null, ".gitignore is missing");
if (gitignore !== null) {
  const lines = new Set(gitignore.split(/\r?\n/).map((l) => l.trim()));
  for (const path of ["config/delivery.yaml", "runs/", "history.jsonl", "history/", "digests/"]) {
    check(lines.has(path), `.gitignore must keep run-data path "${path}" ignored (#17/#19)`);
  }
}

if (failures.length > 0) {
  console.error(`contract check FAILED — ${failures.length} problem(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`contract check passed (${paths.length} referenced paths resolved)`);

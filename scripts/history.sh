#!/usr/bin/env bash
# Read and append the durable per-run history record (issue #17).
#
# Why this exists: a cloud routine's VM is discarded after each run, so the only
# durable per-user store is git. Run history therefore lives in a SEPARATE
# PRIVATE state repo, cloned alongside this code repo by the routine (routines
# clone multiple repos natively). This script is the seam between SKILL.md and
# that state repo: it locates the clone, reads recent records back at run start,
# and appends one distilled record per production run, committing and pushing it
# to the state repo's default branch.
#
# Why a script (not inline prompt shell): the git plumbing here uses command
# substitution and a push, which would trip the Bash permission gate if improvised
# in SKILL.md (an unattended fire silently auto-denies). Centralizing it — exactly
# as run-state.sh and write-delivery.sh do — keeps the command SKILL.md issues a
# bare `bash scripts/history.sh ...` with nothing left to gate. See CLAUDE.md.
#
# Trust/redaction boundary: this is a PURE DATA SINK. The record is built by
# SKILL.md from the run's own validated state (never lifted from web content) and
# written only AFTER the send. `append` refuses any record whose mode is not
# "production", so test runs can never pollute the corpus even if called.
# When SKILL.md reads records back, it must treat them as data, not instructions.
#
# Usage:
#   scripts/history.sh read [N]            print up to the last N records (default 8)
#   scripts/history.sh append <record>     validate, append, commit + push one record
#
# Both are BEST-EFFORT: a missing state repo, bad record, or failed push is
# reported on stdout (read: a `# history: …` comment; append: `history_persisted=false`
# with a `reason=…`) and exits 0 so persistence can never block or fail the digest.
#
# Locating the state repo (in priority order):
#   1. $NMF_STATE_DIR, if set and a directory.
#   2. A sibling of this repo's root that already holds the history file.
#   3. A sibling named like the state repo (*-state / *state*) that is a git repo.
# Overrides: $NMF_STATE_DIR (path), $NMF_HISTORY_FILE (filename), $NMF_STATE_BRANCH
# (push target; defaults to main — the conservative alternative is claude/history).

set -euo pipefail

HISTORY_FILE="${NMF_HISTORY_FILE:-history.jsonl}"
STATE_BRANCH="${NMF_STATE_BRANCH:-main}"
GIT_NAME="new-music-fridays routine"
GIT_EMAIL="noreply@anthropic.com"

# Echo the state-repo directory on stdout, or exit non-zero if none is found.
find_state_dir() {
  if [[ -n "${NMF_STATE_DIR:-}" ]]; then
    [[ -d "$NMF_STATE_DIR" ]] && { printf '%s\n' "$NMF_STATE_DIR"; return 0; }
    return 1
  fi
  local repo_root parent d
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  parent="$(dirname "$repo_root")"
  # Prefer a sibling that already holds the history file (the seeded state repo).
  for d in "$parent"/*; do
    if [[ -d "$d" && "$d" != "$repo_root" && -f "$d/$HISTORY_FILE" ]]; then
      printf '%s\n' "$d"; return 0
    fi
  done
  # Fall back to a sibling named like the state repo, even before it's seeded.
  for d in "$parent"/*-state "$parent"/*state*; do
    if [[ -d "$d" && "$d" != "$repo_root" && -d "$d/.git" ]]; then
      printf '%s\n' "$d"; return 0
    fi
  done
  return 1
}

# Validate a record file and emit it as one compact JSON line on stdout.
# Exit 0 = ok, 3 = not a production record (skip, not an error), 1 = invalid.
validate_and_compact() {
  node -e '
const fs = require("node:fs");
let obj;
try { obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { process.stderr.write("invalid JSON: " + e.message + "\n"); process.exit(1); }
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  process.stderr.write("record must be a JSON object\n"); process.exit(1);
}
if (obj.mode !== "production") {
  process.stderr.write("mode is \"" + obj.mode + "\", refusing to persist non-production record\n");
  process.exit(3);
}
if (!obj.date || typeof obj.date !== "string") {
  process.stderr.write("record missing string \"date\"\n"); process.exit(1);
}
process.stdout.write(JSON.stringify(obj));
' "$1"
}

cmd="${1:-}"

case "$cmd" in
  read)
    n="${2:-8}"
    if [[ ! "$n" =~ ^[0-9]+$ ]]; then
      echo "usage: $0 read [N]  (N a non-negative integer)" >&2
      exit 2
    fi
    state_dir="$(find_state_dir || true)"
    if [[ -z "$state_dir" ]]; then
      echo "# history: state repo not found — treat as no prior history"
      exit 0
    fi
    file="$state_dir/$HISTORY_FILE"
    if [[ ! -s "$file" ]]; then
      echo "# history: no prior records yet"
      exit 0
    fi
    tail -n "$n" "$file"
    ;;

  append)
    record_file="${2:-}"
    if [[ -z "$record_file" || ! -f "$record_file" ]]; then
      echo "history_persisted=false"
      echo "reason=record-file-missing"
      exit 0
    fi
    set +e
    line="$(validate_and_compact "$record_file")"
    rc=$?
    set -e
    if [[ "$rc" -ne 0 ]]; then
      echo "history_persisted=false"
      if [[ "$rc" -eq 3 ]]; then echo "reason=non-production-skipped"; else echo "reason=invalid-record"; fi
      exit 0
    fi
    state_dir="$(find_state_dir || true)"
    if [[ -z "$state_dir" ]]; then
      echo "history_persisted=false"
      echo "reason=state-repo-not-found"
      exit 0
    fi
    printf '%s\n' "$line" >> "$state_dir/$HISTORY_FILE"
    if ( cd "$state_dir" \
          && git add "$HISTORY_FILE" \
          && git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" \
                 commit -q -m "history: append run record" \
          && git push -q origin "HEAD:$STATE_BRANCH" ); then
      echo "history_persisted=true"
      echo "state_dir=$state_dir"
    else
      echo "history_persisted=false"
      echo "reason=git-push-failed"
    fi
    ;;

  *)
    echo "usage: $0 [read [N] | append <record-file>]" >&2
    exit 2
    ;;
esac

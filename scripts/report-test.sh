#!/usr/bin/env bash
# Record a test run's outcome to the private state repo so a trusted CI
# reconciler can report it back on the PR that triggered the run (issue: closing
# the routine-test feedback loop).
#
# Why this exists: a `routine-test`-labeled merge fires a post-merge cloud routine
# run, but the run reports nothing back to GitHub — a green run only lived in the
# session transcript. This script is the producer half of the feedback loop: it
# drops one small JSON result per TEST run into the state repo and pushes it, on
# the SAME git-push seam history.sh/publish-digest.sh already use (no API egress,
# no token in the run). A scheduled Action in the code repo (routine-test-report.yml)
# then reconciles each result onto its PR — comment + label on pass, comment +
# label + revert PR on a hard failure.
#
# Why a script (not inline prompt shell): like history.sh, the git plumbing and
# `git rev-parse` here use command substitution and a push that would trip the
# Bash permission gate if improvised in SKILL.md (an unattended fire silently
# auto-denies). Centralizing it keeps the command SKILL.md issues a bare
# `bash scripts/report-test.sh ...`. See CLAUDE.md.
#
# Trust/redaction boundary: this is the MIRROR IMAGE of history.sh/publish-digest.sh.
# Those refuse any mode that is not "production"; this one refuses any mode that
# is not "test", so a stray flag on a production run can never write a test result
# (and the durable corpus and the digest store stay test-free). The result is
# built by SKILL.md from the run's own validated state (never lifted from web
# content); it carries only mechanical pass/fail signals, no listening data,
# picks, or recipient address.
#
# Usage:
#   scripts/report-test.sh <result-file>   validate, stamp head_sha, push one result
#
# BEST-EFFORT: a missing/invalid result, missing state repo, or failed push is
# reported on stdout (`test_reported=false` with a `reason=…`) and exits 0, so
# reporting can never block or fail the run.
#
# Locating the state repo (same priority order as history.sh):
#   1. $NMF_STATE_DIR, if set and a directory.
#   2. A sibling of this repo's root that already holds the history file.
#   3. A sibling named like the state repo (*-state / *state*) that is a git repo.
# Overrides: $NMF_STATE_DIR (path), $NMF_HISTORY_FILE (the seed file discovery
# keys on), $NMF_TEST_RUNS_DIR (subdir; defaults to test-runs), $NMF_STATE_BRANCH
# (push target; defaults to main — matches where the routine clones from).

set -euo pipefail

HISTORY_FILE="${NMF_HISTORY_FILE:-history.jsonl}"
TEST_RUNS_DIR="${NMF_TEST_RUNS_DIR:-test-runs}"
STATE_BRANCH="${NMF_STATE_BRANCH:-main}"
GIT_NAME="new-music-fridays routine"
GIT_EMAIL="noreply@anthropic.com"

# Repo root of THIS code repo (where the routine clones the change under test);
# its HEAD is the merge commit the reconciler joins on.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Echo the state-repo directory on stdout, or exit non-zero if none is found.
# Mirrors history.sh::find_state_dir so the three locate the same clone.
find_state_dir() {
  if [[ -n "${NMF_STATE_DIR:-}" ]]; then
    [[ -d "$NMF_STATE_DIR" ]] && { printf '%s\n' "$NMF_STATE_DIR"; return 0; }
    return 1
  fi
  local parent d
  parent="$(dirname "$REPO_ROOT")"
  # Prefer a sibling that already holds the history file (the seeded state repo).
  for d in "$parent"/*; do
    if [[ -d "$d" && "$d" != "$REPO_ROOT" && -f "$d/$HISTORY_FILE" ]]; then
      printf '%s\n' "$d"; return 0
    fi
  done
  # Fall back to a sibling named like the state repo, even before it's seeded.
  for d in "$parent"/*-state "$parent"/*state*; do
    if [[ -d "$d" && "$d" != "$REPO_ROOT" && -d "$d/.git" ]]; then
      printf '%s\n' "$d"; return 0
    fi
  done
  return 1
}

# Validate a result file, stamp head_sha + reported_at, emit one compact JSON line.
# Exit 0 = ok, 3 = not a test result (skip, not an error), 1 = invalid.
validate_and_stamp() {
  node -e '
const fs = require("node:fs");
let obj;
try { obj = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
catch (e) { process.stderr.write("invalid JSON: " + e.message + "\n"); process.exit(1); }
if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
  process.stderr.write("result must be a JSON object\n"); process.exit(1);
}
if (obj.mode !== "test") {
  process.stderr.write("mode is \"" + obj.mode + "\", refusing to record non-test result\n");
  process.exit(3);
}
if (typeof obj.validation_passed !== "boolean") {
  process.stderr.write("result missing boolean \"validation_passed\"\n"); process.exit(1);
}
obj.head_sha = process.argv[2];
obj.reported_at = process.argv[3];
process.stdout.write(JSON.stringify(obj));
' "$1" "$2" "$3"
}

record_file="${1:-}"
if [[ -z "$record_file" || ! -f "$record_file" ]]; then
  echo "test_reported=false"
  echo "reason=result-file-missing"
  exit 0
fi

# The merge SHA the reconciler joins the PR on. Inside this allowlisted script so
# the command substitution never reaches the Bash gate.
head_sha="$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || true)"
if [[ -z "$head_sha" ]]; then
  echo "test_reported=false"
  echo "reason=no-head-sha"
  exit 0
fi
reported_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

set +e
line="$(validate_and_stamp "$record_file" "$head_sha" "$reported_at")"
rc=$?
set -e
if [[ "$rc" -ne 0 ]]; then
  echo "test_reported=false"
  if [[ "$rc" -eq 3 ]]; then echo "reason=non-test-skipped"; else echo "reason=invalid-result"; fi
  exit 0
fi

state_dir="$(find_state_dir || true)"
if [[ -z "$state_dir" ]]; then
  echo "test_reported=false"
  echo "reason=state-repo-not-found"
  exit 0
fi

dest="$state_dir/$TEST_RUNS_DIR/$head_sha.json"
mkdir -p "$state_dir/$TEST_RUNS_DIR"
printf '%s\n' "$line" > "$dest"
if ( cd "$state_dir" \
      && git add "$TEST_RUNS_DIR/$head_sha.json" \
      && git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" \
             commit -q -m "test-run: record outcome for $head_sha" \
      && git push -q origin "HEAD:$STATE_BRANCH" ); then
  echo "test_reported=true"
  echo "state_dir=$state_dir"
  echo "test_run_path=$TEST_RUNS_DIR/$head_sha.json"
else
  echo "test_reported=false"
  echo "reason=git-push-failed"
fi

#!/usr/bin/env bash
# Read the durable, append-only feedback file from the private state repo (issue #35).
#
# Why this exists: feedback.md holds the user's personal taste reactions to past
# picks. Before the code repo went public (#19) it lived here, tracked — which
# would have leaked those reactions and been inherited by every forker. It now
# lives in the SAME private state repo the #17 history and #27 digests use, cloned
# alongside this code repo by the routine. This script is the read seam between
# SKILL.md (Incorporate feedback) and that state repo: it locates the clone and
# prints the file so the run can fold the steer in before searching. The public
# code repo carries only config/feedback.example.md, showing the format.
#
# Why a script (not inline prompt shell): mirroring history.sh / publish-digest.sh,
# the state-repo discovery uses command substitution that would trip the Bash
# permission gate if improvised in SKILL.md (an unattended fire silently
# auto-denies). Centralizing it keeps the command SKILL.md issues a bare
# `bash scripts/feedback.sh read`. See CLAUDE.md.
#
# Trust boundary: feedback is TRUSTED input — author-written, only ever reaching
# the state repo's main through a merged PR (the resumed-agent capture protocol in
# SKILL.md's "Capturing feedback (post-run)"), never written by the unattended
# production fire. Note the honest caveat: the state repo has unrestricted pushes
# ON (so the routine can append history), so this is human-gated by CONVENTION
# rather than by branch protection — accepted as low residual risk (see #35 and
# CLAUDE.md). This script only ever READS; it never writes.
#
# Usage:
#   scripts/feedback.sh read     print the state repo's feedback.md (whole file)
#
# BEST-EFFORT: a missing state repo or missing file is reported on stdout (a
# `# feedback: …` comment) and exits 0, so a fresh install with no feedback yet
# never blocks the run.
#
# Locating the state repo (same priority order as history.sh / publish-digest.sh):
#   1. $NMF_STATE_DIR, if set and a directory.
#   2. A sibling of this repo's root that already holds the history file.
#   3. A sibling named like the state repo (*-state / *state*) that is a git repo.
# Overrides: $NMF_STATE_DIR (path), $NMF_HISTORY_FILE (the seed file discovery
# keys on), $NMF_FEEDBACK_FILE (filename; defaults to feedback.md).

set -euo pipefail

HISTORY_FILE="${NMF_HISTORY_FILE:-history.jsonl}"
FEEDBACK_FILE="${NMF_FEEDBACK_FILE:-feedback.md}"

# Echo the state-repo directory on stdout, or exit non-zero if none is found.
# Mirrors history.sh::find_state_dir so all three scripts locate the same clone.
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

cmd="${1:-}"

case "$cmd" in
  read)
    state_dir="$(find_state_dir || true)"
    if [[ -z "$state_dir" ]]; then
      echo "# feedback: state repo not found — treat as no feedback on file"
      exit 0
    fi
    file="$state_dir/$FEEDBACK_FILE"
    if [[ ! -s "$file" ]]; then
      echo "# feedback: no feedback on file yet"
      exit 0
    fi
    cat "$file"
    ;;

  *)
    echo "usage: $0 read" >&2
    exit 2
    ;;
esac

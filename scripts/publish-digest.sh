#!/usr/bin/env bash
# Publish the rendered digest to the private state repo (issue #27).
#
# Why this exists: a cloud routine session exposes no file-download surface — the
# VM is discarded after each run, so `runs/<date>/` is gone and only the session
# transcript survives (as text). The one durable, downloadable artifact is a file
# committed to Git. This script is the opt-in seam that drops the rendered email
# bodies into the SAME private state repo the #17 history already uses, under a
# `digests/<date>/` path, committing and pushing them to its default branch.
#
# Why a script (not inline prompt shell): like history.sh, the git plumbing here
# uses a push that would trip the Bash permission gate if improvised in SKILL.md
# (an unattended fire silently auto-denies). Centralizing it keeps the command
# SKILL.md issues a bare `bash scripts/publish-digest.sh ...`. See CLAUDE.md.
#
# Trust/redaction boundary: persist the RENDERED DIGEST ONLY — never the whole
# `runs/` tree. The email bodies carry no raw Last.fm data, listening profile,
# play counts, or recipient address; the full run directory does. Keeping raw
# listening data out of durable storage bounds the blast radius if the private
# repo's access is ever widened or leaked (the explicit decision behind #26).
# `publish` refuses any mode that is not "production", so test runs can never
# write to the corpus even if the step is reached in error.
#
# Usage:
#   scripts/publish-digest.sh <mode> <date> <html-file> <text-file>
#
# BEST-EFFORT: a missing source file, missing state repo, or failed push is
# reported on stdout (`digest_published=false` with a `reason=…`) and exits 0, so
# publishing can never block or fail the digest send (which already happened).
#
# Locating the state repo (same priority order as history.sh):
#   1. $NMF_STATE_DIR, if set and a directory.
#   2. A sibling of this repo's root that already holds the history file.
#   3. A sibling named like the state repo (*-state / *state*) that is a git repo.
# Overrides: $NMF_STATE_DIR (path), $NMF_HISTORY_FILE (the seed file discovery
# keys on), $NMF_DIGEST_DIR (subdir; defaults to digests), $NMF_STATE_BRANCH
# (push target; defaults to main — the conservative alternative is claude/history).

set -euo pipefail

HISTORY_FILE="${NMF_HISTORY_FILE:-history.jsonl}"
DIGEST_DIR="${NMF_DIGEST_DIR:-digests}"
STATE_BRANCH="${NMF_STATE_BRANCH:-main}"
GIT_NAME="new-music-fridays routine"
GIT_EMAIL="noreply@anthropic.com"

# Echo the state-repo directory on stdout, or exit non-zero if none is found.
# Mirrors history.sh::find_state_dir so the two locate the same clone.
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

mode="${1:-}"
date="${2:-}"
html_file="${3:-}"
text_file="${4:-}"

if [[ -z "$mode" || -z "$date" || -z "$html_file" || -z "$text_file" ]]; then
  echo "usage: $0 <mode> <date> <html-file> <text-file>" >&2
  exit 2
fi

# Production-only mechanical safeguard — the corpus stays clean even if SKILL.md
# reaches this in a test run by mistake.
if [[ "$mode" != "production" ]]; then
  echo "digest_published=false"
  echo "reason=non-production-skipped"
  exit 0
fi

if [[ ! -f "$html_file" || ! -f "$text_file" ]]; then
  echo "digest_published=false"
  echo "reason=digest-file-missing"
  exit 0
fi

state_dir="$(find_state_dir || true)"
if [[ -z "$state_dir" ]]; then
  echo "digest_published=false"
  echo "reason=state-repo-not-found"
  exit 0
fi

dest="$state_dir/$DIGEST_DIR/$date"
mkdir -p "$dest"
cp "$html_file" "$dest/email.html"
cp "$text_file" "$dest/email.txt"

if ( cd "$state_dir" \
      && git add "$DIGEST_DIR/$date/email.html" "$DIGEST_DIR/$date/email.txt" \
      && git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" \
             commit -q -m "digest: publish $date" \
      && git push -q origin "HEAD:$STATE_BRANCH" ); then
  echo "digest_published=true"
  echo "state_dir=$state_dir"
  echo "digest_path=$DIGEST_DIR/$date"
else
  echo "digest_published=false"
  echo "reason=git-push-failed"
fi

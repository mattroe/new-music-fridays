#!/usr/bin/env bash
# Emit run-state values for SKILL.md's "Set up run state" and "Finalize run log"
# steps in a stable, parseable `key=value` form.
#
# Why this exists: SKILL.md used to describe these values in prose ("determine
# today's date", "e.g. via date -u +..."), leaving the runtime to improvise the
# shell. The model would sometimes bundle them into an `echo "...$(date)..."`
# one-liner, which contains command substitution and so trips the Bash
# permission gate — interactive runs ("Run now") prompt for approval, and a true
# unattended scheduled fire silently auto-denies — either way stalling or
# degrading Friday's run. Centralizing the logic here keeps every date / env /
# arithmetic expansion *inside* one allowlisted script invocation, so the command
# the runtime actually issues is just `bash scripts/run-state.sh ...` with no
# inline expansion left to gate. Allowlist it once and the run stays hands-off.
#
# Usage:
#   scripts/run-state.sh start                  emit run-mode env + start stamps
#   scripts/run-state.sh finish <started_epoch>  emit finish stamp + duration
#
# Output (stdout, one key=value per line):
#   start  -> NMF_FAST, NMF_TEST, today, weekday, started_at, started_epoch
#   finish -> finished_at, duration_seconds
#
# `started_epoch` from `start` is passed back verbatim to `finish` so the
# duration subtraction happens here rather than as improvised shell arithmetic.

set -euo pipefail

cmd="${1:-}"

case "$cmd" in
  start)
    printf 'NMF_FAST=%s\n'      "${NMF_FAST:-}"
    printf 'NMF_TEST=%s\n'      "${NMF_TEST:-}"
    printf 'today=%s\n'         "$(date +%Y-%m-%d)"
    printf 'weekday=%s\n'       "$(date +%A)"
    printf 'started_at=%s\n'    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'started_epoch=%s\n' "$(date +%s)"
    ;;
  finish)
    started_epoch="${2:-}"
    if [[ -z "$started_epoch" ]]; then
      echo "usage: $0 finish <started_epoch>" >&2
      exit 2
    fi
    now_epoch="$(date +%s)"
    printf 'finished_at=%s\n'      "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'duration_seconds=%s\n' "$(( now_epoch - started_epoch ))"
    ;;
  *)
    echo "usage: $0 [start | finish <started_epoch>]" >&2
    exit 2
    ;;
esac

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
#   start  -> NMF_TEST, today, weekday, last_friday, started_at, started_epoch
#   finish -> finished_at, duration_seconds
#
# `started_epoch` from `start` is passed back verbatim to `finish` so the
# duration subtraction happens here rather than as improvised shell arithmetic.

set -euo pipefail

# Anchor every date below to the user's local timezone, not the VM's. The cloud
# routine's VM runs on UTC, so a Friday-evening "Run now" past ~17:00 Pacific has
# already rolled over to Saturday in UTC — `date +%Y-%m-%d` then stamps the digest
# (and its window, run dir, and history record) a day late (Fri 06-05 shown as
# 06-06). Forcing TZ here makes `today`/`weekday`/`last_friday` compute in the
# user's calendar day, so a Friday run is dated Friday regardless of fire time.
# Committed default is the single-user owner's zone; a forker overrides via the
# NMF_TZ routine env var (same env-driven pattern as NMF_TEST), no file edit.
export TZ="${NMF_TZ:-America/Los_Angeles}"

cmd="${1:-}"

case "$cmd" in
  start)
    printf 'NMF_TEST=%s\n'      "${NMF_TEST:-}"
    printf 'today=%s\n'         "$(date +%Y-%m-%d)"
    printf 'weekday=%s\n'       "$(date +%A)"
    # Most recent Friday on or before today (== today when today is Friday). The
    # test-mode release window anchors to this so a run fired any weekday still
    # evaluates a complete NMF drop instead of the empty gap between Fridays;
    # production anchors to `today` (a Friday) and gets the same value. ISO
    # weekday `%u` is 1..7 (Fri=5) on both GNU and BSD date; only the day
    # subtraction differs, so branch on which `date` is present. The math stays
    # inside this allowlisted script for the same reason the duration does.
    u="$(date +%u)"
    back=$(( (u - 5 + 7) % 7 ))
    if date -d @0 >/dev/null 2>&1; then
      last_friday="$(date -d "-${back} days" +%Y-%m-%d)"   # GNU (the cloud runtime)
    else
      last_friday="$(date -v-"${back}"d +%Y-%m-%d)"         # BSD (macOS dev/test)
    fi
    printf 'last_friday=%s\n'   "$last_friday"
    printf 'started_at=%s\n'    "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'started_epoch=%s\n' "$(date +%s)"
    ;;
  finish)
    started_epoch="${2:-}"
    # Validate as a non-negative integer BEFORE any arithmetic use. Bash $(( ))
    # performs command substitution inside array subscripts, so an unvalidated
    # value like 'now_epoch[$(cmd)]' would execute cmd — arbitrary code exec that
    # bypasses the permissions.deny list when this allowlisted script is invoked
    # by an injected agent. The ^[0-9]+$ guard admits only digits, closing it.
    if [[ ! "$started_epoch" =~ ^[0-9]+$ ]]; then
      echo "usage: $0 finish <epoch-seconds>  (non-negative integer)" >&2
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

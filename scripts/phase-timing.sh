#!/usr/bin/env bash
# Per-phase wall-clock timing for SKILL.md. Companion to run-state.sh, and here
# for the same reason (see run-state.sh's header and CLAUDE.md's run-state
# gotcha): keep every `date`/arithmetic expansion *inside* one allowlisted
# script, so the command the runtime issues is just `bash scripts/phase-timing.sh
# ...` with no inline `$(date)` / `$(( ))` left to trip the Bash permission gate.
#
# SKILL.md calls `mark` at the start of each phase, then `report` at finalize;
# the per-phase durations land in meta.json.phase_seconds so every run
# self-reports where wall-clock went — no transcript guesswork.
#
# Usage:
#   phase-timing.sh mark <run_dir> <label> [epoch]   record a phase boundary
#   phase-timing.sh report <run_dir> [now_epoch]     emit per-phase + total seconds
#
# State: appends "<epoch>\t<label>" lines to <run_dir>/phase-timings.tsv (internal
# scratch in the ephemeral run dir). `report` attributes the gap between two
# consecutive marks to the EARLIER mark's label, and uses `now` (or the optional
# [now_epoch], for deterministic tests) as the end of the final phase. Durations
# for a repeated label are summed. The optional [epoch] arg on `mark` exists for
# the same test-injection reason run-state.sh finish takes one.
#
# Output (report, stdout, one key=value per line; a `# phase-timing: ...` comment
# and exit 0 when there's nothing to report, so finalize never breaks):
#   phase.<label>=<seconds>   (one per distinct label, in first-seen order)
#   phase.total=<seconds>     (now - first mark)
#
# The math runs in awk, not shell `$(( ))`: awk does no command substitution, so
# a non-integer epoch token in the marks file can never become code execution
# (the run-state finish guard closes the same hole for its single subtraction).

set -euo pipefail

cmd="${1:-}"

case "$cmd" in
  mark)
    run_dir="${2:-}"
    label="${3:-}"
    epoch="${4:-$(date +%s)}"
    if [[ -z "$run_dir" || ! "$label" =~ ^[a-z0-9_]+$ ]]; then
      echo "usage: $0 mark <run_dir> <label[a-z0-9_]> [epoch]" >&2
      exit 2
    fi
    if [[ ! "$epoch" =~ ^[0-9]+$ ]]; then
      echo "usage: $0 mark <run_dir> <label> [epoch]  (epoch must be a non-negative integer)" >&2
      exit 2
    fi
    mkdir -p "$run_dir"
    printf '%s\t%s\n' "$epoch" "$label" >> "$run_dir/phase-timings.tsv"
    printf 'marked=%s\n' "$label"
    ;;
  report)
    run_dir="${2:-}"
    now_epoch="${3:-$(date +%s)}"
    marks="$run_dir/phase-timings.tsv"
    if [[ -z "$run_dir" || ! -f "$marks" ]]; then
      echo "# phase-timing: no marks recorded"
      exit 0
    fi
    if [[ ! "$now_epoch" =~ ^[0-9]+$ ]]; then
      echo "usage: $0 report <run_dir> [now_epoch]  (now_epoch must be a non-negative integer)" >&2
      exit 2
    fi
    awk -F'\t' -v now="$now_epoch" '
      BEGIN { n = 0; oc = 0 }
      $1 ~ /^[0-9]+$/ && $2 ~ /^[a-z0-9_]+$/ { ep[n] = $1; lab[n] = $2; n++ }
      END {
        if (n == 0) { print "# phase-timing: no valid marks recorded"; exit 0 }
        for (i = 0; i < n; i++) {
          end = (i + 1 < n) ? ep[i + 1] : now
          d = end - ep[i]
          if (d < 0) d = 0
          if (!(lab[i] in seen)) { order[oc++] = lab[i]; seen[lab[i]] = 1 }
          sum[lab[i]] += d
        }
        for (j = 0; j < oc; j++) printf "phase.%s=%d\n", order[j], sum[order[j]]
        printf "phase.total=%d\n", now - ep[0]
      }
    ' "$marks"
    ;;
  *)
    echo "usage: $0 [mark <run_dir> <label> [epoch] | report <run_dir> [now_epoch]]" >&2
    exit 2
    ;;
esac

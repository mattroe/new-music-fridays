#!/usr/bin/env bash
# Sum Claude Code API token usage from the most recent session JSONL for this project.
#
# Claude Code writes per-message usage records to ~/.claude/projects/<encoded-path>/<session-id>.jsonl,
# where the encoded path replaces each `/` in the repo's absolute path with `-`.
# This script finds the newest JSONL for the current repo and aggregates token counts.
#
# Path resolution order for REPO_DIR:
#   1. $CLAUDE_PROJECT_DIR if set (Claude Code exports this for hooks and skill scripts)
#   2. The script's own ../, resolved at invocation time
#
# If no JSONL exists at the encoded path, fall back to the most recently touched JSONL
# under ~/.claude/projects (within the last 60 minutes). Only after both lookups fail
# do we emit the error JSON. This defends against the script being invoked from a cwd
# that doesn't match how Claude Code recorded the session (e.g. via a symlink).
#
# Output (stdout, single line of JSON):
#   {"input": N, "output": N, "cache_read": N, "cache_create": N, "total": N}
#
# Caveat: when called from inside the same session it's reading, the tokens spent on the
# scrape itself and any subsequent messages are not yet recorded in the JSONL.

set -euo pipefail

if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  REPO_DIR="$CLAUDE_PROJECT_DIR"
else
  REPO_DIR=$(cd "$(dirname "$0")/.." && pwd)
fi

ENCODED=$(echo "$REPO_DIR" | sed 's|/|-|g')
PROJECT_DIR="${HOME}/.claude/projects/${ENCODED}"

LATEST=$(ls -t "$PROJECT_DIR"/*.jsonl 2>/dev/null | head -1 || true)

if [[ -z "$LATEST" ]]; then
  LATEST=$(find "${HOME}/.claude/projects" -maxdepth 2 -name '*.jsonl' -mmin -60 -print0 2>/dev/null \
    | xargs -0 ls -t 2>/dev/null | head -1 || true)
fi

if [[ -z "$LATEST" ]]; then
  echo '{"error": "no session JSONL files found", "project_dir": "'"$PROJECT_DIR"'"}'
  exit 0
fi

jq -s '
  [.[] | select(.message.usage)]
  | reduce .[] as $m (
      {input: 0, output: 0, cache_read: 0, cache_create: 0};
      {
        input: (.input + ($m.message.usage.input_tokens // 0)),
        output: (.output + ($m.message.usage.output_tokens // 0)),
        cache_read: (.cache_read + ($m.message.usage.cache_read_input_tokens // 0)),
        cache_create: (.cache_create + ($m.message.usage.cache_creation_input_tokens // 0))
      }
    )
  | . + {total: (.input + .output + .cache_read + .cache_create)}
' "$LATEST"

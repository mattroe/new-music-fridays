#!/usr/bin/env bash
# Tests for scripts/sum-tokens.sh covering the path-resolution and fallback logic.
#
# Each test runs sum-tokens.sh with HOME pointed at an isolated tmpdir so we can
# place fake JSONL fixtures under ~/.claude/projects/ without touching the real
# project history. CLAUDE_PROJECT_DIR is set per scenario to exercise priority.
#
# Run from the repo root: ./scripts/test-sum-tokens.sh
# Exits non-zero if any assertion fails.

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
SUM_TOKENS="$REPO_DIR/scripts/sum-tokens.sh"

TEST_HOME=$(mktemp -d)
trap 'rm -rf "$TEST_HOME"' EXIT

PASS=0
FAIL=0

make_jsonl() {
  cat > "$1" <<'EOF'
{"message":{"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":20,"cache_creation_input_tokens":10}}}
{"message":{"usage":{"input_tokens":200,"output_tokens":75,"cache_read_input_tokens":30,"cache_creation_input_tokens":5}}}
EOF
}
# Expected sums from make_jsonl: input=300, output=125, cache_read=50, cache_create=15, total=490

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$expected" == "$actual" ]]; then
    echo "  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    FAIL=$((FAIL + 1))
  fi
}

reset_projects() {
  rm -rf "$TEST_HOME/.claude"
  mkdir -p "$TEST_HOME/.claude/projects"
}

encode_path() {
  echo "$1" | sed 's|/|-|g'
}

echo "Test 1: CLAUDE_PROJECT_DIR takes priority"
reset_projects
FAKE_REPO="$TEST_HOME/fake-repo-1"
mkdir -p "$FAKE_REPO"
ENCODED=$(encode_path "$FAKE_REPO")
mkdir -p "$TEST_HOME/.claude/projects/$ENCODED"
make_jsonl "$TEST_HOME/.claude/projects/$ENCODED/session.jsonl"
OUT=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$FAKE_REPO" bash "$SUM_TOKENS")
assert_eq "total tokens" "490" "$(echo "$OUT" | jq -r '.total')"
assert_eq "input tokens" "300" "$(echo "$OUT" | jq -r '.input')"
assert_eq "output tokens" "125" "$(echo "$OUT" | jq -r '.output')"
assert_eq "cache_read tokens" "50" "$(echo "$OUT" | jq -r '.cache_read')"
assert_eq "cache_create tokens" "15" "$(echo "$OUT" | jq -r '.cache_create')"

echo ""
echo "Test 2: script-relative REPO_DIR when CLAUDE_PROJECT_DIR unset"
reset_projects
REPO_ENCODED=$(encode_path "$REPO_DIR")
mkdir -p "$TEST_HOME/.claude/projects/$REPO_ENCODED"
make_jsonl "$TEST_HOME/.claude/projects/$REPO_ENCODED/session.jsonl"
OUT=$(HOME="$TEST_HOME" env -u CLAUDE_PROJECT_DIR bash "$SUM_TOKENS")
assert_eq "total tokens via script-relative path" "490" "$(echo "$OUT" | jq -r '.total')"

echo ""
echo "Test 3: mtime fallback when encoded path is empty"
reset_projects
FAKE_REPO="$TEST_HOME/fake-repo-3"
mkdir -p "$FAKE_REPO"
mkdir -p "$TEST_HOME/.claude/projects/-some-other-recorded-path"
make_jsonl "$TEST_HOME/.claude/projects/-some-other-recorded-path/recent.jsonl"
OUT=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$FAKE_REPO" bash "$SUM_TOKENS")
assert_eq "total tokens via mtime fallback" "490" "$(echo "$OUT" | jq -r '.total')"

echo ""
echo "Test 4: error JSON when no JSONL exists anywhere"
reset_projects
FAKE_REPO="$TEST_HOME/fake-repo-4"
mkdir -p "$FAKE_REPO"
OUT=$(HOME="$TEST_HOME" CLAUDE_PROJECT_DIR="$FAKE_REPO" bash "$SUM_TOKENS")
ERROR_FIELD=$(echo "$OUT" | jq -r '.error // empty')
if [[ -n "$ERROR_FIELD" ]]; then
  echo "  PASS: error field present"
  PASS=$((PASS + 1))
else
  echo "  FAIL: expected error field"
  echo "    output: $OUT"
  FAIL=$((FAIL + 1))
fi
EXPECTED_PROJECT_DIR="$TEST_HOME/.claude/projects/$(encode_path "$FAKE_REPO")"
assert_eq "error.project_dir echoes the resolved path" \
  "$EXPECTED_PROJECT_DIR" \
  "$(echo "$OUT" | jq -r '.project_dir')"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]

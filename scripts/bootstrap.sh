#!/usr/bin/env bash
# First-time setup helpers for running new-music-fridays as a cloud routine.
#
# Why this exists: the setup that CAN be automated locally is deterministic —
# checking the toolchain, judging where config/delivery.yaml may safely live,
# and sanity-checking it before you wire up the routine. Per repo convention
# (see CLAUDE.md), that deterministic logic belongs in a script, not in prose the
# bootstrap prompt has to reinvent each run. The browser-only steps (Last.fm
# connector OAuth, the Resend account/DNS, creating the routine) can't be
# scripted — the bootstrap prompt in docs/setup.md hands those off with exact values.
#
# Usage:
#   bash scripts/bootstrap.sh preflight   # report toolchain + repo + config readiness
#   bash scripts/bootstrap.sh validate    # sanity-check config/delivery.yaml; exit 1 on problems
#
# Both subcommands are read-only. preflight is a report and never fails; validate
# exits non-zero so the bootstrap prompt (or CI) can gate on it. This is a
# setup-time aid distinct from SKILL.md's pre-send validation, which checks the
# rendered email against these values at send time.

set -euo pipefail

DELIVERY="config/delivery.yaml"
EXAMPLE="config/delivery.yaml.example"

ok()   { printf '  [ok]   %s\n' "$1"; }
todo() { printf '  [todo] %s\n' "$1"; }
info() { printf '  [info] %s\n' "$1"; }

# Read a top-level scalar from the simple, fixed-shape delivery.yaml. Strips the
# key, surrounding whitespace, and surrounding double quotes. delivery.yaml has
# exactly three flat keys, so a full YAML parser would be overkill here.
yaml_value() {
  local key="$1" file="$2" line
  line="$(grep -E "^${key}:" "$file" 2>/dev/null | head -n1 || true)"
  [[ -z "$line" ]] && return 0
  sed -E "s/^${key}:[[:space:]]*//; s/^\"(.*)\"$/\1/" <<<"$line"
}

preflight() {
  echo "Toolchain"
  if command -v node >/dev/null 2>&1; then
    ok "node $(node -v) — runs scripts/send-email.mjs (the Resend send)"
  else
    todo "node not found — install Node 18+ so scripts/send-email.mjs can send"
  fi
  if command -v git >/dev/null 2>&1; then
    ok "git $(git --version | awk '{print $3}')"
  else
    todo "git not found"
  fi
  if command -v gh >/dev/null 2>&1; then
    if gh auth status >/dev/null 2>&1; then
      ok "gh CLI authenticated — can create/push a private repo for you"
    else
      info "gh CLI present but not logged in — run 'gh auth login' to let the bootstrap push for you"
    fi
  else
    info "gh CLI not found (optional) — install it to let the bootstrap create/push a private repo"
  fi

  echo
  echo "Repository"
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    ok "inside a git work tree"
    local origin
    origin="$(git remote get-url origin 2>/dev/null || true)"
    if [[ -n "$origin" ]]; then
      info "origin: $origin"
      if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        local vis
        vis="$(gh repo view --json visibility -q .visibility 2>/dev/null || true)"
        if [[ "$vis" == "PUBLIC" ]]; then
          todo "origin is PUBLIC — don't commit config/delivery.yaml here. Fork to a PRIVATE repo, or keep delivery out of git and use NMF_* routine env vars."
        elif [[ -n "$vis" ]]; then
          ok "origin visibility: $vis — safe to commit config/delivery.yaml (it's gitignored; force it in with 'git add -f')"
        fi
      fi
    else
      info "no 'origin' remote yet — create a private one before wiring up the routine"
    fi
  else
    todo "not inside a git repository — clone the repo first, then run this from its root"
  fi

  echo
  echo "Delivery config"
  if [[ -f "$DELIVERY" ]]; then
    ok "$DELIVERY exists"
    if grep -qE '\.example' "$DELIVERY"; then
      todo "$DELIVERY still has example placeholder values — fill in your real from/to"
    fi
  else
    todo "$DELIVERY missing — copy it from $EXAMPLE and fill in from/to (or set NMF_* and run scripts/write-delivery.sh)"
  fi
}

validate() {
  if [[ ! -f "$DELIVERY" ]]; then
    echo "validate: $DELIVERY not found — copy $EXAMPLE to $DELIVERY and fill it in" >&2
    return 1
  fi

  local from to subject fail=0
  from="$(yaml_value from "$DELIVERY")"
  to="$(yaml_value to "$DELIVERY")"
  subject="$(yaml_value subject_template "$DELIVERY")"

  echo "Parsed $DELIVERY:"
  printf '  from:             %s\n' "${from:-<empty>}"
  printf '  to:               %s\n' "${to:-<empty>}"
  printf '  subject_template: %s\n' "${subject:-<empty>}"
  echo

  # from: present, a plain address (Resend rejects "Name <email>" wrappers),
  # email-shaped, and not the example placeholder.
  if [[ -z "$from" ]]; then
    echo "FAIL from: empty" >&2; fail=1
  elif [[ "$from" == *"<"* || "$from" == *">"* ]]; then
    echo "FAIL from: Resend rejects \"Name <email>\" wrappers — use a plain address" >&2; fail=1
  elif [[ "$from" != *"@"*.* ]]; then
    echo "FAIL from: doesn't look like an email address" >&2; fail=1
  elif [[ "$from" == *.example ]]; then
    echo "FAIL from: still the example placeholder — set your Resend-verified sender" >&2; fail=1
  fi

  # to: present, email-shaped, and not the example placeholder.
  if [[ -z "$to" ]]; then
    echo "FAIL to: empty" >&2; fail=1
  elif [[ "$to" != *"@"*.* ]]; then
    echo "FAIL to: doesn't look like an email address" >&2; fail=1
  elif [[ "$to" == *.example ]]; then
    echo "FAIL to: still the example placeholder — set your delivery address" >&2; fail=1
  fi

  if [[ -z "$subject" ]]; then
    echo "FAIL subject_template: empty" >&2; fail=1
  fi

  if [[ "$fail" -eq 0 ]]; then
    echo "OK: config/delivery.yaml looks well-formed."
    return 0
  fi
  echo "validate: config/delivery.yaml has problems (see FAIL lines above)." >&2
  return 1
}

case "${1:-}" in
  preflight) preflight ;;
  validate)  validate ;;
  *)
    echo "usage: $0 [preflight | validate]" >&2
    exit 2
    ;;
esac

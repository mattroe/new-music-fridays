#!/usr/bin/env bash
# First-time setup helpers for running new-music-fridays as a cloud routine.
#
# Why this exists: the setup that CAN be automated locally is deterministic —
# checking the toolchain, judging where config/delivery.yaml may safely live,
# sanity-checking it, and standing up the private state repo — before you wire up
# the routine. Per repo convention (see CLAUDE.md), that deterministic logic
# belongs in a script, not in prose the bootstrap prompt has to reinvent each run.
# The genuinely browser-only steps (Last.fm connector OAuth, the Resend
# account/DNS, the routine's env vars + network-access allowlist, and the routine
# settings) can't be scripted — the bootstrap prompt in docs/setup.md hands those
# off with exact values. Everything else should be a command, not a manual click.
#
# Usage:
#   bash scripts/bootstrap.sh preflight   # report toolchain + repo + config readiness
#   bash scripts/bootstrap.sh validate    # sanity-check config/delivery.yaml; exit 1 on problems
#   bash scripts/bootstrap.sh state-repo [name]  # create + seed the private state repo (default: new-music-fridays-state)
#
# preflight and validate are read-only: preflight is a report and never fails;
# validate exits non-zero so the bootstrap prompt (or CI) can gate on it. state-repo
# is the one subcommand that writes — it creates a PRIVATE GitHub repo and seeds an
# empty history.jsonl, idempotently (a no-op if the repo already exists), so the
# "Durable run history" setup is one command instead of a manual gh/git sequence.
# This is a setup-time aid distinct from SKILL.md's pre-send validation, which
# checks the rendered email against these values at send time.

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

# Create + seed the private state repo that holds per-run history (issue #17),
# published digests (#27), and the feedback file (#35). This is the one piece of
# "Durable run history" setup that is pure, deterministic plumbing — so it's a
# command, not a manual gh/git sequence the docs make you copy by hand.
# Idempotent: if the repo already exists it's left untouched, and history.jsonl is
# only seeded when absent. What it CANNOT do (routine settings, not GitHub ones):
# add the repo as a second repo on the routine and enable unrestricted branch
# pushes — those stay a one-time browser step, printed at the end.
state_repo() {
  local name="${1:-new-music-fridays-state}"
  command -v gh >/dev/null 2>&1 || { echo "state-repo: needs the GitHub CLI (https://cli.github.com) — install it, then 'gh auth login'." >&2; return 1; }
  gh auth status >/dev/null 2>&1   || { echo "state-repo: gh CLI is not authenticated — run 'gh auth login' first." >&2; return 1; }
  command -v git >/dev/null 2>&1   || { echo "state-repo: git not found." >&2; return 1; }

  local owner slug
  owner="$(gh api user -q .login 2>/dev/null || true)"
  [[ -z "$owner" ]] && { echo "state-repo: couldn't determine your GitHub login from gh." >&2; return 1; }
  slug="$owner/$name"

  if gh repo view "$slug" >/dev/null 2>&1; then
    ok "$slug already exists — leaving it untouched"
  else
    gh repo create "$slug" --private \
      --description "Private per-run state for new-music-fridays (history, digests, feedback)" >/dev/null
    ok "created private repo $slug"
  fi

  # Seed an empty history.jsonl on the default branch only if the repo has none.
  if gh api "repos/$slug/contents/history.jsonl" >/dev/null 2>&1; then
    info "history.jsonl already present — not reseeding"
  else
    local tmp; tmp="$(mktemp -d)"
    if git clone -q "https://github.com/$slug.git" "$tmp" 2>/dev/null; then
      if ( cd "$tmp" \
           && git checkout -q -B main \
           && : > history.jsonl \
           && git add history.jsonl \
           && git -c user.email=bootstrap@local -c user.name=bootstrap commit -q -m "seed history" \
           && git push -q -u origin main ); then
        ok "seeded empty history.jsonl on main"
      else
        todo "couldn't seed history.jsonl automatically — see docs/setup.md 'Durable run history' for the manual steps"
      fi
    else
      todo "couldn't clone $slug to seed it — see docs/setup.md 'Durable run history' for the manual steps"
    fi
    rm -rf "$tmp"
  fi

  echo
  echo "One-time browser step (a routine setting, not a GitHub one — can't be scripted):"
  info "add $slug as a SECOND repository on the routine"
  info "enable 'Allow unrestricted branch pushes' on $slug only (leave the code repo on the default)"
}

case "${1:-}" in
  preflight)  preflight ;;
  validate)   validate ;;
  state-repo) state_repo "${2:-}" ;;
  *)
    echo "usage: $0 [preflight | validate | state-repo [name]]" >&2
    exit 2
    ;;
esac

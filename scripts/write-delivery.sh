#!/usr/bin/env bash
# Materialize config/delivery.yaml from NMF_* environment variables when present.
#
# Why this exists: an Anthropic-hosted cloud routine clones the repo fresh, and
# config/delivery.yaml is gitignored — so it's absent in the clone. The
# environment's *setup script* can't fill it: that runs before the repo is
# cloned, so there's no config/ to write into. SKILL.md therefore runs THIS
# during the run, in the repo root, where config/ exists.
#
# When NMF_* are unset it's a no-op, leaving any existing config/delivery.yaml
# untouched. The trust boundary is unchanged — values come from trusted routine
# env vars, and SKILL.md still reads and validates from/to/subject against
# config/delivery.yaml before sending.
#
# NMF_DELIVERY picks the delivery method written into the file: "resend" (the
# default — emails via scripts/send-email.mjs) or "none" (skip the send; the
# digest is delivered only as the file published to the state repo). An unknown
# value fails loudly rather than silently writing a bad config.
set -euo pipefail

if [[ -n "${NMF_FROM:-}" && -n "${NMF_TO:-}" && -n "${NMF_SUBJECT:-}" ]]; then
  # Only validate the method when we're actually materializing the file — when
  # the env path isn't in use NMF_DELIVERY is ignored, so don't fail on it here.
  method="${NMF_DELIVERY:-resend}"
  if [[ "$method" != "resend" && "$method" != "none" ]]; then
    echo "write-delivery: NMF_DELIVERY must be 'resend' or 'none', got '$method'" >&2
    exit 1
  fi
  mkdir -p config
  printf 'from: %s\nto: %s\nsubject_template: "%s"\nmethod: %s\n' "$NMF_FROM" "$NMF_TO" "$NMF_SUBJECT" "$method" > config/delivery.yaml
  echo "write-delivery: wrote config/delivery.yaml from NMF_* env vars (method: $method)"
else
  echo "write-delivery: NMF_* env vars not all set; left config/delivery.yaml as-is"
fi

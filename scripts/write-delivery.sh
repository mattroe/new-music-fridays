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
set -euo pipefail

if [[ -n "${NMF_FROM:-}" && -n "${NMF_TO:-}" && -n "${NMF_SUBJECT:-}" ]]; then
  mkdir -p config
  printf 'from: %s\nto: %s\nsubject_template: "%s"\n' "$NMF_FROM" "$NMF_TO" "$NMF_SUBJECT" > config/delivery.yaml
  echo "write-delivery: wrote config/delivery.yaml from NMF_* env vars"
else
  echo "write-delivery: NMF_* env vars not all set; left config/delivery.yaml as-is"
fi

#!/usr/bin/env bash
# Generate a fresh random password for each named test user, for this job only.
#
# Why: this repository is public, so a test password committed to it is known to
# everyone, and the local Supabase stack that CI brings up does not need a fixed
# one. Each job makes its own set, masks it in the log, and hands it to later
# steps through the environment. Nothing is printed and nothing is stored.
#
# Usage (from a workflow step, after `cp .env.local-supabase .env`):
#   scripts/ci/generate-test-passwords.sh PRIMARY SECONDARY TERTIARY
#
# Each argument becomes TEST_USER_<NAME>_PASSWORD, appended to ./.env (so
# docker compose sees it) and to $GITHUB_ENV (so later steps and the test
# process see it).
set -euo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 NAME [NAME...]  (for example PRIMARY SECONDARY TERTIARY)" >&2
  exit 2
fi
: "${GITHUB_ENV:?GITHUB_ENV is not set; this script only runs inside a workflow step}"

for name in "$@"; do
  case "$name" in
    *[!A-Z]* | "")
      echo "name must be upper-case letters only: $name" >&2
      exit 2
      ;;
  esac
  # 24 random bytes, base64: always long enough for any password policy, and the
  # trailing "Aa1!" guarantees a lower, upper, digit and symbol character.
  value="$(openssl rand -base64 24 | tr -d '\n=/+')Aa1!"
  echo "::add-mask::${value}"
  printf 'TEST_USER_%s_PASSWORD=%s\n' "$name" "$value" >> .env
  printf 'TEST_USER_%s_PASSWORD=%s\n' "$name" "$value" >> "$GITHUB_ENV"
done

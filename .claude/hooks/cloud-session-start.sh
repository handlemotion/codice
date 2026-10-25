#!/usr/bin/env bash
# Claude Code on the web: per-session setup for this repository (SessionStart hook). Installs the
# dependencies so checks and tests run at once. It does not start the dev server: `pnpm dev:up`
# does, and needs Wrangler's Cloudflare auth for the remote AI Search binding. Idempotent.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$(dirname "$0")/../.."

pnpm install --frozen-lockfile --prefer-offline
bash scripts/ensure-pnpm-native.sh

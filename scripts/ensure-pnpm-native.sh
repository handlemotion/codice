#!/usr/bin/env bash
# pnpm self-installs the `packageManager` version under `$PNPM_HOME/.tools` with lifecycle scripts
# blocked, which leaves a shebang-less placeholder where its native binary belongs. Shells retry
# that placeholder through `sh`, but turbo spawns it directly and gets ENOEXEC ("Exec format
# error"), so `pnpm dev` fails. Running pnpm's own preinstall puts the native binary in place.
# Idempotent; run by the Claude Code SessionStart hook.
set -euo pipefail

pnpm_home="${PNPM_HOME:-$HOME/.local/share/pnpm}"
for wrapper in "$pnpm_home"/.tools/pnpm/*/node_modules/pnpm; do
  [ -f "$wrapper/install.js" ] || continue
  head -c 4 "$wrapper/pnpm" | grep -q $'^\x7fELF' && continue
  (cd "$wrapper" && node install.js)
done

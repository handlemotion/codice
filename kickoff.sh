#!/bin/bash
# Códice: Claude Code cloud environment setup script, the reviewed source of truth. A one-repo
# environment pastes this file into its setup script field; a multi-repo environment's setup script
# runs every cloned repo's kickoff.sh, this one included, as root from that repo's root. So keep it
# self-contained, and pin shared paths (/usr/local/bin) to the same versions the other repos'
# scripts install.
#
# Machine tools only: it runs as root before Claude Code starts, the result is cached as a
# filesystem snapshot, and no secret is readable here. Dependencies are per session
# (.claude/hooks/cloud-session-start.sh). Idempotent.
set -euo pipefail

# Doppler CLI (`pnpm dev` and `eval` run under `doppler run`), pinned and checksum-verified from
# its GitHub release.
doppler_version=3.77.1
doppler_sha256=001f89a42629f9cb827cd86683c4c2dbf87c6299a8d6130643b98044bf5ed80a
if [ "$(doppler --version 2>/dev/null)" != "v$doppler_version" ]; then
  tarball="$(mktemp)"
  curl -fsSL --retry 3 -o "$tarball" \
    "https://github.com/DopplerHQ/cli/releases/download/$doppler_version/doppler_${doppler_version}_linux_amd64.tar.gz"
  echo "$doppler_sha256  $tarball" | sha256sum -c --quiet
  tar -xzf "$tarball" -C /usr/local/bin doppler
  rm -f "$tarball"
fi

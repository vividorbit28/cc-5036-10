#!/usr/bin/env sh
# Launch the accessible 3D viewer release package without any dev toolchain.
# Usage: ./start.sh [port]   (default port 4174)
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT="${1:-4174}"
HOST="${HOST:-127.0.0.1}"
export RELEASE_DIR="$SCRIPT_DIR" PORT HOST
exec node "$SCRIPT_DIR/serve-release.mjs"

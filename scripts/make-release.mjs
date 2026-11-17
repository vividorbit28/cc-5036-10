// Assembles the committed, self-contained release package under release/viewer
// from the Vite build output, plus launch scripts that need no dev toolchain
// beyond Node itself.
import { cpSync, mkdirSync, rmSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(repoRoot, "dist");
const releaseDir = resolve(repoRoot, "release/viewer");

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
cpSync(distDir, releaseDir, { recursive: true });

const launcher = `#!/usr/bin/env sh
# Launch the accessible 3D viewer release package without any dev toolchain.
# Usage: ./start.sh [port]   (default port 4174)
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PORT="\${1:-4174}"
HOST="\${HOST:-127.0.0.1}"
export RELEASE_DIR="\$SCRIPT_DIR" PORT HOST
exec node "$SCRIPT_DIR/serve-release.mjs"
`;
writeFileSync(resolve(releaseDir, "start.sh"), launcher);

// Copy the static server next to the package so start.sh is self-contained.
cpSync(
  resolve(repoRoot, "scripts/serve-release.mjs"),
  resolve(releaseDir, "serve-release.mjs"),
);
chmodSync(resolve(releaseDir, "start.sh"), 0o755);

const manifest = {
  name: "synthetic-space-explorer-release",
  builtAt: new Date().toISOString(),
  contents: readdirSync(releaseDir, { recursive: true }).sort(),
  entry: "index.html",
  resources: [
    "data/dataset.json",
    "data/keyboard-nav.json",
    "fonts/explorer-sans.woff2",
    "fonts/explorer-sans-bold.woff2",
    "fonts/explorer-mono.woff2",
  ],
};
writeFileSync(resolve(releaseDir, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`release package -> ${releaseDir}`);
console.log(manifest.contents.join("\n"));

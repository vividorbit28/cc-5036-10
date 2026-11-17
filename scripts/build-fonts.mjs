// Encodes the self-hosted UI fonts into WOFF2 under public/fonts.
// Source paths come from CLI flags so the build never depends on a hard-coded
// developer machine path; missing sources fail the build loudly.
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compress } from "wawoff2";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function flag(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

const fontSourceDir = flag(
  "source-dir",
  process.env.FONT_SOURCE_DIR ?? "/usr/share/fonts/truetype/dejavu",
);
const outputDir = resolve(repoRoot, flag("out", "public/fonts"));

const fonts = [
  { source: "DejaVuSans.ttf", output: "explorer-sans.woff2" },
  { source: "DejaVuSans-Bold.ttf", output: "explorer-sans-bold.woff2" },
  { source: "DejaVuSansMono.ttf", output: "explorer-mono.woff2" },
];

mkdirSync(outputDir, { recursive: true });

for (const font of fonts) {
  const sourcePath = resolve(fontSourceDir, font.source);
  if (!statSync(sourcePath, { throwIfNoEntry: false })?.isFile()) {
    console.error(`字体源文件缺失：${sourcePath}`);
    process.exit(1);
  }
  const ttf = readFileSync(sourcePath);
  const woff2 = await compress(new Uint8Array(ttf));
  const target = resolve(outputDir, font.output);
  writeFileSync(target, Buffer.from(woff2));
  console.log(`${font.source} -> ${target} (${woff2.length} bytes)`);
}

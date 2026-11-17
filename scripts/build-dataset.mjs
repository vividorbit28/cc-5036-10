// Emits the runtime data sample as public/data/dataset.json. The browser
// fetches this file at runtime, so a missing/blocked data resource fails the
// viewer visibly instead of silently using baked-in defaults.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDatasetBundle } from "../src/data/dataset-source.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(repoRoot, "public/data/dataset.json");
mkdirSync(dirname(target), { recursive: true });

const bundle = buildDatasetBundle();
writeFileSync(target, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(`dataset sample -> ${target} (${bundle.objects.length} objects)`);

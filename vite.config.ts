import { defineConfig } from "vite";

// Relative base keeps the published package operable from any sub path or
// static host without rewriting asset URLs for a developer machine.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});

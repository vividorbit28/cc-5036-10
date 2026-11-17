import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

// Some sandboxes lack Chromium's shared libraries. When the local fallback
// bundle from this workspace exists we point the browser at it; otherwise the
// system installation is used and no override is applied.
const localLibs = [
  "/workspace/.browser-libs/extract/usr/lib/aarch64-linux-gnu",
  "/workspace/.browser-libs/extract/lib/aarch64-linux-gnu",
].filter((path) => existsSync(path));
const libraryPath = localLibs.length
  ? [...localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":")
  : process.env.LD_LIBRARY_PATH;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    launchOptions: {
      env: libraryPath ? { ...process.env, LD_LIBRARY_PATH: libraryPath } : process.env,
      args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});

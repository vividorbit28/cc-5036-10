// Dependency-free static file server for the published viewer. It serves only
// files inside the release directory, so the package works from any checkout
// path without relying on Vite, the dev server or absolute /workspace paths.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(repoRoot, process.env.RELEASE_DIR ?? "release/viewer");

const port = Number(process.env.PORT ?? 4174);
const host = process.env.HOST ?? "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const target = normalize(join(root, pathname));

  // Containment check blocks path traversal outside the release directory.
  if (target !== root && !target.startsWith(root + sep)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const info = await stat(target);
    if (info.isDirectory()) {
      response.writeHead(302, { Location: `${pathname}/` }).end();
      return;
    }
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": MIME[extname(target)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("404 Not Found");
  }
});

server.listen(port, host, () => {
  console.log(`可达查看器发布包服务已启动：http://${host}:${port}/`);
  console.log(`静态根目录：${root}`);
  console.log("按 Ctrl+C 停止。");
});

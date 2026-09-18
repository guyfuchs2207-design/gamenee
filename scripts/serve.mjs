/**
 * Zero-dependency static server for local development.
 * The API is not stubbed here: requests to /api/* simply fail, which is the
 * offline path the game is built to survive. Use `wrangler dev` in worker/
 * to exercise the backend.
 */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("public");
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith("/api/")) {
      res.writeHead(503).end('{"error":"no backend in dev — run wrangler dev"}');
      return;
    }

    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    // Resolve then confirm containment, so ../ cannot escape public/.
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT + path.sep) && file !== path.join(ROOT, "index.html")) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const body = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  })
  .listen(PORT, () => console.log(`Orders dev server → http://localhost:${PORT}`));

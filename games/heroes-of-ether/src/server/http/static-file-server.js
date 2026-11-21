/* Безопасная потоковая выдача браузерных файлов и изображений. */
"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
});

// Поток соблюдает backpressure: медленное соединение не удерживает целый PNG в памяти.
// Файловый дескриптор закрывается также при HEAD, ошибке и отключении клиента.
async function serveStatic(req, res, root) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let requested;
  try {
    const decoded = decodeURIComponent((req.url || "/").split("?")[0]);
    if (decoded.includes("\0") || decoded.includes("\\")) throw new Error("Bad path");
    requested = path.resolve(root, "." + (decoded === "/" ? "/index.html" : decoded));
  } catch (_) {
    res.writeHead(400);
    return res.end("Bad request");
  }
  if (!requested.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  if (!MIME[path.extname(requested).toLowerCase()]) {
    res.writeHead(404);
    return res.end("Not found");
  }
  let handle;
  try {
    const real = await fs.realpath(requested);
    if (!real.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    handle = await fs.open(real, "r");
    const stat = await handle.stat();
    if (!stat.isFile()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const headers = {
      "Content-Type": MIME[path.extname(real).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
    };
    let range;
    // MP3 в Safari/WebKit запрашивается частями, в том числе при повторе трека.
    if (path.extname(real).toLowerCase() === ".mp3") {
      headers["Accept-Ranges"] = "bytes";
      const match = req.method === "GET" && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (match) {
        const first = match[1] ? Number(match[1]) : null,
          last = match[2] ? Number(match[2]) : null,
          start = first ?? Math.max(0, stat.size - (last ?? 0)),
          end = first === null || last === null ? stat.size - 1 : Math.min(last, stat.size - 1);
        if (
          (first !== null && !Number.isSafeInteger(first)) ||
          (last !== null && !Number.isSafeInteger(last)) ||
          (first === null && !last) ||
          start >= stat.size ||
          end < start
        ) {
          res.writeHead(416, { "Content-Range": `bytes */${stat.size}`, "Content-Length": 0 });
          return res.end();
        }
        range = { start, end };
        headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
        headers["Content-Length"] = end - start + 1;
      }
    }
    res.writeHead(range ? 206 : res.statusCode, headers);
    if (req.method === "HEAD") return res.end();
    await pipeline(handle.createReadStream({ ...range, autoClose: false }), res);
  } catch (error) {
    if (res.destroyed) return;
    if (res.headersSent) res.destroy(error);
    else {
      res.writeHead(404);
      res.end("Not found");
    }
  } finally {
    if (handle)
      await handle
        .close()
        .catch((error) => console.error("Не удалось закрыть статический файл:", error.message));
  }
}

module.exports = { serveStatic };

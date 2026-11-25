/* Bounded raster caches. Only static painting is cached, never game state. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexBodyArt = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  class Tiles {
    constructor(maxPixels, maxEntries = 128) {
      this.maxPixels = maxPixels;
      this.maxEntries = maxEntries;
      this.entries = new Map();
      this.pixels = 0;
    }
    get(key, create) {
      let tile = this.entries.get(key);
      if (tile) this.entries.delete(key);
      else {
        tile = create();
        this.pixels += tile.canvas.width * tile.canvas.height;
      }
      this.entries.set(key, tile);
      while (
        this.entries.size > this.maxEntries ||
        (this.pixels > this.maxPixels && this.entries.size > 1)
      ) {
        const first = this.entries.keys().next().value,
          old = this.entries.get(first);
        this.pixels -= old.canvas.width * old.canvas.height;
        this.entries.delete(first);
        old.canvas.width = old.canvas.height = 0;
      }
      return tile;
    }
    clear() {
      for (const tile of this.entries.values()) tile.canvas.width = tile.canvas.height = 0;
      this.entries.clear();
      this.pixels = 0;
    }
  }
  // A visible working set larger than the cache must not evict itself on every
  // frame. Keep recently used portraits and draw non-admitted bodies directly.
  class BodyTiles extends Tiles {
    constructor(maxPixels, maxRasterPixels = 512 * 512) {
      super(maxPixels);
      this.maxRasterPixels = maxRasterPixels;
      this.frame = 0;
      this.rasterPixels = 0;
    }
    beginFrame() {
      this.frame++;
      this.rasterPixels = 0;
    }
    acquire(key, size, create) {
      const hit = this.entries.get(key);
      if (hit) {
        hit.usedFrame = this.frame;
        return super.get(key, create);
      }
      const cost = size * size;
      if (cost > this.maxPixels || this.rasterPixels + cost > this.maxRasterPixels) return null;
      let remainingPixels = this.pixels + cost,
        remainingEntries = this.entries.size + 1;
      const expired = [];
      for (const [id, tile] of this.entries) {
        if (remainingPixels <= this.maxPixels && remainingEntries <= this.maxEntries) break;
        if (tile.usedFrame >= this.frame - 1) continue;
        expired.push([id, tile]);
        remainingPixels -= tile.canvas.width * tile.canvas.height;
        remainingEntries--;
      }
      if (remainingPixels > this.maxPixels || remainingEntries > this.maxEntries) return null;
      for (const [id, tile] of expired) {
        this.pixels -= tile.canvas.width * tile.canvas.height;
        this.entries.delete(id);
        tile.canvas.width = tile.canvas.height = 0;
      }
      const tile = super.get(key, create);
      tile.usedFrame = this.frame;
      this.rasterPixels += cost;
      return tile;
    }
    clear() {
      super.clear();
      this.frame = 0;
      this.rasterPixels = 0;
    }
  }
  function paintBody(paint, size, skin, skinId, color, drawSkin, ready, giftVisual, overlay) {
    const r = size / 2;
    const gradient = paint.createRadialGradient(r * 0.7, r * 0.65, r * 0.04, r, r, r * 1.15);
    gradient.addColorStop(0, "#f3eafa");
    gradient.addColorStop(0.22, color);
    gradient.addColorStop(1, "#2a2447");
    paint.fillStyle = gradient;
    paint.beginPath();
    paint.arc(r, r, r, 0, Math.PI * 2);
    paint.clip();
    paint.fill();
    if (ready && !(giftVisual === "curse" && overlay)) drawSkin(paint, skin, skinId, 0, 0, size, 1.13);
    globalThis.KillexGiftAppearance?.draw(paint, giftVisual, overlay, size);
  }
  class Renderer {
    constructor() {
      this.bodies = new BodyTiles(8 * 1024 * 1024, 1024 * 1024);
      this.labels = new Tiles(4 * 1024 * 1024, 1024);
      this.fadeCanvas = null;
      globalThis.document?.fonts?.addEventListener("loadingdone", () => this.labels.clear());
    }
    clear() {
      this.bodies.clear();
      this.labels.clear();
      if (this.fadeCanvas) this.fadeCanvas.width = this.fadeCanvas.height = 0;
      this.fadeCanvas = null;
    }
    body(ctx, { x, y, radius, scale, density, skin, skinId, color, drawSkin, giftVisual }) {
      const ready = skin?.complete && skin.naturalWidth;
      const overlay = globalThis.KillexGiftAppearance?.image(giftVisual);
      // A small set of resolutions survives continuous camera zoom, unlike a
      // new clipped portrait for every interpolated radius and every part.
      const size = Math.min(
        2048,
        Math.max(64, 2 ** Math.ceil(Math.log2(radius * 2 * scale * density))),
      );
      const key = JSON.stringify([ready ? skin.currentSrc || skin.src : "", skinId, color, size, overlay ? giftVisual : ""]);
      const create = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const paint = canvas.getContext("2d", { willReadFrequently: true });
        paintBody(paint, size, skin, skinId, color, drawSkin, ready, giftVisual, overlay);
        return { canvas };
      };
      const tile = size <= 512 ? this.bodies.acquire(key, size, create) : null;
      if (tile) {
        ctx.drawImage(tile.canvas, x - radius, y - radius, radius * 2, radius * 2);
      } else if (ready && ctx.globalAlpha < 1) {
        // Entry/exit fades apply once to the whole portrait, not separately to
        // skin and background. One reusable GPU surface, at most 2048² pixels.
        const canvas = (this.fadeCanvas ||= document.createElement("canvas"));
        if (canvas.width < size || canvas.height < size) canvas.width = canvas.height = size;
        const paint = canvas.getContext("2d");
        paint.clearRect(0, 0, size, size);
        paint.save();
        paintBody(paint, size, skin, skinId, color, drawSkin, ready, giftVisual, overlay);
        paint.restore();
        ctx.drawImage(canvas, 0, 0, size, size, x - radius, y - radius, radius * 2, radius * 2);
      } else {
        // Preserve the source image, fit and full screen resolution. In
        // particular, do not create a large software canvas just to discard it.
        ctx.save();
        ctx.translate(x - radius, y - radius);
        ctx.scale((radius * 2) / size, (radius * 2) / size);
        paintBody(ctx, size, skin, skinId, color, drawSkin, ready, giftVisual, overlay);
        ctx.restore();
      }
    }
    text(ctx, text, x, y, size, maxWidth, color, outline = 0.2, density = 1) {
      const reference = Math.max(32, Math.min(128, 2 ** Math.ceil(Math.log2(size * density)))),
        key = JSON.stringify([text, color, outline, reference]);
      const tile = this.labels.get(key, () => {
        const canvas = document.createElement("canvas"),
          paint = canvas.getContext("2d", { willReadFrequently: true });
        paint.font = `700 ${reference}px Inter, Arial, sans-serif`;
        const width = Math.min(4096, Math.ceil(paint.measureText(text).width)),
          pad = reference / 4;
        canvas.width = width + pad * 2;
        canvas.height = reference * 2;
        paint.font = `700 ${reference}px Inter, Arial, sans-serif`;
        paint.textAlign = "center";
        paint.textBaseline = "middle";
        paint.strokeStyle = "#25152ee6";
        paint.lineWidth = reference * outline;
        paint.strokeText(text, canvas.width / 2, canvas.height / 2, width);
        paint.fillStyle = color;
        paint.fillText(text, canvas.width / 2, canvas.height / 2, width);
        return { canvas, width };
      });
      const sy = size / reference,
        sx = Math.min(sy, maxWidth / Math.max(1, tile.width));
      const w = tile.canvas.width * sx,
        h = tile.canvas.height * sy;
      ctx.drawImage(tile.canvas, x - w / 2, y - h / 2, w, h);
    }
  }
  return { Tiles, BodyTiles, Renderer };
});

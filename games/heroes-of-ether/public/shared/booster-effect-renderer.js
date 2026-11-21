/* Значки активных эффектов, их расположение и пламя на горящем шаре. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexEffects = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  function active(player, elapsed = 0) {
    const ids = new Set();
    for (const effect of [...(player.effects || []), ...(player.instantEffects || [])]) {
      if (typeof effect.id === "string" && effect.remainingMs > elapsed) ids.add(effect.id);
    }
    if (player.turbo?.active && player.turbo.remainingMs > elapsed) ids.add("turbo");
    return [...ids].sort();
  }
  function layout(count, radius, scale) {
    if (!count) return { size: 0, gap: 0, columns: 0, height: 0 };
    const size = Math.max(14, Math.min(25, radius * scale * 0.3)),
      gap = 3;
    const width = Math.max(size, Math.min(180, radius * scale * 2));
    const columns = Math.max(1, Math.min(6, Math.floor((width + gap) / (size + gap)), count));
    return { size, gap, columns, height: Math.ceil(count / columns) * (size + gap) - gap };
  }
  // Общий кеш языков огня: золотой край, оранжевый завиток и светлая сердцевина,
  // как на Огненном мече. Градиенты и сложные контуры готовятся один раз.
  let burnFrames;
  function flameFrames() {
    if (burnFrames) return burnFrames;
    burnFrames = Array.from({ length: 32 }, (_, i) => {
      const tile = document.createElement("canvas");
      tile.width = 64;
      tile.height = 112;
      const c = tile.getContext("2d", { willReadFrequently: true }),
        phase = i * Math.PI * 2;
      const bend = Math.sin(phase) * 7,
        curl = Math.cos(phase) * 4;
      const outer = c.createLinearGradient(32, 108, 32, 8);
      outer.addColorStop(0, "#d52c08aa");
      outer.addColorStop(0.25, "#f7500c");
      outer.addColorStop(0.68, "#ffab16");
      outer.addColorStop(1, "#fff39c");
      c.fillStyle = outer;
      c.strokeStyle = "#e75912c0";
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(31, 108);
      c.bezierCurveTo(5, 101, 7, 82, 18, 70);
      c.bezierCurveTo(12, 85, 24, 86, 24, 72);
      c.bezierCurveTo(11, 44, 48 + bend, 42, 36 + bend, 9);
      c.bezierCurveTo(62 + curl, 34, 40, 50, 39, 64);
      c.bezierCurveTo(39, 74, 49, 69, 51, 57);
      c.bezierCurveTo(62, 87, 48, 107, 31, 108);
      c.fill();
      c.stroke();
      const core = c.createLinearGradient(30, 108, 32, 22);
      core.addColorStop(0, "#ff9d19cc");
      core.addColorStop(0.35, "#ffe54e");
      core.addColorStop(0.75, "#fff5bb");
      core.addColorStop(1, "#fffbe5");
      c.fillStyle = core;
      c.beginPath();
      c.moveTo(31, 106);
      c.bezierCurveTo(15, 91, 24, 81, 29, 70);
      c.bezierCurveTo(22, 52, 45 + bend, 44, 39 + bend, 26);
      c.bezierCurveTo(49 + bend, 49, 30, 62, 35, 77);
      c.bezierCurveTo(43, 87, 46, 96, 31, 106);
      c.fill();
      return tile;
    });
    return burnFrames;
  }
  function drawBurn(
    ctx,
    { x, y, radius },
    now,
    scale,
    reducedMotion = false,
    remainingMs = Infinity,
  ) {
    const t = reducedMotion ? 0 : now / 1000;
    const size = Math.max(7 / scale, Math.min(radius * 0.34, 32 / scale));
    const frames = flameFrames(),
      opacity = Math.min(1, Math.max(0, remainingMs / 180));
    ctx.save();
    ctx.globalAlpha *= opacity;
    ctx.translate(x, y);
    const glow = ctx.createRadialGradient(0, 0, radius * 0.83, 0, 0, radius + size * 0.65);
    glow.addColorStop(0, "#ffb52a00");
    glow.addColorStop(0.35, "#ff6a2020");
    glow.addColorStop(0.5, "#ffd05c80");
    glow.addColorStop(0.68, "#f5721630");
    glow.addColorStop(1, "#ee501000");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, radius + size * 0.65, 0, Math.PI * 2);
    ctx.fill();
    const count = Math.max(9, Math.min(18, Math.round((radius * scale) / 6)));
    for (let i = 0; i < count; i++) {
      const angle = ((i + 0.12 * Math.sin(i * 2.4)) * Math.PI * 2) / count;
      const upper = (1 - Math.sin(angle)) / 2;
      const flicker = 1 + Math.sin(t * 4.6 + i * 2.3) * 0.13;
      const h = size * (0.6 + upper * 1.25) * flicker;
      const w = h * (0.48 + 0.07 * Math.sin(i * 1.7));
      const frame = Math.floor(((t * 0.9 + i * 0.381966) % 1) * frames.length);
      ctx.save();
      ctx.translate(Math.cos(angle) * radius, Math.sin(angle) * radius);
      ctx.rotate(Math.cos(angle) * (0.35 + (1 - upper) * 0.65) + Math.sin(t * 3 + i) * 0.06);
      ctx.globalAlpha *= 0.7 + upper * 0.3;
      ctx.drawImage(frames[frame], -w / 2, -h * 0.92, w, h);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1 / scale, Math.min(2 / scale, radius * 0.014));
    ctx.strokeStyle = "#ffc35a99";
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.015, 0, Math.PI * 2);
    ctx.stroke();
    if (!reducedMotion)
      for (let i = 0; i < 5; i++) {
        const age = (t * 0.55 + i * 0.618) % 1,
          angle = Math.PI + ((i + 0.5) * Math.PI) / 5;
        const fx = Math.cos(angle) * radius + Math.sin(t * 1.7 + i) * size * 0.3;
        const fy = Math.sin(angle) * radius - age * size * 2.2;
        ctx.globalAlpha = opacity * Math.sin(age * Math.PI) * 0.65;
        ctx.fillStyle = "#ffd979";
        ctx.beginPath();
        ctx.arc(fx, fy, (1.3 - age * 0.7) / scale, 0, Math.PI * 2);
        ctx.fill();
      }
    ctx.restore();
  }
  class Renderer {
    constructor() {
      this.icons = new Map();
      this.images = new Map();
      this.badges = new Map();
    }
    setCatalog(items) {
      this.badges.clear();
      for (const item of items) {
        if (!item.icon) continue;
        this.icons.set(item.id, { url: item.icon, name: item.name });
        // Potion art belongs to the laboratory and is loaded only when used.
        if (item.tier !== "potion") this.loadIcon(item.icon);
      }
    }
    loadIcon(url) {
        if (this.images.has(url)) return;
        const image = new Image();
        this.images.set(url, image);
        image.onload = () => {
          const tile = document.createElement("canvas");
          tile.width = tile.height = 64;
          const ctx = tile.getContext("2d", { willReadFrequently: true });
          if (!ctx) return;
          const ratio = Math.min(64 / image.naturalWidth, 64 / image.naturalHeight);
          const w = image.naturalWidth * ratio,
            h = image.naturalHeight * ratio;
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(image, (64 - w) / 2, (64 - h) / 2, w, h);
          this.images.set(url, tile);
          this.badges.clear();
        };
        image.src = url;
    }
    badge(id, size, color, density) {
      const pixels = Math.ceil((size + 2) * density),
        key = [id, pixels, color, density].join(":");
      let tile = this.badges.get(key);
      if (tile) return tile;
      tile = document.createElement("canvas");
      tile.width = tile.height = pixels;
      const ctx = tile.getContext("2d", { willReadFrequently: true }),
        side = pixels / density - 2;
      ctx.scale(density, density);
      ctx.translate(1, 1);
      ctx.beginPath();
      ctx.roundRect(0, 0, side, side, Math.max(3, side * 0.22));
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "#d8b16bb8";
      ctx.lineWidth = 1;
      ctx.stroke();
      const item = this.icons.get(id);
      if (item) this.loadIcon(item.url);
      const image = item && this.images.get(item.url);
      if (image && (image.complete === undefined || (image.complete && image.naturalWidth)))
        ctx.drawImage(image, 2, 2, side - 4, side - 4);
      else {
        ctx.fillStyle = "#ffe2a3";
        ctx.font = `700 ${side * 0.65}px Inter, Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(id === "turbo" ? "T" : (item?.name || "?").slice(0, 1), side / 2, side / 2);
      }
      // 256 tiles at up to 54x54 pixels. A theme change cannot grow this forever.
      if (this.badges.size >= 256) this.badges.delete(this.badges.keys().next().value);
      this.badges.set(key, tile);
      return tile;
    }
    draw(ctx, ids, { x, y, radius, scale, density = 1 }) {
      const { size, gap, columns } = layout(ids.length, radius, scale);
      const color = globalThis.KillexUITheme?.color("#261433da") || "#261433da";
      density = Math.min(2, Math.max(1, Math.ceil(density)));
      for (let i = 0; i < ids.length; i++) {
        const row = Math.floor(i / columns),
          column = i % columns,
          rowCount = Math.min(columns, ids.length - row * columns);
        const left = x - (rowCount * size + (rowCount - 1) * gap) / 2 + column * (size + gap),
          top = y + row * (size + gap);
        ctx.drawImage(
          this.badge(ids[i], size, color, density),
          left - 1,
          top - 1,
          size + 2,
          size + 2,
        );
      }
    }
  }
  return { active, layout, drawBurn, Renderer };
});

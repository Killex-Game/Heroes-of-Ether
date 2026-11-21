/* Рисование действующих щитов вокруг шара. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexShields = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const ids = ["golden_shield", "clan_shield", "colorful_shield"];
  const active = (effects, elapsed = 0) =>
    (effects || []).find((e) => ids.includes(e.id) && e.remainingMs > Math.max(0, elapsed))?.id ||
    null;
  // All spheres share this smooth static layer. Only five dyadic resolutions
  // (64..1024) are retained: under 5.4 MiB regardless of player count.
  const sphereGlass = new Map();
  const smallSpheres = new Map();
  let smallSpherePixels = 0;
  // Small shields repeat over hundreds of cells. Share their curved paths and
  // rotate one highlight layer, instead of stroking each tiny spark every frame.
  function smallSphere(radius, scale, density) {
    const screenRadius = Math.max(4, Math.round((radius * scale) / 4) * 4);
    const dpr = Math.min(2, Math.max(1, Math.ceil(density)));
    const key = screenRadius + ":" + dpr;
    const cached = smallSpheres.get(key);
    if (cached) {
      smallSpheres.delete(key);
      smallSpheres.set(key, cached);
      return cached;
    }
    const extent = screenRadius * 1.16 + 3;
    const side = Math.ceil(extent * 2 * dpr);
    const layer = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.translate(side / 2, side / 2);
      ctx.scale(dpr, dpr);
      return { canvas, ctx };
    };
    const base = layer(),
      light = layer(),
      animated = layer(),
      r = screenRadius * 1.045;
    paintGlass(base.ctx, r);
    base.ctx.strokeStyle = "#c2ffecbc";
    base.ctx.lineWidth = Math.max(1.4, screenRadius * 0.019);
    base.ctx.beginPath();
    base.ctx.arc(0, 0, r, 0, Math.PI * 2);
    base.ctx.stroke();
    base.ctx.strokeStyle = "#ffffff75";
    base.ctx.lineWidth = Math.max(1, screenRadius * 0.024);
    base.ctx.beginPath();
    base.ctx.arc(-r * 0.04, -r * 0.02, r * 0.82, Math.PI * 1.12, Math.PI * 1.48);
    base.ctx.stroke();
    light.ctx.lineCap = "round";
    light.ctx.lineWidth = Math.max(2, screenRadius * 0.036);
    for (let i = 0; i < 2; i++) {
      light.ctx.strokeStyle = i ? "#b6e9ffb0" : "#f4fff1e8";
      light.ctx.beginPath();
      light.ctx.arc(0, 0, r, i * Math.PI + 0.35, i * Math.PI + 1);
      light.ctx.stroke();
    }
    light.ctx.fillStyle = "#e7fff6d0";
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      light.ctx.beginPath();
      light.ctx.arc(
        Math.cos(angle) * r,
        Math.sin(angle) * r,
        Math.max(1.1, screenRadius * 0.018),
        0,
        Math.PI * 2,
      );
      light.ctx.fill();
    }
    const tile = {
      base: base.canvas,
      light: light.canvas,
      animated: animated.canvas,
      paint: animated.ctx,
      frame: null,
      extent: side / (2 * dpr),
      radius: screenRadius,
      pixels: side * side * 3,
    };
    smallSpheres.set(key, tile);
    smallSpherePixels += tile.pixels;
    while (smallSpherePixels > 4 * 1024 * 1024) {
      const oldest = smallSpheres.keys().next().value;
      smallSpherePixels -= smallSpheres.get(oldest).pixels;
      smallSpheres.delete(oldest);
    }
    return tile;
  }
  function paintGlass(ctx, r) {
    const glass = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r * 1.09);
    glass.addColorStop(0, "#e6fff71a");
    glass.addColorStop(0.6, "#66c9c50a");
    glass.addColorStop(0.83, "#92f3d522");
    glass.addColorStop(0.92, "#a8fce680");
    glass.addColorStop(0.96, "#f0ffefbd");
    glass.addColorStop(1, "#87e8d100");
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.09, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawGlass(ctx, r, scale, density) {
    const size = Math.max(64, 2 ** Math.ceil(Math.log2(r * 2.18 * scale * density)));
    if (size > 1024) {
      paintGlass(ctx, r);
      return;
    }
    let canvas = sphereGlass.get(size);
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const paint = canvas.getContext("2d", { willReadFrequently: true });
      paint.translate(size / 2, size / 2);
      paintGlass(paint, size / 2.18);
      sphereGlass.set(size, canvas);
    }
    const edge = r * 1.09;
    ctx.drawImage(canvas, -edge, -edge, edge * 2, edge * 2);
  }
  function clearSphereCache() {
    for (const canvas of sphereGlass.values()) canvas.width = canvas.height = 0;
    sphereGlass.clear();
    for (const tile of smallSpheres.values()) {
      tile.base.width =
        tile.base.height =
        tile.light.width =
        tile.light.height =
        tile.animated.width =
        tile.animated.height =
          0;
    }
    smallSpheres.clear();
    smallSpherePixels = 0;
  }
  function drawSphere(ctx, { x, y, radius }, now, scale = 1, reducedMotion = false, density = 1) {
    const t = reducedMotion ? 0 : now / 1000,
      r = radius * 1.045;
    ctx.save();
    ctx.translate(x, y);
    if (radius * scale <= 80) {
      const tile = smallSphere(radius, scale, density);
      const edge = (tile.extent * radius) / tile.radius;
      const frame = Math.floor(t * 24);
      if (tile.frame !== frame) {
        const p = tile.paint,
          e = tile.extent;
        p.clearRect(-e, -e, e * 2, e * 2);
        p.drawImage(tile.base, -e, -e, e * 2, e * 2);
        p.save();
        p.rotate((frame / 24) * 0.36);
        p.drawImage(tile.light, -e, -e, e * 2, e * 2);
        p.restore();
        tile.frame = frame;
      }
      ctx.drawImage(tile.animated, -edge, -edge, edge * 2, edge * 2);
      ctx.restore();
      return;
    }
    // Стекло неподвижно; оба блика и шесть искр сохраняют прежнюю анимацию.
    drawGlass(ctx, r, scale, density);
    ctx.lineWidth = Math.max(1.4 / scale, radius * 0.019);
    ctx.strokeStyle = "#c2ffecbc";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const angle = t * 0.36 + i * Math.PI + 0.35;
      ctx.strokeStyle = i ? "#b6e9ffb0" : "#f4fff1e8";
      ctx.lineWidth = Math.max(2 / scale, radius * 0.036);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, r, angle, angle + 0.65);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffffff75";
    ctx.lineWidth = Math.max(1 / scale, radius * 0.024);
    ctx.beginPath();
    ctx.arc(-r * 0.04, -r * 0.02, r * 0.82, Math.PI * 1.12, Math.PI * 1.48);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 - t * 0.16;
      const px = Math.cos(angle) * r,
        py = Math.sin(angle) * r;
      const size = Math.max(1.1 / scale, radius * 0.018) * (1 + Math.sin(t * 1.8 + i) * 0.2);
      ctx.fillStyle = "#e7fff6d0";
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  class Renderer {
    constructor() {
      this.images = new Map(
        ids.map((id) => {
          const img = new Image();
          img.src = `assets/shields/${id}.png`;
          return [id, img];
        }),
      );
    }
    draw(ctx, player, { x, y, radius }, elapsed = 0) {
      const id = active(player.effects, elapsed),
        img = this.images.get(id);
      if (!img?.complete || !img.naturalWidth) return;
      // radius уже включает внешнюю границу выбранной рамки. Коэффициент
      // компенсирует прозрачные поля пресета; физический радиус не меняется.
      const rim = radius * (id === "golden_shield" ? 1.29 : 1.24);
      ctx.drawImage(img, x - rim, y - rim, rim * 2, rim * 2);
    }
  }
  return { active, drawSphere, clearSphereCache, Renderer };
});

/* Список фонов, выбор нового фона и браузерная отрисовка текстуры. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexArenaBackgrounds = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const THEMES = Object.freeze([
    Object.freeze({ id: "astral", fill: "#171a40", outside: "#0c1533", border: "#a18dcc" }),
    Object.freeze({
      id: "cobblestone",
      source: "assets/arena/cobblestone.png?art=20261123-interface-art",
      tileSize: 640,
      fill: "#c4a878",
      outside: "#766044",
      border: "#997239",
      saturation: 1.3,
    }),
    Object.freeze({
      id: "meadow",
      source: "assets/arena/meadow.webp?art=20261123-interface-art",
      tileSize: 640,
      fill: "#728642",
      outside: "#3e4d2c",
      border: "#a5b76e",
    }),
    Object.freeze({
      id: "clearing",
      source: "assets/arena/clearing.webp?art=20261123-interface-art",
      tileSize: 640,
      fill: "#82904a",
      outside: "#4e5630",
      border: "#b9ac70",
    }),
    Object.freeze({
      id: "sandstone",
      source: "assets/arena/sandstone.webp?art=20261123-interface-art",
      tileSize: 640,
      fill: "#d7b274",
      outside: "#806746",
      border: "#a8834f",
    }),
    Object.freeze({
      id: "slate",
      source: "assets/arena/slate.webp?art=20261123-interface-art",
      tileSize: 640,
      fill: "#657a89",
      outside: "#354752",
      border: "#a0afb6",
    }),
  ]);
  const DEFAULT_ID = THEMES[0].id;
  const EVENT_THEMES = Object.freeze([
    Object.freeze({
      id: "easter-meadow",
      source: "assets/arena/easter-meadow.webp?art=20261123-interface-art",
      tileSize: 640,
      fill: "#c06b29",
      outside: "#68401f",
      border: "#e6ac53",
    }),
  ]);
  const themeFor = (id) =>
    [...THEMES, ...EVENT_THEMES].find((theme) => theme.id === id) || THEMES[0];
  // Only the server chooses. Excluding the previous theme also prevents repeats
  // when more arena backgrounds are added to this catalogue.
  function choose(previous, random = Math.random) {
    const candidates = THEMES.filter((theme) => theme.id !== previous);
    const value = random(),
      unit = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    return candidates[Math.min(candidates.length - 1, Math.floor(unit * candidates.length))].id;
  }
  const stars = Object.freeze(
    Array.from({ length: 160 }, (_, i) =>
      Object.freeze({
        x: ((i * 173.71) % 2400) / 2400,
        y: ((i * 97.31) % 1600) / 1600,
        r: 0.5 + (i % 3) * 0.4,
        a: 0.16 + (i % 4) * 0.07,
      }),
    ),
  );
  class Renderer {
    constructor() {
      this.theme = themeFor(DEFAULT_ID);
      this.images = new Map();
      this.textures = new Map();
      // Preload in the lobby; each image is decoded once, not on every frame.
      for (const theme of [...THEMES, ...EVENT_THEMES])
        if (theme.source) {
          const image = new Image();
          image.src = theme.source;
          this.images.set(theme.id, image);
        }
    }
    select(id) {
      this.theme = themeFor(id);
    }
    texture() {
      const image = this.images.get(this.theme.id);
      if (!image?.complete || !image.naturalWidth) return null;
      if (!this.textures.has(this.theme.id)) {
        // Colour correction is baked into the cached tile once, never per frame.
        let source = image;
        if (this.theme.saturation) {
          const tile = document.createElement("canvas");
          tile.width = image.naturalWidth;
          tile.height = image.naturalHeight;
          const paint = tile.getContext("2d", { willReadFrequently: true });
          paint.filter = "saturate(" + this.theme.saturation + ")";
          paint.drawImage(image, 0, 0);
          source = tile;
        }
        // Wrapped gutters let adjacent tiles overlap without seams. Keep their
        // real subpixel positions: rounding each edge makes the ground wobble
        // and changes tile widths while the camera moves or zooms.
        const gutter = 2,
          padded = document.createElement("canvas"),
          width = source.width,
          height = source.height;
        padded.width = width + gutter * 2;
        padded.height = height + gutter * 2;
        const paint = padded.getContext("2d", { willReadFrequently: true });
        for (let y = -1; y <= 1; y++)
          for (let x = -1; x <= 1; x++)
            paint.drawImage(source, gutter + x * width, gutter + y * height);
        const texture = { source: padded, width, height, gutter };
        this.textures.set(this.theme.id, texture);
        // Freeze once, not on the drawing path. No per-frame GPU readbacks.
        if (typeof createImageBitmap === "function")
          createImageBitmap(padded)
            .then((bitmap) => {
              texture.source = bitmap;
            })
            .catch(() => {});
      }
      return this.textures.get(this.theme.id);
    }
    draw(ctx, world, { left, top, right, bottom, scale }) {
      ctx.save();
      ctx.fillStyle = this.theme.fill;
      // Clip texture work to the visible world. Repeating CanvasPattern caused
      // long native Paint tasks in Chrome; cached image tiles use its fast path.
      const x = Math.max(0, left),
        y = Math.max(0, top);
      const w = Math.min(world.width, right) - x,
        h = Math.min(world.height, bottom) - y;
      if (w > 0 && h > 0) {
        ctx.fillRect(x, y, w, h);
        const texture = this.texture(),
          size = this.theme.tileSize;
        if (texture && size > 0) {
          const padX = (texture.gutter / texture.width) * size,
            padY = (texture.gutter / texture.height) * size;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, w, h);
          ctx.clip();
          for (let ty = Math.floor(y / size) * size; ty < y + h; ty += size)
            for (let tx = Math.floor(x / size) * size; tx < x + w; tx += size) {
              ctx.drawImage(texture.source, tx - padX, ty - padY, size + 2 * padX, size + 2 * padY);
            }
          ctx.restore();
        }
      }
      if (this.theme.id === "astral") {
        ctx.strokeStyle = "#9394c71a";
        ctx.lineWidth = 1 / scale;
        for (
          let x = Math.max(0, Math.floor(left / 100) * 100);
          x <= Math.min(world.width, right);
          x += 100
        ) {
          ctx.beginPath();
          ctx.moveTo(x, Math.max(0, top));
          ctx.lineTo(x, Math.min(world.height, bottom));
          ctx.stroke();
        }
        for (
          let y = Math.max(0, Math.floor(top / 100) * 100);
          y <= Math.min(world.height, bottom);
          y += 100
        ) {
          ctx.beginPath();
          ctx.moveTo(Math.max(0, left), y);
          ctx.lineTo(Math.min(world.width, right), y);
          ctx.stroke();
        }
        for (const star of stars) {
          ctx.globalAlpha = star.a;
          ctx.fillStyle = "#c4c8ff";
          ctx.beginPath();
          ctx.arc(star.x * world.width, star.y * world.height, star.r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = this.theme.border;
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(0, 0, world.width, world.height);
      ctx.restore();
    }
  }
  return { THEMES, EVENT_THEMES, DEFAULT_ID, themeFor, choose, Renderer };
});

/* Частицы еды, рамки аккаунтов и отдельные ободки лиг на арене. */
"use strict";
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  // Cached tiles are CPU-backed. Hundreds of GPU-backed source canvases can
  // trigger synchronous GPU readbacks when Chrome paints the main canvas.
  // The arena canvas itself still uses the browser's accelerated renderer.
  class FoodRenderer {
    constructor() {
      this.tiles = new Map();
      this.scaledTiles = new Map();
      this.food = new Map();
      this.cells = new Map();
      this.cellSize = 128;
      this.layers = new Map();
      this.layerPixels = 0;
      this.pending = [];
      this.timelineStarted = false;
      const img = new Image();
      img.onload = () => {
        // Один золотой спрайт для всех значений эфира, включая порции W.
        // Уменьшаем один раз и сохраняем кеш неподвижных ячеек арены.
        const tile = document.createElement("canvas");
        tile.width = tile.height = 64;
        const paint = tile.getContext("2d", { willReadFrequently: true });
        paint.imageSmoothingQuality = "high";
        paint.drawImage(img, 0, 0, 64, 64);
        for (const value of [1, 2, 3, 5, 10]) this.tiles.set(value, tile);
        for (const cell of this.cells.values()) cell.dirty = true;
      };
      img.src = "assets/food/ether-drop-v1.webp?art=20261123-interface-art";
    }
    cellKeys(orb) {
      const size = this.cellSize,
        x = Math.floor(orb.x / size),
        y = Math.floor(orb.y / size);
      // A sprite belongs to one padded tile. Never cut a droplet into pieces
      // at tile edges: independent resampling leaves visible seams.
      return [[x + ":" + y, x * size, y * size]];
    }
    sync(orbs, time = null) {
      if (!Number.isFinite(time)) {
        this.pending = [];
        this.timelineStarted = false;
        this.apply(orbs);
        return;
      }
      if (!this.timelineStarted) {
        this.timelineStarted = true;
        this.apply(orbs);
      }
      if (this.pending.at(-1)?.time === time) this.pending.pop();
      this.pending.push({ time, orbs });
      if (this.pending.length > 32) this.pending.shift();
    }
    advance(time) {
      let snapshot;
      while (this.pending.length && this.pending[0].time <= time) snapshot = this.pending.shift();
      if (snapshot) this.apply(snapshot.orbs);
    }
    apply(orbs) {
      const next = new Map();
      const remove = (item) => {
        for (const [key] of item.keys) {
          const cell = this.cells.get(key);
          if (!cell) continue;
          cell.orbs.delete(item.orb.id);
          cell.dirty = true;
          if (!cell.orbs.size) {
            this.cells.delete(key);
            const layer = this.layers.get(key);
            if (layer) {
              this.layerPixels -= layer.width * layer.height;
              layer.width = layer.height = 0;
            }
            this.layers.delete(key);
          }
        }
      };
      for (const orb of orbs) {
        const signature = [orb.x, orb.y, orb.radius, orb.value, orb.artValue, orb.color].join(",");
        const old = this.food.get(orb.id);
        if (old?.signature === signature) {
          next.set(orb.id, old);
          continue;
        }
        if (old) remove(old);
        const item = { orb, signature, keys: this.cellKeys(orb) };
        next.set(orb.id, item);
        for (const [key, x, y] of item.keys) {
          let cell = this.cells.get(key);
          if (!cell) {
            cell = { x, y, padding: 2, orbs: new Map() };
            this.cells.set(key, cell);
          }
          cell.orbs.set(orb.id, orb);
          cell.padding = Math.max(cell.padding, Math.ceil((orb.radius || 5.5) * 1.18) + 2);
          cell.dirty = true;
        }
      }
      for (const [id, item] of this.food) if (!next.has(id)) remove(item);
      this.food = next;
    }
    drawVisible(ctx, { left, top, right, bottom }) {
      const size = this.cellSize,
        density = 2,
        maxPixels = 16 * 1024 * 1024;
      const visible = new Set();
      let cacheWorkMs = 0;
      const drawCell = (cell) => {
        for (const orb of cell.orbs.values()) {
          if (this.draw(ctx, orb, density)) continue;
          ctx.fillStyle = "#edbd39";
          ctx.beginPath();
          ctx.arc(orb.x, orb.y, orb.radius || 5.5, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      for (const [key, cell] of this.cells) {
        const p = cell.padding;
        if (
          cell.x - p <= right &&
          cell.y - p <= bottom &&
          cell.x + size + p >= left &&
          cell.y + size + p >= top
        )
          visible.add(key);
      }
      // Cache world-space tiles so stationary food needs only a few draw calls,
      // regardless of particle count. Moving/eaten food invalidates its tiles.
      for (const [key, cell] of this.cells) {
        const pad = cell.padding,
          extent = size + pad * 2;
        if (
          cell.x - pad > right ||
          cell.y - pad > bottom ||
          cell.x + size + pad < left ||
          cell.y + size + pad < top
        )
          continue;
        let layer = this.layers.get(key);
        const pixels = Math.ceil(extent * density),
          area = pixels * pixels;
        const oldArea = layer ? layer.width * layer.height : 0;
        const needsPaint =
          !layer || layer.width !== pixels || layer.height !== pixels || cell.dirty;
        if (needsPaint && cacheWorkMs >= 3) {
          // Food remains current while cache construction is spread across frames.
          // Never display a dirty tile: it may still contain an eaten droplet.
          drawCell(cell);
          continue;
        }
        // Keep the old memory ceiling. Never evict a tile visible in this frame:
        // otherwise a wide view could rebuild the same tiles on every frame.
        if (this.layerPixels - oldArea + area > maxPixels) {
          for (const [oldest, tile] of this.layers) {
            if (visible.has(oldest)) continue;
            this.layerPixels -= tile.width * tile.height;
            tile.width = tile.height = 0;
            this.layers.delete(oldest);
            if (this.layerPixels - oldArea + area <= maxPixels) break;
          }
        }
        if (this.layerPixels - oldArea + area > maxPixels) {
          // Extreme wide views still show every droplet using the shared sprite.
          drawCell(cell);
          continue;
        }
        if (!layer) {
          layer = document.createElement("canvas");
          cell.dirty = true;
        }
        if (layer.width !== pixels || layer.height !== pixels) {
          layer.width = layer.height = pixels;
          this.layerPixels += area - oldArea;
          cell.dirty = true;
        }
        this.layers.delete(key);
        this.layers.set(key, layer);
        if (cell.dirty) {
          const started = performance.now();
          const paint = layer.getContext("2d", { willReadFrequently: true });
          paint.setTransform(1, 0, 0, 1, 0, 0);
          paint.clearRect(0, 0, pixels, pixels);
          paint.scale(density, density);
          // Supersampling supplies detail; bilinear filtering avoids costly
          // high-quality CPU resampling for every droplet during tile rebuilds.
          paint.imageSmoothingQuality = "low";
          paint.translate(pad - cell.x, pad - cell.y);
          for (const orb of cell.orbs.values()) {
            if (this.draw(paint, orb, density)) continue;
            paint.fillStyle = "#edbd39";
            paint.beginPath();
            paint.arc(orb.x, orb.y, orb.radius || 5.5, 0, Math.PI * 2);
            paint.fill();
          }
          cell.dirty = false;
          cacheWorkMs += performance.now() - started;
        }
        ctx.drawImage(layer, cell.x - pad, cell.y - pad, extent, extent);
      }
    }
    drawMoving(ctx, orbs, { left, top, right, bottom }) {
      for (const item of orbs) {
        const orb = item.part || item;
        const position = item.position || orb;
        const r = orb.radius || 5.5;
        if (
          position.x + r < left ||
          position.x - r > right ||
          position.y + r < top ||
          position.y - r > bottom
        )
          continue;
        if (this.draw(ctx, orb, 1, position)) continue;
        ctx.fillStyle = "#edbd39";
        ctx.beginPath();
        ctx.arc(position.x, position.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    draw(ctx, orb, density = 1, position = orb) {
      const source = this.tiles.get(orb.artValue || orb.value) || this.tiles.get(1);
      if (!source) return false;
      const radius = orb.radius || 5.5;
      // Resample once per screen-independent sprite size, not once per particle.
      // CPU-backed sources retain the no-GPU-readback rendering path.
      const pixels = Math.min(128, Math.max(1, Math.round(radius * 2.36 * density)));
      let tile = this.scaledTiles.get(pixels);
      if (!tile) {
        tile = document.createElement("canvas");
        tile.width = tile.height = pixels;
        const paint = tile.getContext("2d", { willReadFrequently: true });
        paint.imageSmoothingQuality = "high";
        paint.drawImage(source, 0, 0, pixels, pixels);
        this.scaledTiles.set(pixels, tile);
      }
      ctx.drawImage(
        tile,
        position.x - radius * 1.18,
        position.y - radius * 1.18,
        radius * 2.36,
        radius * 2.36,
      );
      return true;
    }
  }
  let frameShine;
  function shineTexture() {
    if (frameShine) return frameShine;
    const tile = document.createElement("canvas");
    tile.width = tile.height = 512;
    const paint = tile.getContext("2d", { willReadFrequently: true }),
      gradient = paint.createConicGradient(-Math.PI / 2, 256, 256);
    // The same two soft highlights and stops as account-rim-shine in the lobby.
    for (const [position, color] of [
      [0, "#fffbe900"],
      [0.2, "#fffbe900"],
      [0.26, "#fffbe9"],
      [0.32, "#fffbe900"],
      [0.7, "#fffbe900"],
      [0.76, "#fffbe9aa"],
      [0.82, "#fffbe900"],
      [1, "#fffbe900"],
    ])
      gradient.addColorStop(position, color);
    paint.fillStyle = gradient;
    paint.fillRect(0, 0, 512, 512);
    frameShine = tile;
    return tile;
  }
  // Неподвижный рельеф кэшируется; во время кадра движется только мягкий блик.
  // Кэш ограничен по числу пикселей, чтобы крупные шары не накапливали текстуры.
  const rimTiles = new Map();
  let rimPixels = 0;
  const maxRimPixels = 16 * 1024 * 1024;
  let rimCachePressure = false;
  const rimWidth = (radius) => Math.max(3.5, Math.min(11, radius * 0.065));
  // Geometric size levels remain stable while mass and camera scale change.
  // The final draw still uses the exact physical radius. A level is at most
  // 8% larger, so it is downsampled rather than stretched from a smaller tile.
  const rimTileRadius = (radius) =>
    4 * 1.08 ** Math.ceil(Math.log(Math.max(4, radius) / 4) / Math.log(1.08));
  const accountThemes = {
    vip: { id: "vip", rank: 6, metal: "#ffb600", light: "#fff4a0", dark: "#693000" },
    premium: { id: "premium", rank: 7, metal: "#a82aff", light: "#f8cfff", dark: "#310054" },
  };
  function ring(ctx, radius, width, color) {
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  function metalGradient(ctx, theme, radius) {
    const g = ctx.createLinearGradient(-radius, -radius, radius * 0.7, radius);
    for (const [at, color] of [
      [0, theme.dark],
      [0.13, theme.metal],
      [0.26, theme.light],
      [0.38, theme.metal],
      [0.55, theme.dark],
      [0.68, theme.metal],
      [0.8, theme.light],
      [1, theme.dark],
    ])
      g.addColorStop(at, color);
    return g;
  }
  function facet(ctx, w, h, theme, metal) {
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, h);
    ctx.lineTo(-w, 0);
    ctx.closePath();
    ctx.fillStyle = metal;
    ctx.fill();
    ctx.strokeStyle = theme.dark;
    ctx.lineWidth = 0.65;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(0, h);
    ctx.lineTo(-w, 0);
    ctx.closePath();
    ctx.fillStyle = theme.light;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(w, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fillStyle = theme.metal;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -h);
    ctx.lineTo(-w, 0);
    ctx.strokeStyle = "#fff9e9";
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
  // Native circles reproduce the approved rims without asynchronous texture swaps.
  const preparedRimColors = {"vip":["#a56a24","#dba64b","#f2d18a","#b77725"],"premium":["#655175","#a07abb","#d7b7df","#c5a564"],"bronze":["#714c36","#b77d50","#d8b190","#8c5838"],"silver":["#5d6c7a","#a9bac7","#dde5e8","#82929d"],"gold":["#8b7145","#c9ad74","#ead7ab","#b6975d"],"platinum":["#496c70","#9fbfb9","#d6e5da","#81a5a4"],"diamond":["#4c819c","#99cbdc","#d4ebef","#81adc4"],"champions":["#683c40","#9d5360","#ca98a0","#c3a16b"],"title_novice":["#596675","#9dabb9","#d3dce1","#8294a7"],"title_experienced":["#355b83","#89add0","#cfdfec","#86b5d4"],"title_expert":["#815b30","#bd9454","#e7cca1","#799bad"],"title_master":["#7d453a","#c18b4d","#e9caa0","#af6371"],"title_sage":["#2c6675","#84c0cb","#d3e6e8","#79a6be"],"title_pro":["#31694e","#8aac73","#d9dfae","#bba16c"],"title_prince":["#355887","#8ca8cf","#dfd7b8","#c3a06c"],"title_king":["#793741","#ad6670","#e2c7a7","#c4a164"],"title_emperor":["#324667","#8b9dbd","#e5d6ad","#bc9b67"],"title_boss":["#6e3d70","#ac7ab0","#e2c4df","#c5a36b"]};
  function preparedRim(ctx, id, radius) {
    const colors = preparedRimColors[id.replace(/^canon_/, "")];
    if (!colors) return false;
    const [dark, metal, light, trim] = colors, band = rimWidth(radius), center = radius + 0.4;
    const gradient = ctx.createLinearGradient(-radius, -radius, radius, radius);
    [[0,light],[.38,metal],[.72,dark],[1,metal]].forEach(([at,color]) => gradient.addColorStop(at,color));
    ring(ctx, center, band + 1.3, dark);
    ring(ctx, center, band, gradient);
    ring(ctx, center + band * .32, Math.max(.4, band * .1), light);
    ring(ctx, center - band * .32, Math.max(.4, band * .16), trim);
    ring(ctx, center - band * .45, Math.max(.4, band * .1), dark);
    if (radius >= 24) for (let i=0;i<8;i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 4);
      const w=Math.min(5,band*.7), h=band*.22;
      ctx.beginPath(); ctx.moveTo(-w,-center); ctx.lineTo(0,-center-h);
      ctx.lineTo(w,-center); ctx.lineTo(0,-center+h); ctx.closePath();
      ctx.strokeStyle=light; ctx.lineWidth=Math.max(.4,band*.08); ctx.stroke(); ctx.restore();
    }
    return true;
  }
  function paintRim(ctx, t, radius, simple = false) {
    if (preparedRim(ctx, t.id, radius)) return;
    const band = rimWidth(radius),
      center = radius + 0.4;
    const metal = metalGradient(ctx, t, radius);
    const gold = metalGradient(
      ctx,
      { dark: "#825021", metal: "#edbc51", light: "#fff7c7" },
      radius,
    );
    ring(ctx, center + 0.4, band + 2.4, "#120b2480");
    ring(ctx, center, band + 1.3, t.dark);
    ring(ctx, center, band, metal);
    // Тёмная выемка и две световые грани дают читаемую толщину металла.
    ring(ctx, center + band * 0.33, Math.max(0.8, band * 0.12), t.light);
    ring(ctx, center - band * 0.34, Math.max(0.8, band * 0.14), t.dark);
    ring(ctx, center - band * 0.48, 0.75, t.light);
    ring(ctx, center + band * 0.49, 0.65, gold);
    if (simple || radius < 20) return;
    const count = [12, 10, 12, 10, 12, 12, 10, 12][t.rank];
    const detail = Math.min(1, radius / 72),
      s = band * 0.31;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Вставки эмали в канавке и гравировка между оправами.
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
      ctx.beginPath();
      ctx.arc(0, 0, center, angle + 0.045, angle + (Math.PI * 2) / count - 0.045);
      ctx.lineWidth = band * 0.32;
      ctx.strokeStyle = t.dark;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, center - 0.45, angle + 0.06, angle + (Math.PI * 2) / count - 0.06);
      ctx.lineWidth = band * 0.14;
      ctx.strokeStyle = t.metal;
      ctx.stroke();
      ctx.save();
      ctx.rotate(angle);
      ctx.translate(center, 0);
      ctx.rotate(Math.PI / 2);
      ctx.scale(detail, detail);
      if (t.rank === 4 || t.rank === 7 || t.rank === 5) {
        ctx.fillStyle = gold;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 1.3, s * 1.65, 0, 0, Math.PI * 2);
        ctx.fill();
        facet(ctx, s * 0.9, s * 1.3, t, metal);
      } else if (t.rank === 3) {
        ctx.beginPath();
        ctx.moveTo(-s * 2, 0);
        ctx.bezierCurveTo(-s, -s * 1.6, s, -s * 1.6, s * 2, 0);
        ctx.bezierCurveTo(s, s * 1.6, -s, s * 1.6, -s * 2, 0);
        ctx.strokeStyle = t.dark;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = t.light;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        // Парные чеканные листья с собственной тенью и светлой прожилкой.
        for (const side of [-1, 1]) {
          ctx.save();
          ctx.scale(side, 1);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.bezierCurveTo(s * 0.7, -s * 1.4, s * 2, -s * 1.2, s * 2.5, -s * 0.25);
          ctx.bezierCurveTo(s * 1.8, s * 0.7, s * 0.6, s * 0.8, 0, 0);
          ctx.closePath();
          ctx.fillStyle = metal;
          ctx.fill();
          ctx.lineWidth = 0.8;
          ctx.strokeStyle = t.dark;
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(s, -s * 0.3, s * 2.2, -s * 0.3);
          ctx.strokeStyle = t.light;
          ctx.lineWidth = 0.65;
          ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0.75, s * 0.38), 0, Math.PI * 2);
        ctx.fillStyle = t.light;
        ctx.fill();
        ctx.strokeStyle = t.dark;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
      ctx.restore();
    }
    // Верхняя печать остаётся в тех же восьми пикселях окантовки.
    if (radius >= 50 && [2, 5, 6, 7].includes(t.rank)) {
      ctx.save();
      ctx.translate(0, -center);
      const h = Math.min(5.8, band * 0.58);
      if (t.rank === 5 || t.rank === 6) {
        ctx.beginPath();
        ctx.moveTo(-h, h * 0.45);
        ctx.lineTo(-h * 1.2, -h * 0.5);
        ctx.lineTo(-h * 0.4, 0);
        ctx.lineTo(0, -h);
        ctx.lineTo(h * 0.4, 0);
        ctx.lineTo(h * 1.2, -h * 0.5);
        ctx.lineTo(h, h * 0.45);
        ctx.closePath();
        ctx.fillStyle = gold;
        ctx.fill();
        ctx.strokeStyle = "#7f3d13";
        ctx.lineWidth = 0.65;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-h, h * 0.45);
        ctx.lineTo(h, h * 0.45);
        ctx.strokeStyle = "#fff2ab";
        ctx.stroke();
      } else facet(ctx, h * 0.65, h, t, metal);
      ctx.restore();
    }
  }
  function rimTile(theme, screenRadius, simple = false) {
    const radius = rimTileRadius(screenRadius);
    const density = Math.min(devicePixelRatio || 1, 2, 1024 / (2 * (radius + 8)));
    const key = theme.id + ":" + radius + ":" + density.toFixed(2) + (simple ? ":arena" : ":full");
    if (rimTiles.has(key)) {
      const tile = rimTiles.get(key);
      rimTiles.delete(key);
      rimTiles.set(key, tile);
      return tile;
    }
    const side = Math.ceil((radius + 8) * 2 * density);
    const pixels = side * side * (!simple && radius >= 24 ? 2 : 1);
    if (rimCachePressure) {
      // Under pressure retain a nearby larger tile instead of evicting and
      // repainting the same size range every frame (especially at DPR 2).
      // It is always downsampled, never magnified from a lower-resolution rim.
      let reusableKey, reusable;
      for (const [candidateKey, candidate] of rimTiles) {
        if (
          candidate.themeId !== theme.id ||
          candidate.simple !== simple ||
          candidate.radius < radius ||
          candidate.radius > radius * 1.35 ||
          candidate.canvas.width < side
        )
          continue;
        if (!reusable || candidate.radius < reusable.radius) {
          reusableKey = candidateKey;
          reusable = candidate;
        }
      }
      if (reusable) {
        rimTiles.delete(reusableKey);
        rimTiles.set(reusableKey, reusable);
        return reusable;
      }
    }
    const canvas = document.createElement("canvas"),
      extent = radius + 8;
    canvas.width = canvas.height = side;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.scale(density, density);
    ctx.translate(extent, extent);
    paintRim(ctx, theme, radius, simple);
    let shine = null;
    if (!simple && radius >= 24 && !preparedRimColors[theme.id.replace(/^canon_/, "")] && !["vip", "premium"].includes(theme.id)) {
      // Bake the annulus once. Clipping a large rotating square for every
      // part on every frame creates avoidable mask/compositing work in Chrome.
      shine = document.createElement("canvas");
      shine.width = shine.height = canvas.width;
      const light = shine.getContext("2d", { willReadFrequently: true });
      light.scale(density, density);
      light.translate(extent, extent);
      const outer = radius + Math.min(7, rimWidth(radius) * 0.6);
      light.beginPath();
      light.arc(0, 0, outer, 0, Math.PI * 2);
      light.arc(0, 0, Math.max(0, radius - rimWidth(radius) * 0.5), 0, Math.PI * 2, true);
      light.clip("evenodd");
      light.drawImage(shineTexture(), -outer, -outer, outer * 2, outer * 2);
    }
    const tile = { canvas, shine, radius, extent, pixels, themeId: theme.id, simple };
    rimTiles.set(key, tile);
    rimPixels += tile.pixels;
    while (rimTiles.size > 128 || rimPixels > maxRimPixels) {
      rimCachePressure = true;
      // Preserve coverage of the size range. Plain LRU drops all the small
      // rims during a large-player pass, then all large rims on the next one.
      let evict = rimTiles.keys().next().value,
        closestRatio = 1.35;
      for (const [smallKey, small] of rimTiles) {
        for (const large of rimTiles.values()) {
          if (
            large === small ||
            large.themeId !== small.themeId ||
            large.simple !== small.simple ||
            large.canvas.width < small.canvas.width
          )
            continue;
          const ratio = large.radius / small.radius;
          if (ratio >= 1 && ratio < closestRatio) {
            closestRatio = ratio;
            evict = smallKey;
          }
        }
      }
      rimPixels -= rimTiles.get(evict).pixels;
      rimTiles.delete(evict);
    }
    return tile;
  }
  function decoratedFrame(ctx, theme, x, y, radius, scale, now, simple = false) {
    if (!theme || !Number.isFinite(radius) || radius <= 0 || !Number.isFinite(scale) || scale <= 0)
      return false;
    const screenRadius = radius * scale,
      tile = rimTile(theme, screenRadius, simple),
      // Match the exact outer contour even when a larger cached tile is used.
      ratio =
        (frameOuterRadius(radius, scale) * scale) / (tile.radius + 2 + rimWidth(tile.radius) / 2);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1 / scale, 1 / scale);
    const extent = tile.extent * ratio;
    ctx.drawImage(tile.canvas, -extent, -extent, extent * 2, extent * 2);
    if (tile.shine && screenRadius >= 24) {
      ctx.globalAlpha *= 0.65;
      ctx.rotate(reducedMotion.matches ? 0 : ((now % 9000) / 9000) * Math.PI * 2);
      ctx.drawImage(tile.shine, -extent, -extent, extent * 2, extent * 2);
    }
    ctx.restore();
    return true;
  }
  function accountFrame(
    ctx,
    account,
    x,
    y,
    radius,
    scale,
    now = performance.now(),
    simple = false,
  ) {
    return decoratedFrame(
      ctx,
      account?.premium ? accountThemes.premium : account?.vip ? accountThemes.vip : null,
      x,
      y,
      radius,
      scale,
      now,
      simple,
    );
  }
  function leagueFrame(ctx, id, x, y, radius, scale, now = performance.now(), simple = false) {
    return decoratedFrame(
      ctx,
      window.KillexLeagueAppearance.frameTheme(id),
      x,
      y,
      radius,
      scale,
      now,
      simple,
    );
  }
  // Optional frame selections share the thin arena rim, including in DOM previews.
  const variantRims = new Map();
  function variantFrame(ctx, id, x, y, radius, scale, now) {
    const catalog = window.KillexLeagueAppearance, frame = catalog.variantFrame(id);
    if (!frame) return false;
    let theme = variantRims.get(id);
    if (!theme) {
      const base = catalog.frameTheme(frame.baseId) || accountThemes[frame.baseId];
      if (!base) return false;
      theme = { ...base, id };
      variantRims.set(id, theme);
    }
    return decoratedFrame(ctx, theme, x, y, radius, scale, now, true);
  }
  function selectedFrame(
    ctx,
    id,
    account,
    x,
    y,
    radius,
    scale,
    now = performance.now(),
    simple = false,
  ) {
    if (variantFrame(ctx, id, x, y, radius, scale, now)) return true;
    if (leagueFrame(ctx, id, x, y, radius, scale, now, true)) return true;
    const resolved = window.KillexLeagueAppearance.resolveFrame(id, account);
    return accountFrame(ctx, { [resolved]: true }, x, y, radius, scale, now, simple);
  }
  function frameOuterRadius(radius, scale) {
    const screenRadius = radius * scale;
    const tileRadius = rimTileRadius(screenRadius);
    // Внешняя полоса paintRim: center + 0.4 + (band + 2.4) / 2.
    return ((tileRadius + 2 + rimWidth(tileRadius) / 2) * screenRadius) / tileRadius / scale;
  }
  window.KillexArenaArt = {
    FoodRenderer,
    accountFrame,
    leagueFrame,
    selectedFrame,
    frameOuterRadius,
  };
})();

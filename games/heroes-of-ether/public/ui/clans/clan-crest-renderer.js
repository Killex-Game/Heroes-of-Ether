/* Рисование герба из растровых слоёв и кеш изображений. */
"use strict";
(() => {
  const kit = window.KillexClanCrests,
    tiles = new Map(),
    composed = new Map(),
    ready = new Map(),
    SIZE = 512;
  const canvas = () =>
    Object.assign(document.createElement("canvas"), { width: SIZE, height: SIZE });
  // Единые визуальные пропорции: широкий щит глубже, овал и высокий щит шире.
  // Символ компонуется после преобразования рамки и никогда не растягивается.
  const proportions = {
    f01_round: 1,
    f02_oval: 0.86,
    f03_heater: 0.88,
    f04_broad: 1.06,
    f05_kite: 0.82,
    f06_diamond: 0.97,
    f07_octagon: 1,
    f08_cartouche: 0.94,
    f09_royal: 0.94,
    f10_grand: 0.94,
  };
  function bounds(data, accept) {
    let left = SIZE,
      top = SIZE,
      right = -1,
      bottom = -1;
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (accept(data, (y * SIZE + x) * 4)) {
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
    return right < left
      ? { x: 0, y: 0, w: SIZE, h: SIZE }
      : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }
  function load(id) {
    if (!tiles.has(id))
      tiles.set(
        id,
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const tile = canvas(),
              ctx = tile.getContext("2d", { willReadFrequently: true });
            ctx.drawImage(image, 0, 0, SIZE, SIZE);
            const pixels = ctx.getImageData(0, 0, SIZE, SIZE),
              box = bounds(pixels.data, (d, i) => d[i + 3] > 24);
            let mask = null,
              hole = null,
              inside = null,
              center = null;
            if (id.startsWith("f")) {
              // The enclosed transparent centre is the editable enamel layer. Derive
              // its mask once from the artwork so no gap remains beside the gold.
              const visited = new Uint8Array(SIZE * SIZE),
                queue = new Int32Array(SIZE * SIZE);
              let head = 0,
                tail = 0;
              const add = (i) => {
                if (i < 0 || i >= visited.length || visited[i] || pixels.data[i * 4 + 3] >= 80)
                  return;
                visited[i] = 1;
                queue[tail++] = i;
              };
              for (let i = 0; i < SIZE; i++) {
                add(i);
                add((SIZE - 1) * SIZE + i);
                add(i * SIZE);
                add(i * SIZE + SIZE - 1);
              }
              while (head < tail) {
                const i = queue[head++],
                  x = i % SIZE;
                if (x > 0) add(i - 1);
                if (x < SIZE - 1) add(i + 1);
                add(i - SIZE);
                add(i + SIZE);
              }
              mask = canvas();
              const m = mask.getContext("2d", { willReadFrequently: true }),
                fill = m.createImageData(SIZE, SIZE);
              for (let i = 0; i < visited.length; i++) if (!visited[i]) fill.data[i * 4 + 3] = 255;
              m.putImageData(fill, 0, 0);
              hole = bounds(fill.data, (d, i) => d[i + 3] && pixels.data[i + 3] < 80);
              // Только внутреннее поле, без металлического края и внешнего орнамента.
              inside = new Uint8Array(SIZE * SIZE);
              let count = 0,
                sumX = 0,
                sumY = 0;
              for (let i = 0; i < inside.length; i++) {
                if (!visited[i] && pixels.data[i * 4 + 3] < 40) {
                  inside[i] = 1;
                  count++;
                  sumX += i % SIZE;
                  sumY += Math.floor(i / SIZE);
                }
              }
              center = { x: sumX / count, y: sumY / count };
            }
            const points = [];
            if (!id.startsWith("f"))
              for (let y = box.y; y < box.y + box.h; y += 4)
                for (let x = box.x; x < box.x + box.w; x += 4)
                  if (pixels.data[(y * SIZE + x) * 4 + 3] > 80) points.push([x - box.x, y - box.y]);
            resolve({ tile, box, mask, hole, inside, center, points });
          };
          image.onerror = () => reject(Error("Не удалось загрузить рисунок герба: " + id));
          image.src = id.startsWith("f") ? kit.frameSource(id) : kit.symbolSource(id);
        }),
      );
    return tiles.get(id);
  }
  async function render(value) {
    const config = kit.normalize(value),
      key = JSON.stringify(config);
    if (composed.has(key)) return composed.get(key);
    const pending = (async () => {
      const [frame, symbol, field] = await Promise.all([
        load(config.frame),
        config.symbol ? load(config.symbol) : null,
        config.pattern
          ? new Promise((resolve, reject) => {
              const image = new Image();
              image.onload = () => resolve(image);
              image.onerror = () => reject(Error("Не удалось нарисовать поле герба"));
              image.src =
                "data:image/svg+xml;charset=utf-8," + encodeURIComponent(kit.fieldSvg(config));
            })
          : null,
      ]);
      const tile = canvas(),
        ctx = tile.getContext("2d", { willReadFrequently: true }),
        color = kit.colors.find((c) => c.id === config.color).hex;
      const b = frame.box,
        aspect = proportions[config.frame] || b.w / b.h;
      const width = 472 * Math.min(1, aspect),
        height = 472 / Math.max(1, aspect);
      const left = (SIZE - width) / 2,
        top = (SIZE - height) / 2;
      const sx = width / b.w,
        sy = height / b.h;
      const drawFrame = (image) =>
        ctx.drawImage(image, b.x, b.y, b.w, b.h, left, top, width, height);
      const gradient = ctx.createRadialGradient(180, 135, 8, 256, 256, 300);
      gradient.addColorStop(0, color);
      gradient.addColorStop(0.25, color);
      gradient.addColorStop(1, "#22162b");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, SIZE, SIZE);
      if (field) drawFrame(field);
      ctx.globalCompositeOperation = "destination-in";
      drawFrame(frame.mask);
      ctx.globalCompositeOperation = "source-over";
      const metal = kit.metals.find((m) => m.id === config.metal);
      if (metal?.tint) {
        frame.metals ||= new Map();
        if (!frame.metals.has(metal.id)) {
          const tinted = canvas(),
            t = tinted.getContext("2d", { willReadFrequently: true });
          t.drawImage(frame.tile, 0, 0);
          const pixels = t.getImageData(0, 0, SIZE, SIZE),
            d = pixels.data;
          for (let i = 0; i < d.length; i += 4) {
            const light = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
            for (let channel = 0; channel < 3; channel++)
              d[i + channel] = light * metal.tint[channel];
          }
          t.putImageData(pixels, 0, 0);
          frame.metals.set(metal.id, tinted);
        }
        drawFrame(frame.metals.get(metal.id));
      } else drawFrame(frame.tile);
      if (symbol) {
        const area = frame.hole,
          s = symbol.box,
          cx = left + (frame.center.x - b.x) * sx,
          cy = top + (frame.center.y - b.y) * sy;
        const fits = (ratio) =>
          symbol.points.every(([x, y]) => {
            const px = (cx + (x - s.w / 2) * ratio - left) / sx + b.x;
            const py = (cy + (y - s.h / 2) * ratio - top) / sy + b.y;
            return [
              [0, 0],
              [-9, 0],
              [9, 0],
              [0, -9],
              [0, 9],
            ].every(([dx, dy]) => {
              const x1 = Math.round(px + dx / sx),
                y1 = Math.round(py + dy / sy);
              return x1 >= 0 && x1 < SIZE && y1 >= 0 && y1 < SIZE && frame.inside[y1 * SIZE + x1];
            });
          });
        let low = 0,
          high = Math.min((area.w * sx * 0.82) / s.w, (area.h * sy * 0.82) / s.h);
        for (let i = 0; i < 12; i++) {
          const middle = (low + high) / 2;
          if (fits(middle)) low = middle;
          else high = middle;
        }
        const ratio = low;
        ctx.drawImage(
          symbol.tile,
          s.x,
          s.y,
          s.w,
          s.h,
          cx - (s.w * ratio) / 2,
          cy - (s.h * ratio) / 2,
          s.w * ratio,
          s.h * ratio,
        );
      }
      return tile.toDataURL("image/webp", 0.9);
    })();
    if (composed.size >= 64) composed.delete(composed.keys().next().value);
    composed.set(key, pending);
    try {
      const url = await pending;
      if (ready.size >= 128) ready.delete(ready.keys().next().value);
      ready.set(key, url);
      return url;
    } catch (error) {
      composed.delete(key);
      throw error;
    }
  }
  kit.paintImage = (image, value, legacy) => {
    const version = JSON.stringify(value);
    image.dataset.crestVersion = version;
    if (!value) { image.src = kit.defaultSource(legacy); return Promise.resolve(); }
    const key = JSON.stringify(kit.normalize(value));
    const cached = ready.get(key);
    if (cached) { image.src = cached; image.style.visibility = ""; return Promise.resolve(); }
    image.removeAttribute("src");
    image.style.visibility = "hidden";
    return render(value)
      .then((url) => {
        if (image.dataset.crestVersion === version) { image.src = url; image.style.visibility = ""; }
      })
      .catch(() => {
        image.dataset.artError = "true";
      });
  };
  kit.prepare = async (value) => { if (value) await render(value); };
  kit.prepareEditor = async (value) => {
    const c = kit.normalize(value) || kit.DEFAULT;
    await Promise.all([
      ...kit.frames.map(frame => render({ ...c, frame: frame.id })),
      ...kit.metals.map(metal => render({ ...c, metal: metal.id })),
      ...kit.symbols.map(symbol => new Promise(resolve => {
        const image = new Image();
        image.onload = image.onerror = resolve;
        image.src = kit.symbolSource(symbol.id, 128);
      })),
    ]);
  };
  document.addEventListener("killex:profile", ({detail}) => {
    if (detail?.clanCrest) render(detail.clanCrest).catch(() => {});
  });
  kit.renderRaster = render;
})();

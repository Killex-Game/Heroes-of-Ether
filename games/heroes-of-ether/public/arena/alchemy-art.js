"use strict";
(() => {
  const rules = window.KillexAlchemyRules, entries = new Map();
  const shell = new Image(); shell.src = "assets/events/ether-alchemy/v1/ingredient-shell.svg?v=20261116-soft-glass";
  const cropped = new Set();
  // Remove the old painted shell's corner glints in presentation only.
  // The accepted ingredient files and their own glossy highlights stay unchanged.
  const cuts = {
    leaf: [[0,.73],[.73,0],[1,0],[1,1],[0,1]],
    berries: [[0,.73],[.73,0],[1,0],[1,1],[0,1]],
    mushroom: [[0,.73],[.53,.20],[1,.65],[1,1],[0,1]],
    dew: [[0,.80],[.55,.20],[1,.67],[1,1],[0,1]],
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  function sprite(id) {
    let entry = entries.get(id);
    if (!entry) {
      const item = rules.ingredient(id); if (!item) return null;
      const source = new Image(); source.src = item.image;
      entry = { source, canvas: null }; entries.set(id, entry);
    }
    if (entry.canvas) return entry.canvas;
    if (!entry.source.complete || !entry.source.naturalWidth || !shell.complete || !shell.naturalWidth) return null;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256;
    const c = canvas.getContext("2d");
    // Cache a faint glass backing and contrast edge for pale arena floors.
    // Keep the shared shell's single highlight; no extra work per frame.
    c.beginPath(); c.arc(128, 128, 108, 0, Math.PI * 2);
    c.fillStyle = "rgba(214, 244, 237, 0.09)"; c.fill();
    c.strokeStyle = "rgba(26, 104, 112, 0.35)"; c.lineWidth = 3; c.stroke();
    // Approved paintings are retained byte-for-byte. Their original outer rim
    // is clipped in presentation; every collectible uses the same shell asset.
    c.save();
    if (cropped.has(id)) {
      c.beginPath(); c.arc(128, 128, 86, 0, Math.PI * 2); c.clip();
      c.beginPath(); cuts[id].forEach(([x,y], index) => index ? c.lineTo(x * 256, y * 256) : c.moveTo(x * 256, y * 256)); c.closePath(); c.clip();
    }
    const inset = cropped.has(id) ? 0 : 25.6;
    c.drawImage(entry.source, inset, inset, 256 - inset * 2, 256 - inset * 2); c.restore();
    c.drawImage(shell, 0, 0, 256, 256);
    entry.canvas = canvas;
    return canvas;
  }
  function element(id) {
    const item = rules.ingredient(id), wrap = document.createElement("span");
    wrap.className = "alchemy-ingredient-art";
    wrap.dataset.ingredient = id;
    const image = document.createElement("img"); image.loading = "lazy"; image.src = item.image; image.alt = item.name; image.draggable = false;
    let content = image;
    if (cropped.has(id)) {
      content = document.createElement("span"); content.className = "alchemy-approved-ingredient";
      image.style.clipPath = "polygon(" + cuts[id].map(([x,y]) => x * 100 + "% " + y * 100 + "%").join(",") + ")";
      content.append(image);
    } else image.className = "alchemy-plain-ingredient";
    const rim = document.createElement("img"); rim.loading = "lazy"; rim.src = shell.src; rim.alt = ""; rim.draggable = false;
    wrap.append(content, rim); return wrap;
  }
  function draw(ctx, item, x, y, radius, now) {
    const image = sprite(item.alchemyIngredient); if (!image) return;
    const scale = reduced.matches ? 1 : 1 + 0.035 * Math.sin(now * Math.PI * 2 / 3000);
    const size = radius * 2.6 * scale;
    ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  }
  window.KillexAlchemyArt = { sprite, element, draw };
})();

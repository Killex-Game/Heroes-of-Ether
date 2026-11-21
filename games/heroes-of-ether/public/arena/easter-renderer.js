"use strict";
(() => {
  function sprite(src, fallback) {
    const img = new Image();
    const tile = document.createElement("canvas");
    tile.width = tile.height = 128;
    img.onload = () => {
      tile.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0, 128, 128);
      tile.ready = true;
    };
    if (fallback)
      img.onerror = () => {
        img.onerror = null;
        img.src = fallback;
      };
    img.src = src;
    return tile;
  }
  const sprites = window.KillexEaster.eggs.map((egg) => sprite(egg.image)),
    thorn = sprite("/assets/arena/thorn-v2.webp");
  window.KillexEasterRenderer = {
    draw(ctx, items) {
      for (const item of items) {
        const image = item.eggType === null ? thorn : sprites[item.eggType],
          r = item.radius;
        if (image?.ready) ctx.drawImage(image, item.x - r, item.y - r, r * 2, r * 2);
      }
    },
  };
})();

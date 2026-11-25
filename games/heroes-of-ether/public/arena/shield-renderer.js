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
  let sphereImage;
  function sphere() {
    if (!sphereImage && typeof Image !== "undefined") {
      sphereImage = new Image();
      sphereImage.src = "assets/shields/sphere-static-v2.webp";
    }
    return sphereImage;
  }
  function clearSphereCache() { sphereImage = null; }
  // A single immutable texture; caller timing never changes its appearance.
  function drawSphere(ctx, { x, y, radius }) {
    const img = sphere();
    if (!img?.complete || !img.naturalWidth) return;
    const edge = radius * 1.24;
    ctx.drawImage(img, x - edge, y - edge, edge * 2, edge * 2);
  }
  class Renderer {
    constructor() {
      sphere();
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

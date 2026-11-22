(function (root, factory) {
  const common = typeof module === "object" && module.exports;
  const api = factory(common ? require("../shared/arena-emotes") : root.KillexEmotes,
    common ? require("./accessory-renderer") : root.KillexAccessoryView);
  if (common) module.exports = api;
  else root.KillexEmoteView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (rules, accessories) => {
  "use strict";
  function placement(outfit, body, scale) {
    scale = Math.max(0.01, scale);
    const size = Math.max(24, Math.min(64, body.radius * scale * 0.9)) / scale;
    let top = body.y - body.radius;
    let hat = null;
    for (const rect of accessories.placements(outfit, { ...body, scale })) {
      // The emote overlays the upper part of the hat instead of floating above it.
      if (rect.y < top) { top = rect.y; hat = rect; }
    }
    return { x: body.x - size / 2, y: top - size + (hat ? Math.min(size * .4, hat.height * .55) : 0), width: size, height: size };
  }
  class Renderer {
    constructor(imageFactory = () => new Image()) {
      this.active = new Map(); this.images = new Map(); this.imageFactory = imageFactory;
    }
    clear() { this.active.clear(); }
    receive(message, at) {
      if (!rules.valid(message?.index) || typeof message.playerId !== "string" ||
          message.playerId.length > 80 || !Number.isSafeInteger(message.spawnSerial) ||
          !Number.isFinite(at)) return;
      this.active.delete(message.playerId);
      this.active.set(message.playerId, { index: message.index,
        variant: message.variant === "pets" ? "pets" : "basic",
        serial: message.spawnSerial, until: at + rules.DURATION_MS });
      if (this.active.size > 512) this.active.delete(this.active.keys().next().value);
      this.image(message.index, message.variant);
    }
    prune(at) {
      for (const [id, item] of this.active) if (item.until <= at) this.active.delete(id);
    }
    image(index, variant) {
      const source = variant === "pets" ? rules.items[index - 1].premiumImage : rules.items[index - 1].image;
      if (!this.images.has(source)) {
        const image = this.imageFactory();
        image.decoding = "async";
        image.src = source;
        this.images.set(source, image);
      }
      return this.images.get(source);
    }
    draw(ctx, player, body, scale, at, bounds) {
      const item = this.active.get(player.id);
      if (!item || item.until <= at || player.dead || player.departure ||
          item.serial !== player.spawnSerial) return;
      const image = this.image(item.index, item.variant);
      if (!image.complete || !image.naturalWidth) return;
      const rect = placement(player.outfit, body, scale);
      if (bounds && (rect.x > bounds.right || rect.x + rect.width < bounds.left ||
          rect.y > bounds.bottom || rect.y + rect.height < bounds.top)) return;
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    }
  }
  return { Renderer, placement };
});

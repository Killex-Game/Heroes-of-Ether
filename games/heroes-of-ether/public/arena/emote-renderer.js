(function (root, factory) {
  const common = typeof module === "object" && module.exports;
  const api = factory(common ? require("../shared/arena-emotes") : root.KillexEmotes,
    common ? require("./accessory-renderer") : root.KillexAccessoryView);
  if (common) module.exports = api;
  else root.KillexEmoteView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (rules, accessories) => {
  "use strict";
  const PREMIUM_SIZE = 1.2;
  const MOTIONS = {
    shake: [[0, .85, 0, 0], [.12, 1, 0, 0], [.22, 1, -7, 0], [.29, 1, 7, 0],
      [.36, 1, -7, 0], [.43, 1, 7, 0], [.55, 1, 0, 0], [1, 1, 0, 0]],
    tender: [[0, .85, 0, 0], [.12, 1, 0, 0], [.30, 1.06, -6, 0], [.55, 1, 0, 0], [1, 1, 0, 0]],
    joy: [[0, .85, 0, 8], [.12, 1, 0, 0], [.24, 1, 0, -7], [.35, 1, 0, 0],
      [.46, 1, 0, -4], [.58, 1, 0, 0], [1, 1, 0, 0]],
  };
  const MOTION_BY_INDEX = [null, MOTIONS.shake, MOTIONS.shake, MOTIONS.joy, MOTIONS.tender,
    MOTIONS.tender, MOTIONS.joy, MOTIONS.shake, MOTIONS.tender, MOTIONS.tender];
  // The approved preview uses CSS ease (.25, .1, .25, 1). Sample once per
  // player/frame and reuse it for split cells, with no timers or new textures.
  function ease(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 5; i++) {
      const error = ((t - .75) * t + .75) * t - x;
      t = Math.max(0, Math.min(1, t - error / (3 * t * t - 1.5 * t + .75)));
    }
    return ((-1.7 * t + 2.4) * t + .3) * t;
  }
  function motion(index, progress, out, reduced = false) {
    out.scale = 1; out.angle = 0; out.lift = 0; out.alpha = 1;
    if (reduced) return out;
    const t = Math.max(0, Math.min(1, progress));
    const keys = MOTION_BY_INDEX[index];
    for (let i = 1; i < keys.length; i++) {
      if (t > keys[i][0]) continue;
      const a = keys[i - 1], b = keys[i], weight = ease((t - a[0]) / (b[0] - a[0]));
      out.scale = a[1] + (b[1] - a[1]) * weight;
      out.angle = (a[2] + (b[2] - a[2]) * weight) * Math.PI / 180;
      out.lift = a[3] + (b[3] - a[3]) * weight;
      break;
    }
    out.alpha = t < .12 ? ease(t / .12) : t > .85 ? 1 - ease((t - .85) / .15) : 1;
    return out;
  }
  function placement(outfit, body, scale, sizeFactor = 1) {
    scale = Math.max(0.01, scale);
    const size = Math.max(24, Math.min(64, body.radius * scale * 0.9)) * sizeFactor / scale;
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
      this.motionPreference = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
      this.atlases = new Map();
      this.frameAt = null; this.renderMs = 0; this.clock = () => performance.now();
    }
    clear() { this.active.clear(); }
    receive(message, at) {
      if (!rules.valid(message?.index) || typeof message.playerId !== "string" ||
          message.playerId.length > 80 || !Number.isSafeInteger(message.spawnSerial) ||
          !Number.isFinite(at)) return;
      this.active.delete(message.playerId);
      this.active.set(message.playerId, { index: message.index,
        variant: message.variant === "pets" ? "pets" : "basic",
        serial: message.spawnSerial, start: at, until: at + rules.DURATION_MS,
        sampledAt: null, motion: { scale: 1, angle: 0, lift: 0, alpha: 1 } });
      if (this.active.size > 512) this.active.delete(this.active.keys().next().value);
      this.image(message.index, message.variant);
      if(message.variant === "pets" && !this.motionPreference?.matches && MOTION_BY_INDEX[message.index] !== MOTIONS.joy)this.atlas(message.index);
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
    atlas(index) {
      if(!this.atlases.has(index)) {
        const image=this.imageFactory();image.decoding="async";
        image.src=rules.items[index-1].premiumImage.replace("pets-v1/","pets-motion-v2/").replace(".webp",".png");
        this.atlases.set(index,image);
      }
      return this.atlases.get(index);
    }
    draw(ctx, player, body, scale, at, bounds) {
      const item = this.active.get(player.id);
      if (!item || item.until <= at || player.dead || player.departure ||
          item.serial !== player.spawnSerial) return;
      const image = this.image(item.index, item.variant);
      if (!image.complete || !image.naturalWidth) return;
      const premium = item.variant === "pets";
      const rect = placement(player.outfit, body, scale, premium ? PREMIUM_SIZE : 1);
      // Include the small rotation/bounce in the culling envelope.
      const margin = premium ? rect.width * .2 : 0;
      if (bounds && (rect.x - margin > bounds.right || rect.x + rect.width + margin < bounds.left ||
          rect.y - margin > bounds.bottom || rect.y + rect.height + margin < bounds.top)) return;
      if (!premium) { ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height); return; }
      if(this.frameAt !== at){this.frameAt=at;this.renderMs=0;}
      const started=this.clock();
      try {
      if (item.sampledAt !== at) {
        motion(item.index, (at - item.start) / rules.DURATION_MS, item.motion, !!this.motionPreference?.matches);
        item.sampledAt = at;
      }
      const m = item.motion;
      if (m.alpha <= 0) return;
      if (m.scale === 1 && m.angle === 0 && m.lift === 0 && m.alpha === 1) {
        ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height); return;
      }
      // Software renderers can be much slower at rotated sprites. Keep the
      // same size, fade and lively wobble when the frame's emote budget is spent.
      const simplified=this.renderMs>=2;
      const angle = simplified ? 0 : Math.round(m.angle * 180 / Math.PI);
      const atlas = angle ? this.atlas(item.index) : null;
      if (!angle || (atlas.complete && atlas.naturalWidth)) {
        const width=rect.width*m.scale, height=rect.height*m.scale;
        const x=rect.x+(rect.width-width)*.5+(simplified?Math.sin(m.angle)*rect.width*.4:0), y=rect.y+(rect.height-height)*.7+m.lift*rect.width/77;
        const alpha=ctx.globalAlpha;ctx.globalAlpha=alpha*m.alpha;
        if(angle) {
          const cell=angle+7,pad=width/6;
          ctx.drawImage(atlas,cell%5*192,Math.floor(cell/5)*192,192,192,x-pad,y-pad,width+pad*2,height+pad*2);
        } else ctx.drawImage(image,x,y,width,height);
        ctx.globalAlpha=alpha;
        return;
      }
      ctx.save();
      ctx.globalAlpha *= m.alpha;
      ctx.translate(rect.x + rect.width * .5, rect.y + rect.height * .7 + m.lift * rect.width / 77);
      if (m.angle) ctx.rotate(m.angle);
      if (m.scale !== 1) ctx.scale(m.scale, m.scale);
      ctx.drawImage(image, -rect.width * .5, -rect.height * .7, rect.width, rect.height);
      ctx.restore();
      } finally { this.renderMs+=this.clock()-started; }
    }
  }
  return { Renderer, placement, motion, PREMIUM_SIZE };
});

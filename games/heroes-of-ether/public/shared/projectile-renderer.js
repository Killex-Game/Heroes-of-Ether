/* Сглаживание, поворот и рисование летящих и удерживаемых бустеров. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexProjectiles = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  // Ось от крепления/рукоятки к рабочей части на текущей иллюстрации (Y направлен вниз).
  // У крюка рабочая часть снизу слева, у шила — острие сверху справа.
  // Остальные, ненаправленные предметы сохраняют вертикаль.
  const nativeAngles = {
    rocket: -Math.PI / 4,
    warheads: -Math.PI / 4,
    harpoon: -Math.PI / 4,
    hook: (Math.PI * 3) / 4,
    glove: -Math.PI / 3,
    axe: -Math.PI / 3,
    knuckles: -Math.PI / 3,
    fire: Math.PI / 2,
    pet_fire: Math.PI / 2,
    pet_claw: -Math.PI / 4,
    pet_glove: -Math.PI / 4,
    fire_sword: -Math.PI / 4,
    awl: -Math.PI / 4,
  };
  const spinning = new Set([
    "cake",
    "freeze",
    "web",
    "mine",
    "lock",
    "axe",
    "stone",
    "poison",
    "mega_poison",
  ]);
  function appearance(shot, scale, reducedMotion = false) {
    const landed = shot.landed === true;
    const size = shot.held
      ? shot.imageSize || shot.length / 1.1
      : clamp((landed ? 48 : 38) * scale, landed ? 30 : 22, landed ? 48 : 38) / scale;
    const rotation =
      spinning.has(shot.boosterId) && !landed && !reducedMotion
        ? ((shot.spinMs || 0) * Math.PI * 2) / 3600
        : !landed && Object.hasOwn(nativeAngles, shot.boosterId)
          ? shot.heading - nativeAngles[shot.boosterId]
          : 0;
    return { size, rotation };
  }
  class Motion {
    constructor() {
      this.states = new Map();
    }
    clear() {
      this.states.clear();
    }
    sample(state, now) {
      const t = clamp((now - state.receivedAt) / state.duration, 0, 1);
      return {
        ...state.shot,
        x: state.fromX + (state.shot.x - state.fromX) * t,
        y: state.fromY + (state.shot.y - state.fromY) * t,
        heading: state.heading,
        spinMs:
          state.spinMs +
          (state.shot.moving !== false && !state.shot.landed
            ? clamp(now - state.receivedAt, 0, 250)
            : 0),
      };
    }
    sync(shots, now) {
      const alive = new Set();
      for (const shot of shots) {
        if (
          !shot ||
          typeof shot.id !== "string" ||
          typeof shot.boosterId !== "string" ||
          !Number.isFinite(shot.x) ||
          !Number.isFinite(shot.y)
        )
          continue;
        alive.add(shot.id);
        const old = this.states.get(shot.id),
          previous = old && this.sample(old, now);
        const dx = Number.isFinite(shot.dx) ? shot.dx : old ? shot.x - old.shot.x : 0;
        const dy = Number.isFinite(shot.dy) ? shot.dy : old ? shot.y - old.shot.y : 0;
        const heading = Math.hypot(dx, dy) > 0.0001 ? Math.atan2(dy, dx) : old?.heading || 0;
        // В точке отражения или приземления не срезаем поворот сглаживанием.
        const snap =
          !old ||
          shot.landed ||
          shot.moving === false ||
          shot.motionVersion !== old.shot.motionVersion ||
          Math.cos(heading - old.heading) < 0.5;
        this.states.set(shot.id, {
          shot: { ...shot },
          heading,
          spinMs: previous?.spinMs || 0,
          receivedAt: now,
          duration: clamp(old ? now - old.receivedAt : 50, 16, 100),
          fromX: snap ? shot.x : previous.x,
          fromY: snap ? shot.y : previous.y,
        });
      }
      for (const id of this.states.keys()) if (!alive.has(id)) this.states.delete(id);
    }
    values(now) {
      return [...this.states.values()].map((s) => this.sample(s, now));
    }
  }
  class Renderer {
    constructor() {
      this.motion = new Motion();
      this.icons = new Map();
      this.images = new Map();
    }
    clear() {
      this.motion.clear();
    }
    setCatalog(items) {
      const rocket = items.find((item) => item.id === "rocket");
      for (const item of items)
        if ((item.target === "direction" || item.kind === "vortex") && item.icon) {
          // Один бустер выпускает семь отдельных ракет; в полёте не рисуем целый залп на каждой.
          const url = item.id === "warheads" && rocket ? rocket.icon : item.icon;
          this.icons.set(item.id, url);
          if (this.images.has(url)) continue;
          const img = new Image();
          this.images.set(url, img);
          img.onload = () => {
            // Один раз уменьшаем исходную картинку для частой отрисовки на Canvas.
            const tile = document.createElement("canvas");
            tile.width = tile.height = 128;
            const context = tile.getContext("2d", { willReadFrequently: true });
            if (!context) return;
            context.imageSmoothingQuality = "high";
            const ratio = Math.min(128 / img.naturalWidth, 128 / img.naturalHeight);
            const w = img.naturalWidth * ratio,
              h = img.naturalHeight * ratio;
            context.drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
            this.images.set(url, tile);
          };
          img.src = url;
        }
    }
    sync(shots, now) {
      this.motion.sync(shots, now);
    }
    draw(
      ctx,
      {
        now,
        scale,
        left,
        top,
        right,
        bottom,
        reducedMotion = false,
        shots = null,
        bodyFor = () => null,
        ownerFor = () => null,
      },
    ) {
      for (const shot of shots || this.motion.values(now)) {
        // Only the drawing position changes. Keep the snapshot immutable
        // without cloning every projectile on every rendered frame.
        let x = shot.x, y = shot.y;
        if (shot.followPart) {
          const part = bodyFor(shot.ownerId, shot.partId);
          if (!part) continue;
          x = part.x;
          y = part.y;
        }
        if (shot.followOwner) {
          const owner = ownerFor(shot.ownerId);
          if (!owner) continue;
          x = owner.x;
          y = owner.y;
        }
        if (shot.held) {
          const body = bodyFor(shot.ownerId, shot.partId);
          if (!body) continue;
          x = body.x + shot.dx * (body.radius + shot.length * 0.5);
          y = body.y + shot.dy * (body.radius + shot.length * 0.5);
        }
        const { size, rotation } = appearance(shot, scale, reducedMotion),
          margin = Math.max(size * 1.5, shot.areaRadius || 0);
        if (
          x < left - margin ||
          x > right + margin ||
          y < top - margin ||
          y > bottom + margin
        )
          continue;
        ctx.save();
        ctx.translate(x, y);
        if (shot.landed && shot.areaRadius > 0) {
          ctx.beginPath();
          ctx.arc(0, 0, shot.areaRadius, 0, Math.PI * 2);
          ctx.strokeStyle = "#a58ac477";
          ctx.lineWidth = 2 / scale;
          ctx.stroke();
        }
        // Вихрь обозначен в строке эффектов. Зона остаётся, большая копия над «T» не нужна.
        if (shot.boosterId === "vortex") {
          ctx.restore();
          continue;
        }
        ctx.rotate(rotation);
        const img = this.images.get(this.icons.get(shot.boosterId));
        if (img && (img.complete === undefined || (img.complete && img.naturalWidth)))
          ctx.drawImage(img, -size / 2, -size / 2, size, size);
        else {
          // Загрузка изображения не делает снаряд невидимым.
          ctx.beginPath();
          ctx.arc(0, 0, size * 0.23, 0, Math.PI * 2);
          ctx.fillStyle = "#b49bd0";
          ctx.fill();
          ctx.strokeStyle = "#e9d7ae";
          ctx.lineWidth = 1.2 / scale;
          ctx.stroke();
        }
        ctx.restore();
      }
    }
  }
  return { Motion, Renderer, appearance };
});

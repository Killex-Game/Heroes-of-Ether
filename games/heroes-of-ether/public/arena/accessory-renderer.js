/* Рисование шапки и бабочки на шаре. */
(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("../shared/accessory-catalog")
      : root.KillexAccessories,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexAccessoryView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (accessories) => {
  "use strict";
  // Украшения не закрывают соседние шары даже при большой массе и приближении.
  const MAX_HAT_WIDTH_PX = 90;
  const MAX_BOW_WIDTH_PX = 64;
  const TEXTURE_WIDTH = 256;
  const CONTOUR_STRIPS = 64;
  const MAX_CONTOURS = 48;
  // Линия переднего ободка внутри изображения. Прозрачные поля и подвески
  // не являются опорой: каждый рисунок садится ободком на верх шара.
  const hatFits = {
    title_experienced_hat: { cx: .5, cy: 2.04571, radius: 1.33, aspect: 1, widthRatio: 1.18000000 },
    title_expert_hat: { cx: .5, cy: 1.49624, radius: 0.905, aspect: 0.931640625, widthRatio: 1.18000000 },
    title_sage_hat: { cx: .5, cy: 1.30247, radius: 0.72, aspect: 1, widthRatio: 1.18000000 },
    title_master_hat: { cx: .5, cy: 1.63916, radius: 1.065, aspect: 0.923828125, widthRatio: 1.18000000 },
    title_pro_hat: { cx: .5, cy: 1.40018, radius: 0.8, aspect: 1, widthRatio: 1.18000000 },
    title_prince_hat: { cx: .5, cy: 2.13705, radius: 1.485, aspect: 1, widthRatio: 1.18000000 },
    title_king_hat: { cx: .5, cy: 2.19377, radius: 1.51, aspect: 1, widthRatio: 1.18000000 },
    title_emperor_hat: { cx: .5, cy: 1.5778, radius: 0.98, aspect: 0.943359375, widthRatio: 1.18000000 },
    title_boss_hat: { cx: .5, cy: 1.74817, radius: 1.22, aspect: 0.916015625, widthRatio: 1.18000000 },
    viking_hat: { cx: .5, cy: 1.4105, radius: 0.765, aspect: 1, widthRatio: 1.16084537 },
    sombrero_hat: { cx: .5, cy: 1.87122, radius: 1.23, aspect: 1, widthRatio: 0.99437011 },
    mushroom_hat: { cx: .5, cy: 1.57514, radius: 0.99, aspect: 1, widthRatio: 0.76688846 },
    cowboy_hat: { cx: .5, cy: 2.65634, radius: 2, aspect: 1, widthRatio: 0.97685711 },
    baker_hat: { cx: .5, cy: 1.83769, radius: 1.125, aspect: 1, widthRatio: 1.09764168 },
    forest_hood: { cx: .5, cy: 1.28721, radius: 0.69, aspect: 1, widthRatio: 1.18000000 },
    star_pilot: { cx: .5, cy: 1.32641, radius: 0.79, aspect: 0.8515625, widthRatio: 1.18000000 },
    captain_tricorn: { cx: .5, cy: 1.66062, radius: 1.015, aspect: 1, widthRatio: 0.98446571 },
    dawn_circlet: { cx: .5, cy: 1.72401, radius: 1.07, aspect: 1, widthRatio: 0.85542123 },
    polar_hat: { cx: .5, cy: 1.29795, radius: 0.66, aspect: 1, widthRatio: 1.18000000 },
    alchemist_hat: { cx: .5, cy: 2.32635, radius: 1.535, aspect: 1, widthRatio: 1.12048510 },
    magician_hat: { cx: .5, cy: 2.59192, radius: 1.87, aspect: 1, widthRatio: 0.97419808 },
    ash_crown: { cx: .5, cy: 1.74214, radius: 1.09, aspect: 1, widthRatio: 0.78721015 },
    tracker_hat: { cx: .5, cy: 2.25794, radius: 1.59, aspect: 1, widthRatio: 1.10105410 },
    may_wreath: { cx: .5, cy: 1.24636, radius: 0.57, aspect: 1, widthRatio: 1.18000000 },
    royal_page: { cx: .5, cy: 1.4812, radius: 0.815, aspect: 1, widthRatio: 1.13693362 },
    // The cloth base seats on the sphere; the blue visor overlaps its front.
    novice_hat: { cx: .5, cy: 1.485, radius: 0.85, aspect: 1, widthRatio: 1.12525029 },
    rabbit_ears: { cx: .5, cy: 1.58572, radius: 0.825, aspect: 1, widthRatio: 1.18000000 },
  };
  function placements(outfit, { x, y, radius: r, scale = 1 }) {
    const worn = accessories.outfit(outfit),
      result = [],
      screenScale = Math.max(0.01, scale);
    // Поля шапки опираются на верхнюю дугу шара.
    if (worn.hat) {
      const fit = hatFits[worn.hat] || hatFits.novice_hat,
        width = Math.min(r * fit.widthRatio, MAX_HAT_WIDTH_PX / screenScale),
        height = width * fit.aspect;
      result.push({
        id: worn.hat,
        x: x - width / 2,
        // При уменьшении опора остаётся на верхней границе, а не у центра шара.
        y: y - r - width * (fit.cy - fit.radius) + width * .012,
        width,
        height,
      });
    }
    if (worn.bow) {
      const width = Math.min(r * 0.92, MAX_BOW_WIDTH_PX / screenScale);
      result.push({
        id: worn.bow,
        x: x - width / 2,
        y: y + r - width / 4,
        width,
        height: width / 2,
      });
    }
    return result;
  }
  function contour(id, ratio) {
    // At most 38 shapes per hat; screen-space seating error stays below 0.3 px.
    return { id, ratio: Math.round(Math.min(1.18, Math.max(0, ratio)) * 32) / 32 };
  }
  function contourOffset(id, x, ratio) {
    const fit = hatFits[id] || hatFits.novice_hat,
      dx = Math.min(Math.abs(x - fit.cx), fit.radius * .999),
      source = dx * dx / (fit.radius + Math.sqrt(fit.radius * fit.radius - dx * dx)),
      target = dx * dx * ratio / (1 + Math.sqrt(1 - (dx * ratio) ** 2));
    return target - source;
  }
  function fitImage(image, id, ratio, makeCanvas) {
    const shape = contour(id, ratio),
      height = image.naturalHeight / image.naturalWidth * TEXTURE_WIDTH,
      offsets = Array.from({ length: CONTOUR_STRIPS }, (_, x) =>
        contourOffset(id, (x + .5) / CONTOUR_STRIPS, shape.ratio) * TEXTURE_WIDTH),
      top = Math.floor(Math.min(0, ...offsets)) - 1,
      bottom = Math.ceil(Math.max(0, ...offsets)) + 1,
      canvas = makeCanvas(TEXTURE_WIDTH, Math.ceil(height + bottom - top)),
      ctx = canvas.getContext("2d");
    // Warp once when the curvature bucket changes, never slice images each frame.
    for (let x = 0; x < CONTOUR_STRIPS; x++)
      ctx.drawImage(image, x * image.naturalWidth / CONTOUR_STRIPS, 0,
        image.naturalWidth / CONTOUR_STRIPS, image.naturalHeight,
        x * TEXTURE_WIDTH / CONTOUR_STRIPS, offsets[x] - top,
        TEXTURE_WIDTH / CONTOUR_STRIPS, height);
    return { canvas, top: top / TEXTURE_WIDTH };
  }
  function canvasElement(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    return canvas;
  }
  class Renderer {
    constructor() {
      this.images = new Map();
      this.contours = new Map();
    }
    fitted(image, id, ratio) {
      const shape = contour(id, ratio), key = id + ":" + shape.ratio;
      let value = this.contours.get(key);
      if (value) this.contours.delete(key);
      else value = fitImage(image, id, ratio, canvasElement);
      this.contours.set(key, value);
      if (this.contours.size > MAX_CONTOURS) this.contours.delete(this.contours.keys().next().value);
      return value;
    }
    draw(ctx, outfit, body) {
      for (const rect of placements(outfit, body)) {
        let image = this.images.get(rect.id);
        if (!image) { image = new Image(); image.src = accessories.item(rect.id).icon; this.images.set(rect.id, image); }
        if (image?.complete && image.naturalWidth) {
          if (accessories.item(rect.id).slot === "hat") {
            const fitted = this.fitted(image, rect.id, rect.width / body.radius);
            ctx.drawImage(fitted.canvas, rect.x, rect.y + fitted.top * rect.width,
              rect.width, fitted.canvas.height / TEXTURE_WIDTH * rect.width);
          } else ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
        }
      }
    }
  }
  const portraitImages = new Map();
  function portrait(image, id) {
    const item = accessories.item(id),
      rect = placements({ [item.slot]: id }, { x: .5, y: .5, radius: .5 })[0];
    image.dataset.accessoryId = id;
    const apply = (src, top = 0, height = rect.height) => {
      if (image.dataset.accessoryId !== id || image.hidden) return;
      image.src = src;
      for (const [key, value] of Object.entries({ left: rect.x, top: rect.y + top,
        width: rect.width, height })) image.style[key] = `${value * 100}%`;
    };
    if (item.slot !== "hat") return apply(item.icon);
    let ready = portraitImages.get(id);
    if (!ready) {
      ready = new Promise(resolve => {
        const source = new Image();
        source.onload = () => {
          const fitted = fitImage(source, id, rect.width / .5, canvasElement);
          resolve({ src: fitted.canvas.toDataURL(), top: fitted.top * rect.width,
            height: fitted.canvas.height / TEXTURE_WIDTH * rect.width });
        };
        source.onerror = () => resolve({ src: item.icon, top: 0, height: rect.height });
        source.src = item.icon;
      });
      portraitImages.set(id, ready);
    }
    ready.then(({ src, top, height }) => apply(src, top, height));
  }
  return { Renderer, placements, contour, contourOffset, fitImage, portrait };
});

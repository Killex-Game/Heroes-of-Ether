/* Палитры интерфейса. Сохраняем светлоту деталей, объём SVG и контраст подписей. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexUITheme = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const palettes = Object.freeze({
    bronze: { hue: 24, saturation: 0.72 },
    silver: { hue: 213, saturation: 0.22 },
    gold: { hue: 40, saturation: 0.48, contrast: 0.88 },
    platinum: { hue: 172, saturation: 0.32, contrast: 0.88 },
    diamond: { hue: 207, saturation: 0.9 },
    champions: { hue: 347, saturation: 0.86 },
    heroic: { hue: 38, saturation: 0.46, contrast: 0.94 },
    visual: { hue: 38, saturation: 0.34 },
    prism: { hue: 202, saturation: 0.56 },
    glass: { hue: 253, saturation: 0.55, contrast: 0.9 },
  });
  let current = "default";
  const cache = new Map();
  function rgb(hex) {
    let h = hex.slice(1);
    if (h.length < 5) h = [...h].map((c) => c + c).join("");
    return {
      channels: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255),
      alpha: h.slice(6),
    };
  }
  const luminance = (channels) =>
    channels
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
  function hsl(h, s, l) {
    const a = s * Math.min(l, 1 - l),
      f = (n) => {
        const k = (n + h / 30) % 12;
        return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
      };
    return [f(0), f(8), f(4)];
  }
  function color(hex, id = current) {
    const palette = palettes[id];
    if (!palette) return hex;
    const key = id + hex;
    if (cache.has(key)) return cache.get(key);
    const { channels, alpha } = rgb(hex),
      original = luminance(channels),
      target =
        original === 0 || original === 1
          ? original
          : 0.5 + (original - 0.5) * (palette.contrast || 1);
    // Чистый белый и чёрный остаются нейтральными. Остальные материалы получают цвет лиги.
    let low = 0,
      high = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (low + high) / 2;
      if (luminance(hsl(palette.hue, palette.saturation, mid)) < target) low = mid;
      else high = mid;
    }
    const result =
      "#" +
      hsl(palette.hue, palette.saturation, (low + high) / 2)
        .map((c) =>
          Math.round(c * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("") +
      alpha;
    cache.set(key, result);
    return result;
  }
  function apply(id) {
    current = palettes[id] ? id : "default";
    if (typeof document !== "undefined" && document.documentElement.dataset.uiTheme !== current)
      document.documentElement.dataset.uiTheme = current;
  }
  function inherit(node, anchor) {
    node.dataset.uiTheme = anchor?.closest("[data-ui-theme]")?.dataset.uiTheme || current;
  }
  return { palettes, color, apply, inherit, luminance };
});

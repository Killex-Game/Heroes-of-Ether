/* Проверка параметров герба и актуальные слои оформления. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./clan-crest-art-data"),
      require("./clan-crest-variants"),
    );
  else
    root.KillexClanCrests = factory(
      root.KillexClanCrestArt,
      root.KillexCrestVariants,
    );
})(typeof globalThis !== "undefined" ? globalThis : this, (art, variants) => {
  "use strict";
  const LILY = "s21_lily",
    symbols = [{ id: LILY, name: "Геральдическая лилия" }, ...art.symbols, ...variants.symbols]
      .filter((symbol) => symbol.id !== "s19_key");
  // Retired key: keep saved crests valid, preserve their field, metal and frame.
  const currentSymbol = (id) => (id === "s19_key" ? LILY : id);
  const retiredFrames = {
    f04_broad: "f03_heater",
    f06_diamond: "f07_octagon",
    f20_triangle: "f16_gothic",
    f21_tourney: "f11_french",
  };
  const frames = [...art.frames, ...variants.frames].filter(
      (f) => !Object.hasOwn(retiredFrames, f.id),
    ),
    colors = [...art.colors, ...variants.colors];
  const DEFAULT = Object.freeze({
      frame: "f03_heater",
      color: "c01_royal_purple",
      symbol: "s01_crown",
      metal: "steel",
    }),
    EDIT_COST = 50;
  function normalize(value) {
    if (value == null) return null;
    if (
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (k) => !["frame", "color", "symbol", "pattern", "secondary", "metal"].includes(k),
      ) ||
      !frames.some((x) => x.id === (retiredFrames[value.frame] || value.frame)) ||
      !colors.some((x) => x.id === value.color) ||
      (value.secondary !== undefined && !colors.some((x) => x.id === value.secondary)) ||
      (value.pattern !== undefined && !variants.patterns.some((x) => x.id === value.pattern)) ||
      (value.metal !== undefined && !variants.metals.some((x) => x.id === value.metal)) ||
      (value.symbol !== null && !symbols.some((x) => x.id === currentSymbol(value.symbol)))
    )
      throw Error("Выбери форму, цвет и символ из конструктора герба.");
    const result = {
      frame: retiredFrames[value.frame] || value.frame,
      color: value.color,
      symbol: currentSymbol(value.symbol) ?? LILY,
    };
    if (value.pattern && value.pattern !== "solid") {
      result.pattern = value.pattern;
      result.secondary = value.secondary || "c18_ivory";
    }
    if (value.metal && value.metal !== "gold") result.metal = value.metal;
    return result;
  }
  const equal = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
  const unlockLevels = Object.freeze({
    f11_french: 3,
    f12_spanish: 3,
    f13_norman: 3,
    f14_english: 3,
    f15_polish: 3,
    f16_gothic: 3,
    f17_concave: 3,
    f18_trefoil: 7,
    f19_drop: 7,
    f21_tourney: 7,
    f22_byzantine: 7,
    f23_varangian: 7,
    f24_renaissance: 7,
    f25_bastion: 7,
    f08_cartouche: 10,
    f09_royal: 10,
    f10_grand: 10,
    steel: 1,
    copper: 3,
    bronze: 5,
    silver: 7,
    gold: 10,
    s22_bear: 10,
    s23_unicorn: 10,
    s24_kraken: 10,
    s25_rose: 10,
  });
  const requiredLevel = (id) => (Object.hasOwn(unlockLevels, id) ? unlockLevels[id] : 1);
  // В сохранениях отсутствие metal по-прежнему означает золото. Новые
  // гербы используют явно заданную сталь; пропуск поля не обходит уровень.
  function requiredCrestLevel(value) {
    const c = normalize(value);
    return c
      ? Math.max(requiredLevel(c.frame), requiredLevel(c.metal || "gold"), requiredLevel(c.symbol))
      : 1;
  }
  function restrictToLevel(value, level) {
    const c = normalize(value);
    if (!c) return null;
    if (requiredLevel(c.frame) > level) c.frame = DEFAULT.frame;
    if (requiredLevel(c.metal || "gold") > level) c.metal = DEFAULT.metal;
    if (requiredLevel(c.symbol) > level) c.symbol = DEFAULT.symbol;
    return c;
  }
  const catalogs = {
    frames,
    colors,
    symbols,
    patterns: variants.patterns,
    metals: variants.metals,
  };
  const choicesForLevel = (category, level) =>
    [...catalogs[category]].sort(
      (a, b) =>
        Number(requiredLevel(a.id) > level) - Number(requiredLevel(b.id) > level) ||
        requiredLevel(a.id) - requiredLevel(b.id),
    );
  const framesForLevel = (level) => choicesForLevel("frames", level);
  const tint = (hex, delta) =>
    "#" +
    hex
      .slice(1)
      .match(/../g)
      .map((s) =>
        Math.max(0, Math.min(255, Math.round(parseInt(s, 16) + delta)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  function fieldBody(c) {
    const f = frames.find((x) => x.id === c.frame),
      first = colors.find((x) => x.id === c.color).hex,
      second = colors.find((x) => x.id === (c.secondary || "c18_ivory")).hex,
      pattern = variants.patterns.find((x) => x.id === (c.pattern || "solid"));
    const gradient = (id, color) =>
      `<radialGradient id="${id}" cx=".32" cy=".24" r=".8"><stop stop-color="${tint(color, 16)}"/><stop offset=".45" stop-color="${color}"/><stop offset="1" stop-color="${tint(color, -45)}"/></radialGradient>`;
    let shape = pattern.path ? `<path d="${pattern.path}" fill="url(#crest-second)"/>` : "";
    if (pattern.id === "bordure")
      shape = `<path d="${f.inner_path}" fill="none" stroke="url(#crest-second)" stroke-width="100"/>`;
    if (pattern.id === "checkered")
      shape = `<defs><pattern id="checks" width="128" height="128" patternUnits="userSpaceOnUse"><path d="M0 0H64V64H0ZM64 64H128V128H64Z" fill="${second}"/></pattern></defs><rect width="512" height="512" fill="url(#checks)"/>`;
    return `<defs>${gradient("crest-enamel", first)}${gradient("crest-second", second)}</defs><rect width="512" height="512" fill="url(#crest-enamel)"/>${shape}`;
  }
  const wrap = (body) =>
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
    body +
    "</svg>";
  function fieldSvg(value) {
    return wrap(fieldBody(normalize(value) || DEFAULT));
  }
  function frameSource(id) {
    const f = frames.find((x) => x.id === id);
    return f?.vector
      ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(wrap(f.svg))
      : "assets/clan-crests/v2/" + id + ".webp";
  }
  function symbolSource(id, size = 512) {
    return symbols.some((symbol) => symbol.id === id)
      ? `assets/clan-crests/prism-refined-v5/${size <= 128 ? 128 : 512}/${id}.webp?art=20261122b`
      : null;
  }
  function defaultSource(legacy = "astral") {
    return "assets/ui/art/clan_" + (legacy === "grove" ? "grove" : "astral") + ".png";
  }
  return {
    DEFAULT,
    EDIT_COST,
    requiredLevel,
    requiredCrestLevel,
    restrictToLevel,
    choicesForLevel,
    framesForLevel,
    normalize,
    equal,
    defaultSource,
    fieldSvg,
    frameSource,
    symbolSource,
    frames,
    colors,
    patterns: variants.patterns,
    metals: variants.metals,
    presets: variants.presets,
    symbols,
  };
});

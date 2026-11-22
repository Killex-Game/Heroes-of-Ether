/* Проверка параметров герба и SVG представление. */
(function (root, factory) {
  if (typeof module === "object" && module.exports)
    module.exports = factory(
      require("./clan-crest-art-data"),
      require("./clan-crest-variants"),
      require("./clan-crest-symbols-refined"),
    );
  else
    root.KillexClanCrests = factory(
      root.KillexClanCrestArt,
      root.KillexCrestVariants,
      root.KillexCrestPrismSymbols,
    );
})(typeof globalThis !== "undefined" ? globalThis : this, (art, variants, prismSymbols) => {
  "use strict";
  const LILY = "s21_lily",
    symbols = [
      {
        id: LILY,
        name: "Геральдическая лилия",
        svg: '<defs><linearGradient id="lily-gold" x2=".3" y2="1"><stop stop-color="#fff7b6"/><stop offset=".4" stop-color="#ffc326"/><stop offset=".65" stop-color="#ad5810"/><stop offset="1" stop-color="#ffdf60"/></linearGradient></defs><path d="M256 96C194 169 206 200 236 287C191 207 153 209 134 243C113 288 165 316 196 287C169 287 157 267 175 259C196 254 216 291 232 316L211 358L243 345L256 393L269 345L301 358L280 316C296 291 316 254 337 259C355 267 343 287 316 287C347 316 399 288 378 243C359 209 321 207 276 287C306 200 318 169 256 96Z" fill="url(#lily-gold)" stroke="#84400f" stroke-width="5"/><path d="M256 108V311M211 313H301M220 329H292" fill="none" stroke="#fff1a2" stroke-width="7"/>',
      },
      ...art.symbols,
      ...variants.symbols,
    ]
      .filter((symbol) => symbol.id !== "s19_key")
      .map((symbol) => ({ ...symbol, svg: prismSymbols?.[symbol.id] || symbol.svg }));
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
    EDIT_COST = 50,
    cache = new Map();
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
  function svg(value) {
    const c = normalize(value) || DEFAULT,
      f = frames.find((x) => x.id === c.frame),
      symbol = symbols.find((x) => x.id === c.symbol),
      [x, y, w, h] = f.symbol_box,
      scale = Math.min(w, h) / 320;
    const background = `<defs><clipPath id="field-clip"><path d="${f.inner_path}"/></clipPath></defs><g clip-path="url(#field-clip)">${fieldBody(c)}</g>`;
    const metal = variants.metals.find((x) => x.id === c.metal);
    const frame = metal?.tint
      ? `<defs><filter id="metal"><feColorMatrix type="matrix" values="${metal.tint.map((t) => `${0.3 * t} ${0.59 * t} ${0.11 * t} 0 0`).join(" ")} 0 0 0 1 0"/></filter></defs><g filter="url(#metal)">${f.svg}</g>`
      : f.svg;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
      background +
      frame +
      (symbol
        ? '<g transform="translate(' +
          (x + w / 2 - 256 * scale) +
          " " +
          (y + h / 2 - 256 * scale) +
          ") scale(" +
          scale +
          ')">' +
          symbol.svg +
          "</g>"
        : "") +
      "</svg>"
    );
  }
  function source(value, legacy = "astral") {
    if (!value) return "assets/ui/art/clan_" + (legacy === "grove" ? "grove" : "astral") + ".png";
    const c = normalize(value),
      key = JSON.stringify(c);
    if (!cache.has(key)) {
      if (cache.size >= 128) cache.delete(cache.keys().next().value);
      cache.set(key, "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg(c)));
    }
    return cache.get(key);
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
    source,
    svg,
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

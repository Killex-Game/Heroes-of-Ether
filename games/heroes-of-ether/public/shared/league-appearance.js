/* Общие идентификаторы оформления; сервер проверяет доступ к каждой лиге. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexLeagueAppearance = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const themes = Object.freeze(
    [
      ["bronze", "Бронзовая", "Медные лавры", "#b66b36", "#ffe3aa", "#391d29"],
      ["silver", "Серебряная", "Лунное серебро", "#a6c5de", "#f4faff", "#182d4c"],
      ["gold", "Золотая", "Солнечная корона", "#edb832", "#fff1a3", "#58331e"],
      ["platinum", "Платиновая", "Небесная орбита", "#70c6be", "#dcfffa", "#163b4e"],
      ["diamond", "Бриллиантовая", "Хрустальное сияние", "#64d7ff", "#f3eeff", "#302766"],
      ["champions", "Чемпионская", "Триумф чемпионов", "#f0b746", "#fff0bd", "#44216a"],
    ].map(([id, name, title, metal, light, dark], rank) =>
      Object.freeze({ id, name, title, metal, light, dark, rank }),
    ),
  );
  // Interface packs include their own appearance; league rewards stay independent.
  const interfaceThemes = Object.freeze([
    Object.freeze({ id: "heroic", name: "Героическая", title: "Обсидиановый чертог и солнечное золото", earnedTitle: "boss" }),
    Object.freeze({
      id: "visual",
      name: "Королевская",
      title: "Тёплый пергамент и ночная цитадель",
      currency: "coins",
      price: 50000,
    }),
    Object.freeze({
      id: "prism",
      name: "Цитадель",
      title: "Небесный город и жемчужные панели",
      currency: "crystals",
      price: 15000,
    }),
    Object.freeze({
      id: "glass",
      name: "Небесная",
      title: "Мягкий свет и прозрачные панели",
      currency: "bucks",
      price: 3000,
    }),
  ]);
  const interfaceById = new Map(interfaceThemes.map((item) => [item.id, item]));
  const interfaceTheme = (id) => interfaceById.get(id);
  const slots = Object.freeze([
    "lobbyBackground",
    "avatarFrame",
    "profileBackground",
    "arenaFrame",
    "uiTheme",
  ]);
  const accountFrames = Object.freeze([
    Object.freeze({ id: "vip", name: "VIP", title: "Золотой блеск" }),
    Object.freeze({ id: "premium", name: "Premium", title: "Аметистовый блеск" }),
  ]);
  // Opaque inner contour, including all angles, plus a small overlap behind the rim.
  // Restored pre-redesign artwork and its measured opening together.
  // No image scans run in the game.
  const titleFrameFits = {
    novice: [0.4992,0.486659,0.388305],
    experienced: [0.49962,0.504426,0.349774],
    expert: [0.496467,0.489469,0.377344],
    sage: [0.497007,0.492264,0.351435],
    master: [0.499449,0.494755,0.34446],
    pro: [0.498229,0.494607,0.358078],
    prince: [0.497672,0.514641,0.328516],
    king: [0.497751,0.510638,0.322537],
    emperor: [0.496407,0.50859,0.33383],
    boss: [0.498421,0.50908,0.341138],
  };
  const rankFrames = Object.freeze(
    [
      ["novice", "Новичок", "#a6b5c7", "#f7fbff", "#344054"],
      ["experienced", "Опытный", "#a4c7f4", "#f0faff", "#28558e"],
      ["expert", "Знаток", "#ce9039", "#ffedb3", "#713823"],
      ["sage", "Мудрец", "#57bada", "#f4faff", "#194780"],
      ["master", "Мастер", "#e5a42b", "#fff2ad", "#8a1630"],
      ["pro", "Профи", "#e3b330", "#f5ffc1", "#0a624c"],
      ["prince", "Принц", "#dfb02b", "#ffefb2", "#124c9b"],
      ["king", "Король", "#e4ad25", "#ffffd1", "#9c1834"],
      ["emperor", "Император", "#f1c54a", "#fffde0", "#194275"],
      ["boss", "Герой", "#f6c82e", "#ffffdd", "#ad2424"],
    ].map(([titleId, name, metal, light, dark], rank) =>
      Object.freeze({
        id: "title_" + titleId,
        titleId,
        fit: titleFrameFits[titleId],
        name,
        title: "Рамка за титул «" + name + "»",
        metal,
        light,
        dark,
        rank,
      }),
    ),
  );
  // Arena rendering resolves these immutable catalogs for every visible part.
  // Missing IDs are common too; avoid repeated linear scans each frame.
  const ranksById = new Map(rankFrames.map((item) => [item.id, item]));
  const accountsById = new Map(accountFrames.map((item) => [item.id, item]));
  const themesById = new Map(themes.map((item) => [item.id, item]));
  const rankFrame = (id) => ranksById.get(baseFrame(id));
  const frameSlot = (slot) => slot === "avatarFrame" || slot === "arenaFrame";
  const accountFrame = (id) => accountsById.get(baseFrame(id));
  const theme = (id) => themesById.get(id);
  const leagueFrameFits = {
    bronze: [0.49632,0.508343,0.34957],
    silver: [0.498586,0.50462,0.349968],
    gold: [0.496891,0.507611,0.340402],
    platinum: [0.497602,0.505645,0.31808],
    diamond: [0.498516,0.498904,0.329241],
    champions: [0.497125,0.508957,0.319276],
  };
  const frameThemes = themes.map((t) =>
    Object.freeze({
      ...t,
      fit: leagueFrameFits[t.id],
      metal: ["#d48732", "#b3d8f2", "#ffbf12", "#35cfb9", "#35cfff", "#ff2146"][t.rank],
      light: t.rank === 5 ? "#ffe761" : t.light,
      dark: t.rank === 5 ? "#71071f" : t.dark,
    }),
  );
  const packFrames = [
    ["visual", "#dbad4b", "#fff1c1", "#243c68", [0.490234,0.521484,0.350813]],
    ["prism", "#95dafa", "#fcf4dd", "#253c89", [0.494141,0.525391,0.375227]],
    ["glass", "#dbbfea", "#fff5ff", "#66578d", [0.496094,0.542969,0.356294]],
    ["heroic", "#ecc35c", "#fff0bf", "#851f37", [0.491211,0.527344,0.346827]],
  ].map(([id, metal, light, dark, fit]) => Object.freeze({ ...interfaceTheme(id), metal, light, dark, fit, rank: 3 }));
  const variantFrames = Object.freeze([{"id":"canon_title_prince","baseId":"title_prince","name":"Принц","title":"Тонкий ободок","fit":[0.489768,0.530305,0.327269]},{"id":"canon_title_king","baseId":"title_king","name":"Король","title":"Тонкий ободок","fit":[0.49022,0.531235,0.305664]},{"id":"canon_title_emperor","baseId":"title_emperor","name":"Император","title":"Тонкий ободок","fit":[0.491259,0.524036,0.282492]},{"id":"canon_vip","baseId":"vip","name":"VIP","title":"Тонкий ободок","fit":[0.489912,0.516537,0.329339]},{"id":"canon_premium","baseId":"premium","name":"Premium","title":"Тонкий ободок","fit":[0.491828,0.531282,0.320916]},{"id":"canon_bronze","baseId":"bronze","name":"Бронзовая","title":"Тонкий ободок","fit":[0.48832,0.508789,0.327173]},{"id":"canon_silver","baseId":"silver","name":"Серебряная","title":"Тонкий ободок","fit":[0.495117,0.522424,0.350323]},{"id":"canon_gold","baseId":"gold","name":"Золотая","title":"Тонкий ободок","fit":[0.491211,0.524457,0.327249]},{"id":"canon_platinum","baseId":"platinum","name":"Платиновая","title":"Тонкий ободок","fit":[0.493777,0.521507,0.331055]},{"id":"canon_diamond","baseId":"diamond","name":"Бриллиантовая","title":"Тонкий ободок","fit":[0.493141,0.527566,0.338973]},{"id":"canon_champions","baseId":"champions","name":"Чемпионская","title":"Тонкий ободок","fit":[0.492217,0.534226,0.319432]}].map(Object.freeze));
  const variantsById = new Map(variantFrames.map(item => [item.id,item]));
  const variantFrame = id => variantsById.get(id);
  const baseFrame = id => variantFrame(id)?.baseId || id;
  const framesById = new Map([...frameThemes, ...rankFrames, ...packFrames, ...variantFrames].map((item) => [item.id, item]));
  const frameTheme = (id) => framesById.get(id);
  const valid = (id, slot) =>
    id === "default" ||
    !!theme(id) ||
    (frameSlot(slot) && !!(accountFrame(id) || rankFrame(id) || variantFrame(id))) ||
    (slots.includes(slot) && !!interfaceTheme(id));
  const selection = (value) =>
    Object.fromEntries(
      slots.map((slot) => {
        const id = value?.[slot] ?? (slot === "uiTheme" ? value?.lobbyBackground : undefined);
        return [slot, valid(id, slot) ? id : "default"];
      }),
    );
  const resolveFrame = (id) => (theme(id) || accountFrame(id) || rankFrame(id) || interfaceTheme(id) || variantFrame(id) ? id : "default");
  const source = (id, kind) =>
    kind === "frame" && !!(variantFrame(id) || rankFrame(id) || theme(id) || accountFrame(id))
      ? `assets/frames/rims-v2/${id}.webp?art=20261122-rims`
        : interfaceTheme(id) && ["frame", "profile", "lobby"].includes(kind)
          ? `assets/interface-packs/${id}/${kind}.webp?art=${kind === "frame" ? "20261122c" : "20261122b"}`
          : theme(id) && ["lobby", "profile", "frame", "clan"].includes(kind)
            ? `assets/league-appearance/${id}-${kind}.svg?art=20261122b`
            : null;
  return {
    variantFrames, variantFrame, baseFrame,
    themes,
    interfaceThemes,
    interfaceTheme,
    frameTheme,
    rankFrames,
    rankFrame,
    accountFrames,
    frameSlot,
    accountFrame,
    resolveFrame,
    slots,
    theme,
    valid,
    selection,
    source,
  };
});

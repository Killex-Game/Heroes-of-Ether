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
  // Measured from the 20261122 artwork; includes the renderer's 0.98 inset.
  // No image scans run in the game.
  const titleFrameFits = {
    novice: [0.498047,0.503906,0.397316],
    experienced: [0.499349,0.503906,0.396984],
    expert: [0.498698,0.505208,0.400638],
    sage: [0.498698,0.507161,0.400638],
    master: [0.498698,0.513672,0.411931],
    pro: [0.498698,0.504557,0.398645],
    prince: [0.498047,0.505208,0.397648],
    king: [0.498698,0.504557,0.39798],
    emperor: [0.499349,0.503255,0.397648],
    boss: [0.498047,0.502604,0.399973],
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
  const rankFrame = (id) => ranksById.get(id);
  const frameSlot = (slot) => slot === "avatarFrame" || slot === "arenaFrame";
  const accountFrame = (id) => accountsById.get(id);
  const theme = (id) => themesById.get(id);
  const leagueFrameFits = {
    bronze: [0.498437,0.500781,0.393463],
    silver: [0.498437,0.500781,0.393463],
    gold: [0.498437,0.500781,0.393463],
    platinum: [0.498437,0.500781,0.393463],
    diamond: [0.498437,0.500781,0.393463],
    champions: [0.498437,0.500781,0.393463],
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
  const framesById = new Map([...frameThemes, ...rankFrames, ...packFrames].map((item) => [item.id, item]));
  const frameTheme = (id) => framesById.get(id);
  const valid = (id, slot) =>
    id === "default" ||
    !!theme(id) ||
    (frameSlot(slot) && !!(accountFrame(id) || rankFrame(id))) ||
    (slots.includes(slot) && !!interfaceTheme(id));
  const selection = (value) =>
    Object.fromEntries(
      slots.map((slot) => {
        const id = value?.[slot] ?? (slot === "uiTheme" ? value?.lobbyBackground : undefined);
        return [slot, valid(id, slot) ? id : "default"];
      }),
    );
  const resolveFrame = (id) => (theme(id) || accountFrame(id) || rankFrame(id) || interfaceTheme(id) ? id : "default");
  const source = (id, kind) =>
    rankFrame(id) && kind === "frame"
      ? `assets/title-frames/${["novice", "experienced", "master"].includes(rankFrame(id).titleId) ? "v1" : "v2"}/${rankFrame(id).titleId}.webp`
      : theme(id) && kind === "frame"
        ? `assets/league-frames/v2/${id}.webp`
        : interfaceTheme(id) && ["frame", "profile", "lobby"].includes(kind)
          ? `assets/interface-packs/${id}/${kind}.webp`
          : theme(id) && ["lobby", "profile", "frame", "clan"].includes(kind)
            ? `assets/league-appearance/${id}-${kind}.svg?v=20261031-laurels`
            : null;
  return {
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

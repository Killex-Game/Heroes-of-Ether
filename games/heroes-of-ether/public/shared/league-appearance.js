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
    novice: [0.5, 0.5, 0.4521484375],
    experienced: [0.5, 0.5, 0.4521484375],
    expert: [0.5, 0.5, 0.4521484375],
    sage: [0.5, 0.5, 0.4521484375],
    master: [0.5, 0.5, 0.4521484375],
    pro: [0.5, 0.5, 0.4521484375],
    prince: [0.5, 0.5, 0.4521484375],
    king: [0.5, 0.5, 0.4521484375],
    emperor: [0.5, 0.5, 0.4521484375],
    boss: [0.5, 0.5, 0.4521484375],
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
    bronze: [0.5, 0.5, 0.4521484375],
    silver: [0.5, 0.5, 0.4521484375],
    gold: [0.5, 0.5, 0.4521484375],
    platinum: [0.5, 0.5, 0.4521484375],
    diamond: [0.5, 0.5, 0.4521484375],
    champions: [0.5, 0.5, 0.4521484375],
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
    ["visual", "#f5b322", "#fff0a3", "#8e3010", [0.490234,0.521484,0.350813]],
    ["prism", "#29a9f5", "#ddfaff", "#174d9f", [0.494141,0.525391,0.375227]],
    ["glass", "#ad6ee9", "#f4dbff", "#582188", [0.496094,0.542969,0.356294]],
    ["heroic", "#ffbe16", "#fff09a", "#9d102c", [0.491211,0.527344,0.346827]],
  ].map(([id, metal, light, dark, fit]) => Object.freeze({ ...interfaceTheme(id), metal, light, dark, fit, rank: 3 }));
  const variantFrames = Object.freeze([{"id":"canon_title_prince","baseId":"title_prince","name":"Принц","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_title_king","baseId":"title_king","name":"Король","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_title_emperor","baseId":"title_emperor","name":"Император","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_vip","baseId":"vip","name":"VIP","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_premium","baseId":"premium","name":"Premium","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_bronze","baseId":"bronze","name":"Бронзовая","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_silver","baseId":"silver","name":"Серебряная","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_gold","baseId":"gold","name":"Золотая","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_platinum","baseId":"platinum","name":"Платиновая","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_diamond","baseId":"diamond","name":"Бриллиантовая","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]},{"id":"canon_champions","baseId":"champions","name":"Чемпионская","title":"Тонкий ободок","fit":[0.5,0.5,0.4521484375]}].map(Object.freeze));
  const variantsById = new Map(variantFrames.map(item => [item.id,item]));
  const variantFrame = id => variantsById.get(id);
  const baseFrame = id => variantFrame(id)?.baseId || id;
  const arenaVariants = new Map(variantFrames.map(item => [item.baseId, item.id]));
  const frameForSlot = (id, slot) => slot === "avatarFrame" ? baseFrame(id)
    : slot === "arenaFrame" ? arenaVariants.get(baseFrame(id)) || id : id;
  const framesById = new Map([...frameThemes, ...rankFrames, ...packFrames, ...variantFrames].map((item) => [item.id, item]));
  const frameTheme = (id) => framesById.get(id);
  // Profile ornaments have independent measured fits; arena rim geometry is unchanged.
  const titleProfileFits = {"title_novice":[0.4960802520498726,0.5350580501666561,0.3615369592813202],"title_experienced":[0.4984100202013826,0.5294213618990071,0.3489242586986948],"title_expert":[0.49641071231311545,0.5239693433811239,0.35095856524427954],"title_sage":[0.4947862253890017,0.5175578148157163,0.34607622953487616],"title_master":[0.49566221112560566,0.5231587107258937,0.3346841128796016],"title_pro":[0.496427334693173,0.5198926838020498,0.3354978354978355],"title_prince":[0.49636518686513004,0.5231052472625249,0.3513654265533965],"title_king":[0.49561820955446556,0.5283429706013979,0.32614002538814574],"title_emperor":[0.4931919062966485,0.5306584799346615,0.3322429450248999],"title_boss":[0.49402483121063484,0.5250226946402605,0.32939491586108127]};
  const titleProfileFrame = (id) => {
    const base = baseFrame(id), fit = titleProfileFits[base];
    return fit ? { fit, source: `assets/frames/titles-v4/512/${base.slice(6)}.webp?art=20261123-title-frames` } : null;
  };
  // League profile decorations use their own fit, independent from arena rims.
  const leagueProfileFits = {"bronze":[0.4959826764344392,0.5219149809158973,0.36072323666308626],"silver":[0.49318914509897993,0.5331662714202191,0.3558409009536829],"gold":[0.4972681120568017,0.5195164051115465,0.3533997330989812],"platinum":[0.4960250505034565,0.5195351411615778,0.35177228786251347],"diamond":[0.49521098639687994,0.5327396809446455,0.3566546235719168],"champions":[0.4935962894489486,0.5258975168612293,0.3586889301175015]};
  const leagueProfileFrame = (id) => {
    const base = baseFrame(id), fit = leagueProfileFits[base];
    return fit ? { fit, source: `assets/frames/leagues-v3/512/${base}.webp?art=20261123-league-frames` } : null;
  };
  const valid = (id, slot) =>
    id === "default" ||
    !!theme(id) ||
    (frameSlot(slot) && !!(accountFrame(id) || rankFrame(id) || variantFrame(id))) ||
    (slots.includes(slot) && !!interfaceTheme(id));
  const selection = (value) =>
    Object.fromEntries(
      slots.map((slot) => {
        const id = value?.[slot] ?? (slot === "uiTheme" ? value?.lobbyBackground : undefined);
        return [slot, valid(id, slot) ? frameForSlot(id, slot) : "default"];
      }),
    );
  const resolveFrame = (id) => (theme(id) || accountFrame(id) || rankFrame(id) || interfaceTheme(id) || variantFrame(id) ? id : "default");
  const source = (id, kind) =>
    kind === "frame" && !!(variantFrame(id) || rankFrame(id) || theme(id) || accountFrame(id))
      ? `assets/frames/rims-v2/${id}.webp?art=${theme(baseFrame(id)) ? "20261123-league-frames" : "20261123-title-frames"}`
        : interfaceTheme(id) && ["frame", "profile", "lobby"].includes(kind)
          ? `assets/interface-packs/${id}/${kind}.webp?art=${kind === "frame" ? "20261122c" : "20261122b"}`
          : theme(id) && ["lobby", "profile", "frame", "clan"].includes(kind)
            ? `assets/league-appearance/${id}-${kind}.svg?art=20261123-interface-art`
            : null;
  return {
    leagueProfileFrame, titleProfileFrame, variantFrames, variantFrame, baseFrame, frameForSlot,
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

/* Каталог базовых скинов, подписи игроков и значки титулов. */
"use strict";
// Общие идентификаторы, не произвольные URL от игроков.
((root) => {
  // Посадка портретов: нижний срез касается шара, верх головы остаётся внутри.
  const collectionCatalog =
    typeof module === "object" && module.exports
      ? require("./skin-collection-preview")
      : root.KillexSkinCollections;
  const portraitFits = Object.freeze({
    "gift-winged-guardian": { scale: 1.17, x: 0, y: 0.06 },
    "gift-winged-guardianess": { scale: 1.37, x: 0, y: 0.07 },
    ...Object.fromEntries(
      collectionCatalog.collections.flatMap((c) =>
        c.members.map((m) => [m.id, m.fit || { scale: 1, x: 0, y: 0.04 }]),
      ),
    ),
    "forest-owl": { scale: 0.95, x: 0, y: 0.033 },
    "desert-fennec": { scale: 0.92, x: 0, y: 0.0624 },
    "cloud-whale": { scale: 0.96, x: 0, y: 0.0618 },
    "twilight-bat": { scale: 0.97, x: 0, y: 0.0382 },
    "premium-1": { scale: 0.94, x: 0, y: 0.085 },
    "premium-2": { scale: 0.94, x: 0, y: 0.085 },
    "premium-3": { scale: 0.94, x: 0, y: 0.085 },
    "premium-4": { scale: 0.94, x: 0, y: 0.085 },
    "premium-5": { scale: 0.94, x: 0, y: 0.085 },
    "visual-star-lion": { scale: 0.94, x: 0, y: 0.085 },
    "prism-star-lion": { scale: 0.94, x: 0, y: 0.085 },
    "glass-star-lion": { scale: 0.94, x: 0, y: 0.085 },
    "amber-fox": { scale: 0.94, x: 0, y: 0.105 },
    "snow-leopard": { scale: 0.94, x: 0, y: 0.105 },
    "little-owl": { scale: 0.94, x: 0, y: 0.105 },
    "sea-dragon": { scale: 0.94, x: 0, y: 0.105 },
    "crystal-guardian": { scale: 1, x: 0, y: 0.0432 },
    "forest-spirit": { scale: 1.06, x: 0, y: 0.0153 },
    "glass-crystal-guardian": { scale: 1.01, x: 0, y: 0.0385 },
    "glass-forest-spirit": { scale: 1.03, x: 0, y: 0.0413 },
    "glass-moon-dragon": {
      scale: 1.14,
      x: 0,
      y: 0.1009,
    },
    "glass-sun-phoenix": {
      scale: 0.995,
      x: 0,
      y: 0.0944,
    },
    "moon-dragon": {
      scale: 1.09,
      x: 0,
      y: 0.0261,
    },
    "prism-crystal-guardian": {
      scale: 1.075,
      x: 0,
      y: 0.0232,
    },
    "prism-forest-spirit": { scale: 1.04, x: 0, y: 0.0246 },
    "prism-moon-dragon": {
      scale: 1.025,
      x: 0,
      y: 0.105,
    },
    "prism-sun-phoenix": {
      scale: 1.085,
      x: 0,
      y: 0.0646,
    },
    "sun-phoenix": { scale: 1.06, x: 0, y: 0.007 },
    "vip-1": {
      scale: 1.075,
      x: 0,
      y: 0.045,
    },
    "vip-2": { scale: 1.04, x: 0, y: 0.0083 },
    "vip-3": {
      scale: 1.135,
      x: 0,
      y: 0.0586,
    },
    "vip-4": { scale: 1.04, x: 0, y: 0.0083 },
    "vip-5": {
      scale: 0.97,
      x: 0,
      y: 0.0986,
    },
    "visual-crystal-guardian": {
      scale: 1.13,
      x: 0,
      y: 0.0195,
    },
    "visual-forest-spirit": { scale: 1.02, x: 0, y: 0.0219 },
    "visual-moon-dragon": { scale: 1.07, x: 0, y: 0.0441 },
    "visual-sun-phoenix": { scale: 1.05, x: 0, y: 0.0404 },
  });
  // Один прозрачный портрет для всех поверхностей; старые файлы сохраняются как исходники.
  function transparentSkin(skin) {
    const directory = skin.tier === "premium" ? "premium-v2" : "transparent-v2";
    const variants = Object.freeze(
      Object.fromEntries(
        [64, 128, 256, 512, 1024].map((size) => [
          size,
          `assets/skins/${directory}/${size}/${skin.id}.webp`,
        ]),
      ),
    );
    return Object.freeze({ ...skin, variants, arena: variants[1024] });
  }
  const skins = Object.freeze(
    [
      {
        id: "moon-dragon",
        name: "Лунный дракон",
        file: "moon-dragon.png",
        arena: "assets/ui/art/avatar_dragon.png",
      },
      {
        id: "forest-spirit",
        name: "Лесной дух",
        file: "forest-spirit.png",
        arena: "assets/ui/art/avatar_grove.png",
      },
      {
        id: "sun-phoenix",
        name: "Солнечный феникс",
        file: "sun-phoenix.png",
        arena: "assets/ui/art/avatar_phoenix.png",
      },
      {
        id: "crystal-guardian",
        name: "Кристальный страж",
        file: "crystal-guardian.png",
        arena: "assets/ui/art/avatar_crystal.png",
      },
      { id: "amber-fox", name: "Янтарная лиса", file: "amber-fox.webp" },
      { id: "snow-leopard", name: "Снежный барс", file: "snow-leopard.webp" },
      { id: "little-owl", name: "Совёнок", file: "little-owl.webp" },
      { id: "sea-dragon", name: "Морской дракончик", file: "sea-dragon.webp" },
    ].map(transparentSkin),
  );
  // Идентификаторы сохраняются в профилях. Имена файлов описывают реальные изображения.
  const accountSkinSets = {
    vip: [
      ["king", "Король"],
      ["queen", "Королева"],
      ["prince", "Принц"],
      ["knight", "Рыцарь"],
      ["griffin", "Грифон"],
    ],
    premium: [
      ["star", "Звёздная чародейка"],
      ["crown", "Лунный рыцарь"],
      ["crystal", "Сумеречная пантера"],
      ["comet", "Астральный ворон"],
      ["sun", "Аметистовый дракон"],
    ],
  };
  const accountSkins = Object.freeze(
    Object.entries(accountSkinSets).flatMap(([tier, skins]) =>
      skins.map(([symbol, name], index) => {
        const file =
          tier === "vip" ? `vip-${symbol}.png` : `premium-v2/256/premium-${index + 1}.webp`;
        const variants =
          tier === "vip"
            ? Object.freeze(
                Object.fromEntries(
                  [64, 128, 256, 512, 1024].map((size) => [
                    size,
                    `assets/skins/vip/${size}/vip-${symbol}.webp`,
                  ]),
                ),
              )
            : null;
        return transparentSkin({
          id: `${tier}-${index + 1}`,
          name,
          tier,
          file,
          variants,
          arena: variants?.[1024] || "assets/skins/" + file,
        });
      }),
    ),
  );
  const themeSkinSets = Object.freeze([
    Object.freeze({ id: "visual", name: "Королевский набор" }),
    Object.freeze({ id: "prism", name: "Набор «Цитадель»" }),
    Object.freeze({ id: "glass", name: "Небесный набор" }),
  ]);
  const themeSkins = Object.freeze(
    themeSkinSets.flatMap((set) =>
      [...skins.slice(0, 4), { id: "star-lion", name: "Звёздный лев" }].map((skin) => {
        const source = `assets/interface-packs/${set.id}/avatars/${skin.id}.webp`;
        return transparentSkin({
          id: `${set.id}-${skin.id}`,
          name: skin.name,
          set: set.id,
          file: `${set.id}-${skin.id}.webp`,
          variants: Object.freeze({ 1024: source }),
          arena: source,
        });
      }),
    ),
  );
  const collectionSkins = Object.freeze(
    collectionCatalog.collections.flatMap((c) =>
      c.members.map((m) => {
        const variants = Object.freeze(
          Object.fromEntries(
            [64, 128, 256, 512, 1024].map((size) => [
              size,
              "assets/skins/collections-v1/" + size + "/" + m.id + ".webp?v=20261111-shop",
            ]),
          ),
        );
        return Object.freeze({ ...m, collection: c.id, variants, arena: variants[1024] });
      }),
    ),
  );
  const ownerGiftSkins = Object.freeze([
    ["gift-winged-guardian", "Крылатый хранитель"],
    ["gift-winged-guardianess", "Крылатая хранительница"],
  ].map(([id, name]) => {
    const variants = Object.freeze(Object.fromEntries([64, 128, 256, 512, 1024]
      .map(size => [size, `assets/skins/owner-gifts-v1/${size}/${id}.webp`])));
    return Object.freeze({ id, name, ownerGift: true, variants, arena: variants[1024] });
  }));
  const allSkins = Object.freeze([...skins, ...accountSkins, ...themeSkins, ...collectionSkins, ...ownerGiftSkins]);
  // Один каталог путей для миниатюр, профиля, гардероба и большого портрета.
  const resolveSkin = (skin) =>
    (typeof skin === "string" ? allSkins.find((item) => item.id === skin) : skin) || skins[0];
  const skinSource = (skin, size = 256) => {
    skin = resolveSkin(skin);
    if (!skin.variants) return "assets/skins/" + encodeURIComponent(skin.file);
    const sizes = Object.keys(skin.variants)
      .map(Number)
      .sort((a, b) => a - b);
    return skin.variants[sizes.find((candidate) => candidate >= size) || sizes.at(-1)];
  };
  const setSkinImage = (image, skin, size = 256) => {
    skin = resolveSkin(skin);
    const src = skinSource(skin, size);
    const srcset = skin.variants ? `${src} 1x, ${skinSource(skin, size * 2)} 2x` : "";
    if (image.getAttribute("srcset") !== srcset) {
      if (srcset) image.setAttribute("srcset", srcset);
      else image.removeAttribute("srcset");
    }
    if (image.getAttribute("src") !== src) image.setAttribute("src", src);
    image.dataset.skinId = skin.id;
    const fit = portraitFits[skin.id];
    if (fit) {
      image.dataset.skinFit = "portrait";
      image.style.setProperty("--skin-scale", String(fit.scale));
      image.style.setProperty("--skin-x", `${fit.x * 100}%`);
      image.style.setProperty("--skin-y", `${fit.y * 100}%`);
      image.style.setProperty(
        "--skin-clip",
        `circle(${50 / fit.scale}% at ${50 - (fit.x * 100) / fit.scale}% ${50 - (fit.y * 100) / fit.scale}%)`,
      );
    } else {
      delete image.dataset.skinFit;
      for (const name of ["--skin-scale", "--skin-x", "--skin-y", "--skin-clip"])
        image.style.removeProperty(name);
    }
  };
  // Вызывающий код обрезает портрет физическим кругом шара. Без новых объектов на кадр.
  const pendingPortraits = new WeakMap();
  // Keep the previous decoded portrait and its geometry together until the
  // replacement is ready. Late loads from rapid selections cannot resize it.
  const setSkinImageReady = (image, skin, size = 256) => {
    skin = resolveSkin(skin);
    const key = skin.id + ":" + size;
    const previous = pendingPortraits.get(image);
    if (previous?.key === key) return previous.promise;
    const request = { key };
    pendingPortraits.set(image, request);
    const preview = new Image();
    setSkinImage(preview, skin, size);
    request.promise = preview.decode().then(() => {
      if (pendingPortraits.get(image) !== request) return false;
      setSkinImage(image, skin, size);
      image.alt = skin.name;
      image.hidden = false;
      return true;
    }).catch(() => {
      if (pendingPortraits.get(image) === request) pendingPortraits.delete(image);
      return false;
    });
    return request.promise;
  };
  const drawSkin = (ctx, image, skin, x, y, diameter, fallbackScale = 1) => {
    const fit = portraitFits[typeof skin === "string" ? skin : skin?.id];
    const scale = fit?.scale || fallbackScale;
    const size = diameter * scale;
    ctx.drawImage(
      image,
      x + (diameter - size) / 2 + (fit?.x || 0) * diameter,
      y + (diameter - size) / 2 + (fit?.y || 0) * diameter,
      size,
      size,
    );
  };
  const label = (p) =>
    `${p.clanPrefix ? "[" + p.clanPrefix + "] " : ""}${(p.name || "Путник").replace(/\s*[\u00b7\u2022]\s*/gu, " ")} [${Number.isSafeInteger(p.level) && p.level > 0 ? p.level : 1}]`;
  const formatDuration = (seconds) => {
    const n = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
    return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60]
      .map((v) => String(v).padStart(2, "0"))
      .join(":");
  };
  const medalText = (p) =>
    ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"][p?.title?.degree - 1] || "";
  const createMedal = (p) => {
    if (!medalText(p)) return null;
    const source = root.KillexProgressionArt?.rank(p.title.id, 64);
    const node = document.createElement(source ? "img" : "span");
    node.className = "title-medal";
    if (source) {
      node.src = source;
      node.alt = `Медаль за титул ${p.title.name}`;
      node.width = node.height = 28;
    } else {
      node.textContent = medalText(p);
      node.setAttribute("aria-label", `Медаль за титул ${p.title.name}`);
    }
    node.title = `Медаль за титул ${p.title.name}`;
    return node;
  };
  const identity = {
    skins,
    accountSkins,
    themeSkinSets,
    themeSkins,
    allSkins,
    collectionSkins,
    ownerGiftSkins,
    skinSource,
    setSkinImage,
    setSkinImageReady,
    drawSkin,
    label,
    formatDuration,
    medalText,
    createMedal,
    validSkin: (id) => allSkins.some((s) => s.id === id),
    skinAllowed: (id, account, unlockedThemes = [], purchasedCollections = [], grantedSkins = []) => {
      const skin = allSkins.find((s) => s.id === id);
      return (
        !!skin &&
        (grantedSkins.includes(id) || (!skin.ownerGift && (!skin.tier || !!account?.[skin.tier]) &&
        (!skin.set || unlockedThemes.includes(skin.set)) &&
        (!skin.collection || purchasedCollections.includes(skin.collection))))
      );
    },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = identity;
  else root.KillexIdentity = identity;
})(typeof window !== "undefined" ? window : globalThis);

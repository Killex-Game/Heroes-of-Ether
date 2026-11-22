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
  "gift-winged-guardian": {
    "scale": 1.17,
    "x": 0,
    "y": 0.06
  },
  "gift-winged-guardianess": {
    "scale": 1.37,
    "x": 0,
    "y": 0.07
  },
  "moon-dragon": {
    "scale": 1.0133,
    "x": 0.001,
    "y": 0.0231
  },
  "forest-spirit": {
    "scale": 1.0008,
    "x": 0.001,
    "y": 0.029
  },
  "sun-phoenix": {
    "scale": 1.18,
    "x": 0.0081,
    "y": 0.06
  },
  "crystal-guardian": {
    "scale": 1.0327,
    "x": 0,
    "y": 0.03
  },
  "amber-fox": {
    "scale": 0.9689,
    "x": -0.0104,
    "y": 0.031
  },
  "snow-leopard": {
    "scale": 0.9767,
    "x": 0.001,
    "y": 0.0234
  },
  "little-owl": {
    "scale": 1.005,
    "x": -0.001,
    "y": 0.0173
  },
  "sea-dragon": {
    "scale": 0.9906,
    "x": 0.0029,
    "y": 0.03
  },
  "vip-1": {"scale":0.9594,"x":0.0028,"y":0.0282},
  "vip-2": {
    "scale": 0.9747,
    "x": 0.0057,
    "y": 0.0281
  },
  "vip-3": {"scale":0.9927,"x":0.0019,"y":0.0213},
  "vip-4": {
    "scale": 0.9651,
    "x": -0.0009,
    "y": 0.0272
  },
  "vip-5": {
    "scale": 1.046,
    "x": 0.0031,
    "y": 0.03
  },
  "premium-1": {
    "scale": 0.967,
    "x": 0.0009,
    "y": 0.0301
  },
  "premium-2": {"scale":0.9575,"x":0.0009,"y":0.0291},
  "premium-3": {
    "scale": 0.9846,
    "x": 0.0048,
    "y": 0.0156
  },
  "premium-4": {
    "scale": 0.9767,
    "x": 0.001,
    "y": 0.0215
  },
  "premium-5": {
    "scale": 0.9806,
    "x": 0.0048,
    "y": 0.0214
  },
  "visual-moon-dragon": {
    "scale": 1.0857,
    "x": 0.0042,
    "y": 0.0246
  },
  "visual-forest-spirit": {
    "scale": 1.0133,
    "x": 0.001,
    "y": 0.0191
  },
  "visual-sun-phoenix": {
    "scale": 1.062,
    "x": 0.0021,
    "y": 0.0227
  },
  "visual-crystal-guardian": {
    "scale": 1.005,
    "x": 0.0118,
    "y": 0.031
  },
  "visual-star-lion": {
    "scale": 0.9594,
    "x": -0.0019,
    "y": 0.0282
  },
  "prism-moon-dragon": {
    "scale": 1.0667,
    "x": 0,
    "y": 0.0393
  },
  "prism-forest-spirit": {
    "scale": 1.0881,
    "x": 0.0096,
    "y": 0.0299
  },
  "prism-sun-phoenix": {
    "scale": 1.0597,
    "x": -0.0114,
    "y": 0.0258
  },
  "prism-crystal-guardian": {
    "scale": 1.005,
    "x": 0.001,
    "y": 0.029
  },
  "prism-star-lion": {
    "scale": 0.9556,
    "x": 0.0009,
    "y": 0.0301
  },
  "glass-moon-dragon": {
    "scale": 1.046,
    "x": -0.001,
    "y": 0.0198
  },
  "glass-forest-spirit": {
    "scale": 1.0737,
    "x": 0.001,
    "y": 0.0195
  },
  "glass-sun-phoenix": {
    "scale": 1.0349,
    "x": 0.001,
    "y": 0.0189
  },
  "glass-crystal-guardian": {
    "scale": 1.0197,
    "x": 0.002,
    "y": 0.0181
  },
  "glass-star-lion": {
    "scale": 0.9575,
    "x": -0.0009,
    "y": 0.0291
  },
  "workshop-raccoon": {
    "scale": 1.005,
    "x": 0.001,
    "y": 0.0055
  },
  "workshop-hedgehog": {
    "scale": 0.9906,
    "x": -0.0029,
    "y": 0.0204
  },
  "workshop-beaver": {
    "scale": 1.0327,
    "x": -0.005,
    "y": -0.0083
  },
  "workshop-mole": {
    "scale": 1.0505,
    "x": -0.0072,
    "y": -0.0111
  },
  "workshop-robin": {
    "scale": 1.0176,
    "x": 0,
    "y": -0.0008
  },
  "forest-fox": {
    "scale": 0.9651,
    "x": -0.0028,
    "y": 0.0253
  },
  "forest-owl": {
    "scale": 0.9826,
    "x": 0.0029,
    "y": 0.0243
  },
  "forest-badger": {
    "scale": 0.9886,
    "x": -0.0039,
    "y": 0.0136
  },
  "forest-deer": {
    "scale": 0.9613,
    "x": -0.0028,
    "y": 0.0272
  },
  "forest-squirrel": {
    "scale": 0.9787,
    "x": 0.0153,
    "y": 0.0186
  },
  "sea-seal": {
    "scale": 1.0305,
    "x": 0.001,
    "y": 0.0028
  },
  "sea-octopus": {
    "scale": 0.9886,
    "x": 0.001,
    "y": 0.0136
  },
  "sea-seahorse": {
    "scale": 0.9826,
    "x": -0.0115,
    "y": 0.0166
  },
  "sea-turtle": {
    "scale": 0.9651,
    "x": 0.0028,
    "y": 0.0291
  },
  "sea-otter": {
    "scale": 0.9846,
    "x": -0.001,
    "y": 0.0291
  },
  "desert-fennec": {
    "scale": 1.005,
    "x": 0.0079,
    "y": 0.0192
  },
  "desert-cat": {
    "scale": 0.9846,
    "x": -0.0019,
    "y": 0.0291
  },
  "desert-gazelle": {
    "scale": 1.0029,
    "x": 0.0137,
    "y": 0.0104
  },
  "desert-beetle": {
    "scale": 1.0714,
    "x": 0.0031,
    "y": -0.0171
  },
  "desert-jackal": {
    "scale": 0.9575,
    "x": 0.0019,
    "y": 0.0291
  },
  "cloud-griffin": {
    "scale": 0.9906,
    "x": 0.001,
    "y": 0.0146
  },
  "cloud-pegasus": {
    "scale": 1.005,
    "x": 0.001,
    "y": 0.0173
  },
  "cloud-ibex": {
    "scale": 0.9747,
    "x": 0.0019,
    "y": 0.0243
  },
  "cloud-whale": {
    "scale": 1.0371,
    "x": 0.001,
    "y": 0.0037
  },
  "cloud-lynx": {
    "scale": 0.9651,
    "x": 0,
    "y": 0.0253
  },
  "twilight-moth": {
    "scale": 1.007,
    "x": 0.001,
    "y": 0.0162
  },
  "twilight-frog": {
    "scale": 0.9866,
    "x": 0.001,
    "y": 0.0262
  },
  "twilight-gecko": {
    "scale": 1.0438,
    "x": 0.001,
    "y": -0.0138
  },
  "twilight-bat": {
    "scale": 0.9747,
    "x": 0.0048,
    "y": 0.03
  },
  "twilight-panda": {
    "scale": 0.9826,
    "x": 0.001,
    "y": 0.0204
  },
  "snow-fox": {
    "scale": 0.9886,
    "x": 0,
    "y": 0.0136
  },
  "snow-hare": {
    "scale": 0.967,
    "x": 0.0094,
    "y": 0.0244
  },
  "snow-bear": {
    "scale": 1.0371,
    "x": 0.001,
    "y": -0.0105
  },
  "snow-walrus": {
    "scale": 1.0461,
    "x": 0.001,
    "y": -0.0089
  },
  "snow-ermine": {
    "scale": 1.0008,
    "x": 0,
    "y": 0.0154
  },
  "flame-salamander": {
    "scale": 1.0154,
    "x": 0.0069,
    "y": 0.0082
  },
  "flame-ferret": {
    "scale": 1.0349,
    "x": 0.002,
    "y": -0.0013
  },
  "flame-ram": {
    "scale": 1.0438,
    "x": 0.001,
    "y": -0.0138
  },
  "flame-dragon": {
    "scale": 1.0305,
    "x": 0.002,
    "y": 0.0089
  },
  "flame-marten": {
    "scale": 0.9806,
    "x": 0.0105,
    "y": 0.0176
  },
  "grove-ent": {
    "scale": 0.9967,
    "x": -0.0039,
    "y": 0.0115
  },
  "grove-dryad": {
    "scale": 0.9826,
    "x": 0,
    "y": 0.0166
  },
  "grove-faun": {
    "scale": 0.9886,
    "x": -0.0039,
    "y": 0.0136
  },
  "grove-spirit": {
    "scale": 1.0393,
    "x": 0,
    "y": -0.0055
  },
  "grove-hedgehog": {
    "scale": 0.9826,
    "x": -0.0048,
    "y": 0.0166
  },
  "stars-lynx": {
    "scale": 0.9728,
    "x": -0.0009,
    "y": 0.0215
  },
  "stars-ram": {
    "scale": 1.0438,
    "x": 0.001,
    "y": -0.0138
  },
  "stars-koi": {
    "scale": 0.9728,
    "x": 0,
    "y": 0.0234
  },
  "stars-raven": {
    "scale": 1.0154,
    "x": 0.001,
    "y": 0.0042
  },
  "stars-dolphin": {
    "scale": 1.0483,
    "x": 0.0092,
    "y": -0.0018
  }
});
  // Один прозрачный портрет для всех поверхностей; старые файлы сохраняются как исходники.
  function transparentSkin(skin) {
    const directory = skin.tier === "premium" ? "premium-v2" : "transparent-v2";
    const variants = Object.freeze(
      Object.fromEntries(
        [64, 128, 256, 512, 1024].map((size) => [
          size,
          `assets/skins/${directory}/${size}/${skin.id}.webp?art=${["vip-1", "vip-3", "premium-2"].includes(skin.id) ? "20261122c" : "20261122b"}`,
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
        arena: "assets/ui/art/avatar_dragon.png?art=20261122b",
      },
      {
        id: "forest-spirit",
        name: "Лесной дух",
        file: "forest-spirit.png",
        arena: "assets/ui/art/avatar_grove.png?art=20261122b",
      },
      {
        id: "sun-phoenix",
        name: "Солнечный феникс",
        file: "sun-phoenix.png",
        arena: "assets/ui/art/avatar_phoenix.png?art=20261122b",
      },
      {
        id: "crystal-guardian",
        name: "Кристальный страж",
        file: "crystal-guardian.png",
        arena: "assets/ui/art/avatar_crystal.png?art=20261122b",
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
                    `assets/skins/vip/${size}/vip-${symbol}.webp?art=20261122b`,
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
        const source = `assets/interface-packs/${set.id}/avatars/${skin.id}.webp?art=20261122b`;
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
      .map(size => [size, `assets/skins/owner-gifts-v1/${size}/${id}.webp?art=20261122b`])));
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

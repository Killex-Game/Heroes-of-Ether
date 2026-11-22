/* Каталог базовых скинов, подписи игроков и значки титулов. */
"use strict";
// Общие идентификаторы, не произвольные URL от игроков.
((root) => {
  // Единая посадка DOM и арены. Исходные изображения не меняются:
  // более свободное кадрирование сохраняет плечи, крылья и силуэт.
  const collectionCatalog =
    typeof module === "object" && module.exports
      ? require("./skin-collection-preview")
      : root.KillexSkinCollections;
  const portraitAnchors = Object.freeze({
  "army-commander": {
  "scale": 1.49,
  "x": 0,
  "y": 0.1339
},
  "army-sapper": {
  "scale": 1.37,
  "x": 0,
  "y": 0.1481
},
  "army-scout": {
  "scale": 1.27,
  "x": 0,
  "y": 0.1224
},
  "army-scout-falcon": {
    "scale": 1.05,
    "x": 0.0164,
    "y": -0.017
  },
  "army-service-dog": {
    "scale": 1.09,
    "x": 0.0085,
    "y": 0.0269
  },
  "hospital-chief-doctor": {
  "scale": 1.37,
  "x": 0,
  "y": 0.1481
},
  "hospital-helper-cat": {
    "scale": 1.03,
    "x": -0.004,
    "y": -0.007
  },
  "hospital-nurse": {
  "scale": 1.48,
  "x": 0,
  "y": 0.1476
},
  "hospital-paramedic": {
  "scale": 1.29,
  "x": 0,
  "y": 0.1248
},
  "hospital-surgeon": {
  "scale": 1.51,
  "x": 0,
  "y": 0.1663
},
  "norse-freyja": {
  "scale": 1.55,
  "x": 0,
  "y": 0.2025
},
  "norse-hugin": {
    "scale": 1.05,
    "x": -0.0062,
    "y": -0.0088
  },
  "norse-loki": {
  "scale": 1.42,
  "x": 0,
  "y": 0.183
},
  "norse-odin": {
  "scale": 1.52,
  "x": 0,
  "y": 0.2436
},
  "norse-thor": {
  "scale": 1.55,
  "x": 0,
  "y": 0.2335
},
  "gift-winged-guardian": {
  "scale": 1.85,
  "x": 0,
  "y": 0.192
},
  "gift-winged-guardianess": {
  "scale": 1.85,
  "x": 0,
  "y": 0.1735
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
  "vip-1": {
  "scale": 1.19,
  "x": 0,
  "y": 0.089
},
  "vip-2": {
  "scale": 1.06,
  "x": 0,
  "y": 0.0124
},
  "vip-3": {
  "scale": 1.27,
  "x": 0,
  "y": 0.097
},
  "vip-4": {
  "scale": 1.07,
  "x": 0,
  "y": 0.0342
},
  "vip-5": {
    "scale": 1.06,
    "x": 0.0166,
    "y": 0.0235
  },
  "premium-1": {
  "scale": 1.19,
  "x": 0,
  "y": 0.089
},
  "premium-2": {
  "scale": 1.31,
  "x": 0,
  "y": 0.1534
},
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
    "scale": 1,
    "x": 0,
    "y": 0.008
  },
  "workshop-hedgehog": {
  "scale": 1.44,
  "x": 0,
  "y": 0.2004
},
  "workshop-beaver": {
  "scale": 1.28,
  "x": 0,
  "y": 0.1236
},
  "workshop-mole": {
  "scale": 1.3,
  "x": 0,
  "y": 0.139
},
  "workshop-robin": {
    "scale": 0.98,
    "x": 0.088,
    "y": 0.0295
  },
  "forest-fox": {
    "scale": 1.05,
    "x": -0.0082,
    "y": -0.017
  },
  "forest-owl": {
    "scale": 1.03,
    "x": 0.002,
    "y": -0.007
  },
  "forest-badger": {
  "scale": 1.45,
  "x": 0,
  "y": 0.1875
},
  "forest-deer": {
  "scale": 1.31,
  "x": 0,
  "y": 0.1272
},
  "forest-squirrel": {
  "scale": 1.47,
  "x": 0,
  "y": 0.2052
},
  "sea-seal": {
  "scale": 1.21,
  "x": 0,
  "y": 0.091
},
  "sea-octopus": {
  "scale": 1.19,
  "x": 0,
  "y": 0.0771
},
  "sea-seahorse": {
  "scale": 1.32,
  "x": 0,
  "y": 0.1284
},
  "sea-turtle": {
    "scale": 1.1,
    "x": 0.0344,
    "y": 0.0439
  },
  "sea-otter": {
    "scale": 1.04,
    "x": 0.0569,
    "y": 0.0124
  },
  "desert-fennec": {
    "scale": 1.1,
    "x": 0.0107,
    "y": 0.0525
  },
  "desert-cat": {
  "scale": 1.52,
  "x": 0,
  "y": 0.2132
},
  "desert-gazelle": {
    "scale": 1.04,
    "x": 0.0244,
    "y": -0.012
  },
  "desert-beetle": {
  "scale": 1.44,
  "x": 0,
  "y": 0.1716
},
  "desert-jackal": {
  "scale": 1.51,
  "x": 0.0151,
  "y": 0.2116
},
  "cloud-griffin": {
    "scale": 1.09,
    "x": 0,
    "y": 0.0269
  },
  "cloud-pegasus": {
  "scale": 1.32,
  "x": 0,
  "y": 0.1284
},
  "cloud-ibex": {
  "scale": 1.35,
  "x": 0,
  "y": 0.159
},
  "cloud-whale": {
    "scale": 1.13,
    "x": 0.011,
    "y": 0.1019
  },
  "cloud-lynx": {
  "scale": 1.33,
  "x": 0,
  "y": 0.1562
},
  "twilight-moth": {
    "scale": 1.12,
    "x": 0.0131,
    "y": 0.088
  },
  "twilight-frog": {
  "scale": 1.15,
  "x": 0,
  "y": 0.062
},
  "twilight-gecko": {
  "scale": 1.41,
  "x": 0,
  "y": 0.1815
},
  "twilight-bat": {
    "scale": 1.1,
    "x": 0.0107,
    "y": 0.0568
  },
  "twilight-panda": {
  "scale": 1.32,
  "x": 0,
  "y": 0.1548
},
  "snow-fox": {
    "scale": 1.02,
    "x": 0.002,
    "y": -0.002
  },
  "snow-hare": {
  "scale": 1.33,
  "x": 0,
  "y": 0.1296
},
  "snow-bear": {
  "scale": 1.51,
  "x": 0,
  "y": 0.1965
},
  "snow-walrus": {
  "scale": 1.44,
  "x": 0,
  "y": 0.2148
},
  "snow-ermine": {
    "scale": 1.04,
    "x": 0.0102,
    "y": -0.0039
  },
  "flame-salamander": {
  "scale": 1.34,
  "x": 0,
  "y": 0.1442
},
  "flame-ferret": {
  "scale": 1.49,
  "x": -0.0149,
  "y": 0.1935
},
  "flame-ram": {
  "scale": 1.39,
  "x": 0,
  "y": 0.1785
},
  "flame-dragon": {
    "scale": 1.04,
    "x": 0.0041,
    "y": 0.0042
  },
  "flame-marten": {
    "scale": 1.09,
    "x": 0.0043,
    "y": 0.0354
  },
  "grove-ent": {
  "scale": 1.28,
  "x": 0,
  "y": 0.1236
},
  "grove-dryad": {
  "scale": 1.37,
  "x": -0.0137,
  "y": 0.1344
},
  "grove-faun": {
  "scale": 1.44,
  "x": 0,
  "y": 0.1716
},
  "grove-spirit": {
  "scale": 1.3,
  "x": 0,
  "y": 0.074
},
  "grove-hedgehog": {
    "scale": 1.05,
    "x": 0.0267,
    "y": -0.0129
  },
  "stars-lynx": {
    "scale": 1.06,
    "x": 0,
    "y": 0.0318
  },
  "stars-ram": {
  "scale": 1.36,
  "x": 0,
  "y": 0.1196
},
  "stars-koi": {
  "scale": 1.29,
  "x": 0,
  "y": 0.099
},
  "stars-raven": {
    "scale": 1.06,
    "x": 0.0124,
    "y": -0.0054
  },
  "stars-dolphin": {
  "scale": 1.59,
  "x": 0,
  "y": 0.2085
}
});
  // Precomputed from the opaque lower contour, with a small overlap behind the rim.
  // Scaling and vertical placement are independent so a smaller portrait still meets the ball.
  const portraitBottomAnchors = Object.freeze({
  "moon-dragon": 0.0707,
  "forest-spirit": 0.0742,
  "sun-phoenix": 0.0977,
  "crystal-guardian": 0.0847,
  "amber-fox": 0.0575,
  "snow-leopard": 0.0349,
  "little-owl": 0.0443,
  "sea-dragon": 0.0686,
  "vip-1": 0.0205,
  "vip-2": 0.0349,
  "vip-3": 0.0258,
  "vip-4": 0.0274,
  "vip-5": 0.0883,
  "premium-1": 0.0252,
  "premium-2": 0.0231,
  "premium-3": 0.0313,
  "premium-4": 0.0325,
  "premium-5": 0.0356,
  "army-commander": 0.0201,
  "army-sapper": 0.0223,
  "army-scout": 0.0184,
  "army-scout-falcon": 0.0352,
  "army-service-dog": 0.0811,
  "workshop-raccoon": 0.0294,
  "workshop-hedgehog": 0.0301,
  "workshop-beaver": 0.0186,
  "workshop-mole": 0.0209,
  "workshop-robin": 0.0431,
  "forest-fox": 0.0265,
  "forest-owl": 0.0294,
  "forest-badger": 0.0282,
  "forest-deer": 0.0191,
  "forest-squirrel": 0.0308,
  "sea-seal": 0.0204,
  "sea-octopus": 0.0244,
  "sea-seahorse": 0.0193,
  "sea-turtle": 0.1046,
  "sea-otter": 0.0496,
  "desert-fennec": 0.1092,
  "desert-cat": 0.032,
  "desert-gazelle": 0.0289,
  "desert-beetle": 0.0258,
  "desert-jackal": 0.0318,
  "hospital-chief-doctor": 0.0223,
  "hospital-helper-cat": 0.0385,
  "hospital-nurse": 0.0222,
  "hospital-paramedic": 0.0188,
  "hospital-surgeon": 0.025,
  "cloud-griffin": 0.0813,
  "cloud-pegasus": 0.0193,
  "cloud-ibex": 0.0239,
  "cloud-whale": 0.015285,
  "cloud-lynx": 0.0235,
  "twilight-moth": 0.1464,
  "twilight-frog": 0.0291,
  "twilight-gecko": 0.0273,
  "twilight-bat": 0.113,
  "twilight-panda": 0.0233,
  "snow-fox": 0.028,
  "snow-hare": 0.0195,
  "snow-bear": 0.0295,
  "snow-walrus": 0.0323,
  "snow-ermine": 0.0326,
  "norse-freyja": 0.0304,
  "norse-hugin": 0.0395,
  "norse-loki": 0.0275,
  "norse-odin": 0.0351,
  "norse-thor": 0.0351,
  "flame-salamander": 0.0217,
  "flame-ferret": 0.0291,
  "flame-ram": 0.0268,
  "flame-dragon": 0.0402,
  "flame-marten": 0.0888,
  "grove-ent": 0.0186,
  "grove-dryad": 0.0202,
  "grove-faun": 0.0258,
  "grove-spirit": 0.0158,
  "grove-hedgehog": 0.0284,
  "stars-lynx": 0.075,
  "stars-ram": 0.018,
  "stars-koi": 0.0162,
  "stars-raven": 0.043,
  "stars-dolphin": 0.0313,
  "gift-winged-guardian": 0.1192,
  "gift-winged-guardianess": 0.1152
});
  const defaultPortraitFit = Object.freeze({ scale: 0.96, x: 0, y: 0.02 });
  const portraitFits = Object.freeze(Object.fromEntries(Object.entries(portraitAnchors)
    .map(([id, fit]) => [id, Object.freeze({
      scale: Math.min(1.08, Math.max(0.94, 0.96 + (fit.scale - 1) * 0.1)),
      x: fit.x * 0.5,
      y: portraitBottomAnchors[id] ?? 0.02,
    })])));
  // Единый актуальный каталог портретов для всех поверхностей.
  function transparentSkin(skin) {
    const directory = skin.tier === "premium" ? "premium-v2" : "transparent-v2";
    const variants = Object.freeze(
      Object.fromEntries(
        [64, 128, 256, 512, 1024].map((size) => [
          size,
          `assets/skins/${directory}/${size}/${skin.id}.webp?art=${skin.tier === "vip" ? "20261122-canon16" : ["vip-1", "vip-3", "premium-2"].includes(skin.id) ? "20261122c" : "20261122b"}`,
        ]),
      ),
    );
    return Object.freeze({ ...skin, file: `${directory}/256/${skin.id}.webp`, variants, arena: variants[1024] });
  }
  const skins = Object.freeze(
    [
      {
        id: "moon-dragon",
        name: "Лунный дракон",
        file: "moon-dragon.png",

      },
      {
        id: "forest-spirit",
        name: "Лесной дух",
        file: "forest-spirit.png",

      },
      {
        id: "sun-phoenix",
        name: "Солнечный феникс",
        file: "sun-phoenix.png",

      },
      {
        id: "crystal-guardian",
        name: "Кристальный страж",
        file: "crystal-guardian.png",

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
      skins.map(([, name], index) => transparentSkin({ id: `${tier}-${index + 1}`, name, tier })),
    ),
  );
  const themeSkinSets = Object.freeze([]);
  const themeSkins = Object.freeze([]);
  // Read-only compatibility for saved identities and old reward receipts. No retired art is loaded.
  const retiredSkinReplacements = Object.freeze(Object.fromEntries(["visual", "prism", "glass"].flatMap(theme =>
    ["moon-dragon", "forest-spirit", "sun-phoenix", "crystal-guardian", "star-lion"]
      .map(id => [`${theme}-${id}`, id === "star-lion" ? "snow-leopard" : id]))));
  const currentSkinId = id => Object.prototype.hasOwnProperty.call(retiredSkinReplacements, id) ? retiredSkinReplacements[id] : id;
  const collectionSkins = Object.freeze(
    collectionCatalog.collections.flatMap((c) =>
      c.members.map((m) => {
        const variants = Object.freeze(
          Object.fromEntries(
            [64, 128, 256, 512, 1024].map((size) => [
              size,
              "assets/skins/collections-v1/" + size + "/" + m.id + ".webp?v=20261122-canon16",
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
    (typeof skin === "string" ? allSkins.find((item) => item.id === currentSkinId(skin)) : skin) || skins[0];
  const skinSource = (skin, size = 256) => {
    skin = resolveSkin(skin);
    if (!skin.variants) skin = skins[0];
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
    const fit = portraitFits[skin.id] || defaultPortraitFit;
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
    const fit = portraitFits[typeof skin === "string" ? skin : skin?.id] || defaultPortraitFit;
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
    currentSkinId,
    retiredSkinReplacements,
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

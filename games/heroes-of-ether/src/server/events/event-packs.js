"use strict";
// Only reviewed, installed content can be selected by an uploaded manifest.
// Future event achievements, cosmetics and reward rules belong to versioned packs.
// Uploading JSON never loads JavaScript or changes reward catalogs.
const packs = Object.freeze({
  "ether-alchemy-v1": Object.freeze({
    id: "ether-alchemy-v1", title: "Эфирная алхимия", achievements: require("./alchemy-achievements").definitions,
    hats: [], bows: [], rewards: require("../../../public/shared/alchemy-rules").potions.map(p => p.boosterId),
  }),
  "black-friday-v1": Object.freeze({
    id: "black-friday-v1", title: "Чёрная пятница",
    achievements: [...require("./black-friday").achievements,...require("./lucky-week").achievements],
    linkedEvents: ["lucky-week"], hats: [], bows: [], rewards: [],
  }),
  "easter-hunt-v1": Object.freeze({
    id: "easter-hunt-v1",
    title: "Пасхальная охота",
    achievements: [
      ...require("./easter-hunt").achievements,
      ...require("./lucky-week").achievements,
    ],
    linkedEvents: ["lucky-week"],
    hats: ["rabbit_ears"],
    bows: [],
    rewards: ["easter_egg", "golden_egg"],
  }),
  "lucky-week-v1": Object.freeze({
    id: "lucky-week-v1",
    title: "Удачная неделя",
    achievements: require("./lucky-week").achievements,
    hats: [],
    bows: [],
    rewards: [],
  }),
  "core-v1": Object.freeze({
    id: "core-v1",
    title: "Рулетка и Lite",
    achievements: [],
    hats: [],
    bows: [],
    rewards: [],
  }),
});
module.exports = { packs };

"use strict";
// Each event supplies its own life counters; the result dialog consumes one common format.
const sources = [
  (p, lifeId) =>
    Object.entries(p.easter?.runs || {})
      .filter(([, s]) => s.life?.id === lifeId)
      .flatMap(([runId, s]) =>
        require("../../../public/shared/easter-rules").eggs.map((egg, i) => ({
          runId,
          eventId: "easter-hunt",
          itemId: egg.id,
          name: egg.name,
          image: egg.image,
          count: s.life.eggs[i],
        })),
      ),
];
const forLife = (p, lifeId) => sources.flatMap((source) => source(p, lifeId));
function validate(items) {
  if (items === undefined) return;
  if (
    !Array.isArray(items) ||
    items.some(
      (item) =>
        !item ||
        ![item.runId, item.eventId, item.itemId, item.name, item.image].every(
          (s) => typeof s === "string" && s.length > 0 && s.length < 300,
        ) ||
        !item.image.startsWith("assets/") ||
        !Number.isSafeInteger(item.count) ||
        item.count < 0,
    )
  )
    throw Error("Повреждены итоги сбора событийных предметов.");
}
module.exports = { forLife, validate };

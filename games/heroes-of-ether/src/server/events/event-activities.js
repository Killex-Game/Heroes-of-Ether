"use strict";
// Installed companion activities share the parent launch ID and exact lifetime.
// Resolve old saved manifests too, without replacing their launch or reward receipts.
const linked = Object.freeze({
  "easter-hunt-v1": [
    {
      id: "lucky-week",
      title: "Удачная неделя",
      contentPack: "lucky-week-v1",
      features: { roulette: true, lite: true },
    },
  ],
});
function companions(manifest) {
  // Alchemy is standalone, including launches saved with the previous flags.
  if (manifest.contentPack === "ether-alchemy-v1") return [];
  const installed = linked[manifest.contentPack];
  if (installed) return installed;
  // A roulette enabled by any event carries its achievement set with it.
  // Resolve saved manifests too; the parent's launch ID and receipts stay intact.
  if (manifest.contentPack !== "lucky-week-v1" && manifest.features?.roulette)
    return [
      {
        id: "lucky-week",
        title: "Удачная неделя",
        contentPack: "lucky-week-v1",
        features: { roulette: true, lite: !!manifest.features.lite },
      },
    ];
  return [];
}
function describe(manifest) {
  const linkedEvents = companions(manifest);
  return {
    ...manifest,
    ...(manifest.contentPack === "lucky-week-v1"
      ? {
          description:
            "Рулетка, Lite подписка и достижения ждут вас. Полученные призы и неиспользованные билеты сохраняются после события.",
        }
      : manifest.contentPack === "black-friday-v1"
        ? { description: require("./black-friday").manifest.description }
        : {}),
    features: features(manifest),
    linkedEvents: structuredClone(linkedEvents),
  };
}
// Availability is consulted during ordinary profile/arena operations. It does
// not need a cloned public description or the list of achievement companions.
function features(manifest) {
  const result = { ...manifest.features };
  if (manifest.contentPack === "ether-alchemy-v1")
    return { ...result, roulette: false, lite: false };
  for (const companion of companions(manifest)) Object.assign(result, companion.features);
  return result;
}
function stamp(manifest) {
  return companions(manifest).map((e) => e.id).join(",");
}
function includes(manifest, pack) {
  return manifest.contentPack === pack || companions(manifest).some((e) => e.contentPack === pack);
}
module.exports = { describe, includes, features, stamp };

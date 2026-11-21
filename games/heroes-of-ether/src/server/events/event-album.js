"use strict";
const easter = require("./easter-hunt");
const blackFriday = require("./black-friday");
const { BoosterError } = require("../boosters/booster-catalog");

const events = [
  {
    id: easter.manifest.id,
    title: easter.manifest.title,
    banner: "assets/events/easter-hunt/banner.png",
    pictures: easter.albumPictures,
  },
  { id: blackFriday.manifest.id, title: blackFriday.manifest.title,
    banner: "assets/events/black-friday/banner.webp", pictures: blackFriday.albumPictures },
];
const rewardPerPicture = 100;

function shelf(profile, event, pictures = event.pictures(profile)) {
  const claimed = profile.eventAlbumClaims?.[event.id] || [];
  const items = pictures.map(({ id, name, image, progress, target }) => ({
    id,
    name,
    image,
    progress,
    target,
    owned: progress >= target,
    claimed: claimed.includes(id),
  }));
  return {
    id: event.id,
    title: event.title,
    banner: event.banner,
    items,
    rewardPerPicture,
    available: items.filter((art) => art.owned && !art.claimed).length * rewardPerPicture,
    sendingGift: (() => {
      const gift = require("../profiles/gift-catalog").gifts.find(g => g.eventId === event.id);
      return gift ? { id: gift.id, name: gift.name, icon: gift.icon, price: gift.price,
        unlocked: items.some(art => art.owned), unlockHint: gift.unlockHint } : null;
    })(),
  };
}
function view(profile, easterPictures) {
  return events.map((event) =>
    shelf(profile, event, event.id === easter.manifest.id ? easterPictures : undefined),
  );
}
function claim(store, token, input) {
  const event = events.find((entry) => entry.id === input?.eventId);
  if (!event) throw new BoosterError("Событие не найдено.", 400);
  return store.transactProfile(token, input.requestId, JSON.stringify(["album-reward", event.id]), (p) => {
    const { items, available } = shelf(p, event);
    if (!available) throw new BoosterError("Нет новых наград за изображения.", 409);
    const balance = p.wallet.bucks + available;
    if (!Number.isSafeInteger(balance))
      throw new BoosterError("Достигнут предел баланса эфира.", 409);
    p.wallet.bucks = balance;
    p.eventAlbumClaims ||= {};
    (p.eventAlbumClaims[event.id] ||= []).push(
      ...items.filter((art) => art.owned && !art.claimed).map((art) => art.id),
    );
  });
}
function validate(profile) {
  const ledger = profile.eventAlbumClaims;
  if (ledger === undefined) return;
  if (
    !ledger ||
    typeof ledger !== "object" ||
    Array.isArray(ledger) ||
    Object.values(ledger).some(
      (ids) =>
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => typeof id !== "string" || !id),
    )
  )
    throw Error("Повреждены награды Альбома.");
}
module.exports = { view, claim, validate };

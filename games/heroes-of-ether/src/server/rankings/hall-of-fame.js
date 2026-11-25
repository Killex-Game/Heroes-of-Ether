/* Read-only hall: earned titles, current committed greatness, bounded public rows. */
"use strict";
const { TITLES, publicTitleMedals } = require("../progression/title-chest-rewards");
const HERO = TITLES.find((title) => title.id === "boss");
const PAGE_SIZE = 8;

function view(store, requestedPage = 1) {
  const heroes = [];
  for (const profile of Object.values(store.data.profiles)) {
    const medal = publicTitleMedals(profile).find((item) => item.id === HERO.id);
    if (medal) heroes.push({ profile, awardedAt: medal.awardedAt });
  }
  // The recorded award date makes ties stable across refreshes and restarts.
  // Legacy unknown dates remain unknown; no invented historical timestamps.
  heroes.sort(
    (a, b) =>
      b.profile.greatness - a.profile.greatness ||
      (a.awardedAt ?? Number.MAX_SAFE_INTEGER) - (b.awardedAt ?? Number.MAX_SAFE_INTEGER) ||
      a.profile.id.localeCompare(b.profile.id),
  );
  const pages = Math.max(1, Math.ceil(heroes.length / PAGE_SIZE));
  const value = Number(requestedPage);
  const page = Math.max(1, Math.min(pages, Number.isSafeInteger(value) ? value : 1));
  const rows = new Map();
  function row(item, index) {
    if (!rows.has(item.profile.id)) {
      const identity = store.identity(item.profile);
      rows.set(item.profile.id, {
        id: item.profile.id,
        name: identity.name,
        clanPrefix: identity.clanPrefix,
        level: identity.level,
        skinId: identity.skinId,
        ...(identity.giftAppearance ? { giftAppearance: identity.giftAppearance } : {}),
        greatness: item.profile.greatness,
        awardedAt: item.awardedAt,
        rank: index + 1,
      });
    }
    return rows.get(item.profile.id);
  }
  const offset = (page - 1) * PAGE_SIZE;
  return {
    total: heroes.length,
    threshold: HERO.threshold,
    top: heroes.slice(0, 7).map(row),
    heroes: heroes.slice(offset, offset + PAGE_SIZE).map((item, i) => row(item, offset + i)),
    page,
    pages,
    pageSize: PAGE_SIZE,
  };
}
module.exports = { view };

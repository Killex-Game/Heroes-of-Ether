"use strict";
const { gifts } = require("./gift-catalog");
const { BoosterError } = require("../boosters/booster-catalog");
const SHOWCASE_MS = 48 * 60 * 60 * 1000, PAGE_SIZE = 40;
const catalog = new Map(gifts.map(g => [g.id, g]));
// Old histories retain a newest-first suffix. Before trimming again, the
// writer pins these ordinals so expiry or clock changes cannot shift a fence.
const ordinal = (gift, row, index) => row.ordinal ?? gift.count - index;
const visible = (row, now) => row.at + SHOWCASE_MS > now;
const publicRow = row => ({
  ...(row.anonymous ? { anonymous: true, at: row.at }
    : { fromId: row.fromId, fromName: row.fromName, at: row.at }),
  expiresAt: row.at + SHOWCASE_MS,
});
function overview(social, now) {
  const shown = [], pending = [], notices = [];
  let remaining = PAGE_SIZE, total = 0;
  for (const gift of social?.gifts || []) {
    const info = catalog.get(gift.id); if (!info) continue;
    const history = []; let count = 0, unread = 0, latestAt = 0, nextExpiry = Infinity;
    for (let i = 0; i < gift.history.length; i++) {
      const row = gift.history[i]; if (!visible(row, now)) continue;
      count++; latestAt = Math.max(latestAt, row.at); nextExpiry = Math.min(nextExpiry, row.at + SHOWCASE_MS);
      if (remaining > 0) { history.push(publicRow(row)); remaining--; }
      if (row.id && !row.readAt && ordinal(gift, row, i) > (gift.noticeThrough || 0)) {
        unread++;
        if (notices.length < PAGE_SIZE) notices.push({ row, gift: info });
      }
    }
    if (count) shown.push({ id: gift.id, count, info, history, latestAt, nextExpiry,
      historyMore: count > history.length, effectUntil: social.giftEffects?.[gift.id] || 0 });
    if (unread) { pending.push({ gift: info, count: unread, through: gift.count }); total += unread; }
  }
  return { gifts: shown, pending, total, notices };
}
function page(profile, giftId, before, now) {
  const gift = profile.social?.gifts.find(g => g.id === giftId);
  if (!catalog.has(giftId) || !gift) throw new BoosterError("Подарок не найден.", 404);
  if (before !== null && (!/^[1-9]\d{0,15}$/.test(before) || !Number.isSafeInteger(Number(before))))
    throw new BoosterError("Неверная страница подарков.", 400);
  const boundary = before === null ? Infinity : Number(before), history = [];
  let last = null, more = false;
  for (let i = 0; i < gift.history.length; i++) {
    const row = gift.history[i], seq = ordinal(gift, row, i);
    if (seq >= boundary || !visible(row, now)) continue;
    if (history.length === PAGE_SIZE) { more = true; break; }
    history.push(publicRow(row)); last = seq;
  }
  return { gift: catalog.get(giftId), history, nextBefore: more ? last : null, serverNow: now };
}
module.exports = { overview, page, ordinal, SHOWCASE_MS, PAGE_SIZE };

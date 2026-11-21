"use strict";

const WEEK = 7 * 86400000;
const REASONS = Object.freeze({ flood: "Флуд и спам в чате", profanity: "Нецензурная речь в игре" });
function counter(value, at) {
  return value && at - value.lastAt < WEEK ? value : { count: 0, lastAt: 0 };
}
function activeMute(profile, at) {
  const mute = profile?.chatModeration?.mute;
  return mute?.until > at ? mute : null;
}
function decision(previous, { flood, profanity }, at) {
  const next = {
    version: 1,
    flood: { ...counter(previous?.flood, at) },
    profanity: { ...counter(previous?.profanity, at) },
    mute: previous?.mute?.until > at ? { ...previous.mute } : null,
  };
  let punishment = null;
  function choose(kind, minutes, account = false) {
    const candidate = { kind, reason: REASONS[kind], minutes, account, at, until: at + minutes * 60000 };
    if (!punishment || (account && !punishment.account) || (account === punishment.account && minutes > punishment.minutes))
      punishment = candidate;
  }
  if (flood) {
    next.flood = { count: next.flood.count + 1, lastAt: at };
    const n = next.flood.count;
    choose("flood", n === 1 ? 5 : n === 2 ? 30 : 60, n >= 3);
  }
  if (profanity) {
    const old = next.profanity.count, count = old + profanity;
    if (!Number.isSafeInteger(count)) throw Error("Превышен счётчик нарушений чата");
    next.profanity = { count, lastAt: at };
    if (Math.floor(count / 3) > Math.floor(old / 3))
      choose("profanity", 60, true);
    else if (old < 2 && count >= 2) choose("profanity", 30);
    else if (old < 1 && count >= 1) choose("profanity", 15);
  }
  if (punishment && !punishment.account)
    next.mute = { at, until: punishment.until, reason: punishment.reason };
  return { next, punishment };
}
function validate(profile) {
  const state = profile.chatModeration;
  if (state === undefined) return;
  const validCounter = c => c && Number.isSafeInteger(c.count) && c.count >= 0 &&
    Number.isSafeInteger(c.lastAt) && c.lastAt >= 0;
  const mute = state?.mute;
  if (!state || state.version !== 1 || !validCounter(state.flood) || !validCounter(state.profanity) ||
    (mute !== null && (!mute || !Object.values(REASONS).includes(mute.reason) ||
      !Number.isSafeInteger(mute.at) || mute.at < 0 || !Number.isSafeInteger(mute.until) || mute.until <= mute.at)))
    throw Error("Повреждены данные ограничений чата. Сохранение не перезаписано.");
}
function ownerView(profile, at) {
  const result = { mute: activeMute(profile, at) ? { ...activeMute(profile, at) } : null };
  for (const kind of ["flood", "profanity"]) {
    const value = counter(profile.chatModeration?.[kind], at);
    result[kind] = { strikes: value.count, lastAt: value.count ? value.lastAt : null,
      resetAt: value.count ? value.lastAt + WEEK : null };
  }
  return result;
}
module.exports = { WEEK, REASONS, counter, activeMute, decision, validate, ownerView };

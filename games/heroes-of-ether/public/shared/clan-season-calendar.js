/* Общий календарь. Сервер хранит UTC; интерфейс форматирует местное время. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexClanCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const HOUR = 3600000, DAY = 24 * HOUR, OFFSET = 3 * HOUR;
  function season(at) {
    if (!Number.isFinite(at)) throw Error("Invalid clan calendar time");
    const date = new Date(at + OFFSET), year = date.getUTCFullYear();
    const block = Math.floor(date.getUTCMonth() / 2), month = block * 2;
    const mode = block % 2 ? "quests" : "battle";
    return {
      id: `clan-${mode}-${year}-${String(month + 1).padStart(2, "0")}`,
      mode, name: mode === "quests" ? "Сезон клановых заданий" : "Сезон клановых битв",
      number: (year - 2026) * 3 + Math.floor(block / 2) + 1,
      start: Date.UTC(year, month, 1) - OFFSET,
      end: Date.UTC(year, month + 2, 1) - OFFSET,
    };
  }
  function daily(at) {
    const midnight = Math.floor((at + OFFSET) / DAY) * DAY - OFFSET;
    return { start: midnight + 8 * HOUR, end: midnight + 21 * HOUR,
      nextStart: midnight + (at < midnight + 8 * HOUR ? 0 : DAY) + 8 * HOUR };
  }
  const QUEST_PRIZES = Object.freeze([
    [1, 3, "diamond", "Бриллиантовая", 250, 3000, 250],
    [4, 10, "platinum", "Платиновая", 200, 2500, 200],
    [11, 20, "gold", "Золотая", 150, 2000, 150],
    [21, 25, "silver", "Серебряная", 100, 1500, 100],
    [26, 30, "bronze", "Бронзовая", 50, 1000, 50],
  ].map(([from, to, id, name, bucks, coins, crystals]) => Object.freeze({from, to, id, name,
    reward: Object.freeze({bucks, coins, crystals})})));
  const questPrize = rank => QUEST_PRIZES.find(p => rank >= p.from && rank <= p.to) || null;
  const localTime = at => new Date(at).toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"});
  const localDate = at => new Date(at).toLocaleDateString("ru-RU");
  const localRange = at => { const d = daily(at); return `${localTime(d.start)}–${localTime(d.end)}`; };
  const countdown = (end, at) => {
    const s = Math.max(0, Math.ceil((end - at) / 1000)), days = Math.floor(s / 86400);
    return (days ? `${days} д ` : "") + [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
      .map(n => String(n).padStart(2, "0")).join(":");
  };
  return {season, daily, QUEST_PRIZES, questPrize, localTime, localDate, localRange, countdown};
});

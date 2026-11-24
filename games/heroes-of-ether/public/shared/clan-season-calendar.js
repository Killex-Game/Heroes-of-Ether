/* Общий календарь. Сервер хранит UTC; интерфейс форматирует местное время. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexClanCalendar = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const HOUR = 3600000, DAY = 24 * HOUR, OFFSET = 3 * HOUR;
  function season(at, schedule = []) {
    if (!Number.isFinite(at)) throw Error("Invalid clan calendar time");
    const date = new Date(at + OFFSET), year = date.getUTCFullYear();
    const block = Math.floor(date.getUTCMonth() / 2), month = block * 2;
    const start = Date.UTC(year, month, 1) - OFFSET;
    const mode = schedule.find(row => row.start === start)?.mode || (block % 2 ? "quests" : "battle");
    let number = (year - 2026) * 3 + (mode === 'quests' ? Math.floor(block / 2) : Math.ceil(block / 2)) + 1;
    for (const row of schedule) if (row.start < start) {
      const original = Math.floor(new Date(row.start + OFFSET).getUTCMonth() / 2) % 2 ? 'quests' : 'battle';
      number += Number(row.mode === mode) - Number(original === mode);
    }
    return {
      id: `clan-${mode}-${year}-${String(month + 1).padStart(2, "0")}`,
      mode, name: mode === "quests" ? "Сезон клановых заданий" : "Сезон клановых битв",
      number,
      start,
      end: Date.UTC(year, month + 2, 1) - OFFSET,
    };
  }
  function validateSchedule(schedule) {
    if (!Array.isArray(schedule) || schedule.length > 1200) throw Error('Invalid clan calendar schedule');
    let previous = -Infinity;
    for (const row of schedule) {
      if (!row || Object.keys(row).sort().join(',') !== 'mode,start' || !['quests','battle'].includes(row.mode) ||
          !Number.isSafeInteger(row.start) || row.start < Date.UTC(2026,0,1)-OFFSET || row.start <= previous ||
          season(row.start).start !== row.start) throw Error('Invalid clan calendar schedule');
      previous = row.start;
    }
  }
  function daily(at, mode = "battle") {
    const midnight = Math.floor((at + OFFSET) / DAY) * DAY - OFFSET;
    const opening = 7;
    return { start: midnight + opening * HOUR, end: midnight + 22 * HOUR,
      nextStart: midnight + (at < midnight + opening * HOUR ? 0 : DAY) + opening * HOUR };
  }
  const QUEST_PRIZES = Object.freeze([
    [1, 3, "diamond", "Бриллиантовая", 250, 3000, 250, 100],
    [4, 10, "platinum", "Платиновая", 200, 2500, 200, 75],
    [11, 20, "gold", "Золотая", 150, 2000, 150, 50],
    [21, 25, "silver", "Серебряная", 100, 1500, 100, 25],
    [26, 30, "bronze", "Бронзовая", 50, 1000, 50, 10],
  ].map(([from, to, id, name, bucks, coins, crystals, greatness]) => Object.freeze({from, to, id, name,
    reward: Object.freeze({bucks, coins, crystals, greatness})})));
  const questPrize = rank => QUEST_PRIZES.find(p => rank >= p.from && rank <= p.to) || null;
  const localTime = at => new Date(at).toLocaleTimeString("ru-RU", {hour: "2-digit", minute: "2-digit"});
  const localDate = at => new Date(at).toLocaleDateString("ru-RU");
  const localRange = (at, mode = "battle") => { const d = daily(at, mode); return `${localTime(d.start)} - ${localTime(d.end)}`; };
  // Named season days stay calendar dates, independent of the viewer's timezone.
  const seasonDay = at => { const d = new Date(at + OFFSET); return `${String(d.getUTCDate()).padStart(2,"0")}.${String(d.getUTCMonth()+1).padStart(2,"0")}.${d.getUTCFullYear()}`; };
  const seasonRange = s => `${seasonDay(s.start)} - ${seasonDay(s.end - 1)}`;
  const countdown = (end, at) => {
    const s = Math.max(0, Math.ceil((end - at) / 1000)), days = Math.floor(s / 86400);
    return (days ? `${days} д ` : "") + [Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60]
      .map(n => String(n).padStart(2, "0")).join(":");
  };
  return {season, validateSchedule, daily, QUEST_PRIZES, questPrize, localTime, localDate, localRange, seasonRange, countdown};
});

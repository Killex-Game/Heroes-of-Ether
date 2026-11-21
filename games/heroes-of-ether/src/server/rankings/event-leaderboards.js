"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");

const lite = require("../accounts/lite-account");
const history = require("../profiles/transaction-history");
const titles = require("../progression/title-chest-rewards");
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const DAY = 86400000,
  MSK = 10800000;
const dayAt = (at) => Math.floor((at + MSK) / DAY);
const dayEnd = (day) => (day + 1) * DAY - MSK;
const resultKey = (runId, day) => `${runId}:${day}`;
const definitions = {
  "black-friday-v1": {
    title:"Топ исполнителей", unit:"жетонов",
    score:(p,id,day)=>p.blackFriday?.runs?.[id]?.days?.[day]?.earned||0,
    days:(p,id)=>Object.keys(p.blackFriday?.runs?.[id]?.days||{}).map(Number),
    prizes:[
      {from:1,to:3,greatness:30,coins:100,crystals:15,bucks:0,tickets:3},
      {from:4,to:10,greatness:20,coins:75,crystals:10,bucks:0,tickets:2},
      {from:11,to:50,greatness:10,coins:50,crystals:5,bucks:0,tickets:1},
      {from:51,to:100,greatness:5,coins:25,crystals:0,bucks:0,tickets:0},
    ],
  },
  "lucky-week-v1": {
    title: "Топ счастливчиков",
    unit: "билетов",
    // Roulette records one attempt per consumed ticket in the same transaction
    // as its receipt and prize. Purchases and grants do not increase this counter.
    // Old cumulative totals have no date and must not become today's score.
    score: (p, runId, day) => p.eventAchievements?.[runId]?.dailySpins?.[day] || 0,
    days: (p, runId) => Object.keys(p.eventAchievements?.[runId]?.dailySpins || {}).map(Number),
    prizes: [
      { from: 1, to: 3, greatness: 10, bucks: 10, tickets: 0, coins: 0, crystals: 0 },
      { from: 4, to: 10, greatness: 7, bucks: 7, tickets: 0, coins: 0, crystals: 0 },
      { from: 11, to: 50, greatness: 5, bucks: 5, tickets: 0, coins: 0, crystals: 0 },
    ],
  },
  "easter-hunt-v1": {
    title: "Топ искателей",
    unit: "яиц",
    score: (p, runId, day) => p.easter?.runs[runId]?.dailyFound?.[day] || 0,
    days: (p, runId) => Object.keys(p.easter?.runs[runId]?.dailyFound || {}).map(Number),
    prizes: [
      { from: 1, to: 5, bucks: 50, tickets: 10, coins: 500, crystals: 30 },
      { from: 6, to: 20, bucks: 25, tickets: 5, coins: 250, crystals: 15 },
      { from: 21, to: 100, bucks: 10, tickets: 3, coins: 150, crystals: 10 },
    ],
  },
};
const finish = (run) => Math.min(run.endsAt, run.stoppedAt ?? run.endsAt);
const runs = (manager) =>
  (manager?.data.runs || []).filter(
    (r) => Object.hasOwn(definitions, r.manifest.contentPack) && finish(r) > r.startsAt,
  );
function leaders(data, run, day) {
  const definition = definitions[run.manifest.contentPack];
  return Object.values(data.profiles)
    .filter((p) => !p.testBot)
    .map((p) => ({ id: p.id, score: definition.score(p, run.id, day) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((r, index) => ({ ...r, rank: index + 1 }));
}
function due(data, manager, at) {
  if (!manager || !runs(manager).length) return false;
  if (data.eventDailyRankingStartedAt === undefined) return true;
  if (data.luckyRankingStartedAt === undefined) return true;
  if (data.luckyDailyRankingStartedAt === undefined) return true;
  return pendingPeriods(data, manager, at).length > 0;
}
function pendingPeriods(data, manager, at) {
  return runs(manager)
    .flatMap((run) => {
      const definition = definitions[run.manifest.contentPack];
      if (definition.period === "event") {
        const endsAt = finish(run);
        return endsAt > data.luckyRankingStartedAt && endsAt <= at &&
          !data.eventRankingResults?.[run.id]
          ? [{ run, endsAt, field: "eventRankingResults", key: run.id }]
          : [];
      }
      // Daily awards cannot exist before a Moscow day closes. Check the
      // calendar and durable receipts before touching every player's history.
      // No cached deadline: rescheduling, clock reversal and a failed commit
      // are evaluated from the supplied snapshot on every call.
      const firstDay = Math.max(dayAt(run.startsAt), dayAt(data.eventDailyRankingStartedAt));
      const lastDay = Math.min(dayAt(finish(run) - 1), dayAt(at) - 1);
      if (firstDay > lastDay) return [];
      // Valid event runs are at most 90 days. Keep unknown/legacy ranges on
      // the original history path instead of allowing an unbounded scan.
      if (Number.isSafeInteger(firstDay) && Number.isSafeInteger(lastDay) && lastDay - firstDay <= 366) {
        let unclaimed = false;
        for (let day = firstDay; day <= lastDay; day++)
          if (!data.eventDailyRankingResults?.[resultKey(run.id, day)]) { unclaimed = true; break; }
        if (!unclaimed) return [];
      }
      const days = new Set(
        Object.values(data.profiles)
          .filter((p) => !p.testBot)
          .flatMap((p) => definition.days(p, run.id)),
      );
      return [...days]
        .sort((a, b) => a - b)
        .filter(
          (day) =>
            day >= dayAt(run.startsAt) &&
            day <= dayAt(finish(run) - 1) &&
            dayEnd(day) > data.eventDailyRankingStartedAt &&
            dayEnd(day) <= at &&
            !data.eventDailyRankingResults?.[resultKey(run.id, day)],
        )
        .map((day) => ({ run, day, endsAt: dayEnd(day),
          field: "eventDailyRankingResults", key: resultKey(run.id, day) }));
    })
    .sort((a, b) => a.endsAt - b.endsAt || a.run.startsAt - b.run.startsAt);
}
function add(a, b) {
  if (!integer(a) || !integer(b) || !integer(a + b))
    throw Error("Превышен предел награды событийного топа.");
  return a + b;
}
function startLuckyDaily(data, manager, at) {
  if (data.luckyDailyRankingStartedAt !== undefined) return data;
  const day = dayAt(at), start = dayEnd(day) - DAY,
    active = runs(manager).filter(r => r.manifest.contentPack === "lucky-week-v1" &&
      r.startsAt <= at && at < finish(r));
  const profiles = { ...data.profiles };
  for (const [key, original] of Object.entries(profiles)) {
    let p = original;
    for (const run of active) {
      const state = p.eventAchievements?.[run.id];
      if (!state || state.dailySpins !== undefined) continue;
      // Recover only today's dated, committed roulette receipts. Undated totals
      // and previous days cannot be awarded retroactively by this migration.
      const count = Object.values(p.roulette?.results || {}).reduce((sum, result) =>
        result.at >= Math.max(start, run.startsAt) && result.at <= at && result.at < finish(run)
          ? sum + 1 + (result.extraSpins?.length || 0) : sum, 0);
      if (p === original) p = copyProfile(original);
      p.eventAchievements[run.id].dailySpins = count > 0 && count <= (state.values.lucky_attempt || 0)
        ? { [day]: count } : {};
    }
    if (p !== original) { p.revision = add(p.revision, 1); profiles[key] = p; }
  }
  return { ...data, profiles, luckyDailyRankingStartedAt: at };
}
// Results, account balances and the settlement marker are committed by one ProfileStore.save.
function settle(data, manager, at) {
  if (!manager || !runs(manager).length) return data;
  if (data.eventDailyRankingStartedAt === undefined)
    data = { ...data, eventDailyRankingStartedAt: at };
  // Do not retroactively award archived events when installing the new top.
  if (data.luckyRankingStartedAt === undefined)
    data = { ...data, luckyRankingStartedAt: at };
  data = startLuckyDaily(data, manager, at);
  for (const { run, day, endsAt, field, key: receiptKey } of pendingPeriods(data, manager, at)) {
    const definition = definitions[run.manifest.contentPack],
      entries = leaders(data, run, day);
    const profiles = { ...data.profiles },
      keys = new Map(Object.entries(profiles).map(([key, p]) => [p.id, key]));
    for (const entry of entries) {
      const prize = definition.prizes.find((p) => entry.rank >= p.from && entry.rank <= p.to);
      if (!prize) continue;
      const key = keys.get(entry.id),
        p = copyProfile(profiles[key]),
        before = history.snapshot(p);
      for (const currency of ["coins", "crystals", "bucks"])
        p.wallet[currency] = add(p.wallet[currency], prize[currency]);
      lite.grantTickets(p, prize.tickets);
      if (prize.greatness) {
        p.greatness = add(p.greatness, prize.greatness);
        titles.awardTitles(p, at);
      }
      history.record(p, before, at, {
        kind: "reward",
        label: `${definition.title}${day === undefined ? "" : ", " + dateLabel(day)}: ${entry.rank} место`,
        detail: definition.unit === "билетов"
          ? `Использовано билетов: ${entry.score}. Величие: +${prize.greatness}. Эфир: +${prize.bucks}`
          : `Получено ${definition.unit}: ${entry.score}. Билеты рулетки: +${prize.tickets}`,
      });
      p.revision = add(p.revision, 1);
      profiles[key] = p;
      entry.reward = {
        bucks: prize.bucks,
        tickets: prize.tickets,
        coins: prize.coins,
        crystals: prize.crystals,
        ...(prize.greatness ? { greatness: prize.greatness } : {}),
      };
    }
    data = {
      ...data,
      profiles,
      [field]: {
        ...data[field],
        [receiptKey]: {
          title: definition.title,
          ...(day === undefined ? {} : { day }),
          runId: run.id,
          endsAt,
          settledAt: at,
          entries,
        },
      },
    };
  }
  return data;
}
function dateLabel(day) {
  return new Date(day * DAY - MSK).toLocaleDateString("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
  });
}
function view(store, profile, page = 1) {
  const at = store.now(),
    run = runs(store.events).findLast(
      (r) =>
        r.startsAt <= at &&
        at < finish(r) &&
        (definitions[r.manifest.contentPack].period === "event" ||
          dayEnd(dayAt(finish(r) - 1)) > (store.data.eventDailyRankingStartedAt ?? at)),
    );
  if (!run) return null;
  const day = Math.min(dayAt(at), dayAt(finish(run) - 1));
  const definition = definitions[run.manifest.contentPack],
    wholeEvent = definition.period === "event",
    result = wholeEvent ? store.data.eventRankingResults?.[run.id]
      : store.data.eventDailyRankingResults?.[resultKey(run.id, day)];
  const entries = result?.entries || leaders(store.data, run, day),
    top = entries.slice(0, 100);
  const pages = Math.max(1, Math.ceil(top.length / 10)),
    current = Math.max(1, Math.min(pages, Number.isInteger(Number(page)) ? Number(page) : 1));
  const identity = (entry) => {
    const p = store.byId(entry.id);
    return { ...entry, ...(p ? store.identity(p) : { name: "Игрок" }) };
  };
  return {
    runId: run.id,
    title: definition.title,
    unit: definition.unit,
    period: wholeEvent ? "event" : "day",
    day,
    dateLabel: dateLabel(day),
    endsAt: wholeEvent ? finish(run) : dayEnd(day),
    settled: !!result || at >= (wholeEvent ? finish(run) : dayEnd(day)),
    prizes: definition.prizes,
    page: current,
    pages,
    total: entries.length,
    mine: entries.find((r) => r.id === profile.id) || null,
    rows: top.slice((current - 1) * 10, current * 10).map(identity),
  };
}
function validate(data) {
  if (data.eventRankingStartedAt !== undefined && !integer(data.eventRankingStartedAt))
    throw Error("Повреждён срок начала событийных топов.");
  if (data.eventDailyRankingStartedAt !== undefined && !integer(data.eventDailyRankingStartedAt))
    throw Error("Повреждён срок начала ежедневных событийных топов.");
  if (data.luckyRankingStartedAt !== undefined && !integer(data.luckyRankingStartedAt))
    throw Error("Повреждён срок начала Топа счастливчиков.");
  if (data.luckyDailyRankingStartedAt !== undefined && !integer(data.luckyDailyRankingStartedAt))
    throw Error("Повреждён срок начала ежедневного Топа счастливчиков.");
  // Preserve old receipts, including whole-event Easter settlements.
  for (const [field, daily] of [
    ["eventRankingResults", false],
    ["eventDailyRankingResults", true],
  ]) {
    if (data[field] === undefined) continue;
    const results = data[field];
    if (!results || typeof results !== "object" || Array.isArray(results))
      throw Error("Повреждены итоги событийных топов.");
    for (const [id, result] of Object.entries(results)) {
      if (
        !(daily ? /^[a-zA-Z0-9_-]{1,80}:\d{1,8}$/ : /^[a-zA-Z0-9_-]{1,80}$/).test(id) ||
        !result ||
        (daily &&
          (!integer(result.day) ||
            resultKey(result.runId, result.day) !== id ||
            result.endsAt !== dayEnd(result.day))) ||
        typeof result.title !== "string" ||
        !integer(result.endsAt) ||
        !integer(result.settledAt) ||
        result.settledAt < result.endsAt ||
        !Array.isArray(result.entries)
      )
        throw Error("Повреждён итог событийного топа.");
      const ids = new Set();
      for (const [i, entry] of result.entries.entries()) {
        if (
          !entry ||
          typeof entry.id !== "string" ||
          ids.has(entry.id) ||
          entry.rank !== i + 1 ||
          !integer(entry.score) ||
          !entry.score ||
          (i && entry.score > result.entries[i - 1].score) ||
          (entry.reward !== undefined &&
            (!entry.reward ||
              !["coins", "crystals", "bucks", "tickets"].every((key) =>
                integer(entry.reward[key]),
              ) || (entry.reward.greatness !== undefined && !integer(entry.reward.greatness))))
        )
          throw Error("Повреждены места событийного топа.");
        ids.add(entry.id);
      }
    }
  }
}
module.exports = { due, settle, view, validate, leaders, dayAt, dayEnd, resultKey };

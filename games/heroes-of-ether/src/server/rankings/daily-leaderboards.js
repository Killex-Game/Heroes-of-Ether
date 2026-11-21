/* Суточные рейтинги игроков и смена расчётного дня. */
"use strict";
const { copyProfile } = require("../profiles/owned-profile-draft");
const DAY_MS = 86400000,
  MOSCOW_OFFSET_MS = 3 * 3600000;
const rules = require("../../../public/shared/daily-ranking-rules");
const { awardTitles } = require("../progression/title-chest-rewards");
const history = require("../profiles/transaction-history");
const notices = require("./daily-ranking-notices");
const METRICS = Object.freeze(Object.fromEntries(rules.boards.map((b) => [b.id, b.metric])));
const dayAt = (at) => Math.floor((at + MOSCOW_OFFSET_MS) / DAY_MS);
const startOfDay = (at) => dayAt(at) * DAY_MS - MOSCOW_OFFSET_MS;
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const empty = (at) => ({ day: dayAt(at), kills: 0, arenaSeconds: 0, greatness: 0 });
function validate(profile) {
  notices.validate(profile);
  const daily = profile.daily;
  if (
    daily !== undefined &&
    (!daily ||
      Array.isArray(daily) ||
      ![daily.day, daily.kills, daily.arenaSeconds, daily.greatness].every(integer))
  )
    throw Error("Повреждены дневные рейтинги. Сохранение не перезаписано.");
  if (
    profile.regalia !== undefined &&
    (!profile.regalia ||
      typeof profile.regalia !== "object" ||
      Array.isArray(profile.regalia) ||
      Object.entries(profile.regalia).some(
        ([id, medal]) =>
          !rules.medals.some((m) => m.id === id) ||
          !medal ||
          !integer(medal.count) ||
          medal.count < 1 ||
          !integer(medal.firstDay) ||
          !integer(medal.lastDay) ||
          medal.lastDay < medal.firstDay,
      ))
  )
    throw Error("Повреждены регалии. Сохранение не перезаписано.");
}
function validateWorld(data) {
  if (
    data.dailyPrizes !== undefined &&
    (!data.dailyPrizes || Array.isArray(data.dailyPrizes) || !integer(data.dailyPrizes.day))
  )
    throw Error("Повреждён расчёт призов за день. Сохранение не перезаписано.");
}
const due = (data, at) => !data.dailyPrizes || data.dailyPrizes.day < dayAt(at);
function add(a, b) {
  const value = a + b;
  if (!integer(value)) throw Error("Награда рейтинга превысила допустимое значение.");
  return value;
}
// Считаем по зафиксированным итогам до сброса счётчиков. Балансы, регалии и
// отметка завершённого дня входят в одну атомарную запись ProfileStore.save.
function eventDay(events, day) {
  const start = day * DAY_MS - MOSCOW_OFFSET_MS,
    end = start + DAY_MS;
  // Учитываем завершившийся день по МСК, включая последний день события.
  // Запоздалый расчёт после перезапуска не теряет уже заработанный бонус.
  return !!events?.data.runs.some((run) => {
    const finish = Math.min(run.endsAt, run.stoppedAt ?? run.endsAt);
    return run.startsAt < end && finish > start && finish > run.startsAt;
  });
}
function settle(next, previous, at, events) {
  if (!due(previous, at)) return next;
  const day = previous.dailyPrizes?.day;
  next = { ...next, dailyPrizes: { day: dayAt(at) }, profiles: { ...next.profiles } };
  // При включении механики не раздаём призы за старые неполные дни.
  if (day === undefined) return next;
  const bonus = eventDay(events, day);
  const changed = new Map();
  for (const board of rules.boards) {
    const leaders = Object.entries(previous.profiles)
      .filter(([, p]) => p.daily?.day === day && p.daily[board.metric] > 0)
      .sort(
        ([, a], [, b]) => b.daily[board.metric] - a.daily[board.metric] || a.id.localeCompare(b.id),
      )
      .slice(0, 3);
    for (const [index, [key]] of leaders.entries()) {
      if (!next.profiles[key]) continue;
      if (!changed.has(key)) changed.set(key, copyProfile(next.profiles[key]));
      const p = changed.get(key),
        prize = {
          ...rules.prizes[index],
          ...(bonus ? { tickets: rules.eventTickets[index] } : {}),
        },
        id = board.medal + "-" + (index + 1);
      const before = history.snapshot(p);
      notices.record(p, day, id, prize);
      p.greatness = add(p.greatness, prize.greatness);
      p.wallet.coins = add(p.wallet.coins, prize.coins);
      p.wallet.crystals = add(p.wallet.crystals, prize.crystals);
      if (prize.tickets) {
        const roulette = require("../roulette/roulette-service");
        const r = (p.roulette ||= roulette.fresh(p.level));
        r.tickets = add(r.tickets, prize.tickets);
        r.earned = add(r.earned, prize.tickets);
        roulette.validate(p);
      }
      history.record(p, before, at, {
        kind: "reward",
        label: `Рейтинг «${board.name}»: ${index + 1} место`,
        detail:
          "Расчётный день: " +
          new Date(day * DAY_MS).toISOString().slice(0, 10) +
          (prize.tickets ? `. Билеты рулетки: +${prize.tickets}` : ""),
      });
      if (p.activity) {
        p.activity.values.top = add(p.activity.values.top, 1);
        require("../progression/activity-achievements").awardExtra(p, at);
      }
      p.regalia ||= {};
      const medal = p.regalia[id];
      p.regalia[id] = {
        count: add(medal?.count || 0, 1),
        firstDay: medal?.firstDay ?? day,
        lastDay: day,
      };
    }
  }
  for (const [key, p] of changed) {
    // Призы фиксированные, без множителей аккаунтов. Доступные титула
    // открываются обычным способом, а величие призов не запускает новый топ.
    awardTitles(p, at);
    p.revision = add(p.revision, 1);
    validate(p);
    next.profiles[key] = p;
  }
  return next;
}
function publicRegalia(profile) {
  return rules.medals
    .filter((m) => profile.regalia?.[m.id])
    .map((m) => ({
      id: m.id,
      ...profile.regalia[m.id],
    }));
}
function current(profile, at) {
  return profile.daily?.day === dayAt(at) ? { ...profile.daily } : empty(at);
}
// Вызывается перед атомарным сохранением. Повтор операции не увеличивает счётчики.
function capture(profile, previous, at) {
  if (profile === previous && profile.daily?.day === dayAt(at)) return profile;
  const daily = current(profile, at);
  if (previous) {
    const deltas = {
      kills: Math.max(0, profile.progress.kills - previous.progress.kills),
      greatness: Math.max(0, profile.greatness - previous.greatness),
      arenaSeconds: Math.max(
        0,
        (profile.activity?.arenaSeconds || 0) - (previous.activity?.arenaSeconds || 0),
      ),
    };
    // Последний интервал жизни может пересечь полночь: новым суткам достаётся
    // только его часть после 00:00 МСК. Простой между запусками не начисляется.
    deltas.arenaSeconds = Math.min(deltas.arenaSeconds, Math.floor((at - startOfDay(at)) / 1000));
    for (const key of Object.keys(deltas)) {
      daily[key] += deltas[key];
      if (!integer(daily[key])) throw Error("Дневной рейтинг превысил допустимое значение.");
    }
  }
  // Preserve unchanged row identities: the durable journal writes replaced
  // profiles. Cloning an idle ranking here made one player's booster save
  // every profile on the server and could exhaust the checkpoint backlog.
  if (
    profile.daily &&
    ["day", "kills", "arenaSeconds", "greatness"].every((key) => profile.daily[key] === daily[key])
  )
    return profile;
  return { ...profile, daily };
}
module.exports = {
  METRICS,
  dayAt,
  eventDay,
  startOfDay,
  nextReset: (at) => startOfDay(at) + DAY_MS,
  validate,
  current,
  capture,
  due,
  settle,
  validateWorld,
  publicRegalia,
};

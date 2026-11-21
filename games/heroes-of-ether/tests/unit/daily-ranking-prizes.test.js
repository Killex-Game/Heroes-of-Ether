"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const daily = require("../../src/server/rankings/daily-leaderboards");
const rules = require("../../public/shared/daily-ranking-rules");
const notices = require("../../src/server/rankings/daily-ranking-notices");
const { EventManager } = require("../../src/server/events/event-manager");
const MIDNIGHT = Date.parse("2026-10-21T21:00:00Z");
function fixture(count = 4) {
  let at = MIDNIGHT - 60000;
  const store = new ProfileStore({ now: () => at });
  const users = Array.from({ length: count }, () => store.open());
  return {
    store,
    users,
    clock: (value) => {
      at = value;
    },
    p: (i) => store.find(users[i].token),
    score(i, values) {
      store.transact(users[i].token, randomUUID(), "seed", (p) => {
        p.daily = { day: daily.dayAt(at), kills: 0, arenaSeconds: 0, greatness: 0, ...values };
      });
    },
  };
}
test("Три топа: точные призы, девять регалий, накопление наград и исключение нулевых результатов", () => {
  const f = fixture();
  for (let i = 0; i < 3; i++)
    f.score(i, { kills: 30 - i, arenaSeconds: 300 - i, greatness: 30 - i });
  const before = f.users.map((_, i) => structuredClone(f.p(i)));
  f.clock(MIDNIGHT - 1);
  f.store.refreshCompetition();
  assert.equal(f.p(0).regalia, undefined);
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  const earned = [];
  for (let i = 0; i < 3; i++) {
    const p = f.p(i),
      prize = rules.prizes[i];
    assert.equal(p.greatness - before[i].greatness, prize.greatness * 3 + 10);
    assert.equal(p.activity.values.top, 3);
    assert.equal(p.activity.claimed.top, 1);
    assert.equal(p.wallet.coins - before[i].wallet.coins, prize.coins * 3);
    assert.equal(p.wallet.crystals - before[i].wallet.crystals, prize.crystals * 3);
    assert.deepEqual(p.progress, before[i].progress);
    assert.deepEqual(daily.current(p, MIDNIGHT), {
      day: daily.dayAt(MIDNIGHT),
      kills: 0,
      arenaSeconds: 0,
      greatness: 0,
    });
    const regalia = f.store.publicPlayer(p.id).regalia;
    const rewards = f.store.view(p).dailyRankingRewards;
    assert.equal(rewards.length, 3);
    assert.ok(rewards.every((n) => n.day === daily.dayAt(MIDNIGHT) - 1));
    assert.ok(rewards.every((n) => JSON.stringify(n.prize) === JSON.stringify(prize)));
    assert.equal(f.store.publicPlayer(p.id).dailyRankingRewards, undefined);
    assert.equal(regalia.length, 3);
    for (const r of regalia) {
      assert.equal(r.count, 1);
      earned.push(r.id);
    }
  }
  assert.equal(new Set(earned).size, 9);
  assert.equal(f.p(3).regalia, undefined);
  const committed = structuredClone(f.store.data);
  f.store.refreshCompetition();
  assert.deepEqual(f.store.data, committed);
  f.clock(MIDNIGHT + 86400000);
  f.store.refreshCompetition();
  assert.deepEqual(
    f.p(0).regalia,
    before[0].regalia || committed.profiles[Object.keys(committed.profiles)[0]].regalia,
  );
});
test("Одинаковые результаты: призовые места совпадают с отображаемым рейтингом", () => {
  const f = fixture(5),
    clans = new ClanService(f.store);
  for (let i = 0; i < 5; i++) f.score(i, { kills: 10 });
  const leaders = clans.state(f.users[0].token, "", 1, "", "dailyKills").playerLeaders;
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  for (const [i, p] of leaders.entries()) {
    const medals = f.store.publicPlayer(p.id).regalia;
    assert.deepEqual(
      medals.map((m) => m.id),
      i < 3 ? ["kills-" + (i + 1)] : [],
    );
  }
});
test("Повторная победа увеличивает счётчик, пропущенные пустые дни не раздают призы", () => {
  const f = fixture(1);
  f.score(0, { kills: 5 });
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  const first = structuredClone(f.p(0).regalia["kills-1"]);
  f.score(0, { kills: 8 });
  f.clock(MIDNIGHT + 4 * 86400000);
  f.store.refreshCompetition();
  assert.deepEqual(f.p(0).regalia["kills-1"], {
    count: 2,
    firstDay: first.firstDay,
    lastDay: first.lastDay + 1,
  });
  assert.equal(daily.current(f.p(0), MIDNIGHT + 4 * 86400000).greatness, 0);
  f.clock(MIDNIGHT + 86400000);
  f.store.refreshCompetition();
  f.clock(MIDNIGHT + 4 * 86400000);
  f.store.refreshCompetition();
  assert.equal(f.p(0).regalia["kills-1"].count, 2);
});
test("Включение на старых профилях не выдаёт наград за историю, активный день участвует", () => {
  const f = fixture(1);
  f.score(0, { kills: 4 });
  delete f.store.data.dailyPrizes;
  f.store.refreshCompetition();
  assert.equal(f.p(0).regalia, undefined);
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  assert.equal(f.p(0).regalia["kills-1"].count, 1);
});
test("Повреждение регалий, отметки дня и переполнение баланса не перезаписывают состояние", () => {
  assert.throws(
    () => daily.validate({ regalia: { "kills-1": { count: -1, firstDay: 1, lastDay: 1 } } }),
    /регалии/,
  );
  assert.throws(
    () => daily.validate({ regalia: { other: { count: 1, firstDay: 1, lastDay: 1 } } }),
    /регалии/,
  );
  assert.throws(() => daily.validateWorld({ dailyPrizes: { day: "bad" } }), /расчёт/);
  const f = fixture(1);
  f.score(0, { kills: 1 });
  f.p(0).wallet.coins = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(f.store.data);
  f.clock(MIDNIGHT);
  assert.throws(() => f.store.refreshCompetition(), /допустимое/);
  assert.deepEqual(f.store.data, before);
});

test("Прочтение дневных призов не трогает награды, не затрагивает другого игрока и повторяется безопасно", () => {
  const f = fixture(2);
  f.score(0, { kills: 5, arenaSeconds: 60 });
  f.score(1, { kills: 3 });
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  const before = structuredClone(f.p(0)),
    other = structuredClone(f.p(1));
  const input = { requestId: randomUUID(), ids: notices.view(f.p(0)).map((n) => n.id) };
  const result = f.store.dismissDailyRankingRewards(f.users[0].token, input);
  assert.deepEqual(result.profile.dailyRankingRewards, []);
  assert.deepEqual(f.p(0).wallet, before.wallet);
  assert.equal(f.p(0).greatness, before.greatness);
  assert.deepEqual(f.p(0).regalia, before.regalia);
  assert.deepEqual(f.p(1), other);
  const committed = structuredClone(f.store.data);
  assert.equal(f.store.dismissDailyRankingRewards(f.users[0].token, input).replay, true);
  assert.deepEqual(f.store.data, committed);
  f.score(0, { kills: 6 });
  f.clock(MIDNIGHT + 86400000);
  f.store.refreshCompetition();
  assert.equal(notices.view(f.p(0)).length, 1);
  assert.equal(notices.view(f.p(0))[0].day, daily.dayAt(MIDNIGHT));
  f.store.dismissDailyRankingRewards(f.users[0].token, { ...input, requestId: randomUUID() });
  assert.equal(notices.view(f.p(0)).length, 1, "старое прочтение не скрывает новый приз");
});

test("Старые регалии дают уведомление только о последнем итоге без повторного начисления", () => {
  const f = fixture(1);
  f.score(0, { kills: 5, arenaSeconds: 60 });
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  delete f.p(0).dailyRankingRewards;
  f.p(0).regalia["greatness-3"] = { count: 2, firstDay: 20000, lastDay: 20001 };
  const before = structuredClone(f.p(0));
  const pending = notices.view(f.p(0));
  assert.equal(pending.length, 2);
  assert.deepEqual(f.p(0), before, "просмотр не меняет сохранение");
  f.store.dismissDailyRankingRewards(f.users[0].token, {
    requestId: randomUUID(),
    ids: pending.map((n) => n.id),
  });
  assert.deepEqual(notices.view(f.p(0)), []);
  assert.deepEqual(f.p(0).wallet, before.wallet);
  assert.deepEqual(f.p(0).regalia, before.regalia);
  assert.equal(f.p(0).greatness, before.greatness);
  assert.throws(() => notices.dismiss(f.p(0), ["unknown"]), /уведомление/);
  assert.throws(() => notices.validate({ dailyRankingRewards: [{}] }), /уведомления/);
  assert.throws(
    () => notices.validate({ dailyRankingRewards: [pending[0], pending[0]] }),
    /уведомления/,
  );
});

test("Ивентовый день: 3/2/1 билета за каждый топ, без множителей аккаунта и повторной выдачи", () => {
  const f = fixture();
  for (let i = 0; i < 3; i++)
    f.score(i, { kills: 30 - i, arenaSeconds: 300 - i, greatness: 30 - i });
  const events = new EventManager({ now: () => MIDNIGHT - 60000 });
  events.apply("owner", "start", {
    requestId: randomUUID(),
    revision: events.data.revision,
    eventId: "lucky-week",
  });
  f.store.events = events;
  f.p(0).account = {
    ...require("../../src/server/accounts/account-benefits").fresh(),
    vipUntil: MIDNIGHT + 86400000,
    premiumUntil: MIDNIGHT + 86400000,
  };
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  for (let i = 0; i < 3; i++) {
    assert.equal(f.p(i).roulette.tickets, [9, 6, 3][i]);
    assert.equal(f.p(i).roulette.earned, [9, 6, 3][i]);
    assert.ok(f.store.view(f.p(i)).dailyRankingRewards.every((n) => n.prize.tickets === 3 - i));
    require("../../src/server/roulette/roulette-service").validate(f.p(i));
  }
  assert.equal(f.p(3).roulette.tickets, 0);
  const before = structuredClone(f.store.data);
  f.store.refreshCompetition();
  assert.deepEqual(f.store.data, before);
});

test("Билеты определяются днём результата по МСК, включая конец ивента и поздний расчёт", () => {
  for (const [name, startsAt, endsAt, stoppedAt, expected] of [
    ["окончание в полночь", MIDNIGHT - 86400000, MIDNIGHT, undefined, 3],
    ["ивент начался только в новый день", MIDNIGHT, MIDNIGHT + 60000, undefined, 0],
    ["ивент закончился до расчётного дня", MIDNIGHT - 172800000, MIDNIGHT - 86400000, undefined, 0],
    [
      "досрочное окончание внутри дня",
      MIDNIGHT - 86400000,
      MIDNIGHT + 86400000,
      MIDNIGHT - 60000,
      3,
    ],
    [
      "досрочное окончание до дня",
      MIDNIGHT - 172800000,
      MIDNIGHT + 86400000,
      MIDNIGHT - 86400000,
      0,
    ],
  ]) {
    const f = fixture(1);
    f.score(0, { kills: 1 });
    const events = new EventManager({ now: () => MIDNIGHT });
    events.data.runs.push({
      id: randomUUID(),
      manifest: require("../../src/server/events/lucky-week").manifest,
      startsAt,
      endsAt,
      ...(stoppedAt === undefined ? {} : { stoppedAt }),
    });
    f.store.events = events;
    f.clock(MIDNIGHT + 3 * 86400000);
    f.store.refreshCompetition();
    assert.equal(f.p(0).roulette.tickets, expected, name);
    assert.equal(f.store.view(f.p(0)).dailyRankingRewards[0].prize.tickets || 0, expected, name);
  }
});

test("Тестовый доступ к рулетке без ивента не даёт билеты; переполнение откатывает все призы", () => {
  const f = fixture(1);
  f.store.rouletteConfig = { testEnabled: true, events: [] };
  f.score(0, { kills: 1 });
  f.clock(MIDNIGHT);
  f.store.refreshCompetition();
  assert.equal(f.p(0).roulette.tickets, 0);
  const g = fixture(1);
  g.score(0, { kills: 1 });
  const events = new EventManager({ now: () => MIDNIGHT - 60000 });
  events.apply("owner", "start", {
    requestId: randomUUID(),
    revision: events.data.revision,
    eventId: "lucky-week",
  });
  g.store.events = events;
  g.p(0).roulette.tickets = g.p(0).roulette.earned = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(g.store.data);
  g.clock(MIDNIGHT);
  assert.throws(() => g.store.refreshCompetition(), /допустимое/);
  assert.deepEqual(g.store.data, before);
});

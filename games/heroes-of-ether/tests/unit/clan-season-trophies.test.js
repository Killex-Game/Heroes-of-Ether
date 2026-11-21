"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { setup: createFixture } = require("../fixtures/season-trophies"),
  rules = require("../../public/shared/clan-competition-rules"),
  trophies = require("../../src/server/clans/clan-season-trophies"),
  { BOOSTERS } = require("../../src/server/boosters/booster-catalog");
function played(f) {
  for (const clan of Object.values(f.profiles.data.clans))
    require('../../src/server/clans/battle-history').append(clan,
      {id:'opponent-'+clan.id,name:'Соперник',prefix:'TEST'},1,0,f.now());
}
function setup(options) { const f=createFixture(options);played(f);return f; }
test('Кубки не выдаются клану без битвы; бой прошлого сезона не даёт новый кубок',()=>{
  const f=createFixture(),head=f.heads[0],before={...f.p(head).wallet};
  f.time('2026-12-31T21:00:00Z');f.profiles.refreshCompetition();
  assert.deepEqual(f.c(head).competition.trophies,[]);assert.equal(f.p(head).wallet.bucks,before.bucks);
  assert.equal(f.p(head).activity.values.cup_keeper,0);
  const g=setup(),h=g.heads[0];g.time('2026-12-31T21:00:00Z');g.profiles.refreshCompetition();
  assert.equal(g.c(h).competition.trophies.length,1);
  const wallet={...g.p(h).wallet};g.time('2027-06-30T21:00:00Z');g.profiles.refreshCompetition();
  assert.equal(g.c(h).competition.trophies.length,1);assert.equal(g.p(h).wallet.bucks,wallet.bucks);
  assert.equal(g.p(h).activity.values.cup_keeper,1);
});
test("Кубки: все шесть наград, каждый участник, сохранённый максимум после понижения, повтор не платит", () => {
  const f = setup({ count: 6 });
  const wallets = [];
  for (const [rank, head] of f.heads.entries()) {
    const idle = f.user();
    f.act(idle, "apply", { clanId: f.c(head).id });
    f.c(head).competition.league = rank;
    f.profiles.save(f.profiles.data);
    f.c(head).competition.league = 0;
    f.profiles.save(f.profiles.data);
    for (const u of [head, idle]) {
      const p = f.p(u);
      p.account = require("../../src/server/accounts/account-benefits").fresh();
      p.account.vipUntil = p.account.premiumUntil = f.now() + 86400000;
      wallets.push({ u, rank, wallet: { ...p.wallet } });
    }
  }
  f.time("2026-12-31T21:00:00Z");
  f.profiles.refreshCompetition();
  for (const { u, rank, wallet } of wallets) {
    const p = f.p(u),
      c = f.c(u),
      reward = rules.SEASON_PRIZES[rank].reward;
    for (const currency of ["coins", "crystals", "bucks"])
      assert.equal(p.wallet[currency], wallet[currency] + reward[currency]);
    assert.equal(c.competition.league, 0);
    assert.deepEqual(c.competition.seasonPeak, { seasonId: "2027-1", league: 0 });
    assert.deepEqual(c.competition.trophies, [
      { seasonId: "2026-2", number: 2, league: rank, year: 2027, awardedAt: f.now() },
    ]);
    assert.deepEqual(p.seasonTrophies, c.competition.trophies);
    assert.deepEqual(f.profiles.publicPlayer(p.id).seasonTrophies, p.seasonTrophies);
    assert.equal(f.profiles.view(p).seasonBenefits.discount, rules.SEASON_PRIZES[rank].discount);
    assert.equal(
      p.clanChests.notices.filter((n) => n.text.startsWith("Кубок за 2 сезон")).length,
      1,
    );
  }
  const saved = structuredClone(f.profiles.data);
  f.profiles.refreshCompetition();
  assert.deepEqual(f.profiles.data, saved);
  f.time("2027-01-01T20:00:00Z");
  f.profiles.refreshCompetition();
  for (const { u, rank, wallet } of wallets)
    assert.equal(f.p(u).wallet.bucks, wallet.bucks + rules.SEASON_PRIZES[rank].reward.bucks);
});
test("Кубки: повышение на последней неделе засчитывается до сезонного сброса", () => {
  const f = setup({ count: 10, start: "2026-12-27T20:59:00Z" }),
    head = f.heads[0];
  for (const c of Object.values(f.profiles.data.clans)) c.competition.league = 1;
  f.time("2026-12-27T21:00:00Z");
  f.profiles.refreshCompetition();
  const w = f.profiles.data.competition.week,
    c = f.c(head);
  w.scores[c.id] = { kills: 10000, members: {} };
  f.time("2026-12-31T21:00:00Z");
  f.profiles.refreshCompetition();
  assert.equal(f.c(head).competition.trophies[0].league, 2);
  assert.equal(f.c(head).competition.seasonPeak.league, 0);
  assert.equal(f.c(head).competition.league, 0);
});
test("Кубки: миграция учитывает датированное повышение, но не все старые медали", () => {
  const f = setup(),
    c = f.c(f.heads[0]),
    season = f.profiles.data.competition.season;
  delete c.competition.seasonPeak;
  delete c.competition.trophies;
  c.competition.league = 1;
  c.competition.medals.champions = 10;
  c.appearance.grants = { gold: season.start + 30 * 86400000, platinum: season.start - 1 };
  trophies.track(c, season, { league: 3, result: "demote", endedAt: season.start + 86400000 });
  assert.equal(c.competition.seasonPeak.league, 3);
  assert.deepEqual(c.competition.trophies, []);
  assert.doesNotThrow(() => trophies.validate(c));
  c.competition.trophies = [
    { seasonId: "bad", number: 1, league: 6, year: 2027, awardedAt: season.end },
  ];
  assert.throws(() => trophies.validate(c), /Повреждена история/);
});
test("Кубки: перерыв в работе не создаёт наград за пустые сезоны, откат часов не выдаёт будущий кубок", () => {
  const f = setup(),
    head = f.heads[0],
    before = f.p(head).wallet.bucks;
  f.c(head).competition.league = 4;
  f.profiles.save(f.profiles.data);
  f.time("2028-08-10T08:00:00Z");
  f.profiles.refreshCompetition();
  assert.equal(f.c(head).competition.trophies.length, 1);
  assert.equal(f.p(head).wallet.bucks, before + 5000);
  f.time("2027-06-01T08:00:00Z");
  f.profiles.refreshCompetition();
  assert.equal(f.c(head).competition.trophies.length, 1);
  assert.equal(f.c(head).competition.seasonPeak.seasonId, "2028-2");
});
test("Скидка: лучший кубок, серверная цена, повтор покупки, выход и вступление без повторного приза", () => {
  const f = setup(),
    head = f.heads[0],
    member = f.user(),
    c = f.c(head);
  f.act(member, "apply", { clanId: c.id });
  f.c(head).competition.league = 5;
  f.c(head).treasury = 1000000;
  f.profiles.save(f.profiles.data);
  f.time("2026-12-31T21:00:00Z");
  f.profiles.refreshCompetition();
  const b = [...BOOSTERS.values()].find((b) => b.ready && b.tier === "clan"),
    amount = rules.discountedPrice(b.price.amount, 15);
  const quote = f.clans.state(head.token).shop.find((item) => item.id === b.id);
  assert.equal(quote.price.amount, amount);
  assert.equal(quote.discount, 15);
  const before = f.c(head).treasury,
    requestId = randomUUID();
  f.act(head, "buyBooster", { clanId: c.id, boosterId: b.id, requestId, discount: 100, amount: 0 });
  f.act(head, "buyBooster", { clanId: c.id, boosterId: b.id, requestId, discount: 100, amount: 0 });
  assert.equal(f.c(head).treasury, before - amount);
  assert.equal(f.p(member).inventory[b.id], b.price.quantity);
  const wallet = { ...f.p(member).wallet };
  f.act(member, "leave", { clanId: c.id });
  const retained = structuredClone(f.p(member).seasonTrophies);
  assert.equal(retained.length, 1);
  assert.equal(f.profiles.view(f.p(member)).seasonBenefits.discount, 0);
  f.act(member, "apply", { clanId: c.id });
  assert.deepEqual(f.p(member).seasonTrophies, retained);
  assert.equal(f.profiles.view(f.p(member)).seasonBenefits.discount, 15);
  assert.equal(f.p(member).wallet.bucks, wallet.bucks);
  f.time('2027-01-02T12:00:00Z');
  played(f);
  f.time("2027-06-30T21:00:00Z");
  f.profiles.refreshCompetition();
  assert.equal(f.c(head).competition.trophies.length, 2);
  assert.equal(f.p(member).seasonTrophies.length, 2);
  assert.equal(f.profiles.view(f.p(member)).seasonBenefits.discount, 15);
  for (const price of [0, 1, 99, 100, 101, 999, Number.MAX_SAFE_INTEGER]) {
    const expected = Number(BigInt(price) - (BigInt(price) * 15n) / 100n);
    assert.equal(rules.discountedPrice(price, 15), expected);
  }
});
test("Кубки: переполнение одного кошелька отменяет всё начисление", () => {
  const f = setup(),
    head = f.heads[0],
    member = f.user();
  f.act(member, "apply", { clanId: f.c(head).id });
  f.p(member).wallet.bucks = Number.MAX_SAFE_INTEGER;
  const before = structuredClone(f.profiles.data);
  f.time("2026-12-31T21:00:00Z");
  assert.throws(() => f.profiles.refreshCompetition(), /баланс/);
  assert.deepEqual(f.profiles.data, before);
});

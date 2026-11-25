/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService, roleOf } = require("../../src/server/clans/clan-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression");
const comp = require("../../src/server/clans/clan-competition-service"),
  chests = require("../../src/server/clans/clan-chest-rewards"),
  accounts = require("../../src/server/accounts/account-benefits"),
  rules = require("../../public/shared/clan-competition-rules");
const { temporary } = require("../temp");
function setup(count = 16, filePath = null) {
  let at = Date.parse("2026-10-19T04:59:00Z");
  const store = new ProfileStore({ filePath, now: () => at }),
    clans = new ClanService(store);
  const user = () => {
    const u = store.open(),
      p = store.find(u.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 10000;
    return u;
  };
  const act = (u, action, extra = {}) =>
    clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  const heads = [];
  for (let i = 0; i < count; i++) {
    const u = user();
    act(u, "create", { name: "Клан " + i, prefix: "C" + i, emblem: "astral", privacy: "open" });
    heads.push(u);
  }
  let filled = false;
  const set = (time) => {
    if (!filled) {
      filled = true;
      for (const c of Object.values(store.data.clans)) {
        while (store.data.clans[c.id].members.length < rules.BATTLE_MIN_MEMBERS)
          act(user(), "apply", { clanId: c.id });
      }
    }
    at = typeof time === "string" ? Date.parse(time) : time;
    store.refreshCompetition(at);
  };
  const kill = (u) => {
    const p = store.find(u.token);
    if (!p.progress.session) store.startLife(p.id, randomUUID());
    store.applyArenaProgress(
      randomUUID(),
      [{ type: "absorbed", profileId: p.id, victimProfileId: randomUUID(), gain: 1 }],
      at,
    );
  };
  return {
    store,
    clans,
    heads,
    user,
    act,
    set,
    kill,
    now: () => at,
    p: (u) => store.find(u.token),
    c: (u) => store.data.clans[store.find(u.token).clanId],
  };
}

test('owner early battle finish settles actual fights and season cups once before opening quests',()=>{
  const f=setup(10);f.set('2026-10-19T06:00:00Z');
  let data=require('../../src/server/clans/daily-quests/service').initialize(f.store.data,f.now());
  data={...data,clanQuests:{...data.clanQuests,arenaSettlementVersion:0}};f.store.save(data,f.now());
  f.kill(f.heads[0]);f.set(f.now()+1000);
  const admin=require('../../src/server/clans/daily-quests/admin'),before=admin.view(f.store);
  const input={action:'switch',mode:'quests',seasonId:before.current.id,revision:before.revision,requestId:randomUUID(),reason:'Проверка завершения битв'};
  const saved=admin.apply(f.store,{isOwner:()=>true},{id:'owner'},input);
  assert.equal(saved.current.mode,'quests');assert.equal(f.store.data.competition.season.settled,true);
  assert.equal(f.store.data.competition.day,null);
  for(const u of f.heads){const trophies=f.c(u).competition.trophies.filter(t=>t.seasonId===before.current.id);assert.equal(trophies.length,1);assert.equal(trophies[0].awardedAt,f.now());}
  const wallets=f.heads.map(u=>structuredClone(f.p(u).wallet));
  assert(admin.apply(f.store,{isOwner:()=>true},{id:'owner'},input).replay);
  f.set(f.now()+1000);assert.deepEqual(f.heads.map(u=>f.p(u).wallet),wallets);
  assert(f.c(f.heads[0]).dailyQuests.board.quests.length>0);
});
test("Booster transactions preserve unchanged clan state; scored kills and day settlement still run", () => {
  const f = setup(10),
    u = f.heads[0];
  f.set("2026-10-19T05:00:00Z");
  f.store.transact(u.token, randomUUID(), "fixture", (p) => {
    p.inventory.meat = 2;
  });
  const before = f.store.data,
    clans = Object.values(before.clans);
  const request = randomUUID();
  f.store.consume(u.token, "meat", request, "consume-test", () => ({ mass: 100 }));
  assert.equal(f.store.data.competition, before.competition);
  assert.ok(Object.values(f.store.data.clans).every((c, i) => c === clans[i]));
  assert.equal(f.p(u).inventory.meat, 1);
  f.store.consume(u.token, "meat", request, "consume-test", () => {
    throw Error("duplicate");
  });
  assert.equal(f.p(u).inventory.meat, 1);
  f.kill(u);
  assert.notEqual(f.store.data.competition, before.competition);
  assert.equal(f.store.data.competition.day.scores[f.c(u).id].kills, 1);
  assert.equal(before.competition.day.scores[f.c(u).id]?.kills || 0, 0);
  f.set("2026-10-19T21:00:00Z");
  assert.equal(f.c(u).competition.wins, 1);
  assert.equal(f.p(u).clanChests.items.length, 1);
});

test("scored clan kills leave published profiles untouched including achievement and title awards", () => {
  const f = setup(10), u = f.heads[0];
  f.set("2026-10-19T05:00:00Z");
  const activity = require("../../src/server/progression/activity-achievements");
  const key = Object.keys(f.store.data.profiles).find(k => f.store.data.profiles[k].id === u.profile.id);
  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  for (const gain of [1, 50, 1000, 1000000]) {
    const before = f.store.data, source = before.profiles[key];
    const p = { ...source, greatness: 1999990,
      progress: { ...source.progress, kills: source.progress.kills + gain } };
    const expected = structuredClone(p);
    activity.leagueEvent(expected, "kills", gain, f.now());
    const original = structuredClone(p);
    freeze(p);
    const next = { ...before, profiles: { ...before.profiles, [key]: p } };
    const result = comp.capture(next, before, f.now(), {
      incremental: true, validatedPrevious: true, profileKeys: [key],
    });
    assert.deepEqual(result.profiles[key], expected);
    assert.deepEqual(p, original);
    assert.equal(result.profiles[key].inventory, p.inventory);
    assert.equal(result.profiles[key].clanChests, p.clanChests);
    assert.equal(result.competition.day.scores[p.clanId].kills,
      (before.competition.day.scores[p.clanId]?.kills || 0) + gain);
    assert.equal(before.competition.day.scores[p.clanId]?.kills || 0, 0);
  }
});

test("battle results reach both clan chats exactly once, atomically with rewards, and survive reload", t => {
  const path=require("node:path"),history=require("../../src/server/clans/battle-history"),{ChatService}=require("../../src/server/chat/chat-service");
  const file=path.join(temporary(t,"battle-chat"),"profiles.json"),f=setup(10,file);
  f.set("2026-10-19T05:00:00Z");
  const pair=f.store.data.competition.day.pairs[0],winner=f.heads.find(u=>f.c(u).id===pair.a),loser=f.heads.find(u=>f.c(u).id===pair.b);
  f.kill(winner);f.kill(winner);f.kill(loser);
  const old=f.store.data,save=f.store.save;
  f.store.save=()=>{throw Error("disk full");};
  assert.throws(()=>f.set("2026-10-19T21:00:00Z"),/disk full/);assert.equal(f.store.data,old);assert.equal(f.c(winner).battleHistory,undefined);
  f.store.save=save;f.set("2026-10-19T21:00:00Z");
  const messages=history.messages(f.c(winner),f.store.data.competition.lastBattle[pair.a],f.now());
  assert.equal(messages.length,1);assert.match(messages[0].text,/победил.*2:1/);
  assert.deepEqual(history.messages(f.c(loser),f.store.data.competition.lastBattle[pair.b],f.now()),messages);
  const draw=f.store.data.competition.day;
  assert.equal(draw,null);
  const another=Object.values(f.store.data.clans).find(c=>![pair.a,pair.b].includes(c.id));
  assert.match(history.messages(another,null,f.now())[0].text,/вничью: 0:0/);
  f.store.refreshCompetition();assert.equal(f.c(winner).battleHistory.length,1);
  const restored=new ProfileStore({filePath:file,now:f.now});
  assert.deepEqual(history.messages(restored.data.clans[pair.a],null,f.now()),messages);
  const chat=new ChatService({now:f.now}),p=f.p(winner);
  const normal=chat.send(p,f.c(winner),pair.a,{text:"Хорошая игра!",requestId:randomUUID()}).message;
  const late=chat.history(pair.a,normal.id,"arena-1",messages);
  assert.equal(late.reset,false);assert.equal(late.systemMessages[0].id,messages[0].id);
  assert.equal(chat.achievementCounts[p.id],1,"system messages never credit player chat achievements");
  assert.equal(chat.history(pair.a,messages[0].id,"arena-1",messages).reset,false,"system cursor is recognized");
  const copy=history.cloneClans(restored.data.clans);assert.equal(copy[pair.a].battleHistory,restored.data.clans[pair.a].battleHistory);
  assert.deepEqual(history.messages(copy[pair.a],null,f.now()+49*3600000),[]);assert.equal(copy[pair.a].battleHistory.length,1,"chat expiry does not delete the ledger");
  history.validate(copy[pair.a]);const invalid=structuredClone(copy[pair.a]);invalid.battleHistory[0].sides[0].score=-1;assert.throws(()=>history.validate(invalid),/Повреждена/);
});

test("Лиги: группы всегда чётные 10–16, максимум включённых кланов и особые зоны", () => {
  for (let n = 0; n < 100; n++) {
    const sizes = comp.groupSizes(n);
    assert.ok(sizes.every((x) => x >= 10 && x <= 16 && x % 2 === 0));
    assert.ok(sizes.reduce((a, b) => a + b, 0) <= n);
  }
  assert.deepEqual(comp.groupSizes(9), []);
  assert.deepEqual(comp.groupSizes(16), [16]);
  assert.deepEqual(comp.groupSizes(20), [10, 10]);
  assert.equal(
    comp.groupSizes(31).reduce((a, b) => a + b, 0),
    30,
  );
  assert.deepEqual(rules.zones(0, 16), { promote: 3, stay: 8, demote: 5 });
  assert.deepEqual(rules.zones(0, 10), { promote: 3, stay: 4, demote: 3 });
  assert.deepEqual(rules.zones(3, 16), { promote: 2, stay: 7, demote: 7 });
  assert.deepEqual(rules.zones(5, 16), { promote: 1, stay: 3, demote: 12 });
});
test("Календарь: 08:00/00:00 МСК, понедельник, полугодовой сезон", () => {
  const f = setup(10),
    u = f.heads[0];
  f.kill(u);
  assert.equal(f.store.data.competition.day, null);
  f.set("2026-10-19T05:00:00Z");
  const s = f.store.data.competition;
  assert.equal(s.day.pairs.length, 5);
  assert.equal(new Set(s.day.pairs.flatMap((p) => [p.a, p.b])).size, 10);
  assert.equal(s.week.end, Date.parse("2026-10-25T21:00:00Z"));
  f.kill(u);
  assert.equal(f.store.data.competition.day.scores[f.c(u).id].kills, 1);
  f.set("2026-10-19T21:00:00Z");
  assert.equal(f.c(u).competition.wins, 1);
  assert.equal(f.p(u).clanChests.items.length, 1);
  const before = JSON.stringify(f.store.data);
  f.store.refreshCompetition();
  assert.equal(JSON.stringify(f.store.data), before);
  f.kill(u);
  assert.equal(f.store.data.competition.day, null);
});
test("Мало кланов: ни битв, ни группы, даже если игрок набивает киллы", () => {
  const f = setup(9);
  f.set("2026-10-19T05:00:00Z");
  f.kill(f.heads[0]);
  const state = f.clans.state(f.heads[0].token).competition;
  assert.equal(state.group, null);
  assert.equal(state.battle, null);
});
test("Поражение: каждый текущий участник теряет 5 величия, независимо от активности и аккаунта", () => {
  const f = setup(10),
    loser = f.heads[0],
    clanId = f.c(loser).id;
  const idle = f.user(),
    poor = f.user(),
    empty = f.user(),
    left = f.user();
  for (const u of [idle, poor, empty, left]) f.act(u, "apply", { clanId });
  f.act(left, "leave", { clanId });
  f.set("2026-10-19T05:00:00Z");
  const pair = f.store.data.competition.day.pairs.find((p) => p.a === clanId || p.b === clanId);
  const winner = f.heads.find((u) => f.c(u).id === (pair.a === clanId ? pair.b : pair.a));
  const recruit = f.user();
  f.act(recruit, "apply", { clanId });
  for (const u of [loser, idle, left, recruit, winner]) f.p(u).greatness = 20;
  f.p(poor).greatness = 3;
  f.p(empty).greatness = 0;
  f.p(loser).account = {
    ...accounts.fresh(),
    vipUntil: f.now() + 7 * rules.DAY,
    premiumUntil: f.now() + 7 * rules.DAY,
  };
  f.kill(loser);
  f.kill(winner);
  f.kill(winner);
  f.kill(winner); // Premium doubles the loser's one absorption: the opponent needs three kills.
  const honors = structuredClone(f.p(idle).honors),
    progress = structuredClone(f.p(idle).progress);
  const revision = f.p(idle).revision,
    wallet = structuredClone(f.p(loser).wallet);
  f.set("2026-10-19T21:00:00Z");
  assert.equal(f.p(loser).greatness, 37); // -5 за поражение, +2 за второе место, +20 за «Топ» с Premium; фиксированная награда без величия.
  assert.equal(f.p(loser).regalia["kills-2"].count, 1);
  for (const u of [idle, recruit]) assert.equal(f.p(u).greatness, 15);
  for (const u of [poor, empty]) assert.equal(f.p(u).greatness, 0);
  assert.equal(f.p(winner).greatness, 33); // +3 за первое место и +10 за первую степень «Топ».
  assert.equal(f.p(left).greatness, 20);
  assert.equal(f.p(idle).revision, revision + 1);
  assert.deepEqual(f.p(idle).honors, honors);
  assert.deepEqual(f.p(idle).progress, progress);
  assert.deepEqual(f.p(loser).wallet, {
    coins: wallet.coins + 100 + 70,
    crystals: wallet.crystals + 10 + 7,
    bucks: wallet.bucks,
  });
  assert.equal(f.store.data.competition.lastBattle[clanId].won, false);
  const settled = JSON.stringify(f.store.data);
  f.store.refreshCompetition();
  assert.equal(JSON.stringify(f.store.data), settled);
});
test("Ничья без штрафа; новое поражение следующего дня списывает величие отдельно", () => {
  const f = setup(10),
    head = f.heads[0],
    clanId = f.c(head).id;
  f.p(head).greatness = 20;
  f.set("2026-10-19T05:00:00Z");
  f.set("2026-10-19T21:00:00Z");
  assert.equal(f.p(head).greatness, 20);
  assert.equal(f.store.data.competition.lastBattle[clanId].draw, true);
  for (const day of [20, 21]) {
    f.set(`2026-10-${day}T05:00:00Z`);
    const pair = f.store.data.competition.day.pairs.find((p) => p.a === clanId || p.b === clanId);
    const opponent = f.heads.find((u) => f.c(u).id === (pair.a === clanId ? pair.b : pair.a));
    f.kill(opponent);
    f.set(`2026-10-${day}T21:00:00Z`);
    assert.equal(f.p(head).greatness, 20 - (day - 19) * 5);
    f.store.refreshCompetition();
    assert.equal(f.p(head).greatness, 20 - (day - 19) * 5);
  }
});
test("Зачёт: лимит XP исключает визуальные киллы, бонусные киллы учитываются", () => {
  const f = setup(10),
    u = f.heads[0];
  f.set("2026-10-19T05:00:00Z");
  f.kill(u);
  let p = f.p(u),
    id = p.progress.session.id;
  f.store.applyArenaProgress(
    randomUUID(),
    [{ type: "massBonus", profileId: p.id, lifeId: id, sequence: 1, kills: 20 }],
    f.now(),
  );
  assert.equal(f.store.data.competition.day.scores[f.c(u).id].kills, 21);
  p = f.p(u);
  p.progress.session.xp = p.progress.arenaXpTarget - p.progress.xp;
  f.kill(u);
  assert.equal(f.store.data.competition.day.scores[f.c(u).id].kills, 21);
  assert.equal(f.p(u).progress.session.kills, 22);
});
test("Новобранец не может дать киллы или получить роль, завтра участвует", () => {
  const f = setup(10),
    u = f.user(),
    head = f.heads[0],
    id = f.c(head).id;
  f.set("2026-10-19T05:00:00Z");
  f.act(u, "apply", { clanId: id });
  assert.equal(roleOf(f.c(u), f.p(u).id, f.now()), "recruit");
  assert.throws(
    () => f.act(head, "role", { clanId: id, memberId: f.p(u).id, role: "officer" }),
    /Новобранец/,
  );
  f.kill(u);
  assert.equal(f.store.data.competition.day.scores[id], undefined);
  f.set("2026-10-19T21:00:00Z");
  assert.equal(roleOf(f.c(u), f.p(u).id, f.now()), "member");
  f.set("2026-10-20T05:00:00Z");
  f.kill(u);
  assert.equal(f.store.data.competition.day.scores[id].kills, 1);
});
test("Доли 30/30/30/10: наибольшие остатки, точные десятки и стабильный порядок при равенстве", () => {
  const counts = (rows) =>
    Object.fromEntries(
      ["high", "medium", "low", "fixed"].map((t) => [t, rows.filter((p) => p.tier === t).length]),
    );
  for (let n = 0; n <= 100; n++) {
    const entries = Array.from({ length: n }, (_, i) => ({
      id: String(i).padStart(2, "0"),
      kills: 100,
      joinedAt: i,
    }));
    const plan = rules.rewardPlan(entries),
      allocation = rules.rewardCounts(n);
    assert.deepEqual(counts(plan), allocation);
    assert.equal(
      Object.values(allocation).reduce((a, b) => a + b, 0),
      n,
    );
    assert.deepEqual(rules.rewardPlan(entries.slice().reverse()), plan);
    assert.equal(plan.length, n);
    if (n) assert.equal(plan[0].tier, "high");
    for (const [tier, weight] of [
      ["high", 3],
      ["medium", 3],
      ["low", 3],
      ["fixed", 1],
    ]) {
      const quota = (n * weight) / 10;
      assert.ok(allocation[tier] === Math.floor(quota) || allocation[tier] === Math.ceil(quota));
      if (n % 10 === 0) assert.equal(allocation[tier], quota);
    }
  }
  assert.deepEqual(rules.rewardCounts(12), { high: 4, medium: 4, low: 3, fixed: 1 });
  assert.deepEqual(rules.rewardCounts(10), { high: 3, medium: 3, low: 3, fixed: 1 });
  assert.deepEqual(rules.rewardCounts(15), { high: 5, medium: 5, low: 4, fixed: 1 });
  assert.deepEqual(rules.rewardCounts(6), { high: 2, medium: 2, low: 2, fixed: 0 });
  assert.deepEqual(rules.rewardCounts(7), { high: 2, medium: 2, low: 2, fixed: 1 });
  for (const invalid of [-1, 1.5, NaN, Infinity]) assert.throws(() => rules.rewardCounts(invalid));
  assert.deepEqual(rules.rewardPlan([{ id: "idle", kills: 0 }]), []);
  const tie = rules.rewardPlan([
    { id: "b", kills: 1, joinedAt: 2 },
    { id: "a", kills: 1, joinedAt: 2 },
    { id: "z", kills: 1, joinedAt: 1 },
  ]);
  assert.deepEqual(
    tie.map((p) => p.id),
    ["z", "a", "b"],
  );
  const ranked = rules.rewardPlan([
    ...Array.from({ length: 12 }, (_, i) => ({ id: String(i), kills: i + 1, joinedAt: 12 - i })),
    { id: "idle", kills: 0, joinedAt: 0 },
  ]);
  assert.deepEqual(
    ranked.map((p) => p.kills),
    [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  );
  assert.deepEqual(
    ranked.map((p) => p.tier),
    [
      "high",
      "high",
      "high",
      "high",
      "medium",
      "medium",
      "medium",
      "medium",
      "low",
      "low",
      "low",
      "fixed",
    ],
  );
});

test("12 участников: 4/4/3/1 совпадает с выдачей, неактивные и новобранцы исключены, повтор безопасен", (t) => {
  const filePath = require("node:path").join(temporary(t, "battle-shares"), "profiles.json");
  const f = setup(10, filePath),
    head = f.heads[0],
    clanId = f.c(head).id,
    members = [head];
  for (let i = 1; i < 12; i++) {
    const u = f.user();
    f.act(u, "apply", { clanId });
    members.push(u);
  }
  const idle = f.user();
  f.act(idle, "apply", { clanId });
  f.set("2026-10-19T05:00:00Z");
  for (const u of members) f.kill(u);
  const recruit = f.user();
  f.act(recruit, "apply", { clanId });
  f.kill(recruit);
  const preview = f.clans.state(head.token).competition.personal;
  for (const [tier, count] of [
    ["high", 4],
    ["medium", 4],
    ["low", 3],
    ["fixed", 1],
  ])
    assert.equal(Object.values(preview).filter((p) => p.reward === tier).length, count);
  for (const u of [idle, recruit]) {
    assert.equal(preview[f.p(u).id].reward, null);
    assert.equal(preview[f.p(u).id].place, null);
  }
  const before = structuredClone(f.store.data),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.set("2026-10-19T21:00:00Z"), /disk full/);
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  f.store.refreshCompetition();
  for (const u of members) {
    const p = f.p(u);
    assert.equal(p.clanChests.battleReward.tier, preview[p.id].reward);
    assert.equal(p.clanChests.items.length, preview[p.id].reward === "fixed" ? 0 : 1);
    if (preview[p.id].reward === "fixed") {
      const old = Object.values(before.profiles).find((profile) => profile.id === p.id);
      for (const [currency, amount] of [
        ["coins", 100],
        ["crystals", 10],
        ["bucks", 0],
      ])
        assert.equal(p.wallet[currency], old.wallet[currency] + amount);
      assert.equal(p.greatness, old.greatness + 1);
      assert.deepEqual(p.clanChests.battleReward.fixedReward, {
        coins: 100,
        crystals: 10,
        greatness: 1,
      });
    }
  }
  for (const u of [idle, recruit]) assert.equal(f.p(u).clanChests?.battleReward ?? null, null);
  assert.deepEqual(f.store.data.competition.lastBattle[clanId].rewardCounts, {
    high: 4,
    medium: 4,
    low: 3,
    fixed: 1,
  });
  const after = structuredClone(f.store.data);
  f.store.refreshCompetition();
  assert.deepEqual(f.store.data, after);
  const restored = new ProfileStore({ filePath, now: f.now });
  restored.refreshCompetition();
  for (const u of members)
    assert.deepEqual(restored.byId(u.profile.id).clanChests, f.p(u).clanChests);
});

test("Неделя: пороги, награды активным, без наград вышедшему, сохранённые чемпионы", () => {
  const f = setup(16);
  f.set("2026-10-19T05:00:00Z");
  let next = structuredClone(f.store.data),
    s = next.competition,
    g = s.week.groups[0];
  g.league = 5;
  const sorted = [...g.clans].sort();
  sorted.forEach((id, i) => {
    const c = next.clans[id],
      u = c.ownerId;
    c.competition.league = 5;
    s.week.scores[id] = {
      kills: 1000001 - i,
      members: { [u]: { kills: 1, joinedAt: c.competition.joined[u] } },
    };
  });
  const winner = sorted[0];
  f.store.save(next, f.now());
  f.set("2026-10-25T21:00:00Z");
  assert.equal(f.store.data.clans[winner].competition.frame, "champion");
  assert.equal(f.store.data.clans[sorted[4]].competition.league, 4);
  const first = f.store.byId(f.store.data.clans[winner].ownerId);
  assert.ok(first.wallet.coins >= 25000);
  assert.ok(first.wallet.bucks >= 1000);
  const loser = f.store.byId(f.store.data.clans[sorted[4]].ownerId);
  assert.equal(loser.wallet.bucks, 0);
  const before = first.wallet.bucks;
  f.store.refreshCompetition();
  assert.equal(f.store.byId(first.id).wallet.bucks, before);
  f.set("2027-01-01T00:00:00Z");
  assert.equal(f.store.data.clans[winner].competition.league, 0);
  assert.equal(f.store.data.clans[winner].competition.frame, "champion");
});
test("Призовые места всех лиг получают полный приз и медаль без порога, но не повышение или чемпионскую рамку", () => {
  for (let league = 0; league < 6; league++) {
    const f = setup(10);
    f.set("2026-10-19T05:00:00Z");
    const next = structuredClone(f.store.data),
      g = next.competition.week.groups[0];
    g.league = league;
    const ids = [...g.clans].sort(),
      z = rules.zones(league, 10),
      spec = rules.LEAGUES[league];
    ids.forEach((id, i) => {
      const c = next.clans[id];
      c.competition.league = league;
      next.competition.week.scores[id] = {
        kills: 100 - i,
        members: { [c.ownerId]: { kills: 1, joinedAt: c.competition.joined[c.ownerId] } },
      };
    });
    f.store.save(next, f.now());
    for (const id of ids) {
      const p = f.store.byId(next.clans[id].ownerId);
      p.greatness = 1000000;
      require("../../src/server/progression/title-chest-rewards").awardTitles(p, f.now());
    }
    const before = ids.map((id) => structuredClone(f.store.byId(next.clans[id].ownerId)));
    f.set("2026-10-25T21:00:00Z");
    ids.forEach((id, i) => {
      const c = f.store.data.clans[id],
        p = f.store.byId(c.ownerId),
        prize = i < z.promote,
        stays = i < 10 - z.demote;
      const reward = prize
        ? spec.reward
        : stays
          ? { coins: 100, crystals: 100, bucks: 1, greatness: 2 }
          : { coins: 0, crystals: 0, bucks: 0, greatness: 0 };
      for (const currency of ["coins", "crystals", "bucks"])
        assert.equal(p.wallet[currency] - before[i].wallet[currency], reward[currency]);
      assert.equal(p.greatness - before[i].greatness, reward.greatness);
      assert.equal(c.competition.medals[spec.id] || 0, prize ? 1 : 0);
      assert.equal(c.competition.league, stays ? league : Math.max(0, league - 1));
      assert.equal(c.competition.frame, null);
    });
    const settled = JSON.stringify(f.store.data);
    f.store.refreshCompetition();
    assert.equal(JSON.stringify(f.store.data), settled);
  }
});
test("Клану без киллов полагается медаль за призовое место, но личных наград нет", () => {
  const f = setup(10);
  f.set("2026-10-19T05:00:00Z");
  const ids = [...f.store.data.competition.week.groups[0].clans].sort(),
    u = f.heads.find((u) => f.c(u).id === ids[0]),
    before = structuredClone(f.p(u).wallet);
  f.set("2026-10-25T21:00:00Z");
  assert.deepEqual(f.p(u).wallet, before);
  assert.deepEqual(f.c(u).competition.medals, { bronze: 1 });
});
test("Недельная награда не положена вышедшему игроку, его киллы сохраняются клану", () => {
  const f = setup(10),
    u = f.user(),
    id = f.c(f.heads[0]).id;
  f.act(u, "apply", { clanId: id });
  f.set("2026-10-19T05:00:00Z");
  f.kill(u);
  f.act(u, "leave", { clanId: id });
  assert.equal(f.store.data.competition.week.scores[id].kills, 1);
  const before = f.p(u).wallet.coins;
  f.set("2026-10-25T21:00:00Z");
  assert.equal(f.p(u).wallet.coins, before + 100); // Личный суточный топ не зависит от клана.
  assert.equal(f.p(u).regalia["kills-1"].count, 1);
});
test("Сундуки: предел 7/10/12, ожидание места, 3 часа без аккаунта и сообщение о сгорании", () => {
  const f = setup(0),
    u = f.user(),
    p = f.p(u),
    at = f.now();
  for (let i = 0; i < 8; i++) {
    const c = chests.grant(p, "low", at);
    chests.act(p, "claim", c.id, at);
  }
  assert.equal(chests.view(p, at).stored, 7);
  assert.equal(p.clanChests.items[7].stored, false);
  chests.act(p, "claim", p.clanChests.items[7].id, at);
  assert.equal(p.clanChests.items[7].stored, false);
  p.account = { vipUntil: at + rules.DAY, premiumUntil: 0, dailyDay: "", dailyAmount: 0 };
  assert.equal(chests.capacity(p, at), 10);
  p.account.premiumUntil = at + rules.DAY;
  assert.equal(chests.capacity(p, at), 12);
  assert.equal(chests.capacity(p, at + rules.DAY), 7);
  p.account.vipUntil = p.account.premiumUntil = 0;
  assert.equal(p.clanChests.items.length, 8);
  assert.equal(chests.expire(p, at + 3 * 3600000 - 1), false);
  assert.equal(chests.expire(p, at + 3 * 3600000), true);
  assert.equal(p.clanChests.items.length, 7);
  assert.ok(p.clanChests.items.every((c) => c.stored && c.expiresAt === null));
  assert.match(p.clanChests.notices.at(-1).text, /[Сс]горел/);
  chests.validate(p);
});
test("Каждая степень сундука: точные доли, случайные диапазоны, фиксирование награды и однократная выдача", () => {
  const f = setup(0),
    u = f.user();
  for (const tier of ["high", "medium", "low"]) {
    const p = f.p(u);
    chests.grant(p, tier, f.now());
    const id = p.clanChests.items.at(-1).id;
    chests.act(p, "claim", id, f.now());
    const prepare = () =>
      f.store.clanChestAction(u.token, { action: "prepare", chestId: id, requestId: randomUUID() });
    prepare();
    const r = structuredClone(f.p(u).clanChests.items.find((x) => x.id === id).reward);
    prepare();
    assert.deepEqual(f.p(u).clanChests.items.find((x) => x.id === id).reward, r);
    assert.equal(
      Object.values(r.items).reduce((a, b) => a + b, 0),
      rules.CHESTS[tier].boosters,
    );
    const before = f.p(u).wallet.coins,
      req = { action: "open", chestId: id, requestId: randomUUID() };
    f.store.clanChestAction(u.token, req);
    f.store.clanChestAction(u.token, req);
    assert.equal(f.p(u).wallet.coins, before + r.coins);
    assert.ok(!f.p(u).clanChests.items.some((x) => x.id === id));
  }
});
test("Чемпионская рамка: переключает только глава, без потери права на неё", () => {
  const f = setup(1),
    head = f.heads[0],
    id = f.c(head).id,
    u = f.user();
  f.c(head).competition.frames = ["champion"];
  f.act(head, "frame", { clanId: id, frame: "champion" });
  assert.equal(f.c(head).competition.frame, "champion");
  f.act(u, "apply", { clanId: id });
  assert.throws(() => f.act(u, "frame", { clanId: id, frame: null }), /главе/);
  f.act(head, "frame", { clanId: id, frame: null });
  assert.deepEqual(f.c(head).competition.frames, ["champion"]);
});

test("Итоги и подготовленный сундук переживают перезапуск без повторной выдачи", (t) => {
  const path = require("node:path"),
    filePath = path.join(temporary(t, "competition-restart"), "profiles.json"),
    f = setup(10, filePath),
    u = f.heads[0];
  f.set("2026-10-19T05:00:00Z");
  f.kill(u);
  f.set("2026-10-19T21:00:00Z");
  const id = f.p(u).clanChests.items[0].id;
  const waiting = new ProfileStore({ filePath, now: f.now });
  assert.equal(chests.view(waiting.find(u.token), f.now()).stored, 0);
  assert.equal(waiting.find(u.token).clanChests.items[0].stored, false);
  assert.equal(waiting.find(u.token).clanChests.items[0].receivedAt, null);
  assert.ok(waiting.find(u.token).clanChests.items[0].expiresAt > f.now());
  const claim = { action: "claim", chestId: id, requestId: randomUUID() },
    beforeClaim = { ...f.p(u).wallet };
  f.store.clanChestAction(u.token, claim);
  f.store.clanChestAction(u.token, claim);
  f.store.clanChestAction(u.token, { ...claim, requestId: randomUUID() });
  assert.equal(chests.view(f.p(u), f.now()).stored, 1);
  assert.deepEqual(f.p(u).wallet, beforeClaim);
  f.store.clanChestAction(u.token, { action: "prepare", chestId: id, requestId: randomUUID() });
  const reward = structuredClone(f.p(u).clanChests.items[0].reward),
    reloaded = new ProfileStore({ filePath, now: f.now });
  reloaded.refreshCompetition();
  assert.equal(reloaded.data.clans[f.c(u).id].competition.wins, 1);
  assert.equal(reloaded.find(u.token).clanChests.items.length, 1);
  assert.deepEqual(reloaded.find(u.token).clanChests.items[0].reward, reward);
  assert.deepEqual(chests.view(reloaded.find(u.token), f.now()).battleReward, {
    clanId: f.c(u).id,
    endedAt: f.now(),
    tier: "high",
    status: "stored",
    chestId: id,
    expiresAt: null,
  });
  const other = f.heads[1];
  assert.throws(
    () =>
      reloaded.clanChestAction(other.token, {
        action: "open",
        chestId: id,
        requestId: randomUUID(),
      }),
    /открыт|хранения/,
  );
  const request = { action: "open", chestId: id, requestId: randomUUID() },
    coins = reloaded.find(u.token).wallet.coins;
  reloaded.clanChestAction(u.token, request);
  const again = new ProfileStore({ filePath, now: f.now });
  again.clanChestAction(u.token, request);
  assert.equal(again.find(u.token).wallet.coins, coins + reward.coins);
  assert.equal(again.find(u.token).clanChests.items.length, 0);
  assert.equal(chests.view(again.find(u.token), f.now()).battleReward.status, "opened");
});

test("Ошибка записи итогов не теряет счёт и не выдаёт половину наград", () => {
  const f = setup(10),
    u = f.heads[0];
  f.set("2026-10-19T05:00:00Z");
  f.kill(u);
  const before = JSON.stringify(f.store.data),
    original = f.store.save.bind(f.store);
  // Exercise the actual atomic writer after settlement computes a complete candidate.
  f.store.filePath = __filename + "/invalid/profiles.json";
  assert.throws(() => f.set("2026-10-19T21:00:00Z"));
  assert.equal(JSON.stringify(f.store.data), before);
  f.store.filePath = null;
  f.store.save = original;
  f.store.refreshCompetition();
  assert.equal(f.c(u).competition.wins, 1);
  assert.equal(f.p(u).clanChests.items.length, 1);
});

test("Долгий простой: очередь сгорает от даты итогов, сохранённый сундук не имеет срока", () => {
  const f = setup(10),
    u = f.heads[0];
  f.set("2026-10-19T05:00:00Z");
  for (let i = 0; i < 7; i++) {
    const c = chests.grant(f.p(u), "low", f.now());
    chests.act(f.p(u), "claim", c.id, f.now());
  }
  f.kill(u);
  f.set("2026-10-23T05:00:00Z");
  assert.equal(f.p(u).clanChests.items.length, 7);
  assert.ok(f.p(u).clanChests.notices.some((n) => n.kind === "expired"));
  assert.equal(chests.view(f.p(u), f.now()).battleReward.status, "expired");
  const id = f.p(u).clanChests.items[0].id;
  f.store.clanChestAction(u.token, { action: "prepare", chestId: id, requestId: randomUUID() });
  const coins = f.p(u).wallet.coins;
  f.set(f.now() + 2 * rules.DAY);
  const reward = f.p(u).clanChests.items.find((c) => c.id === id).reward;
  f.store.clanChestAction(u.token, { action: "open", chestId: id, requestId: randomUUID() });
  assert.equal(f.p(u).wallet.coins, coins + reward.coins);
});

test("Ничья даёт фиксированную награду, порог обязателен и повреждённая группа отклоняется", () => {
  const f = setup(10);
  f.set("2026-10-19T05:00:00Z");
  const pair = f.store.data.competition.day.pairs[0],
    a = f.heads.find((u) => f.c(u).id === pair.a),
    b = f.heads.find((u) => f.c(u).id === pair.b);
  f.kill(a);
  f.kill(b);
  const coins = f.p(a).wallet.coins;
  f.set("2026-10-19T21:00:00Z");
  const dailyPlace = f.p(a).id.localeCompare(f.p(b).id) < 0 ? 1 : 2;
  assert.equal(f.p(a).wallet.coins, coins + 100 + (dailyPlace === 1 ? 100 : 70));
  assert.equal(f.p(a).regalia["kills-" + dailyPlace].count, 1);
  assert.equal(f.c(a).competition.wins, 0);
  assert.equal(f.p(a).clanChests.items.length, 0);
  assert.deepEqual(chests.view(f.p(a), f.now()).battleReward, {
    clanId: f.c(a).id,
    endedAt: f.now(),
    tier: "fixed",
    fixedReward: { coins: 100, crystals: 10, greatness: 0 },
    status: "credited",
    chestId: null,
    expiresAt: null,
  });
  assert.equal(comp.outcome(0, 16, 0, 999), "stay");
  assert.equal(comp.outcome(0, 16, 0, 1000), "promote");
  assert.equal(comp.outcome(0, 16, 3, 10000), "stay");
  comp.validate(f.store.data);
  const bad = structuredClone(f.store.data);
  bad.competition.week.groups[0].clans.pop();
  assert.throws(() => comp.validate(bad), /Повреждены/);
});

test("Медали клана: призовое место без порога, сохранение и отсутствие повторной выдачи", (t) => {
  const filePath = require("node:path").join(temporary(t, "clan-medals"), "profiles.json"),
    f = setup(16, filePath);
  f.set("2026-10-19T05:00:00Z");
  const next = structuredClone(f.store.data),
    group = next.competition.week.groups[0],
    ids = [...group.clans].sort();
  ids.forEach((id, i) => {
    next.competition.week.scores[id] = { kills: [2000, 1000, 999, 900][i] || 0, members: {} };
  });
  next.clans[ids[0]].competition.medals = { bronze: 1 };
  f.store.save(next, f.now());
  f.set("2026-10-25T21:00:00Z");
  assert.deepEqual(f.store.data.clans[ids[0]].competition.medals, { bronze: 2 });
  assert.deepEqual(f.store.data.clans[ids[1]].competition.medals, { bronze: 1 });
  assert.deepEqual(f.store.data.clans[ids[2]].competition.medals, { bronze: 1 });
  assert.equal(f.store.data.clans[ids[2]].competition.league, 0);
  for (const id of ids.slice(3)) assert.deepEqual(f.store.data.clans[id].competition.medals, {});
  const reloaded = new ProfileStore({ filePath, now: f.now });
  reloaded.refreshCompetition();
  assert.deepEqual(reloaded.data.clans[ids[0]].competition.medals, { bronze: 2 });
  assert.deepEqual(comp.publicState(reloaded.data, reloaded.data.clans[ids[0]], f.now()).medals, {
    bronze: 2,
  });
  comp.advance(reloaded.data, Date.parse("2027-01-01T05:00:00Z"));
  assert.deepEqual(reloaded.data.clans[ids[0]].competition.medals, { bronze: 2 });
});

test("Медали: чемпион получает медаль своей лиги, старые сохранения совместимы, неверные счётчики отклоняются", () => {
  const f = setup(10);
  f.set("2026-10-19T05:00:00Z");
  const next = structuredClone(f.store.data),
    group = next.competition.week.groups[0],
    winner = group.clans[0];
  group.league = 5;
  for (const id of group.clans) {
    next.clans[id].competition.league = 5;
    delete next.clans[id].competition.medals;
  }
  comp.validate(next);
  next.competition.week.scores[winner] = { kills: 1000000, members: {} };
  f.store.save(next, f.now());
  f.set("2026-10-25T21:00:00Z");
  assert.deepEqual(f.store.data.clans[winner].competition.medals, { champions: 1 });
  for (const medals of [
    { bronze: -1 },
    { silver: 1.5 },
    { gold: Number.MAX_SAFE_INTEGER + 1 },
    { unknown: 1 },
    [],
    null,
  ]) {
    const bad = structuredClone(f.store.data);
    bad.clans[winner].competition.medals = medals;
    assert.throws(() => comp.validate(bad), /Повреждены/);
  }
});

test("Снижение вместимости отправляет последние сундуки в очередь, перезапуск и повтор получения не меняют её", (t) => {
  const fs = require("node:fs"),
    path = require("node:path"),
    filePath = path.join(temporary(t, "chests-capacity"), "profiles.json"),
    f = setup(0, filePath),
    u = f.user(),
    p = f.p(u),
    at = f.now();
  p.account = { ...accounts.fresh(), vipUntil: at + rules.DAY, premiumUntil: at + rules.DAY };
  for (let i = 0; i < 13; i++) {
    const c = chests.grant(p, "low", at);
    chests.act(p, "claim", c.id, at);
  }
  assert.equal(chests.view(p, at).stored, 12);
  const ids = p.clanChests.items.map((x) => x.id);
  p.account.vipUntil = p.account.premiumUntil = 0;
  f.store.save(f.store.data, at);
  const disk = new ProfileStore({ filePath, now: () => at }),
    restored = disk.find(u.token);
  assert.equal(chests.view(restored, at).capacity, 7);
  assert.equal(chests.view(restored, at).stored, 7);
  assert.deepEqual(
    restored.clanChests.items.filter((c) => !c.stored).map((c) => c.id),
    ids.slice(7),
  );
  assert.deepEqual(
    restored.clanChests.items.map((x) => x.id),
    ids,
  );
  chests.act(restored, "claim", ids[12], at);
  assert.equal(restored.clanChests.items[12].stored, false);
  for (const id of ids.slice(0, 6)) {
    disk.clanChestAction(u.token, { action: "prepare", chestId: id, requestId: randomUUID() });
    const op = { action: "open", chestId: id, requestId: randomUUID() };
    disk.clanChestAction(u.token, op);
    const wallet = structuredClone(disk.find(u.token).wallet);
    disk.clanChestAction(u.token, op);
    assert.deepEqual(disk.find(u.token).wallet, wallet);
  }
  const op = { action: "claim", chestId: ids[12], requestId: randomUUID() };
  disk.clanChestAction(u.token, op);
  disk.clanChestAction(u.token, op);
  assert.equal(chests.view(disk.find(u.token), at).stored, 7);
});

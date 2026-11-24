/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { clanProgress } = require("../../src/server/clans/clan-level-progress");
const { xpForLevel } = require("../../src/server/progression/experience-progression"),
  { temporary } = require("../temp");
function setup(filePath) {
  const store = new ProfileStore({ filePath }),
    clans = new ClanService(store);
  const user = (level = 12) => {
    const u = store.open(),
      p = store.find(u.token);
    p.level = level;
    p.progress.xp = xpForLevel(level);
    p.wallet.coins = 3000;
    return u;
  };
  const act = (u, action, fields = {}, requestId = randomUUID()) =>
    clans.mutate(u.token, { action, ...fields, requestId });
  const create = (u, prefix = "A", privacy = "closed") => {
    act(u, "create", { name: "Клан " + prefix, prefix, emblem: "astral", privacy });
    return store.find(u.token).clanId;
  };
  const join = (head, u, clanId) => {
    act(u, "apply", { clanId });
    act(head, "accept", { clanId, memberId: u.profile.id });
  };
  return { store, clans, user, act, create, join, p: (u) => store.find(u.token) };
}
test("Создание и вступление с 12 уровня: отказ не списывает деньги, открытый клан принимает сразу", () => {
  const { user, p, act, create, store } = setup(),
    a = user(),
    b = user(11),
    clanId = create(a, "A", "open");
  const before = structuredClone(store.data);
  assert.throws(() => act(b, "apply", { clanId }), /12 уровня/);
  assert.throws(() => create(b, "B"), /12 уровня/);
  assert.deepEqual(store.data, before);
  p(b).level = 12;
  p(b).progress.xp = xpForLevel(12);
  const id = randomUUID();
  act(b, "apply", { clanId }, id);
  act(b, "apply", { clanId }, id);
  assert.equal(p(b).wallet.coins, 2950);
  assert.equal(p(b).clanId, clanId);
  assert.deepEqual(store.data.clans[clanId].applications, []);
  assert.equal(store.data.clans[clanId].roles[b.profile.id], "member");
  act(b, "leave", { clanId });
  assert.equal(p(b).wallet.coins, 2950);
});
test("Заявка резервирует 50 монет: отмена и отказ возвращают ровно один раз; принятие сохраняет оплату", () => {
  const { user, p, act, create, store } = setup(),
    a = user(),
    b = user(),
    clanId = create(a);
  act(b, "apply", { clanId });
  assert.equal(p(b).wallet.coins, 2950);
  assert.equal(p(b).clanId, null);
  assert.throws(() => act(b, "apply", { clanId }), /уже отправлена/);
  const cancel = randomUUID();
  act(b, "cancel", { clanId }, cancel);
  act(b, "cancel", { clanId }, cancel);
  assert.equal(p(b).wallet.coins, 3000);
  act(b, "apply", { clanId });
  const reject = randomUUID();
  act(a, "reject", { clanId, memberId: b.profile.id }, reject);
  act(a, "reject", { clanId, memberId: b.profile.id }, reject);
  assert.equal(p(b).wallet.coins, 3000);
  assert.deepEqual(store.data.clans[clanId].applicationFees, {});
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  assert.equal(p(b).wallet.coins, 2950);
});
test("Вступление в другой клан, создание и роспуск возвращают оплату отменённых заявок", () => {
  const { user, p, act, create, store } = setup(),
    a = user(),
    b = user(),
    c = user(),
    d = user(),
    first = create(a),
    second = create(b, "B", "open");
  act(c, "apply", { clanId: first });
  act(c, "apply", { clanId: second });
  assert.equal(p(c).wallet.coins, 2950);
  assert.deepEqual(store.data.clans[first].applications, []);
  act(d, "apply", { clanId: first });
  create(d, "D");
  assert.equal(p(d).wallet.coins, 1500);
  const e = user();
  act(e, "apply", { clanId: first });
  act(a, "disband", { clanId: first });
  assert.equal(p(e).wallet.coins, 3000);
});
test("Ошибка записи заявки, возврата, роли и покупки оставляет все профили и казну нетронутыми", () => {
  const { user, p, act, create, join, store } = setup(),
    a = user(),
    b = user(),
    c = user(),
    clanId = create(a);
  join(a, b, clanId);
  act(c, "apply", { clanId });
  p(a).wallet.bucks = 500;
  act(a, "deposit", { clanId, amount: 500 });
  const before = structuredClone(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  for (const fn of [
    () => act(c, "cancel", { clanId }),
    () => act(a, "reject", { clanId, memberId: c.profile.id }),
    () => act(a, "role", { clanId, memberId: b.profile.id, role: "manager" }),
    () => act(a, "buyBooster", { clanId, boosterId: "fire" }),
  ]) {
    assert.throws(fn, /disk full/);
    assert.deepEqual(store.data, before);
  }
  store.save = save;
  act(c, "cancel", { clanId });
  const newBefore = structuredClone(store.data);
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => act(c, "apply", { clanId }), /disk full/);
  assert.deepEqual(store.data, newBefore);
});
test("Роли: глава, управляющий, офицер и участник; запрет управления равными и старшими", () => {
  const { user, p, act, create, join, store, clans } = setup(),
    head = user(),
    manager = user(),
    officer = user(),
    member = user(),
    peer = user(),
    applicant = user();
  const clanId = create(head);
  for (const u of [manager, officer, member, peer]) join(head, u, clanId);
  const role = (actor, target, role) =>
    act(actor, "role", { clanId, memberId: target.profile.id, role });
  role(head, manager, "manager");
  role(head, peer, "manager");
  role(manager, officer, "officer");
  assert.equal(clans.state(manager.token).mine.permissions.buy, true);
  assert.equal(clans.state(officer.token).mine.permissions.recruit, true);
  assert.equal(clans.state(member.token).mine.permissions.edit, false);
  for (const [actor, target, newRole] of [
    [manager, head, "member"],
    [manager, peer, "officer"],
    [manager, member, "manager"],
    [officer, member, "officer"],
    [member, member, "head"],
  ])
    assert.throws(() => role(actor, target, newRole));
  for (const [actor, target] of [
    [manager, head],
    [manager, peer],
    [officer, manager],
    [member, officer],
  ])
    assert.throws(() => act(actor, "kick", { clanId, memberId: target.profile.id }));
  act(manager, "edit", { clanId, description: "Новое описание", privacy: "open" });
  assert.equal(store.data.clans[clanId].description, "Новое описание");
  assert.throws(() => act(manager, "edit", { clanId, name: "Подмена" }), /только глава/);
  assert.throws(() => act(manager, "edit", { clanId, emblem: "grove" }), /только глава/);
  assert.throws(
    () => act(officer, "edit", { clanId, description: "Подмена" }),
    /Недостаточно прав/,
  );
  act(manager, "edit", { clanId, privacy: "closed" });
  act(applicant, "apply", { clanId });
  act(officer, "accept", { clanId, memberId: applicant.profile.id });
  act(officer, "kick", { clanId, memberId: applicant.profile.id });
  assert.equal(p(applicant).clanId, null);
  p(member).wallet.bucks = 500;
  act(member, "deposit", { clanId, amount: 500 });
  assert.throws(
    () => act(officer, "buyBooster", { clanId, boosterId: "fire" }),
    /Недостаточно прав/,
  );
  act(manager, "buyBooster", { clanId, boosterId: "fire" });
  for (const u of [head, manager, officer, member, peer]) assert.equal(p(u).inventory.fire, 10);
  assert.throws(
    () => act(manager, "transfer", { clanId, memberId: member.profile.id }),
    /только главе/,
  );
  act(head, "transfer", { clanId, memberId: member.profile.id });
  assert.equal(store.data.clans[clanId].roles[member.profile.id], "head");
  assert.equal(store.data.clans[clanId].roles[head.profile.id], "member");
  assert.throws(() => role(head, manager, "member"));
});
test("Приватность меняется без удаления старых заявок; просмотр чужого клана недоступен", () => {
  const { user, act, create, clans, store } = setup(),
    a = user(),
    b = user(),
    c = user(),
    clanId = create(a);
  act(b, "apply", { clanId });
  act(a, "edit", { clanId, privacy: "open" });
  assert.deepEqual(store.data.clans[clanId].applications, [b.profile.id]);
  const details = clans.state(c.token, "", 1, clanId).selected;
  assert.equal(details, null);
  const applicant = clans.state(b.token, "", 1, clanId);
  assert.equal(applicant.selected, null);
  assert.equal(applicant.applications[0].id, clanId);
  assert.equal(clans.state(a.token, "", 1, clanId).mine.applications.length, 1);
});
test("Переходы уровня клана и максимальный 15-й, опыт сверх максимума хранится", () => {
  for (const [xp, level, remaining, cost] of [
    [0, 1, 0, 30000],
    [29999, 1, 29999, 30000],
    [30000, 2, 0, 100000],
    [129999, 2, 99999, 100000],
    [130000, 3, 0, 300000],
    [430000, 4, 0, 500000],
    [930000, 5, 0, 750000],
    [1680000, 6, 0, 1000000],
    [2680000, 7, 0, 1500000],
    [4180000, 8, 0, 2000000],
    [6180000, 9, 0, 2500000],
    [8680000, 10, 0, 3000000],
    [11680000, 11, 0, 4000000],
    [15680000, 12, 0, 5000000],
    [20680000, 13, 0, 7500000],
    [28180000, 14, 0, 10000000],
    [38179999, 14, 9999999, 10000000],
    [38180000, 15, 0, null],
    [38300000, 15, 120000, null],
  ]) {
    assert.deepEqual(clanProgress(xp), {
      level,
      totalXp: xp,
      levelXp: remaining,
      nextLevelXp: cost,
    });
  }
});
test("XP клана считается в момент заработка: до вступления не учитывается, после ухода остаётся", () => {
  const { user, p, act, create, store } = setup(),
    a = user(),
    b = user(),
    clanId = create(a);
  const event = (id, items) =>
    store.applyArenaProgress(
      id,
      items.map((e) => ({ profileId: b.profile.id, ...e })),
      1000000,
    );
  store.startLife(b.profile.id, "life");
  event("before", [{ type: "survivalMinute", mass: 5000, minutes: 1 }]);
  assert.equal(p(b).progress.session.xp, 10);
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  event("after", [{ type: "survivalMinute", mass: 10000, minutes: 1 }]);
  assert.equal(store.data.clans[clanId].xp, 20);
  event("after", [{ type: "survivalMinute", mass: 10000, minutes: 1 }]);
  assert.equal(store.data.clans[clanId].xp, 20);
  act(a, "kick", { clanId, memberId: b.profile.id });
  event("outside", [
    { type: "survivalMinute", mass: 15000, minutes: 1 },
    { type: "lifeEnded", lifeId: "life", durationSeconds: 180, reason: "left" },
  ]);
  assert.equal(store.data.clans[clanId].xp, 20);
  assert.equal(p(b).progress.xp, xpForLevel(12) + 60);
  act(b, "apply", { clanId });
  act(a, "accept", { clanId, memberId: b.profile.id });
  assert.equal(store.data.clans[clanId].xp, 20);
});
test("XP клана ограничен фактически заработанным XP и не дублируется при смерти, продолжении или восстановлении", (t) => {
  const filePath = path.join(temporary(t, "clan-xp"), "profiles.json"),
    { user, p, create, store } = setup(filePath),
    a = user(),
    clanId = create(a);
  store.startLife(a.profile.id, "life");
  const items = [{ type: "survivalMinute", profileId: a.profile.id, mass: 75000, minutes: 4 }];
  const before = structuredClone(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => store.applyArenaProgress("earn", items, 1), /disk full/);
  assert.deepEqual(store.data, before);
  store.save = save;
  store.applyArenaProgress("earn", items, 1);
  assert.equal(store.data.clans[clanId].xp, 500);
  const disk = new ProfileStore({ filePath });
  assert.equal(disk.data.clans[clanId].xp, 500);
  assert.equal(disk.find(a.token).progress.xp, xpForLevel(13));
  disk.applyArenaProgress(
    "end",
    [
      {
        type: "lifeEnded",
        profileId: a.profile.id,
        lifeId: "life",
        durationSeconds: 240,
        reason: "left",
      },
    ],
    2,
  );
  disk.startLife(a.profile.id, "continue", false);
  disk.applyArenaProgress("cap", items, 3);
  assert.equal(disk.data.clans[clanId].xp, 500);
  disk.applyArenaProgress(
    "end-continue",
    [
      {
        type: "lifeEnded",
        profileId: a.profile.id,
        lifeId: "continue",
        durationSeconds: 60,
        reason: "left",
      },
    ],
    4,
  );
  disk.startLife(a.profile.id, "lobby", true);
  disk.applyArenaProgress("new", items, 5);
  assert.equal(disk.data.clans[clanId].xp, 1000);
});
test("Миграция v6 сохраняет имущество и бесплатные заявки; отмена не создаёт монеты", (t) => {
  const filePath = path.join(temporary(t, "clan-migration"), "profiles.json"),
    { user, p, act, create, store } = setup(),
    a = user(),
    b = user(),
    clanId = create(a);
  act(b, "apply", { clanId });
  p(b).wallet.coins += 50;
  const old = structuredClone(store.data);
  old.version = 6;
  for (const p of Object.values(old.profiles)) delete p.transactions;
  for (const c of Object.values(old.clans))
    for (const key of ["roles", "privacy", "xp", "applicationFees"]) delete c[key];
  fs.writeFileSync(filePath, JSON.stringify(old));
  const disk = new ProfileStore({ filePath }),
    clans = new ClanService(disk);
  assert.equal(disk.data.version, 13);
  assert.equal(disk.data.clans[clanId].xp, 0);
  assert.equal(disk.data.clans[clanId].privacy, "closed");
  assert.equal(disk.data.clans[clanId].roles[a.profile.id], "head");
  assert.equal(disk.data.clans[clanId].applicationFees[b.profile.id], 0);
  assert.deepEqual(disk.find(b.token).wallet, p(b).wallet);
  assert.deepEqual(disk.find(a.token).inventory, p(a).inventory);
  clans.mutate(b.token, { action: "cancel", clanId, requestId: randomUUID() });
  assert.equal(disk.find(b.token).wallet.coins, 3000);
  disk.data.clans[clanId].xp = 90000;
  disk.save(disk.data);
  assert.equal(
    new ClanService(new ProfileStore({ filePath })).state(a.token).mine.progress.level,
    2,
  );
});
test("Повреждённые роли, опыт и плата отклоняются без перезаписи", (t) => {
  const filePath = path.join(temporary(t, "clan-invalid"), "profiles.json"),
    { user, create, store } = setup(),
    a = user(),
    clanId = create(a);
  for (const mutate of [
    (c) => (c.roles[a.profile.id] = "manager"),
    (c) => (c.roles.fake = "head"),
    (c) => (c.xp = -1),
    (c) => (c.privacy = "?"),
    (c) => (c.applicationFees.fake = 50),
  ]) {
    const data = structuredClone(store.data);
    mutate(data.clans[clanId]);
    const raw = JSON.stringify(data);
    fs.writeFileSync(filePath, raw);
    assert.throws(() => new ProfileStore({ filePath }), /Повреждены/);
    assert.equal(fs.readFileSync(filePath, "utf8"), raw);
  }
});

/* Границы вместимости, рамки 10 уровня и однократные награды за новый уровень. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const path = require("node:path"),
  fs = require("node:fs");
const { temporary } = require("../temp");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { ClanService } = require("../../src/server/clans/clan-service");
const { clanProgress, clanCapacity } = require("../../src/server/clans/clan-level-progress");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
const kit = require("../../public/shared/clan-crest-rules");
function clanXp(level) {
  let xp = 0;
  while (clanProgress(xp).level < level) xp += clanProgress(xp).nextLevelXp;
  return xp;
}
function setup(filePath) {
  const store = new ProfileStore({ filePath }),
    clans = new ClanService(store);
  const user = () => {
    const u = store.open(),
      p = store.find(u.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 5000;
    return u;
  };
  const head = user();
  const act = (u, action, extra = {}) =>
    clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  act(head, "create", { prefix: "CAP", name: "Вместимость", emblem: "astral", privacy: "open" });
  const id = store.find(head.token).clanId;
  return { store, clans, user, head, act, id };
}
test("Вместимость: точные границы всех 15 уровней, сохранение и вступление до 50", (t) => {
  const f = setup(path.join(temporary(t, "clan-capacity"), "profiles.json"));
  const capacities = [15, 20, 30, 40, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
  for (let level = 1; level <= 15; level++) {
    const xp = clanXp(level),
      cap = capacities[level - 1];
    assert.equal(clanCapacity(xp), cap);
    if (level > 1) assert.equal(clanCapacity(xp - 1), capacities[level - 2]);
    f.store.data.clans[f.id].xp = xp;
    assert.equal(f.clans.state(f.head.token).mine.capacity, cap);
    while (f.store.data.clans[f.id].members.length < cap)
      f.act(f.user(), "apply", { clanId: f.id });
    const outsider = f.user(),
      balance = f.store.find(outsider.token).wallet.coins;
    assert.throws(() => f.act(outsider, "apply", { clanId: f.id }), /свободных мест/);
    assert.equal(f.store.find(outsider.token).wallet.coins, balance);
  }
  f.store.save(f.store.data);
  const reloaded = new ProfileStore({ filePath: f.store.filePath });
  assert.equal(reloaded.data.clans[f.id].capacity, 50);
  assert.equal(reloaded.data.clans[f.id].members.length, 50);
});
test("Старая вместимость 15 обновляется по XP; заявка не переполняет новый предел", (t) => {
  const filePath = path.join(temporary(t, "clan-capacity-migration"), "profiles.json");
  const f = setup(filePath);
  f.store.data.clans[f.id].xp = clanXp(4);
  f.store.save(f.store.data);
  const disk = JSON.parse(fs.readFileSync(filePath));
  disk.clans[f.id].capacity = 15;
  disk.clans[f.id].crest = { ...kit.DEFAULT, frame: "f10_grand", symbol: kit.symbols[2].id };
  fs.writeFileSync(filePath, JSON.stringify(disk));
  const loaded = new ProfileStore({ filePath });
  assert.equal(loaded.data.clans[f.id].capacity, 40);
  assert.deepEqual(loaded.data.clans[f.id].crest, {
    ...disk.clans[f.id].crest,
    frame: kit.DEFAULT.frame,
  });
  f.act(f.head, "edit", { clanId: f.id, privacy: "closed" });
  const applicants = Array.from({ length: 40 }, () => f.user());
  for (const u of applicants) f.act(u, "apply", { clanId: f.id });
  for (const u of applicants.slice(0, 39))
    f.act(f.head, "accept", { clanId: f.id, memberId: u.profile.id });
  assert.throws(
    () => f.act(f.head, "accept", { clanId: f.id, memberId: applicants[39].profile.id }),
    /мест|вступил/,
  );
  assert.equal(f.store.data.clans[f.id].members.length, 40);
});
test("Новые пороги сохраняют XP и участников переполненного клана, но блокируют новые вступления", (t) => {
  const f = setup(path.join(temporary(t, "clan-rebalance-overflow"), "profiles.json"));
  f.store.data.clans[f.id].xp = clanXp(15);
  for (let i = 1; i < 50; i++) f.act(f.user(), "apply", { clanId: f.id });
  const outsider = f.user();
  f.store.save(f.store.data);
  const disk = JSON.parse(fs.readFileSync(f.store.filePath));
  // This much XP used to mean level 15 with 50 seats, now level 6 with 50; all existing members remain.
  disk.clans[f.id].xp = 1740000;
  disk.clans[f.id].capacity = 50;
  fs.writeFileSync(f.store.filePath, JSON.stringify(disk));
  const loaded = new ProfileStore({ filePath: f.store.filePath });
  const service = new ClanService(loaded);
  assert.equal(loaded.data.clans[f.id].xp, 1740000);
  assert.equal(service.state(f.head.token).mine.progress.level, 6);
  assert.equal(loaded.data.clans[f.id].capacity, 50);
  assert.deepEqual(loaded.data.clans[f.id].members, disk.clans[f.id].members);
  assert.throws(() => service.mutate(outsider.token, {
    action: "apply", clanId: f.id, requestId: randomUUID(),
  }), /свободных мест/);
  loaded.save(loaded.data);
  assert.equal(new ProfileStore({ filePath: f.store.filePath }).data.clans[f.id].members.length, 50);
});

test("Опыт участника автоматически открывает новые места при повышении уровня клана", () => {
  const f = setup();
  f.store.data.clans[f.id].xp = clanXp(4) - 1;
  const profileId = f.head.profile.id;
  f.store.applyArenaProgress(
    randomUUID(),
    [
      { profileId, type: "lifeStarted", lifeId: "capacity-life" },
      { profileId, type: "survivalMinute", mass: 1000, minutes: 1 },
    ],
    Date.now(),
  );
  assert.equal(f.store.data.clans[f.id].capacity, 40);
  assert.equal(f.clans.state(f.head.token).mine.progress.level, 4);
});
test("Три особые рамки недоступны до 10 уровня и не списывают валюту при отказе", () => {
  const f = setup();
  for (const frame of ["f08_cartouche", "f09_royal", "f10_grand"]) {
    f.store.data.clans[f.id].xp = clanXp(10) - 1;
    f.store.find(f.head.token).wallet.crystals = 100;
    const before = JSON.stringify(f.store.data);
    assert.throws(
      () => f.act(f.head, "edit", { clanId: f.id, crest: { ...kit.DEFAULT, frame } }),
      /10 уровня/,
    );
    assert.equal(JSON.stringify(f.store.data), before);
    f.store.data.clans[f.id].xp = clanXp(10);
    f.act(f.head, "edit", { clanId: f.id, crest: { ...kit.DEFAULT, frame } });
    assert.equal(f.store.data.clans[f.id].crest.frame, frame);
    assert.equal(f.store.find(f.head.token).wallet.crystals, 50);
  }
  const newcomer = f.user();
  assert.throws(
    () =>
      f.act(newcomer, "create", {
        prefix: "NEW",
        name: "Новый",
        emblem: "astral",
        crest: { ...kit.DEFAULT, frame: "f10_grand" },
      }),
    /10 уровня/,
  );
});
test("Новый уровень: 10 монет и 1 кристалл только после окончания жизни; повтор и перезапуск без дубля", (t) => {
  const filePath = path.join(temporary(t, "level-reward"), "profiles.json");
  const store = new ProfileStore({ filePath }),
    u = store.open(),
    p = store.find(u.token);
  p.progress.xp = 499;
  const wallet = { ...p.wallet },
    id = randomUUID(),
    profileId = p.id;
  const batch = (events) =>
    store.applyArenaProgress(
      randomUUID(),
      events.map((e) => ({ profileId, ...e })),
      Date.now(),
    );
  batch([
    { type: "lifeStarted", lifeId: id },
    { type: "survivalMinute", mass: 1000, minutes: 1 },
  ]);
  assert.equal(store.find(u.token).progress.session.xp, 1);
  assert.equal(store.find(u.token).wallet.coins, wallet.coins);
  const finish = { type: "lifeEnded", lifeId: id, durationSeconds: 60, reason: "left" };
  batch([finish]);
  const updated = store.find(u.token);
  assert.equal(updated.level, 2);
  assert.equal(updated.wallet.coins, wallet.coins + 10);
  assert.equal(updated.wallet.crystals, wallet.crystals + 1);
  assert.deepEqual(updated.progress.lastLife.levelReward, { levels: 1, coins: 10, crystals: 1 });
  batch([finish]);
  const loaded = new ProfileStore({ filePath });
  loaded.applyArenaProgress(randomUUID(), [{ profileId, ...finish }], Date.now());
  assert.deepEqual(loaded.find(u.token).wallet, updated.wallet);
});
test("Ошибка сохранения награды за уровень откатывает кошелёк и XP; повтор выдаёт один раз", () => {
  const store = new ProfileStore(),
    u = store.open(),
    p = store.find(u.token);
  p.progress.xp = 499;
  store.applyArenaProgress(
    "start",
    [
      { profileId: p.id, type: "lifeStarted", lifeId: "life" },
      { profileId: p.id, type: "survivalMinute", mass: 1000, minutes: 1 },
    ],
    Date.now(),
  );
  const before = JSON.stringify(store.data),
    save = store.save;
  store.save = () => {
    throw Error("disk full");
  };
  const events = [
    { profileId: p.id, type: "lifeEnded", lifeId: "life", durationSeconds: 60, reason: "left" },
  ];
  assert.throws(() => store.applyArenaProgress("finish", events, Date.now()), /disk full/);
  assert.equal(JSON.stringify(store.data), before);
  store.save = save;
  store.applyArenaProgress("finish", events, Date.now());
  const wallet = { ...store.find(u.token).wallet };
  store.applyArenaProgress("finish", events, Date.now());
  assert.deepEqual(store.find(u.token).wallet, wallet);
});

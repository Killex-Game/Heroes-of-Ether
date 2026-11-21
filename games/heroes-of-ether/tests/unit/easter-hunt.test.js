"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  path = require("node:path");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { EventManager } = require("../../src/server/events/event-manager"),
  E = require("../../src/server/events/easter-hunt"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  T = require("../../src/server/progression/treasury-capacity"),
  { temporary } = require("../temp");
const AT = Date.UTC(2026, 9, 26, 12);
function fixture(filePath) {
  let now = AT;
  const events = new EventManager({ now: () => now }),
    store = new ProfileStore({ now: () => now, filePath });
  store.events = events;
  events.apply("test", "start", {
    eventId: E.manifest.id,
    revision: events.data.revision,
    requestId: randomUUID(),
  });
  const auth = store.open();
  return {
    store,
    events,
    auth,
    get: () => store.find(auth.token),
    run: () => events.active().id,
    now: () => now,
    set: (v) => (now = v),
  };
}
function collect(f, n = 40) {
  const batch = Array.from({ length: n }, (_, i) => ({
    type: "easterPickup",
    eggType: i % 4,
    lifeId: f.get().progress.session?.id,
    runId: f.run(),
    profileId: f.get().id,
  }));
  f.store.applyArenaProgress(randomUUID(), batch, f.now());
}
test("Компактное обновление HUD сообщает яйца текущей жизни и сохраняет каталог лобби", () => {
  const f = fixture(),
    wire = require("../../public/shared/arena-wire");
  f.store.startLife(f.get().id, "life");
  const before = f.store.view(f.get());
  collect(f, 1);
  const patch = f.store.arenaView(f.get());
  assert.deepEqual(patch.easter.lifeEggs, [1, 0, 0, 0]);
  assert.equal(patch.easter.chests, undefined);
  assert.deepEqual(wire.mergeProfile(before, patch).easter.chests, before.easter.chests);
});
test("Ручной перенос окончания сохраняет единые сроки Пасхи и связанной рулетки", () => {
  const f = fixture();
  const endsAt = f.events.active().endsAt + 3600000;
  f.events.apply("test", "reschedule", {
    runId: f.run(),
    endsAt,
    revision: f.events.data.revision,
    requestId: randomUUID(),
  });
  assert.equal(E.view(f.get(), f.events, f.now()).endsAt, endsAt);
  assert.equal(f.events.publicView(f.now()).endsAt, endsAt);
  assert.equal(f.events.rouletteConfig({}, f.now()).events[0].endsAt, endsAt);
  f.set(endsAt);
  assert.equal(E.view(f.get(), f.events, f.now()).active, false);
  assert.equal(f.events.rouletteConfig({}, f.now()).events.length, 0);
});
test("Коллекционное уведомление сохраняется один раз, после ивента, с откатом ошибки записи", (t) => {
  const filePath = path.join(temporary(t, "collection-notice"), "profiles.json"),
    f = fixture(filePath);
  assert.throws(() => action(f, "notice"), /ещё не получены/);
  collect(f, 40);
  const s = f.get().easter.runs[f.run()];
  s.fragmentCounts = Array(48).fill(1);
  s.fragments = 48;
  f.get().easter.trophies.push({ runId: f.run(), at: f.now(), collectionVersion: 2 });
  f.store.save(f.store.data);
  const runId = f.run(),
    request = { action: "notice", runId, requestId: randomUUID() },
    before = structuredClone(f.get()),
    save = f.store.save.bind(f.store);
  f.set(f.events.active().endsAt + 1000);
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, request), /disk full/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, request);
  const notifiedAt = f.get().easter.trophies[0].notifiedAt;
  assert.equal(notifiedAt, f.now());
  const disk = new ProfileStore({ filePath, now: f.now });
  disk.events = f.events;
  assert.equal(E.mutate(disk, f.auth.token, request).replay, true);
  E.mutate(disk, f.auth.token, { ...request, requestId: randomUUID() });
  assert.equal(disk.find(f.auth.token).easter.trophies[0].notifiedAt, notifiedAt);
});
test("четыре разных яйца: обмен не выдаёт фрагмент, повторы не завершают коллекцию", () => {
  const f = fixture();
  f.store.applyArenaProgress(
    randomUUID(),
    Array.from({ length: 60 }, () => ({
      type: "easterPickup",
      eggType: 0,
      runId: f.run(),
      profileId: f.get().id,
    })),
    f.now(),
  );
  const before = structuredClone(f.get());
  assert.throws(() => action(f, "exchange"), /по 10 каждого вида/);
  assert.deepEqual(f.get(), before);
  collect(f, 120);
  for (let i = 0; i < 3; i++) action(f, "exchange");
  let s = f.get().easter.runs[f.run()];
  assert.deepEqual(s.eggs, [60, 0, 0, 0]);
  assert.equal(s.fragments, 0);
  assert.equal(f.get().easter.chests.length, 3);
  openFragment(f, 7);
  openFragment(f, 7);
  openFragment(f, 2);
  s = f.get().easter.runs[f.run()];
  assert.equal(s.fragments, 2);
  assert.equal(s.fragmentCounts[7], 2);
  assert.equal(s.fragmentCounts[2], 1);
  assert.equal(f.get().easter.trophies.length, 0);
  assert.equal(E.view(f.get(), f.events, f.now()).fragmentCounts[7], 2);
  assert.throws(() => action(f, "ether"), /Сначала собери/);
});
test("для сундука нужен каждый вид: нехватка, точный набор, повтор и ошибка записи", () => {
  const f = fixture();
  collect(f, 4);
  assert.throws(() => action(f, "exchange"), /40 яиц - по 10 каждого вида/);
  collect(f, 35);
  const before = structuredClone(f.get());
  assert.throws(() => action(f, "exchange"), /по 10 каждого вида/);
  assert.deepEqual(f.get(), before);
  f.store.applyArenaProgress(
    randomUUID(),
    [
      {
        type: "easterPickup",
        eggType: 3,
        runId: f.run(),
        profileId: f.get().id,
      },
    ],
    f.now(),
  );
  const ready = structuredClone(f.get()),
    save = f.store.save;
  const request = {
    action: "exchange",
    runId: f.run(),
    requestId: randomUUID(),
  };
  f.store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, request), /disk/);
  assert.deepEqual(f.get(), ready);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, request);
  assert.deepEqual(f.get().easter.runs[f.run()].eggs, [0, 0, 0, 0]);
  assert.equal(f.get().easter.chests.length, 1);
  const exchanged = structuredClone(f.get());
  E.mutate(f.store, f.auth.token, request);
  assert.deepEqual(f.get(), exchanged);
  assert.throws(() => action(f, "exchange"), /по 10 каждого вида/);
  assert.deepEqual(f.get(), exchanged);
});
test("фрагмент запечатывается при открытии, не меняется при повторе и восстанавливается с диска", (t) => {
  const file = path.join(temporary(t, "easter-fragment"), "profiles.json"),
    f = fixture(file);
  collect(f, 120);
  for (let i = 0; i < 3; i++) action(f, "exchange");
  const chest = f.get().easter.chests[0],
    request = { action: "prepare", chestId: chest.id, requestId: randomUUID() };
  const before = structuredClone(f.get()),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, request), /disk/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, request);
  const first = f.get().easter.chests[0].reward.fragmentId;
  assert.ok(first >= 0 && first < 48);
  action(f, "prepare", { chestId: chest.id });
  assert.equal(f.get().easter.chests[0].reward.fragmentId, first);
  const restored = new ProfileStore({ filePath: file, now: f.now });
  assert.equal(restored.find(f.auth.token).easter.chests[0].reward.fragmentId, first);
  const open = { action: "open", chestId: chest.id, requestId: randomUUID() };
  E.mutate(f.store, f.auth.token, open);
  E.mutate(f.store, f.auth.token, open);
  assert.equal(f.get().easter.runs[f.run()].fragmentCounts[first], 1);
  openFragment(f, first);
  assert.equal(f.get().easter.runs[f.run()].fragments, 1);
  const old = f.run();
  f.set(f.events.active().endsAt);
  f.events.apply("test", "start", {
    eventId: E.manifest.id,
    revision: f.events.data.revision,
    requestId: randomUUID(),
  });
  openFragment(f, (first + 1) % 48);
  assert.equal(f.get().easter.runs[old].fragments, 2);
  assert.equal(E.view(f.get(), f.events, f.now()).fragments, 0);
});
test("старые фрагменты и постоянная награда сохраняются при переходе на случайные находки", () => {
  const f = fixture();
  collect(f, 80);
  action(f, "exchange");
  action(f, "exchange");
  const s = f.get().easter.runs[f.run()];
  s.fragments = 12;
  f.get().easter.trophies.push({ runId: f.run(), at: f.now() });
  E.validate(f.get());
  assert.deepEqual(E.view(f.get(), f.events, f.now()).fragmentCounts, [
    ...Array(12).fill(1),
    ...Array(36).fill(0),
  ]);
  openFragment(f, 11);
  const migrated = f.get().easter.runs[f.run()];
  assert.equal(migrated.fragments, 12);
  assert.equal(migrated.fragmentCounts[11], 2);
  assert.equal(f.get().easter.trophies.length, 1);
});
test("Удачная неделя вложена в охоту: старый запуск, Lite, рулетка, достижения и окончание", () => {
  const f = fixture(),
    run = f.events.active(),
    lucky = require("../../src/server/events/lucky-week");
  run.manifest.features = { roulette: false, lite: false };
  const before = JSON.stringify(f.events.data);
  assert.equal(f.events.publicView().linkedEvents[0].id, "lucky-week");
  assert.equal(f.events.view().active.manifest.features.lite, true);
  assert.equal(f.events.rouletteConfig({}).events[0].id, run.id);
  assert.equal(f.store.view(f.get()).roulette.available, true);
  assert.equal(
    require("../../src/server/accounts/lite-account").view(f.get(), f.store.rouletteConfig, f.now())
      .available,
    true,
  );
  assert.equal(lucky.view(f.get(), f.events, f.now()).length, 5);
  for (let i = 0; i < 10; i++)
    lucky.spin(f.get(), f.events, { category: "coins", amount: 100 }, f.now());
  assert.equal(f.get().eventAchievements[run.id].claimed.lucky_attempt, 1);
  assert.equal(JSON.stringify(f.events.data), before);
  f.set(run.endsAt);
  assert.deepEqual(f.events.rouletteConfig({}).events, []);
  assert.equal(lucky.view(f.get(), f.events, f.now()).length, 0);
});
const action = (f, action, more = {}) =>
  E.mutate(f.store, f.auth.token, {
    action,
    runId: f.run(),
    requestId: randomUUID(),
    ...more,
  });
function openFragment(f, index) {
  const chest = f.get().easter.chests.find((c) => c.stored);
  chest.reward.fragmentId = index;
  return f.store.transact(f.auth.token, randomUUID(), "test-open-" + chest.id, (p) =>
    E.act(p, f.events, { action: "open", chestId: chest.id }, f.now(), () => index),
  );
}

test("четыре изображения: награда только за 48 частей, Альбом остаётся после ивента и перезапуска", (t) => {
  const filePath = path.join(temporary(t, "easter-album"), "profiles.json"),
    f = fixture(filePath);
  collect(f, 1920);
  for (let i = 0; i < 48; i++) action(f, "exchange");
  for (let i = 0; i < 47; i++) openFragment(f, i);
  assert.equal(f.get().easter.trophies.length, 0);
  assert.equal(E.album(f.get()).length, 3);
  assert.ok(!f.store.view(f.get()).wardrobe.owned.includes("rabbit_ears"));
  openFragment(f, 47);
  assert.equal(E.album(f.get()).length, 4);
  assert.equal(f.get().easter.trophies.length, 1);
  assert.equal(f.get().easter.runs[f.run()].claimed.easter_collection, 4);
  assert.equal(f.get().inventory.easter_egg, 144);
  f.set(f.events.active().endsAt);
  const restored = new ProfileStore({ filePath, now: f.now });
  assert.equal(E.view(restored.find(f.auth.token), f.events, f.now()).album.length, 4);
  f.events.apply("test", "start", {
    eventId: E.manifest.id,
    revision: f.events.data.revision,
    requestId: randomUUID(),
  });
  assert.equal(E.view(restored.find(f.auth.token), f.events, f.now()).fragments, 0);
  assert.equal(E.view(restored.find(f.auth.token), f.events, f.now()).album.length, 4);
});

test("Альбом: 100 эфира за новую картину, одна выдача через повторы, сбой записи и перезапуск", (t) => {
  const album = require("../../src/server/events/event-album"),
    filePath = path.join(temporary(t, "album-reward"), "profiles.json"),
    f = fixture(filePath),
    eventId = E.manifest.id;
  const claim = (store = f.store, requestId = randomUUID()) =>
    album.claim(store, f.auth.token, { eventId, requestId, amount: 9000 });
  const runId = f.run();
  collect(f);
  const state = f.get().easter.runs[runId];
  state.fragmentCounts = Array(48).fill(0);
  state.fragmentCounts.fill(3, 0, 11);
  state.fragments = 11;
  assert.throws(() => claim(), /Нет новых наград/);
  state.fragmentCounts[11] = 1;
  state.fragments = 12;
  const before = f.get().wallet.bucks,
    id = randomUUID();
  const save = f.store.save.bind(f.store);
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => claim(f.store, id), /disk full/);
  assert.equal(f.get().wallet.bucks, before);
  assert.equal(f.get().eventAlbumClaims, undefined);
  f.store.save = save;
  assert.equal(claim(f.store, id).profile.wallet.bucks, before + 100);
  assert.equal(claim(f.store, id).replay, true);
  assert.throws(() => claim(), /Нет новых наград/);
  // Прежнее сохранение и получение после закрытия ивента.
  f.get().easter.runs[runId].fragmentCounts.fill(1);
  f.get().easter.runs[runId].fragments = 48;
  f.store.save(f.store.data);
  f.set(f.events.active().endsAt);
  const restored = new ProfileStore({ filePath, now: f.now });
  const shelf = restored.view(restored.find(f.auth.token)).eventAlbum[0];
  assert.equal(shelf.items.filter((art) => art.claimed).length, 1);
  assert.equal(shelf.available, 300);
  const result = claim(restored).profile;
  assert.equal(result.wallet.bucks, before + 400);
  assert.ok(result.eventAlbum[0].items.every((art) => art.owned && art.claimed));
  assert.throws(() => claim(restored), /Нет новых наград/);
});

test("повторки: базовый шанс минус 5 п.п., без потери последних частей и выхода за диапазон", () => {
  for (const owned of [0, 1, 12, 24, 47, 48]) {
    const s = { fragmentCounts: Array.from({ length: 48 }, (_, i) => (i < owned ? 1 : 0)) };
    let duplicates = 0;
    for (let roll = 0; roll < 960; roll++) {
      let calls = 0;
      const result = E.drawFragment(s, (limit) =>
        calls++ === 0 && owned && owned < 48 ? roll : limit - 1,
      );
      assert.ok(result >= 0 && result < 48);
      if (result < owned) duplicates++;
    }
    assert.equal(duplicates, owned === 48 ? 960 : Math.max(0, owned * 20 - 48));
  }
});

test("новый сундук: границы 100–150 монет и 3 бустера; старая показанная награда сохраняется", () => {
  const f = fixture();
  collect(f, 120);
  for (const high of [false, true]) {
    E.act(f.get(), f.events, { action: "exchange", runId: f.run() }, f.now(), (n) =>
      high ? n - 1 : 0,
    );
    const c = f.get().easter.chests.at(-1);
    assert.equal(c.reward.coins, high ? 150 : 100);
    assert.equal(c.reward.boosterCount, 3);
  }
  action(f, "exchange");
  const c = f.get().easter.chests.at(-1);
  c.reward = { coins: 159, crystals: 20, fragmentId: 11 };
  c.prepared = true;
  E.validate(f.get());
  action(f, "open", { chestId: c.id });
  assert.equal(f.get().inventory.easter_egg, 1);
});

test("ранее показанные 10 яиц сохраняются, нераскрытый старый сундук даёт 3", () => {
  const f = fixture();
  collect(f, 80);
  action(f, "exchange"); action(f, "exchange");
  const [shown, hidden] = f.get().easter.chests;
  for (const chest of [shown, hidden]) {
    chest.reward.version = 2;
    chest.reward.boosterCount = 10;
  }
  shown.prepared = true;
  shown.reward.fragmentId = 0;
  shown.reward.multiplier = 1;
  E.validate(f.get());
  action(f, "prepare", { chestId: shown.id });
  assert.equal(f.get().easter.chests[0].reward.boosterCount, 10);
  action(f, "open", { chestId: shown.id });
  assert.equal(f.get().inventory.easter_egg, 10);
  action(f, "prepare", { chestId: hidden.id });
  assert.equal(f.get().easter.chests[0].reward.boosterCount, 3);
  action(f, "open", { chestId: hidden.id });
  assert.equal(f.get().inventory.easter_egg, 13);
});

test("семь достижений: новые пороги, все степени, остаток и повтор пакета", () => {
  const f = fixture();
  f.store.eventRankingReady = () => false; // This scenario isolates achievement rewards.
  collect(f, 4000);
  const s = f.get().easter.runs[f.run()];
  assert.equal(s.claimed.easter_hunter, 5);
  assert.equal(s.claimed.easter_colors, 5);
  assert.equal(s.claimed.easter_trail, 1);
  for (let i = 0; i < 48; i++) action(f, "exchange");
  assert.equal(f.get().easter.runs[f.run()].claimed.easter_find, 5);
  assert.equal(f.get().easter.runs[f.run()].fragments, 0);
  for (let i = 0; i < 48; i++) openFragment(f, i);
  assert.equal(f.get().easter.runs[f.run()].fragments, 48);
  for (let i = 0; i < 15; i++) {
    if (i === 10) f.set(AT + 86400000);
    action(f, "ether");
  }
  f.set(AT + 86400000 + 60000);
  const batch = Array.from({ length: 910 }, (_, i) => ({
      type: "lifeEnded",
      lifeId: "easter-life-" + i,
      durationMs: 60000,
      profileId: f.get().id,
    })),
    id = randomUUID();
  f.store.applyArenaProgress(id, batch, f.now());
  const before = structuredClone(f.get());
  f.store.applyArenaProgress(id, batch, f.now());
  assert.deepEqual(f.get(), before);
  const result = f.get().easter.runs[f.run()];
  for (const d of E.achievements) assert.equal(result.claimed[d.id], d.thresholds.length, d.id);
  // The second calendar day also pays the daily greatness prize and its first top achievement.
  assert.equal(f.get().greatness, 3540 + 3 + 10);
  assert.equal(f.get().easter.trophies.length, 1);
  assert.equal(f.get().wallet.bucks, 75);
  E.validate(f.get());
});

test("обмен эфира: десять в сутки по Москве, повтор, отказ записи, перезапуск и сброс в полночь", (t) => {
  const filePath = path.join(temporary(t, "ether-limit"), "profiles.json"),
    f = fixture(filePath);
  f.store.eventRankingReady = () => false;
  collect(f, 2400);
  const s = f.get().easter.runs[f.run()];
  s.fragmentCounts = Array(48).fill(1);
  s.fragments = 48;
  f.store.refreshCompetition();
  const day = Math.floor((AT + 10800000) / 86400000),
    midnight = (day + 1) * 86400000 - 10800000;
  const inputs = Array.from({ length: 10 }, () => ({
    action: "ether",
    runId: f.run(),
    requestId: randomUUID(),
  }));
  const original = f.get().wallet.bucks;
  inputs.slice(0, 9).forEach((input) => E.mutate(f.store, f.auth.token, input));
  const before = structuredClone(f.store.data),
    save = f.store.save;
  f.store.save = () => {
    throw Error("limit save failed");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, inputs[9]), /limit save failed/);
  assert.deepEqual(f.store.data, before);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, inputs[9]);
  assert.equal(f.get().wallet.bucks, original + 50);
  assert.equal(E.view(f.get(), f.events, f.now()).etherExchange.used, 10);
  const committed = structuredClone(f.get());
  assert.equal(E.mutate(f.store, f.auth.token, inputs[9]).replay, true);
  assert.throws(() => action(f, "ether"), /10 обменов/);
  assert.deepEqual(f.get(), committed);
  const restored = new ProfileStore({ filePath, now: f.now });
  restored.events = f.events;
  restored.eventRankingReady = () => false;
  assert.throws(
    () => E.mutate(restored, f.auth.token, { ...inputs[9], requestId: randomUUID() }),
    /10 обменов/,
  );
  f.set(midnight - 1);
  assert.equal(E.view(restored.find(f.auth.token), f.events, f.now()).etherExchange.used, 10);
  f.set(midnight);
  assert.equal(E.view(restored.find(f.auth.token), f.events, f.now()).etherExchange.used, 0);
  E.mutate(restored, f.auth.token, { ...inputs[9], requestId: randomUUID() });
  assert.equal(restored.find(f.auth.token).easter.etherExchangeDays[day + 1], 1);
  assert.equal(restored.find(f.auth.token).wallet.bucks, original + 55);
  E.validate(restored.find(f.auth.token));
});
test("наборы четырёх цветов не тратят яйца и после первой степени нужен новый полный порог", () => {
  const f = fixture();
  collect(f, 12);
  assert.equal(f.get().easter.runs[f.run()].claimed.easter_colors, 1);
  collect(f, 8);
  assert.equal(f.get().easter.runs[f.run()].claimed.easter_colors, 1);
  assert.equal(
    E.achievementView(f.get(), f.events, f.now()).find((a) => a.id === "easter_colors").value,
    2,
  );
  collect(f, 12);
  assert.equal(f.get().easter.runs[f.run()].claimed.easter_colors, 2);
});
test("24 яйца сохраняются при отказе записи, повторе и восстановлении", (t) => {
  const file = path.join(temporary(t, "easter-save"), "profiles.json"),
    f = fixture(file),
    id = randomUUID(),
    batch = Array.from({ length: 24 }, (_, i) => ({
      type: "easterPickup",
      eggType: i % 4,
      runId: f.run(),
      profileId: f.get().id,
    })),
    before = structuredClone(f.get()),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => f.store.applyArenaProgress(id, batch, f.now()), /disk failure/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  f.store.applyArenaProgress(id, batch, f.now());
  f.store.applyArenaProgress(id, batch, f.now());
  const restored = new ProfileStore({ filePath: file, now: () => f.now() });
  assert.deepEqual(restored.find(f.auth.token).easter.runs[f.run()].eggs, [6, 6, 6, 6]);
});
test("обмен и открытие атомарны, не повторяются; награда запечатана до подготовки", () => {
  const f = fixture();
  collect(f);
  const input = { action: "exchange", runId: f.run(), requestId: randomUUID() },
    before = structuredClone(f.get()),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, input), /disk/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, input);
  assert.equal(E.mutate(f.store, f.auth.token, input).replay, true);
  assert.equal(f.get().easter.chests.length, 1);
  assert.equal(E.view(f.get(), f.events, f.now()).chests[0].reward, null);
  const chest = f.get().easter.chests[0],
    coin = f.get().wallet.coins,
    crystal = f.get().wallet.crystals,
    greatness = f.get().greatness;
  action(f, "prepare", { chestId: chest.id });
  assert.deepEqual(E.view(f.get(), f.events, f.now()).chests[0].reward.items, {
    easter_egg: 3,
  });
  const open = { action: "open", chestId: chest.id, requestId: randomUUID() };
  const prepared = structuredClone(f.get());
  f.store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, open), /disk/);
  assert.deepEqual(f.get(), prepared);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, open);
  assert.equal(E.mutate(f.store, f.auth.token, open).replay, true);
  assert.equal(f.get().wallet.coins, coin + chest.reward.coins);
  assert.equal(f.get().wallet.crystals, crystal + chest.reward.crystals);
  assert.equal(f.get().greatness, greatness + 5);
  assert.equal(f.get().inventory.easter_egg, 3);
  assert.equal(f.get().easter.chests.length, 0);
});
test("общая вместимость, очередь и сохранение после окончания; новый запуск без старого прогресса", () => {
  const f = fixture();
  collect(f, 2400);
  for (let i = 0; i < 60; i++) action(f, "exchange");
  for (let i = 0; i < 48; i++) openFragment(f, i);
  assert.equal(T.stored(f.get(), f.now()), 7);
  assert.equal(f.get().easter.chests.filter((c) => !c.stored).length, 5);
  assert.ok(f.store.view(f.get()).wardrobe.owned.includes("rabbit_ears"));
  const old = f.run();
  f.set(f.events.active().endsAt);
  f.store.refreshCompetition();
  const greatness = f.get().greatness;
  assert.equal(E.achievementView(f.get(), f.events, f.now()).length, 0);
  assert.throws(
    () =>
      E.mutate(f.store, f.auth.token, {
        action: "exchange",
        runId: old,
        requestId: randomUUID(),
      }),
    /завершён/,
  );
  const chest = f.get().easter.chests[0];
  E.mutate(f.store, f.auth.token, {
    action: "open",
    chestId: chest.id,
    requestId: randomUUID(),
  });
  assert.equal(T.stored(f.get(), f.now()), 6);
  assert.equal(
    f.get().easter.chests.length,
    6,
    "очередь сгорела; хранимые сундуки пережили окончание события",
  );
  assert.equal(f.get().greatness, greatness + 5);
  assert.equal(f.get().inventory.easter_egg, 147);
  f.events.apply("test", "start", {
    eventId: E.manifest.id,
    revision: f.events.data.revision,
    requestId: randomUUID(),
  });
  assert.notEqual(f.run(), old);
  assert.deepEqual(E.view(f.get(), f.events, f.now()).eggs, [0, 0, 0, 0]);
  collect(f, 1);
  assert.equal(f.get().greatness, greatness + 30);
  assert.equal(f.get().easter.trophies.length, 1);
});
test("игра учитывает только минуту внутри события, завершение и жизнь один раз", () => {
  const f = fixture();
  f.set(AT + 60000);
  const p = f.get();
  E.progress(p, f.events, { type: "lifeEnded", lifeId: "short", durationMs: 59999 }, f.now());
  assert.equal(p.easter, undefined);
  E.progress(p, f.events, { type: "lifeEnded", lifeId: "valid", durationMs: 60000 }, f.now());
  E.progress(p, f.events, { type: "lifeEnded", lifeId: "valid", durationMs: 60000 }, f.now());
  assert.equal(p.easter.runs[f.run()].games, 1);
  const ends = f.events.active().endsAt;
  E.progress(
    p,
    f.events,
    { type: "lifeEnded", lifeId: "outside", durationMs: 60000 },
    ends + 60000,
  );
  assert.equal(p.easter.runs[f.run()].games, 1);
});
test("пасхальный комплект нельзя получить подменой; награда остаётся после завершения", () => {
  const f = fixture(),
    input = {
      slot: "hat",
      accessoryId: "rabbit_ears",
      requestId: randomUUID(),
    };
  assert.throws(() => f.store.setAccessory(f.auth.token, input), /Сначала собери/);
  const bow = { slot: "bow", accessoryId: "carrot_bow", requestId: randomUUID() };
  assert.throws(() => f.store.setAccessory(f.auth.token, bow), /Сначала собери/);
  assert.throws(() => f.store.buy(f.auth.token, "easter_egg", randomUUID()), /за событие/);
  collect(f, 1920);
  for (let i = 0; i < 48; i++) action(f, "exchange");
  for (let i = 0; i < 48; i++) openFragment(f, i);
  f.set(f.events.active().endsAt);
  f.store.setAccessory(f.auth.token, input);
  f.store.setAccessory(f.auth.token, bow);
  assert.equal(f.get().outfit.hat, "rabbit_ears");
  assert.equal(f.get().outfit.bow, "carrot_bow");
  assert.equal(f.store.publicPlayer(f.get().id).easter.trophies.length, 1);
});

test("старые ушки сохраняются; завершение четырёх картин открывает бабочку и переживает восстановление", (t) => {
  const file = path.join(temporary(t, "easter-outfit"), "profiles.json"),
    f = fixture(file);
  collect(f, 40);
  const state = f.get().easter.runs[f.run()];
  state.fragmentCounts = Array.from({ length: 48 }, (_, i) => (i < 12 ? 1 : 0));
  state.fragments = 12;
  f.get().easter.trophies.push({ runId: f.run(), at: f.now() });
  f.store.refreshCompetition();
  let owned = f.store.view(f.get()).wardrobe.owned;
  assert.ok(owned.includes("rabbit_ears"));
  assert.ok(!owned.includes("carrot_bow"));
  action(f, "exchange");
  const current = f.get().easter.runs[f.run()];
  current.fragmentCounts = Array.from({ length: 48 }, (_, i) => (i < 47 ? 1 : 0));
  current.fragments = 47;
  openFragment(f, 47);
  assert.equal(f.get().easter.trophies.length, 1);
  assert.equal(f.get().easter.trophies[0].collectionVersion, 2);
  const restored = new ProfileStore({ filePath: file, now: () => f.now() });
  assert.ok(restored.view(restored.find(f.auth.token)).wardrobe.owned.includes("carrot_bow"));
});
test("срок: два календарных месяца, округление к полуночи, ранняя партия расходуется первой", () => {
  assert.equal(
    new Date(E.expiresAt(Date.UTC(2026, 0, 31, 12))).toISOString(),
    "2026-03-31T21:00:00.000Z",
  );
  assert.equal(
    new Date(E.expiresAt(Date.UTC(2026, 11, 30, 21))).toISOString(),
    "2027-02-27T21:00:00.000Z",
  );
  const f = fixture();
  collect(f, 80);
  action(f, "exchange");
  action(f, "exchange");
  for (const c of [...f.get().easter.chests]) action(f, "open", { chestId: c.id });
  const deadline = f.get().easter.batches[0].expiresAt;
  f.get().inventory.easter_egg = 2;
  f.get().easter.batches = [
    { count: 1, expiresAt: deadline + 86400000 },
    { count: 1, expiresAt: deadline },
  ];
  f.store.consume(f.auth.token, "easter_egg", randomUUID(), "easter-test", () => ({}));
  assert.deepEqual(f.get().easter.batches, [{ count: 1, expiresAt: deadline + 86400000 }]);
  f.get().quickSlots = ["easter_egg"];
  f.set(deadline + 86400000);
  f.store.refreshCompetition();
  assert.equal(f.get().inventory.easter_egg, 0);
  assert.equal(f.get().quickSlots[0], null);
  assert.throws(
    () => f.store.consume(f.auth.token, "easter_egg", randomUUID(), "expired", () => ({})),
    /нет в инвентаре/,
  );
});
test("бустер даёт каждой части пять порций по 50 на 2/4/6/8/10 секундах без дублей", () => {
  const a = new Arena({ etherCount: 0 }),
    p = a.addPlayer(0, "test");
  p.level = 121;
  p.protectedUntil = 0;
  a.gainMass(p, 1000 - p.mass);
  a.boosterEffects.split(p, a.mainBody(p), 2, 1000);
  const before = a.bodies(p).map((b) => b.mass);
  a.prepareBooster(p.id, { boosterId: "easter_egg", spawnSerial: p.spawnSerial }, 5000)();
  assert.throws(
    () => a.prepareBooster(p.id, { boosterId: "easter_egg", spawnSerial: p.spawnSerial }, 6000),
    /уже действует/,
  );
  a.boosterEffects.tick(p, 6000);
  assert.equal(p.mass, 1000);
  for (let portion = 1; portion <= 5; portion++) {
    const at = 5000 + portion * 2000;
    a.boosterEffects.tick(p, at - 1);
    assert.equal(p.mass, 1000 + (portion - 1) * 100);
    a.boosterEffects.tick(p, at);
    assert.deepEqual(
      a.bodies(p).map((b) => b.mass),
      before.map((m) => m + portion * 50),
    );
    a.boosterEffects.tick(p, at);
    assert.equal(p.mass, 1000 + portion * 100);
  }
  a.boosterEffects.tick(p, 16000);
  assert.equal(p.mass, 1500);
});
test("пасхальный рост учитывает деление, слияние, уничтожение части и новую жизнь", () => {
  const a = new Arena({ etherCount: 0 }),
    p = a.addPlayer(0, "growing");
  p.level = 121;
  p.protectedUntil = 0;
  a.gainMass(p, 1000 - p.mass);
  a.prepareBooster(p.id, { boosterId: "easter_egg", spawnSerial: p.spawnSerial }, 0)();
  a.boosterEffects.tick(p, 2000);
  assert.equal(p.mass, 1050);
  a.boosterEffects.split(p, a.mainBody(p), 2, 2100);
  a.boosterEffects.tick(p, 4000);
  assert.deepEqual(
    a.bodies(p).map((b) => b.mass),
    [575, 575],
  );
  for (const part of p.parts)
    Object.assign(part, { x: 2000, y: 1500, mergeAt: 4100, vx: 0, vy: 0 });
  p.mergeAt = 4100;
  a.moveParts(p, 4100, 0);
  assert.equal(a.bodies(p).length, 1);
  a.boosterEffects.tick(p, 6000);
  assert.equal(p.mass, 1200);
  a.boosterEffects.split(p, a.mainBody(p), 3, 6100);
  const removed = p.parts[2];
  removed.mass = 50;
  a.syncParts(p);
  a.boosterEffects.burn(p, removed, 6200);
  assert.equal(a.bodies(p).length, 2);
  const before = a.bodies(p).map((b) => b.mass);
  a.boosterEffects.tick(p, 8000);
  assert.deepEqual(
    a.bodies(p).map((b) => b.mass),
    before.map((m) => m + 50),
  );
  assert.equal(removed.mass, 50);
  a.resetPlayer(p, 8500);
  const spawnedMass = p.mass;
  a.boosterEffects.tick(p, 20000);
  assert.equal(p.mass, spawnedMass);
});
test("пасхальный рост всех 16 частей соблюдает отдельный предел и не передаёт излишек", () => {
  const { massLimitForLevel } = require("../../src/server/arena/arena-simulation");
  const a = new Arena({ etherCount: 0 }),
    p = a.addPlayer(0, "full-split");
  p.level = 121;
  p.protectedUntil = 0;
  a.gainMass(p, 1600 - p.mass);
  a.boosterEffects.split(p, a.mainBody(p), 16, 0);
  assert.equal(p.parts.length, 16);
  const limit = massLimitForLevel(p.level);
  a.gainMass(p, limit - p.parts[0].mass - 50, p.parts[0]);
  const before = p.parts.map((b) => b.mass);
  a.prepareBooster(p.id, { boosterId: "easter_egg", spawnSerial: p.spawnSerial }, 0)();
  a.boosterEffects.tick(p, 1000);
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    before,
  );
  a.boosterEffects.tick(p, 2000);
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    before.map((m) => Math.min(limit, m + 50)),
  );
  const firstMass = p.mass;
  a.boosterEffects.tick(p, 2000);
  assert.equal(p.mass, firstMass);
  a.boosterEffects.tick(p, 12000);
  assert.deepEqual(
    p.parts.map((b) => b.mass),
    before.map((m) => Math.min(limit, m + 250)),
  );
});
test("счётчик жизни отделён от запаса, сбрасывается при входе, переживает повтор и отказ записи", (t) => {
  const file = path.join(temporary(t, "easter-life-eggs"), "profiles.json"),
    f = fixture(file);
  collect(f, 56);
  f.store.startLife(f.get().id, "life-one");
  assert.deepEqual(E.view(f.get(), f.events, f.now()).lifeEggs, [0, 0, 0, 0]);
  collect(f, 4);
  const before = structuredClone(f.get()),
    save = f.store.save;
  const batch = [
    {
      type: "easterPickup",
      profileId: f.get().id,
      lifeId: "life-one",
      runId: f.run(),
      eggType: 2,
    },
  ];
  f.store.save = () => {
    throw Error("disk");
  };
  assert.throws(() => f.store.applyArenaProgress("pickup-life", batch, f.now()), /disk/);
  assert.deepEqual(f.get(), before);
  f.store.save = save;
  f.store.applyArenaProgress("pickup-life", batch, f.now());
  f.store.applyArenaProgress("pickup-life", batch, f.now());
  assert.deepEqual(E.view(f.get(), f.events, f.now()).lifeEggs, [1, 1, 2, 1]);
  const restored = new ProfileStore({ filePath: file, now: f.now });
  assert.deepEqual(E.view(restored.find(f.auth.token), f.events, f.now()).lifeEggs, [1, 1, 2, 1]);
  f.store.applyArenaProgress(
    "ended",
    [
      {
        type: "lifeEnded",
        profileId: f.get().id,
        lifeId: "life-one",
        durationSeconds: 60,
      },
    ],
    f.now(),
  );
  action(f, "exchange");
  assert.deepEqual(E.view(f.get(), f.events, f.now()).lifeEggs, [1, 1, 2, 1]);
  f.store.startLife(f.get().id, "life-two");
  assert.deepEqual(E.view(f.get(), f.events, f.now()).lifeEggs, [0, 0, 0, 0]);
  assert.deepEqual(E.view(f.get(), f.events, f.now()).eggs, [5, 5, 6, 5]);
});

test("Золотая коллекция: по 250 за каждую картину в любом порядке, четыре новые степени", () => {
  const f = fixture();
  collect(f, 1920);
  for (let i = 0; i < 48; i++) action(f, "exchange");
  let degree = 0;
  for (const collection of [2, 0, 3, 1]) {
    for (let part = 0; part < 12; part++) {
      const before = f.get().greatness;
      openFragment(f, collection * 12 + part);
      assert.equal(f.get().greatness - before, part === 11 ? 255 : 5);
      assert.equal(
        f.get().easter.runs[f.run()].claimed.easter_collection || 0,
        degree + (part === 11 ? 1 : 0),
      );
    }
    degree++;
  }
  assert.equal(f.get().easter.trophies.length, 1);
  assert.deepEqual(
    E.achievementView(f.get(), f.events, f.now()).find((d) => d.id === "easter_collection").rewards,
    [250, 250, 250, 250],
  );
});

test("новые степени для старой коллекции: прежние 500 сохраняются, доплата однократная", () => {
  const f = fixture();
  collect(f, 40);
  const p = f.get(),
    s = p.easter.runs[f.run()];
  s.fragmentCounts = Array(48).fill(1);
  s.fragments = 48;
  s.claimed.easter_collection = 1;
  s.stageSpent.easter_collection = 1;
  p.greatness = 500;
  const before = structuredClone(p),
    next = E.capture(p, f.now());
  assert.deepEqual(p, before);
  assert.equal(next.greatness, 1250);
  assert.equal(next.easter.runs[f.run()].claimed.easter_collection, 4);
  E.validate(next);
  assert.equal(E.capture(next, f.now()), next);
});

test("обмен лишнего фрагмента: только готовая картина, десять яиц, сохранение картины и повтор запроса", (t) => {
  const filePath = path.join(temporary(t, "fragment-exchange"), "profiles.json"),
    f = fixture(filePath);
  collect(f, 600);
  for (let i = 0; i < 15; i++) action(f, "exchange");
  for (let i = 0; i < 11; i++) openFragment(f, i);
  openFragment(f, 0);
  const input = {
    action: "fragments",
    runId: f.run(),
    collectionId: "golden-egg",
    requestId: randomUUID(),
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, input), /все 12/);
  openFragment(f, 11);
  openFragment(f, 0);
  const before = structuredClone(f.get());
  const response = E.mutate(f.store, f.auth.token, input);
  assert.equal(response.replay, false);
  let s = f.get().easter.runs[f.run()];
  assert.equal(
    s.eggs.reduce((a, b) => a + b, 0),
    before.easter.runs[f.run()].eggs.reduce((a, b) => a + b, 0) + 10,
  );
  assert.equal(
    s.exchangedEggs.reduce((a, b) => a + b, 0),
    10,
  );
  assert.deepEqual(s.found, before.easter.runs[f.run()].found);
  assert.equal(s.fragmentCounts[0], 2);
  assert.equal(s.fragments, 12);
  assert.equal(E.album(f.get()).length, 1);
  assert.equal(f.get().greatness, before.greatness);
  const after = structuredClone(f.get());
  assert.equal(E.mutate(f.store, f.auth.token, input).replay, true);
  assert.deepEqual(f.get(), after);
  assert.throws(
    () => E.mutate(f.store, f.auth.token, { ...input, collectionId: "spring-basket" }),
    /номер уже/,
  );
  assert.throws(
    () =>
      E.mutate(f.store, f.auth.token, {
        ...input,
        collectionId: "unknown",
        requestId: randomUUID(),
      }),
    /Неверная/,
  );
  assert.throws(
    () =>
      E.mutate(f.store, f.auth.token, {
        ...input,
        collectionId: "spring-basket",
        requestId: randomUUID(),
      }),
    /все 12/,
  );
  const nextInput = { ...input, requestId: randomUUID() },
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk failure");
  };
  assert.throws(() => E.mutate(f.store, f.auth.token, nextInput), /disk failure/);
  assert.deepEqual(f.get(), after);
  f.store.save = save;
  E.mutate(f.store, f.auth.token, nextInput);
  s = f.get().easter.runs[f.run()];
  assert.equal(s.fragmentCounts[0], 1);
  assert.equal(
    s.exchangedEggs.reduce((a, b) => a + b, 0),
    20,
  );
  assert.throws(
    () => E.mutate(f.store, f.auth.token, { ...input, requestId: randomUUID() }),
    /нет лишних/,
  );
  const restored = new ProfileStore({ filePath, now: f.now });
  assert.deepEqual(restored.find(f.auth.token).easter, f.get().easter);
  openFragment(f, 0);
  f.set(f.events.active().endsAt);
  assert.throws(
    () => E.mutate(f.store, f.auth.token, { ...input, requestId: randomUUID() }),
    /завершён/,
  );
});

test("все повторы одной картины: сохранение оригиналов, другой картины, статистики и восстановление", (t) => {
  const filePath = path.join(temporary(t, "all-fragments"), "profiles.json"),
    f = fixture(filePath);
  collect(f, 1000);
  for (let i = 0; i < 25; i++) action(f, "exchange");
  for (let i = 0; i < 24; i++) openFragment(f, i);
  openFragment(f, 0);
  const s = f.get().easter.runs[f.run()];
  s.fragmentCounts[0] = 8;
  s.fragmentCounts[5] = 4;
  s.fragmentCounts[12] = 6;
  const before = structuredClone(f.get()),
    input = {
      action: "fragments-all",
      runId: f.run(),
      collectionId: "golden-egg",
      requestId: randomUUID(),
    };
  E.mutate(f.store, f.auth.token, input);
  const after = f.get(),
    a = after.easter.runs[f.run()];
  assert.deepEqual(a.fragmentCounts.slice(0, 12), Array(12).fill(1));
  assert.deepEqual(
    a.fragmentCounts.slice(12),
    before.easter.runs[f.run()].fragmentCounts.slice(12),
  );
  assert.equal(
    a.eggs.reduce((x, y) => x + y, 0),
    100,
  );
  assert.equal(
    a.exchangedEggs.reduce((x, y) => x + y, 0),
    100,
  );
  for (const field of ["found", "dailyFound", "life", "fragments", "claimed"])
    assert.deepEqual(a[field], before.easter.runs[f.run()][field], field);
  assert.deepEqual(E.album(after), E.album(before));
  assert.equal(after.greatness, before.greatness);
  assert.equal(E.mutate(f.store, f.auth.token, input).replay, true);
  assert.deepEqual(f.get(), after);
  const restored = new ProfileStore({ filePath, now: f.now });
  restored.events = f.events;
  assert.equal(E.mutate(restored, f.auth.token, input).replay, true);
  assert.deepEqual(restored.find(f.auth.token).easter, after.easter);
  assert.throws(
    () => E.mutate(f.store, f.auth.token, { ...input, requestId: randomUUID() }),
    /нет лишних/,
  );
  assert.throws(
    () => E.mutate(f.store, f.auth.token, { ...input, action: "fragments" }),
    /номер уже/,
  );
});

test("массовый обмен не допускает переполнение и не меняет коллекцию при отказе", () => {
  const f = fixture();
  collect(f, 4);
  const s = f.get().easter.runs[f.run()];
  s.fragments = 12;
  s.fragmentCounts = Array.from({ length: 48 }, (_, i) =>
    i === 0 ? Number.MAX_SAFE_INTEGER : i < 12 ? 1 : 0,
  );
  f.store.refreshCompetition();
  const before = structuredClone(f.get()),
    input = {
      action: "fragments-all",
      runId: f.run(),
      collectionId: "golden-egg",
      requestId: randomUUID(),
    };
  assert.throws(() => E.mutate(f.store, f.auth.token, input), /предел/);
  assert.deepEqual(f.get(), before);
});

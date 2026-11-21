"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { ClanService } = require("../../src/server/clans/clan-service"),
  { xpForLevel } = require("../../src/server/progression/experience-progression"),
  { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation"),
  appearance = require("../../src/server/profiles/league-appearance"),
  { temporary } = require("../temp");
function setup(filePath) {
  let now = Date.parse("2026-10-21T12:00:00Z");
  const store = new ProfileStore({ filePath, now: () => now }),
    clans = new ClanService(store);
  const user = () => {
    const u = store.open(),
      p = store.find(u.token);
    p.level = 12;
    p.progress.xp = xpForLevel(12);
    p.wallet.coins = 10000;
    p.wallet.crystals = 100; // Explicit fixture funding for crest edits.
    return u;
  };
  const act = (u, action, extra = {}) =>
    clans.mutate(u.token, { action, requestId: randomUUID(), ...extra });
  const head = user();
  act(head, "create", { name: "Оформление", prefix: "ART", emblem: "astral", privacy: "open" });
  const clanId = store.find(head.token).clanId;
  for (let i = 0; i < 9; i++)
    act(user(), "create", {
      name: "Соперник " + i,
      prefix: "O" + i,
      emblem: "astral",
      privacy: "open",
    });
  return {
    store,
    clans,
    head,
    clanId,
    user,
    act,
    now: () => now,
    time: (at) => {
      now = at;
    },
    choose: (u, slot, themeId, requestId = randomUUID()) =>
      store.setAppearance(u.token, { slot, themeId, requestId }),
    view: (u) => store.view(store.find(u.token)).appearance,
  };
}
function medal(f, rank, kills = 2000000) {
  const next = structuredClone(f.store.data),
    w = next.competition.week;
  next.clans[f.clanId].competition.league = rank;
  w.groups = [{ id: "appearance-test", league: rank, clans: Object.keys(next.clans) }];
  w.scores[f.clanId] = { kills, members: {} };
  f.store.save(next);
  f.time(w.end);
  f.store.refreshCompetition();
}

test("Персональный доступ открывает оформление по ID, сохраняет выбор и не выдаёт бонусы аккаунтов", (t) => {
  const filePath = path.join(temporary(t, "personal-appearance"), "profiles.json"),
    f = setup(filePath),
    catalog = require("../../public/shared/league-appearance"),
    overrides = require("../../config/appearance-testing.json"),
    p = f.store.find(f.head.token),
    outsider = f.user(),
    other = f.store.find(outsider.token);
  other.name = "Killex";
  const initial = structuredClone(p);
  overrides.allPersonalAppearanceProfileIds.push(p.id);
  t.after(() =>
    overrides.allPersonalAppearanceProfileIds.splice(
      overrides.allPersonalAppearanceProfileIds.indexOf(p.id),
      1,
    ),
  );
  for (const theme of catalog.themes) {
    assert.equal(f.view(f.head).availableUntil[theme.id], null);
    const requestId = randomUUID();
    f.choose(f.head, "set", theme.id, requestId);
    assert.equal(f.choose(f.head, "set", theme.id, requestId).replay, true);
    for (const slot of catalog.slots) assert.equal(f.view(f.head)[slot], theme.id);
    assert.throws(() => f.choose(outsider, "set", theme.id), /недоступно/);
  }
  for (const { id } of catalog.accountFrames) {
    assert.equal(f.view(f.head).unlocked.includes(id), false);
    assert.throws(() => f.choose(f.head, "frames", id), /недоступно/);
  }
  for (const key of ["wallet", "account", "inventory", "progress", "honors"])
    assert.deepEqual(f.store.find(f.head.token)[key], initial[key]);
  const restarted = new ProfileStore({ filePath, now: () => f.now() + 365 * 86400000 });
  restarted.open(f.head.token);
  const current = restarted.view(restarted.find(f.head.token)).appearance;
  assert.equal(current.uiTheme, "champions");
  assert.equal(current.avatarFrame, "champions");
  assert.deepEqual(f.view(outsider).unlocked, ["default"]);
});
test("Медаль: 30 дней всем участникам, независимый выбор, повтор запроса, срок не продлевается при входе", (t) => {
  const filePath = path.join(temporary(t, "league-appearance"), "profiles.json"),
    f = setup(filePath);
  const member = f.user(),
    outsider = f.user();
  f.act(member, "apply", { clanId: f.clanId });
  assert.deepEqual(f.view(f.head).unlocked, ["default"]);
  assert.throws(() => f.choose(f.head, "avatarFrame", "silver"), /недоступно/);
  const wallet = structuredClone(f.store.find(member.token).wallet);
  medal(f, 1);
  const until = f.now() + appearance.MONTH;
  assert.equal(f.store.data.clans[f.clanId].competition.league, 2);
  assert.equal(f.view(f.head).unlocked.includes("gold"), false);
  for (const u of [f.head, member]) assert.equal(f.view(u).availableUntil.silver, until);
  assert.equal(f.view(outsider).unlocked.includes("silver"), false);
  const id = randomUUID();
  f.choose(member, "avatarFrame", "silver", id);
  assert.equal(f.choose(member, "avatarFrame", "silver", id).replay, true);
  f.choose(member, "lobbyBackground", "silver");
  assert.equal(f.view(member).avatarFrame, "silver");
  assert.equal(f.view(member).profileBackground, "default");
  assert.deepEqual(f.store.find(member.token).wallet, wallet);
  f.act(outsider, "apply", { clanId: f.clanId });
  assert.equal(f.view(outsider).unlocked.includes("silver"), false);
  f.act(member, "leave", { clanId: f.clanId });
  assert.equal(f.view(member).avatarFrame, "silver");
  assert.equal(f.view(member).lobbyBackground, "silver");
  f.time(until - 1);
  f.store.open(member.token);
  assert.equal(f.view(member).availableUntil.silver, until);
  const disk = new ProfileStore({ filePath, now: f.now });
  assert.equal(disk.view(disk.find(member.token)).appearance.availableUntil.silver, until);
  f.time(until);
  assert.equal(f.view(member).avatarFrame, "default");
  assert.equal(f.store.publicPlayer(member.profile.id).appearance.avatarFrame, "default");
  assert.throws(() => f.choose(member, "avatarFrame", "silver"), /недоступно/);
});
test("Чемпионское выдаётся за медаль и остаётся после выхода, смены сезона и перезапуска", (t) => {
  const filePath = path.join(temporary(t, "champion-appearance"), "profiles.json"),
    f = setup(filePath);
  medal(f, 4);
  assert.equal(f.store.data.clans[f.clanId].competition.league, 5);
  assert.equal(f.view(f.head).unlocked.includes("champions"), false);
  medal(f, 5, 1);
  assert.equal(f.view(f.head).availableUntil.champions, null);
  f.choose(f.head, "profileBackground", "champions");
  f.act(f.head, "disband", { clanId: f.clanId });
  f.time(Date.parse("2030-01-01T00:00:00Z"));
  f.store.open(f.head.token);
  const disk = new ProfileStore({ filePath, now: f.now });
  assert.equal(disk.view(disk.find(f.head.token)).appearance.profileBackground, "champions");
  assert.equal(disk.view(disk.find(f.head.token)).appearance.availableUntil.champions, null);
});
test("Срок после простоя идёт от итога недели; повторная медаль обновляет срок только этой лиги", () => {
  const f = setup();
  medal(f, 1);
  const first = f.view(f.head).availableUntil.silver;
  medal(f, 2);
  assert.equal(f.view(f.head).availableUntil.silver, first);
  medal(f, 1);
  assert.ok(f.view(f.head).availableUntil.silver > first);
  const next = structuredClone(f.store.data),
    w = next.competition.week;
  next.clans[f.clanId].competition.league = 2;
  w.groups = [{ id: "appearance-offline", league: 2, clans: Object.keys(next.clans) }];
  w.scores[f.clanId] = { kills: 2000000, members: {} };
  f.store.save(next);
  f.time(w.end + appearance.MONTH + 1);
  f.store.refreshCompetition();
  assert.equal(f.store.find(f.head.token).appearance.grants.gold, w.end + appearance.MONTH);
  assert.equal(f.view(f.head).unlocked.includes("gold"), false);
});
test("Совместимость сохранений, повреждение данных, отказ записи и запрещённые поля", (t) => {
  const filePath = path.join(temporary(t, "appearance-migration"), "profiles.json"),
    f = setup();
  f.store.data.clans[f.clanId].competition.league = 2;
  const original = structuredClone(f.store.find(f.head.token));
  delete f.store.find(f.head.token).appearance;
  fs.writeFileSync(filePath, JSON.stringify(f.store.data));
  const disk = new ProfileStore({ filePath, now: f.now });
  assert.equal(disk.view(disk.find(f.head.token)).appearance.availableUntil.gold, undefined);
  for (const key of ["wallet", "honors", "progress", "inventory"])
    assert.deepEqual(disk.find(f.head.token)[key], original[key]);
  disk.open(f.head.token); // Первая загрузка фиксирует миграцию до ответа игроку.
  assert.ok(
    JSON.parse(fs.readFileSync(filePath, "utf8")).profiles[Object.keys(disk.data.profiles)[0]]
      .appearance,
  );
  const restarted = new ProfileStore({ filePath, now: () => f.now() + 1000 });
  assert.equal(restarted.find(f.head.token).appearance.grants.gold, undefined);
  for (const input of [
    { slot: "__proto__", themeId: "bronze" },
    { slot: "avatarFrame", themeId: "../x" },
  ])
    assert.throws(
      () => disk.setAppearance(f.head.token, { ...input, requestId: randomUUID() }),
      /доступное/,
    );
  appearance.grant(disk.find(f.head.token), 2, f.now());
  disk.save(disk.data);
  const before = structuredClone(disk.find(f.head.token)),
    save = disk.save;
  disk.save = () => {
    throw Error("disk full");
  };
  assert.throws(
    () =>
      disk.setAppearance(f.head.token, {
        slot: "avatarFrame",
        themeId: "gold",
        requestId: randomUUID(),
      }),
    /disk full/,
  );
  assert.deepEqual(disk.find(f.head.token), before);
  disk.save = save;
  disk.find(f.head.token).appearance.grants.champions = 42;
  fs.writeFileSync(filePath, JSON.stringify(disk.data));
  assert.throws(() => new ProfileStore({ filePath }), /оформление/);
});
test("HTTP: нельзя выдать себе лигу, изменить чужой профиль или переодеться на арене", async (t) => {
  const f = setup(),
    other = f.user();
  medal(f, 0, 1);
  const app = createGameServer({
    profiles: f.store,
    clans: f.clans,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    wallNow: f.now,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port,
    cookie = "sferorumiya_session=" + f.head.token,
    post = (body) =>
      fetch(url + "/api/profile/appearance", {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: randomUUID(), ...body }),
      });
  assert.equal(
    (await post({ slot: "avatarFrame", themeId: "champions", grants: { champions: null } })).status,
    403,
  );
  assert.equal(
    (await post({ slot: "avatarFrame", themeId: "bronze", profileId: other.profile.id })).status,
    200,
  );
  assert.equal(f.view(other).avatarFrame, "default");
  assert.equal(
    (
      await fetch(url + "/api/profile/appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slot: "avatarFrame", themeId: "bronze", requestId: randomUUID() }),
      })
    ).status,
    401,
  );
  const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie } });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("message", (raw) => {
      if (JSON.parse(raw).type === "state") resolve();
    });
  });
  assert.equal((await post({ slot: "avatarFrame", themeId: "default" })).status, 409);
  assert.equal((await post({ slot: "set", themeId: "bronze" })).status, 409);
});

test("Набор лиги: тема интерфейса, фоны и рамки сохраняются атомарно, повторы и отдельная замена безопасны", (t) => {
  const filePath = path.join(temporary(t, "appearance-set"), "profiles.json"),
    f = setup(filePath),
    slots = require("../../public/shared/league-appearance").slots;
  assert.throws(() => f.choose(f.head, "set", "silver"), /недоступно/);
  appearance.grant(f.store.find(f.head.token), 0, f.now());
  medal(f, 1);
  const before = structuredClone(f.store.find(f.head.token)),
    requestId = randomUUID();
  f.choose(f.head, "set", "silver", requestId);
  for (const slot of slots) assert.equal(f.view(f.head)[slot], "silver");
  assert.equal(f.choose(f.head, "set", "silver", requestId).replay, true);
  assert.throws(() => f.choose(f.head, "set", "bronze", requestId), /операц|запрос/);
  f.choose(f.head, "arenaFrame", "bronze");
  for (const slot of slots)
    assert.equal(f.view(f.head)[slot], slot === "arenaFrame" ? "bronze" : "silver");
  f.choose(f.head, "set", "silver", requestId);
  assert.equal(f.view(f.head).arenaFrame, "bronze");
  const committed = structuredClone(f.store.find(f.head.token)),
    save = f.store.save;
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => f.choose(f.head, "set", "bronze"), /disk full/);
  assert.deepEqual(f.store.find(f.head.token), committed);
  f.store.save = save;
  const disk = new ProfileStore({ filePath, now: f.now });
  assert.deepEqual(disk.find(f.head.token).appearance, committed.appearance);
  for (const field of ["wallet", "inventory", "honors", "greatness", "progress", "account"])
    assert.deepEqual(committed[field], before[field]);
  assert.deepEqual(committed.appearance.grants, before.appearance.grants);
  f.time(f.view(f.head).availableUntil.silver);
  assert.equal(f.view(f.head).lobbyBackground, "default");
  assert.equal(f.view(f.head).avatarFrame, "default");
  assert.equal(f.view(f.head).profileBackground, "default");
  assert.equal(f.view(f.head).uiTheme, "default");
  assert.equal(f.view(f.head).arenaFrame, "default");
  f.choose(f.head, "set", "default");
  for (const slot of slots) assert.equal(f.view(f.head)[slot], "default");
});

test("Набор не обходит доступ к отдельным элементам, не принимает VIP вместо лиги и не выдаёт наград", () => {
  const store = new ProfileStore({ unlockLeagueBackgrounds: true }),
    user = store.open();
  const choose = (themeId) =>
    store.setAppearance(user.token, { slot: "set", themeId, requestId: randomUUID() });
  const before = structuredClone(store.find(user.token));
  assert.throws(() => choose("gold"), /недоступно/);
  assert.deepEqual(store.find(user.token), before);
  store.unlockLeagueBackgrounds = false;
  store.unlockLeagueFrames = true;
  assert.throws(() => choose("gold"), /недоступно/);
  store.unlockLeagueBackgrounds = true;
  for (const id of ["vip", "premium", "__proto__", "missing"])
    assert.throws(() => choose(id), /оформление/);
  choose("champions");
  const changed = store.find(user.token);
  for (const slot of require("../../public/shared/league-appearance").slots)
    assert.equal(changed.appearance[slot], "champions");
  assert.deepEqual(changed.appearance.grants, {});
  for (const field of ["wallet", "inventory", "honors", "greatness", "progress", "account"])
    assert.deepEqual(changed[field], before[field]);
});

test("Тестовые фоны доступны без лиги; отключение не выдаёт вечные награды и не открывает рамки", (t) => {
  const filePath = path.join(temporary(t, "test-backgrounds"), "profiles.json"),
    now = Date.now(),
    store = new ProfileStore({ filePath, now: () => now, unlockLeagueBackgrounds: true }),
    user = store.open(),
    before = structuredClone(store.find(user.token));
  for (const theme of require("../../public/shared/league-appearance").themes) {
    for (const slot of ["lobbyBackground", "profileBackground"])
      store.setAppearance(user.token, { slot, themeId: theme.id, requestId: randomUUID() });
    for (const slot of ["avatarFrame", "arenaFrame"])
      assert.throws(
        () =>
          store.setAppearance(user.token, {
            slot,
            themeId: theme.id,
            requestId: randomUUID(),
            testBackgrounds: true,
            testFrames: true,
          }),
        /недоступно/,
      );
  }
  assert.equal(store.publicPlayer(user.profile.id).appearance.profileBackground, "champions");
  assert.equal(store.view(store.find(user.token)).appearance.testBackgrounds, true);
  assert.deepEqual(store.find(user.token).appearance.grants, {});
  for (const key of ["wallet", "honors", "inventory", "greatness", "progress"])
    assert.deepEqual(store.find(user.token)[key], before[key]);
  const disk = new ProfileStore({ filePath, now: () => now });
  assert.equal(disk.publicPlayer(user.profile.id).appearance.profileBackground, "default");
  assert.equal(disk.view(disk.find(user.token)).appearance.testBackgrounds, false);
  assert.deepEqual(disk.find(user.token).appearance.grants, {});
});

test("Тестовые рамки доступны без клана, сохраняются и отключаются без изменения наград", (t) => {
  const filePath = path.join(temporary(t, "test-frames"), "profiles.json");
  let now = Date.now();
  const options = { filePath, now: () => now, unlockLeagueFrames: true };
  const store = new ProfileStore(options),
    user = store.open();
  // Реальная награда остаётся с прежним сроком даже в тестовом режиме.
  appearance.grant(store.find(user.token), 1, now);
  store.save(store.data);
  const before = structuredClone(store.find(user.token));
  for (const theme of require("../../public/shared/league-appearance").themes) {
    for (const slot of ["avatarFrame", "arenaFrame"]) {
      const input = { slot, themeId: theme.id, requestId: randomUUID() };
      store.setAppearance(user.token, input);
      const revision = store.find(user.token).revision;
      store.setAppearance(user.token, input);
      assert.equal(store.find(user.token).revision, revision);
      assert.equal(store.identity(store.find(user.token)).appearance[slot], theme.id);
    }
  }
  assert.equal(store.view(store.find(user.token)).appearance.testFrames, true);
  assert.equal(store.view(store.find(user.token)).appearance.testBackgrounds, false);
  for (const slot of ["lobbyBackground", "profileBackground"])
    assert.throws(
      () =>
        store.setAppearance(user.token, {
          slot,
          themeId: "gold",
          requestId: randomUUID(),
          testFrames: true,
        }),
      /недоступно/,
    );
  for (const key of ["wallet", "honors", "inventory", "greatness", "progress", "account", "clanId"])
    assert.deepEqual(store.find(user.token)[key], before[key]);
  assert.deepEqual(store.find(user.token).appearance.grants, before.appearance.grants);
  now += appearance.MONTH + 1;
  const restarted = new ProfileStore(options);
  for (const slot of ["avatarFrame", "arenaFrame"])
    assert.equal(restarted.identity(restarted.find(user.token)).appearance[slot], "champions");
  const disabled = new ProfileStore({ filePath, now: () => now, unlockLeagueBackgrounds: true });
  for (const slot of ["avatarFrame", "arenaFrame"])
    assert.equal(disabled.identity(disabled.find(user.token)).appearance[slot], "default");
  assert.equal(disabled.view(disabled.find(user.token)).appearance.testFrames, false);
  assert.equal(disabled.view(disabled.find(user.token)).appearance.testBackgrounds, true);
  assert.deepEqual(disabled.find(user.token).appearance.grants, before.appearance.grants);
  assert.throws(
    () =>
      disabled.setAppearance(user.token, {
        slot: "arenaFrame",
        themeId: "champions",
        requestId: randomUUID(),
        testFrames: true,
      }),
    /недоступно/,
  );
});

test("Рамка арены передаётся всем игрокам, выбирается независимо и снимается по серверному сроку", async (t) => {
  let wall = Date.now();
  const store = new ProfileStore({ now: () => wall }),
    own = store.open(),
    other = store.open();
  appearance.grant(store.find(own.token), 1, wall - appearance.MONTH + 5000);
  store.setAppearance(own.token, {
    slot: "arenaFrame",
    themeId: "silver",
    requestId: randomUUID(),
  });
  assert.equal(store.view(store.find(own.token)).appearance.avatarFrame, "default");
  const app = createGameServer({
    profiles: store,
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => 5000,
    wallNow: () => wall,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "ws://127.0.0.1:" + app.httpServer.address().port;
  const connect = async (user) => {
    const ws = new WebSocket(url, { headers: { Cookie: "sferorumiya_session=" + user.token } });
    t.after(() => ws.terminate());
    return new Promise((resolve, reject) => {
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "state") resolve(m);
      });
    });
  };
  const first = await connect(own),
    second = await connect(other);
  const ownId = first.players[0].id;
  assert.equal(first.players.find((p) => p.id === ownId).arenaFrame, "silver");
  assert.equal(second.players.find((p) => p.id === ownId).arenaFrame, "silver");
  const radius = app.arena.players.get(ownId).radius;
  wall += 5001;
  app.tick();
  assert.equal(app.arena.snapshot(5000).players.find((p) => p.id === ownId).arenaFrame, "default");
  assert.equal(app.arena.players.get(ownId).radius, radius);
});

test("Рамки аккаунтов: независимый выбор, срок, запрет фонов и отсутствие обхода через тестовый доступ", (t) => {
  let now = Date.now();
  const filePath = path.join(temporary(t, "account-frames"), "profiles.json");
  const store = new ProfileStore({ filePath, now: () => now }),
    user = store.open();
  const choose = (slot, themeId) =>
    store.setAppearance(user.token, { slot, themeId, requestId: randomUUID() });
  for (const id of ["vip", "premium"])
    for (const slot of ["avatarFrame", "arenaFrame"])
      assert.throws(() => choose(slot, id), /недоступно/);
  store.find(user.token).account = require("../../src/server/accounts/account-benefits").fresh();
  store.find(user.token).account.vipUntil = now + 1000;
  store.find(user.token).account.premiumUntil = now + 2000;
  choose("avatarFrame", "vip");
  choose("arenaFrame", "premium");
  const before = structuredClone(store.find(user.token));
  assert.equal(store.publicPlayer(user.profile.id).appearance.avatarFrame, "vip");
  assert.equal(store.identity(store.find(user.token)).appearance.arenaFrame, "premium");
  const restarted = new ProfileStore({ filePath, now: () => now });
  assert.equal(restarted.identity(restarted.find(user.token)).appearance.avatarFrame, "vip");
  for (const id of ["vip", "premium"])
    for (const slot of ["lobbyBackground", "profileBackground"])
      assert.throws(() => choose(slot, id), /доступное/);
  now += 1001;
  assert.equal(store.identity(store.find(user.token)).appearance.avatarFrame, "default");
  assert.equal(store.identity(store.find(user.token)).appearance.arenaFrame, "premium");
  now += 1000;
  assert.equal(store.identity(store.find(user.token)).appearance.arenaFrame, "default");
  const testing = new ProfileStore({
    filePath,
    now: () => now,
    unlockLeagueFrames: true,
    unlockLeagueBackgrounds: true,
  });
  for (const id of ["vip", "premium"])
    for (const slot of ["avatarFrame", "arenaFrame"])
      assert.throws(
        () => testing.setAppearance(user.token, { slot, themeId: id, requestId: randomUUID() }),
        /недоступно/,
      );
  assert.deepEqual(testing.find(user.token).account, before.account);
  assert.deepEqual(testing.find(user.token).appearance.grants, before.appearance.grants);
  for (const slot of ["lobbyBackground", "profileBackground"])
    assert.throws(
      () => testing.setAppearance(user.token, { slot, themeId: "vip", requestId: randomUUID() }),
      /доступное/,
    );
  const normal = new ProfileStore({ filePath, now: () => now });
  assert.equal(normal.identity(normal.find(user.token)).appearance.avatarFrame, "default");
  assert.equal(normal.identity(normal.find(user.token)).appearance.arenaFrame, "default");
});

test("Фон клана: медаль даёт 30 дней, меняет только глава, повторы и истечение безопасны", (t) => {
  const filePath = path.join(temporary(t, "clan-background"), "profiles.json"),
    f = setup(filePath);
  const member = f.user();
  f.act(member, "apply", { clanId: f.clanId });
  f.act(f.head, "role", { clanId: f.clanId, memberId: member.profile.id, role: "manager" });
  const choose = (user, themeId, requestId = randomUUID()) =>
    f.clans.mutate(user.token, { action: "background", clanId: f.clanId, themeId, requestId });
  assert.throws(() => choose(f.head, "bronze"), /недоступен/);
  medal(f, 0);
  choose(f.head, "bronze");
  assert.throws(() => choose(f.head, "silver"), /недоступен/);
  assert.throws(() => choose(member, "bronze"), /только главе/);
  medal(f, 1);
  const until = f.now() + appearance.MONTH;
  assert.equal(
    f.clans.publicClan(f.store.data.clans[f.clanId]).appearance.availableUntil.silver,
    until,
  );
  const id = randomUUID();
  choose(f.head, "silver", id);
  assert.equal(choose(f.head, "silver", id).replay, true);
  assert.throws(() => choose(f.head, "bronze", id));
  const saved = structuredClone(f.store.data),
    originalSave = f.store.save;
  f.store.save = () => {
    throw Error("disk full");
  };
  assert.throws(() => choose(f.head, "default"), /disk full/);
  assert.deepEqual(f.store.data, saved);
  f.store.save = originalSave;
  const disk = new ProfileStore({ filePath, now: f.now });
  assert.equal(
    new ClanService(disk).publicClan(disk.data.clans[f.clanId]).appearance.background,
    "silver",
  );
  assert.equal(disk.data.clans[f.clanId].appearance.grants.silver, until);
  f.time(until);
  assert.equal(f.clans.publicClan(f.store.data.clans[f.clanId]).appearance.background, "default");
  assert.throws(() => choose(f.head, "silver"), /недоступен/);
  assert.throws(() => choose(f.head, "vip"), /каталога/);
});

test("Фоны клана: чемпионский навсегда, тест не выдаёт награды, миграция однократна", (t) => {
  const filePath = path.join(temporary(t, "clan-background-migration"), "profiles.json"),
    f = setup(filePath);
  medal(f, 5);
  assert.equal(f.store.data.clans[f.clanId].appearance.grants.champions, null);
  f.act(f.head, "background", { clanId: f.clanId, themeId: "champions" });
  f.time(f.now() + appearance.MONTH * 4);
  f.store.refreshCompetition();
  assert.equal(f.clans.publicClan(f.store.data.clans[f.clanId]).appearance.background, "champions");
  const testStore = new ProfileStore({ filePath, now: f.now, unlockLeagueBackgrounds: true }),
    testClans = new ClanService(testStore);
  const before = structuredClone(testStore.data.clans[f.clanId].appearance.grants);
  for (const theme of require("../../public/shared/league-appearance").themes)
    testClans.mutate(f.head.token, {
      action: "background",
      clanId: f.clanId,
      themeId: theme.id,
      requestId: randomUUID(),
    });
  testClans.mutate(f.head.token, {
    action: "background",
    clanId: f.clanId,
    themeId: "gold",
    requestId: randomUUID(),
  });
  assert.deepEqual(testStore.data.clans[f.clanId].appearance.grants, before);
  const off = new ProfileStore({ filePath, now: f.now });
  assert.equal(off.data.clans[f.clanId].appearance.background, "default");
  const data = structuredClone(off.data);
  delete data.clans[f.clanId].appearance;
  data.clans[f.clanId].competition.league = 2;
  fs.writeFileSync(filePath, JSON.stringify(data));
  const migrated = new ProfileStore({ filePath, now: f.now });
  migrated.open(f.head.token);
  assert.equal(migrated.data.clans[f.clanId].appearance.grants.gold, undefined);
  const restarted = new ProfileStore({ filePath, now: () => f.now() + 1000 });
  assert.equal(restarted.data.clans[f.clanId].appearance.grants.gold, undefined);
  const corrupt = structuredClone(restarted.data);
  corrupt.clans[f.clanId].appearance.grants.gold = -1;
  fs.writeFileSync(filePath, JSON.stringify(corrupt));
  assert.throws(() => new ProfileStore({ filePath }), /оформление клана/);
});

test("Бронза: медаль без порога киллов даёт 30 дней, вход и вступление не выдают и не продлевают набор", (t) => {
  const filePath = path.join(temporary(t, "bronze-month"), "profiles.json"),
    f = setup(filePath);
  const clanView = () => f.clans.publicClan(f.store.data.clans[f.clanId]).appearance;
  assert.equal(f.view(f.head).availableUntil.bronze, undefined);
  assert.equal(clanView().availableUntil.bronze, undefined);
  assert.throws(() => f.choose(f.head, "set", "bronze"), /недоступно/);
  const member = f.user();
  f.act(member, "apply", { clanId: f.clanId });
  assert.equal(f.view(member).availableUntil.bronze, undefined);
  medal(f, 0, 1); // Призовое место и медаль без перехода в следующую лигу.
  const until = f.now() + appearance.MONTH;
  assert.equal(f.store.data.clans[f.clanId].competition.league, 0);
  assert.equal(f.store.data.clans[f.clanId].competition.medals.bronze, 1);
  assert.equal(f.view(f.head).availableUntil.bronze, until);
  assert.equal(clanView().availableUntil.bronze, until);
  f.choose(f.head, "set", "bronze");
  f.act(f.head, "background", { clanId: f.clanId, themeId: "bronze" });
  const late = f.user();
  f.act(late, "apply", { clanId: f.clanId });
  assert.equal(f.view(late).availableUntil.bronze, undefined);
  // В проверяемом месяце нет новых результатов недель: иначе новое
  // призовое место законно выдаст очередную медаль и продлит тему.
  const noResults = structuredClone(f.store.data);
  noResults.competition.week.groups = [];
  noResults.competition.day = null;
  f.store.save(noResults);
  f.choose(member, "set", "bronze");
  f.time(until - 1);
  f.store.open(member.token);
  assert.equal(f.view(member).availableUntil.bronze, until);
  assert.equal(clanView().background, "bronze");
  f.time(until);
  for (const slot of require("../../public/shared/league-appearance").slots)
    assert.equal(f.view(member)[slot], "default");
  assert.equal(clanView().background, "default");
  assert.throws(() => f.choose(member, "set", "bronze"), /недоступно/);
  assert.throws(
    () => f.act(f.head, "background", { clanId: f.clanId, themeId: "bronze" }),
    /недоступен/,
  );
  f.act(member, "leave", { clanId: f.clanId });
  f.act(member, "apply", { clanId: f.clanId });
  assert.equal(f.view(member).unlocked.includes("bronze"), false);
  assert.equal(f.store.find(member.token).appearance.grants.bronze, until);
  const restarted = new ProfileStore({ filePath, now: () => f.now() + 1000 });
  restarted.open(member.token);
  assert.equal(restarted.find(member.token).appearance.grants.bronze, until);
  assert.equal(restarted.data.clans[f.clanId].appearance.grants.bronze, until);
});

test("Отключение теста фиксирует выбор и миграцию атомарно, сохраняя реальные сроки и вечную Чемпионскую", (t) => {
  const filePath = path.join(temporary(t, "league-theme-transition"), "profiles.json"),
    f = setup(),
    outsider = f.user();
  f.store.save(f.store.data);
  const legacy = structuredClone(f.store.data),
    profile = Object.values(legacy.profiles).find((p) => p.id === f.head.profile.id),
    other = Object.values(legacy.profiles).find((p) => p.id === outsider.profile.id),
    clan = legacy.clans[f.clanId],
    silverUntil = f.now() + 86400000;
  delete profile.appearance.grantVersion;
  profile.appearance.grants = {
    bronze: f.now() + appearance.MONTH,
    silver: silverUntil,
    champions: null,
  };
  profile.appearance.lobbyBackground = "champions";
  profile.appearance.avatarFrame = "platinum"; // Только тестовый выбор, без выдачи.
  clan.appearance = {
    background: "bronze",
    grants: { bronze: f.now() + appearance.MONTH, silver: silverUntil, champions: null },
  };
  other.appearance.lobbyBackground = "diamond";
  fs.writeFileSync(filePath, JSON.stringify(legacy));
  const savedBefore = fs.readFileSync(filePath),
    disk = new ProfileStore({ filePath, now: f.now }),
    migration = structuredClone(disk.data),
    rename = fs.renameSync;
  assert.equal(disk.appearanceMigrationPending, true);
  assert.equal(disk.find(f.head.token).appearance.grants.bronze, undefined);
  assert.equal(disk.data.clans[f.clanId].appearance.grants.bronze, undefined);
  assert.equal(disk.find(f.head.token).appearance.lobbyBackground, "champions");
  assert.equal(disk.find(f.head.token).appearance.avatarFrame, "default");
  assert.equal(disk.find(outsider.token).appearance.lobbyBackground, "default");
  assert.deepEqual(disk.find(outsider.token).appearance.grants, {});
  assert.equal(disk.data.clans[f.clanId].appearance.background, "default");
  fs.renameSync = () => {
    throw Error("appearance disk full");
  };
  try {
    assert.throws(() => disk.open(f.head.token), /appearance disk full/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fs.readFileSync(filePath), savedBefore);
  assert.deepEqual(disk.data, migration);
  assert.equal(disk.appearanceMigrationPending, true);
  disk.open(f.head.token);
  assert.equal(disk.appearanceMigrationPending, false);
  const restarted = new ProfileStore({ filePath, now: () => f.now() + 5000 });
  assert.equal(restarted.find(f.head.token).appearance.grants.bronze, undefined);
  for (const a of [
    restarted.find(f.head.token).appearance,
    restarted.data.clans[f.clanId].appearance,
  ]) {
    assert.equal(a.grants.silver, silverUntil);
    assert.equal(a.grants.champions, null);
  }
  for (const field of ["wallet", "honors", "progress", "inventory", "greatness", "account"])
    assert.deepEqual(restarted.find(f.head.token)[field], profile[field], field);
  assert.equal(restarted.find(outsider.token).appearance.lobbyBackground, "default");
});

test("Повторное достижение продлевает только свою тему, без бесконечного суммирования месяца", () => {
  const f = setup(),
    clanArt = require("../../src/server/clans/clan-appearance"),
    p = f.store.find(f.head.token),
    c = f.store.data.clans[f.clanId],
    initial = f.now();
  for (let rank = 0; rank <= 5; rank++) {
    appearance.grant(p, rank, initial);
    clanArt.grant(c, rank, initial);
  }
  const second = initial + 86400000;
  for (const [subject, rules] of [
    [p, appearance],
    [c, clanArt],
  ]) {
    rules.grant(subject, 2, second);
    rules.grant(subject, 2, second);
    rules.grant(subject, 2, initial); // Поздний повтор старого события не сокращает срок.
    assert.equal(subject.appearance.grants.gold, second + appearance.MONTH);
    for (const id of ["bronze", "silver", "platinum", "diamond"])
      assert.equal(subject.appearance.grants[id], initial + appearance.MONTH);
    assert.equal(subject.appearance.grants.champions, null);
  }
});

test("Медаль и оформление фиксируются вместе: отказ записи, повтор расчёта и повторная медаль", (t) => {
  const filePath = path.join(temporary(t, "medal-appearance-atomic"), "profiles.json"),
    f = setup(filePath),
    next = structuredClone(f.store.data),
    w = next.competition.week;
  w.groups = [{ id: "medal-atomic", league: 0, clans: Object.keys(next.clans) }];
  w.scores[f.clanId] = { kills: 1, members: {} };
  f.store.save(next);
  const before = structuredClone(f.store.data),
    saved = fs.readFileSync(filePath),
    rename = fs.renameSync;
  f.time(w.end);
  fs.renameSync = () => {
    throw Error("medal disk full");
  };
  try {
    assert.throws(() => f.store.refreshCompetition(), /medal disk full/);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(f.store.data, before);
  assert.deepEqual(fs.readFileSync(filePath), saved);
  f.store.refreshCompetition();
  const until = w.end + appearance.MONTH;
  assert.equal(f.store.data.clans[f.clanId].competition.medals.bronze, 1);
  assert.equal(f.view(f.head).availableUntil.bronze, until);
  assert.equal(f.store.data.clans[f.clanId].appearance.grants.bronze, until);
  f.store.refreshCompetition();
  const restarted = new ProfileStore({ filePath, now: f.now });
  restarted.open(f.head.token);
  assert.equal(restarted.data.clans[f.clanId].competition.medals.bronze, 1);
  assert.equal(restarted.find(f.head.token).appearance.grants.bronze, until);
  medal(f, 0, 1);
  assert.equal(f.store.data.clans[f.clanId].competition.medals.bronze, 2);
  assert.equal(f.view(f.head).availableUntil.bronze, f.now() + appearance.MONTH);
  assert.ok(f.view(f.head).availableUntil.bronze > until);
});

test("Адресный полный тест оформления: все рамки и клановые фоны без выдачи наград", (t) => {
  const filePath = path.join(temporary(t, "all-appearance"), "profiles.json"),
    f = setup(filePath);
  const catalog = require("../../public/shared/league-appearance"),
    kit = require("../../public/shared/clan-crest-rules");
  const config = require("../../config/appearance-testing.json"),
    p = f.store.find(f.head.token),
    outsider = f.user();
  config.allAppearanceProfileIds.push(p.id);
  t.after(() => {
    const index = config.allAppearanceProfileIds.indexOf(p.id);
    if (index >= 0) config.allAppearanceProfileIds.splice(index, 1);
  });
  f.store.find(outsider.token).name = "Killex";
  const before = structuredClone(p),
    beforeClan = structuredClone(f.store.data.clans[f.clanId]);
  for (const theme of [...catalog.themes, ...catalog.interfaceThemes]) {
    f.choose(f.head, catalog.interfaceTheme(theme.id) ? "theme" : "set", theme.id);
    assert.equal(f.view(f.head).availableUntil[theme.id], null);
    assert.throws(() => f.choose(outsider, "theme", theme.id), /недоступно|купи|Герой/);
  }
  for (const frame of [...catalog.accountFrames, ...catalog.rankFrames]) {
    const id = randomUUID();
    f.choose(f.head, "frames", frame.id, id);
    assert.equal(f.choose(f.head, "frames", frame.id, id).replay, true);
    assert.equal(f.view(f.head).avatarFrame, frame.id);
    assert.throws(() => f.choose(outsider, "frames", frame.id), /недоступно|титул/);
  }
  for (const theme of catalog.themes) {
    f.act(f.head, "background", { clanId: f.clanId, themeId: theme.id });
    assert.equal(f.clans.clanData(p).mine.appearance.background, theme.id);
    assert.throws(() => f.act(outsider, "background", { clanId: f.clanId, themeId: theme.id }));
  }
  f.act(f.head, "frame", { clanId: f.clanId, frame: "champion" });
  assert.equal(f.clans.clanData(p).competition.frame, "champion");
  assert.deepEqual(f.store.data.clans[f.clanId].competition.frames, beforeClan.competition.frames);
  assert.deepEqual(f.store.data.clans[f.clanId].competition.medals, beforeClan.competition.medals);
  assert.deepEqual(f.store.data.clans[f.clanId].appearance.grants, beforeClan.appearance.grants);
  const choice = {
    ...kit.DEFAULT,
    frame: kit.frames.find((x) => kit.requiredCrestLevel({ ...kit.DEFAULT, frame: x.id }) === 10)
      .id,
  };
  f.act(f.head, "edit", { clanId: f.clanId, crest: choice });
  assert.equal(f.store.data.clans[f.clanId].crest.frame, choice.frame);
  for (const key of ["account", "honors", "progress", "inventory"])
    assert.deepEqual(f.store.find(f.head.token)[key], before[key]);
  assert.equal(f.clans.clanData(p).rules.testCrests, true);
  assert.equal(f.clans.clanData(f.store.find(outsider.token)).rules.testCrests, false);
  const restarted = new ProfileStore({ filePath, now: f.now });
  assert.equal(restarted.byId(p.id).appearance.avatarFrame, catalog.rankFrames.at(-1).id);
  assert.equal(restarted.data.clans[f.clanId].crest.frame, choice.frame);
  assert.equal(
    new ClanService(restarted).clanData(restarted.byId(p.id)).competition.frame,
    "champion",
  );
  config.allAppearanceProfileIds.splice(config.allAppearanceProfileIds.indexOf(p.id), 1);
  assert.equal(f.view(f.head).unlocked.includes("premium"), false);
  assert.throws(() => f.choose(f.head, "frames", "premium"), /недоступно/);
  const revoked = new ProfileStore({ filePath, now: f.now });
  assert.equal(revoked.byId(p.id).appearance.avatarFrame, "default");
  assert.equal(new ClanService(revoked).clanData(revoked.byId(p.id)).competition.frame, null);
  assert.notEqual(revoked.data.clans[f.clanId].crest.frame, choice.frame);
});

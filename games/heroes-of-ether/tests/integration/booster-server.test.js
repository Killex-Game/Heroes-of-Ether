/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const http = require("node:http");
const { grantCoins } = require("../../scripts/development/grant-coins");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena } = require("../../src/server/arena/arena-simulation");
async function setup(t) {
  let now = 5000;
  const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => now,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const session = async () => {
    const response = await fetch(url + "/api/profile");
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const stored = app.profiles.find(cookie.split("=")[1]);
    stored.level = 25;
    // Purchase/race fixtures need funds beyond the new 100/10 starting wallet.
    Object.assign(stored.wallet, { coins: 1000, crystals: 100 });
    stored.progress = require("../../src/server/progression/experience-progression").freshProgress(
      25,
    );
    return { cookie, ...(await response.json()) };
  };
  const buy = (cookie, id, requestId = randomUUID(), extra = {}) =>
    fetch(url + "/api/shop/buy", {
      method: "POST",
      headers: { Cookie: cookie || "", "Content-Type": "application/json" },
      body: JSON.stringify({ boosterId: id, requestId, ...extra }),
    });
  const connect = (cookie) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: cookie || "" } });
      const messages = [];
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.type === "welcome") resolve({ ws, id: m.id, messages });
      });
    });
  return {
    app,
    url,
    session,
    buy,
    connect,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}
function use(ws, payload) {
  const message = { type: "useBooster", requestId: randomUUID(), ...payload };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off("message", receive);
      reject(Error("No booster reply"));
    }, 2000);
    function receive(raw) {
      const result = JSON.parse(raw);
      if (result.type !== "boosterResult" || result.requestId !== message.requestId) return;
      clearTimeout(timer);
      ws.off("message", receive);
      resolve(result);
    }
    ws.on("message", receive);
    ws.send(JSON.stringify(message));
  });
}

test("Дополнительный слот проверяет срок аккаунта на сервере; запрет не расходует предмет", async (t) => {
  const { app, session, connect, advance } = await setup(t);
  let accountNow = Date.now();
  app.profiles.now = () => accountNow;
  const a = await session(),
    token = a.cookie.split("=")[1];
  const ids = ["candy", "ice_cream", "donut", "meat", "speed", "golden_shield"];
  const saved = app.profiles.find(token);
  for (const id of ids) saved.inventory[id] = 3;
  app.profiles.activateAccount(token, { kind: "vip", requestId: randomUUID() });
  app.profiles.activateAccount(token, { kind: "premium", requestId: randomUUID() });
  app.profiles.find(token).account.vipUntil = accountNow + 8 * 86400000;
  app.profiles.setLoadout(token, {
    name: "Игрок",
    skinId: "moon-dragon",
    quickSlots: ids,
    requestId: randomUUID(),
  });
  const c = await connect(a.cookie),
    p = app.arena.players.get(c.id);
  let result = await use(c.ws, { boosterId: "golden_shield", spawnSerial: p.spawnSerial });
  assert.equal(result.ok, true);
  assert.equal(app.profiles.find(token).inventory.golden_shield, 2);
  advance(7 * 86400000);
  accountNow += 7 * 86400000;
  result = await use(c.ws, { boosterId: "golden_shield", spawnSerial: p.spawnSerial });
  assert.equal(result.ok, false);
  assert.match(result.message, /доступных слотах/);
  assert.equal(app.profiles.find(token).inventory.golden_shield, 2);
  result = await use(c.ws, { boosterId: "candy", spawnSerial: p.spawnSerial });
  assert.equal(result.ok, true);
  result = await use(c.ws, { boosterId: "speed", spawnSerial: p.spawnSerial });
  assert.equal(result.ok, true, "пятый слот доступен оставшемуся VIP");
  const speedStock = app.profiles.find(token).inventory.speed;
  advance(86400000);
  accountNow += 86400000;
  result = await use(c.ws, { boosterId: "speed", spawnSerial: p.spawnSerial });
  assert.equal(result.ok, false, "после истечения VIP пятый слот закрыт");
  assert.equal(app.profiles.find(token).inventory.speed, speedStock);
  assert.deepEqual(app.profiles.find(token).quickSlots, ids);
});
for (const source of ["обычный", "питомца"])
  test(
    `Огонь ${source} завершает жизнь сервером, сохраняет XP жертвы без киллов и опыта отправителю`,
    { timeout: 10000 },
    async (t) => {
      const { app, session, connect, advance } = await setup(t),
        a = await session(),
        b = await session();
      if (source === "питомца") {
        const token = a.cookie.split("=")[1];
        app.profiles.find(token).wallet.bucks = 500;
        require("../../src/server/pets/pet-service").mutate(app.profiles, token, {
          action: "buy",
          petId: "drakosha",
          requestId: randomUUID(),
        });
      }
      const ca = await connect(a.cookie),
        cb = await connect(b.cookie),
        attacker = app.arena.players.get(ca.id),
        victim = app.arena.players.get(cb.id);
      const saved = app.profiles.find(b.cookie.split("=")[1]);
      saved.progress.session.xp = 123;
      Object.assign(attacker, {
        x: 1000,
        y: 800,
        targetX: 1000,
        targetY: 800,
        protectedUntil: 0,
        stopped: true,
      });
      Object.assign(victim, {
        x: 1100,
        y: 800,
        targetX: 1100,
        targetY: 800,
        protectedUntil: 0,
        stopped: true,
      });
      if (source === "питомца") {
        const pets = require("../../src/server/pets/arena-pets");
        pets.use(
          app.arena,
          attacker,
          {
            ability: "fire",
            sequence: 1,
            requestId: randomUUID(),
            spawnSerial: attacker.spawnSerial,
            aimX: 2000,
            aimY: 800,
          },
          5000,
        );
      } else
        app.arena.prepareBooster(
          attacker.id,
          { boosterId: "fire", spawnSerial: 0, aimX: 2000, aimY: 800 },
          5000,
        )();
      const received = new Promise((resolve) =>
        cb.ws.on("message", (raw) => {
          const m = JSON.parse(raw);
          if (m.type === "lifeEnded") resolve(m);
        }),
      );
      advance(1000);
      app.tick();
      const result = await received;
      assert.equal(result.result.reason, "burned");
      assert.equal(result.result.killer, null);
      assert.equal(result.result.earnedXp, 123);
      assert.equal(app.profiles.find(b.cookie.split("=")[1]).progress.xp, 12000 + 123);
      const shooter = app.profiles.find(a.cookie.split("=")[1]);
      assert.equal(shooter.progress.kills, 0);
      assert.equal(shooter.progress.session.xp, 0);
      assert.equal(victim.dead, true);
      assert.equal(
        app.arena.snapshot(6000).players.some((p) => p.id === victim.id),
        false,
      );
    },
  );
test("Загрузка профиля и покупка в лобби не создают игрока", async (t) => {
  const { app, session, buy, url } = await setup(t),
    a = await session();
  assert.equal(a.catalog.items.filter(b => b.tier !== "potion").length, 30);
  assert.equal(a.catalog.items.filter(b => b.tier === "potion" && !b.purchasable).length, 16);
  assert.equal(app.arena.players.size, 0);
  const response = await buy(a.cookie, "candy", randomUUID(), {
    price: 0,
    quantity: 999999,
    mass: 100000,
  });
  const result = await response.json();
  assert.equal(result.profile.wallet.coins, 990);
  assert.equal(result.profile.inventory.candy, 10);
  assert.equal(app.arena.players.size, 0);
  const reloaded = await (
    await fetch(url + "/api/profile", { headers: { Cookie: a.cookie } })
  ).json();
  assert.equal(reloaded.profile.id, a.profile.id);
  assert.equal(reloaded.profile.wallet.coins, 990);
});
test("Повторная покупка, включая параллельные запросы, списывает цену один раз", async (t) => {
  const { session, buy } = await setup(t),
    a = await session(),
    id = randomUUID();
  const responses = await Promise.all([buy(a.cookie, "speed", id), buy(a.cookie, "speed", id)]);
  const values = await Promise.all(responses.map((r) => r.json()));
  assert.equal(values.filter((v) => v.replay).length, 1);
  assert.ok(
    values.every((v) => v.profile.wallet.crystals === 90 && v.profile.inventory.speed === 10),
  );
});

test("Покупка на арене запрещена для всего профиля; выход возвращает магазин", async (t) => {
  const { app, url, session, buy, connect } = await setup(t),
    a = await session(),
    b = await session();
  const token = a.cookie.split("=")[1],
    requestId = randomUUID();
  const client = await connect(a.cookie);
  const before = structuredClone(app.profiles.find(token));
  const status = await (
    await fetch(url + "/api/profile", { headers: { Cookie: a.cookie } })
  ).json();
  assert.equal(status.inArena, true);
  const blocked = await buy(a.cookie, "candy", requestId);
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "ARENA_ACTIVE");
  assert.deepEqual(
    app.profiles.find(token),
    before,
    "Баланс, предметы и история покупок не изменились",
  );
  assert.equal((await buy(b.cookie, "candy")).status, 200, "Другой профиль в лобби может покупать");
  const serverClosed = once([...app.wss.clients][0], "close");
  client.ws.close();
  await serverClosed;
  assert.equal([...app.arena.players.values()].filter((p) => !p.isRemnant).length, 0);
  const lobby = await (await fetch(url + "/api/profile", { headers: { Cookie: a.cookie } })).json();
  assert.equal(lobby.inArena, false);
  const bought = await buy(a.cookie, "candy", requestId);
  assert.equal(bought.status, 200);
  assert.equal((await bought.json()).profile.wallet.coins, 990);
});

test('public profile read after a finished life is authorized; writes and live-player reads stay locked',async t=>{
 const {app,url,session,buy,connect}=await setup(t),a=await session(),b=await session();
 const client=await connect(a.cookie),server=[...app.wss.clients][0],p=app.arena.players.get(client.id);
 const read=cookie=>fetch(url+'/api/players/'+b.profile.id,{headers:{Cookie:cookie||''}});
 assert.equal((await read()).status,401);assert.equal((await read(a.cookie)).status,409);
 p.dead=true;assert.equal((await read(a.cookie)).status,409,'An unsaved death is not an ended life');
 server.lastLifeResult={id:p.lifeId};
 const result=await read(a.cookie);assert.equal(result.status,200);assert.equal((await result.json()).player.id,b.profile.id);
 assert.equal((await buy(a.cookie,'candy')).status,409);
 p.dead=false;assert.equal((await read(a.cookie)).status,409);
 client.ws.close();
});

test("Запрос покупки, начатый до входа, проверяется после получения полного тела", async (t) => {
  const { app, url, session, connect } = await setup(t),
    a = await session();
  const token = a.cookie.split("=")[1];
  const body = JSON.stringify({ boosterId: "candy", requestId: randomUUID() });
  const request = http.request(url + "/api/shop/buy", {
    method: "POST",
    headers: {
      Cookie: a.cookie,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  });
  t.after(() => request.destroy());
  const received = once(app.httpServer, "request");
  request.write(body.slice(0, 5));
  await received;
  await connect(a.cookie);
  const before = structuredClone(app.profiles.find(token));
  const response = once(request, "response");
  request.end(body.slice(5));
  const [res] = await response;
  res.resume();
  await once(res, "end");
  assert.equal(res.statusCode, 409);
  assert.deepEqual(app.profiles.find(token), before);
});
test("Чужой Origin, отсутствие сессии, повреждённый JSON и заблокированные предметы отклоняются", async (t) => {
  const { session, buy, url } = await setup(t),
    a = await session();
  assert.equal((await buy("", "candy")).status, 401);
  assert.equal((await buy(a.cookie, "fire")).status, 400);
  assert.equal(
    (
      await fetch(url + "/api/shop/buy", {
        method: "POST",
        headers: {
          Cookie: a.cookie,
          Origin: "https://elsewhere.invalid",
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(url + "/api/shop/buy", {
        method: "POST",
        headers: { Cookie: a.cookie, "Content-Type": "application/json" },
        body: "{bad",
      })
    ).status,
    400,
  );
  assert.equal((await fetch(url + "/data/profiles.json")).status, 404);
});
test("Применение расходует один предмет, сервер считает массу, повтор не начисляет снова", async (t) => {
  const { app, session, buy, connect } = await setup(t),
    a = await session();
  await buy(a.cookie, "ice_cream");
  const client = await connect(a.cookie);
  const operation = {
    boosterId: "ice_cream",
    spawnSerial: 0,
    requestId: randomUUID(),
    amount: 999999,
  };
  const first = await use(client.ws, operation),
    repeated = await use(client.ws, operation);
  assert.equal(first.ok, true);
  assert.equal(repeated.replay, true);
  assert.equal(repeated.profile.inventory.ice_cream, 9);
  assert.equal(app.arena.players.get(client.id).mass, 220);
});

test("Предел массы проверяется до сохранения расхода; достижение получает фактическую прибавку", async (t) => {
  const { app, session, buy, connect } = await setup(t),
    a = await session();
  await buy(a.cookie, "donut");
  const client = await connect(a.cookie),
    p = app.arena.players.get(client.id);
  p.mass = 4999;
  p.radius = require("../../src/server/arena/arena-simulation").radiusForMass(p.mass);
  const operation = {
    boosterId: "donut",
    spawnSerial: p.spawnSerial,
    requestId: randomUUID(),
    massLimit: 999999,
  };
  const first = await use(client.ws, operation);
  assert.equal(first.ok, true);
  assert.equal(p.mass, 5000);
  const saved = structuredClone(app.profiles.find(a.cookie.split("=")[1]));
  assert.equal(saved.progress.maxMass, 5000);
  assert.equal(saved.inventory.donut, 9);
  assert.equal((await use(client.ws, operation)).replay, true);
  assert.equal(p.boosterUses.donut, 1);
  const denied = await use(client.ws, { boosterId: "donut", spawnSerial: p.spawnSerial });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /предел массы/);
  assert.deepEqual(app.profiles.find(a.cookie.split("=")[1]), saved);
});
test("Сервер сохраняет общий рекорд выше лимита одного шара, расход ограничен главным", async (t) => {
  const { app, session, buy, connect } = await setup(t),
    a = await session();
  await buy(a.cookie, "donut");
  const profile = app.profiles.byId(a.profile.id);
  profile.level = 26;
  profile.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(
    26,
  );
  const client = await connect(a.cookie),
    p = app.arena.players.get(client.id),
    radius = require("../../src/server/arena/arena-simulation").radiusForMass;
  p.parts = [17999, 17999].map((mass, i) => ({
    id: i ? "other" : p.mainPartId,
    mass,
    radius: radius(mass),
    x: i ? 1900 : 500,
    y: 800,
  }));
  app.arena.syncParts(p);
  const result = await use(client.ws, { boosterId: "donut", spawnSerial: 0, massLimit: 999999 });
  assert.equal(result.ok, true);
  assert.equal(p.mass, 35999);
  assert.deepEqual(
    p.parts.map((part) => part.mass),
    [18000, 17999],
  );
  assert.equal(app.profiles.byId(a.profile.id).progress.maxMass, 35999);
  assert.equal(result.profile.inventory.donut, 9);
  p.parts[1].mass = 100;
  p.parts[1].radius = radius(100);
  app.arena.syncParts(p);
  const denied = await use(client.ws, { boosterId: "donut", spawnSerial: 0 });
  assert.equal(denied.ok, false);
  assert.equal(app.profiles.byId(a.profile.id).inventory.donut, 9);
});
test("Два профиля имеют раздельные инвентари, атакуемый получает серверный эффект", async (t) => {
  const { app, session, buy, connect } = await setup(t),
    a = await session(),
    b = await session();
  await buy(a.cookie, "freeze");
  const ca = await connect(a.cookie),
    cb = await connect(b.cookie);
  const pa = app.arena.players.get(ca.id),
    pb = app.arena.players.get(cb.id);
  Object.assign(pa, { x: 500, y: 500, protectedUntil: 0 });
  Object.assign(pb, { x: 700, y: 500, protectedUntil: 0 });
  const attack = await use(ca.ws, { boosterId: "freeze", spawnSerial: 0, aimX: 1500, aimY: 500 });
  assert.equal(attack.ok, true);
  assert.equal(pb.effects.freeze, undefined);
  app.arena.combat.update(5500);
  assert.equal(pb.effects.freeze, undefined);
  app.arena.combat.update(6000);
  assert.equal(pb.effects.freeze, 16000);
  app.arena.combat.update(7000);
  assert.equal(pb.effects.freeze, 16000);
  const stolen = await use(cb.ws, {
    boosterId: "web",
    spawnSerial: 0,
    targetId: ca.id,
    targetSpawnSerial: 0,
  });
  assert.equal(stolen.ok, false);
  assert.ok(
    cb.messages
      .filter((m) => m.type === "state")
      .every((m) => m.players.every((p) => !p.wallet && !p.inventory)),
  );
  assert.ok(
    cb.messages.filter((m) => m.type === "profile").every((m) => m.profile.id === b.profile.id),
  );
});
test("Предел оставленных ловушек отклоняет запуск без расхода инвентаря и лимита слота", async (t) => {
  const { app, session, buy, connect } = await setup(t),
    a = await session();
  await buy(a.cookie, "web");
  const client = await connect(a.cookie),
    p = app.arena.players.get(client.id);
  Object.assign(p, { x: 500, y: 500, protectedUntil: 0 });
  const booster = require("../../src/server/boosters/booster-catalog").BOOSTERS.get("web");
  for (let i = 0; i < 48; i++)
    app.arena.combat.prepare(p, booster, { aimX: 1500, aimY: 500 }, 5000)();
  const before = structuredClone(app.profiles.byId(a.profile.id));
  const result = await use(client.ws, {
    boosterId: "web",
    spawnSerial: p.spawnSerial,
    aimX: 1500,
    aimY: 500,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /48 ваших ловушек/);
  assert.deepEqual(app.profiles.byId(a.profile.id), before);
  assert.deepEqual(p.boosterUses, {});
  assert.equal(app.arena.combat.shots.length, 48);
});

test("Один гостевой профиль не создаёт две сферы в разных вкладках", async (t) => {
  const { app, session, connect } = await setup(t),
    a = await session();
  await connect(a.cookie);
  await assert.rejects(connect(a.cookie), /409/);
  assert.equal(app.arena.players.size, 1);
});
test("Повтор последнего бустера успешен после очистки слота, новая команда не расходует ничего", async (t) => {
  const { app, session, buy, connect } = await setup(t),
    a = await session();
  await buy(a.cookie, "meat");
  await buy(a.cookie, "speed");
  app.profiles.find(a.cookie.split("=")[1]).inventory.meat = 1;
  const client = await connect(a.cookie);
  const operation = { requestId: randomUUID(), boosterId: "meat", spawnSerial: 0 };
  const first = await use(client.ws, operation),
    player = app.arena.players.get(client.id);
  assert.equal(first.ok, true);
  assert.deepEqual(first.profile.quickSlots, [null, "speed"]);
  assert.deepEqual(player.quickSlots, [null, "speed"]);
  assert.equal(player.mass, 720);
  const replay = await use(client.ws, operation);
  assert.equal(replay.ok, true);
  assert.equal(replay.replay, true);
  assert.equal(player.mass, 720);
  assert.equal(player.boosterUses.meat, 1);
  assert.equal((await use(client.ws, { ...operation, requestId: randomUUID() })).ok, false);
});
test("Неудачная цель и устаревшее поколение не списывают предмет", async (t) => {
  const { app, session, buy, connect, advance } = await setup(t),
    a = await session();
  await buy(a.cookie, "web");
  const client = await connect(a.cookie);
  const result = await use(client.ws, {
    boosterId: "web",
    spawnSerial: 0,
    targetId: "gone",
    targetSpawnSerial: 0,
  });
  assert.equal(result.ok, false);
  advance(2000);
  app.arena.resetPlayer(app.arena.players.get(client.id), 7000);
  const stale = await use(client.ws, {
    boosterId: "web",
    spawnSerial: 0,
    targetId: "gone",
    targetSpawnSerial: 0,
  });
  assert.equal(stale.ok, false);
  const token = a.cookie.split("=")[1];
  assert.equal(app.profiles.find(token).inventory.web, 10);
});

const post = (url, cookie, route, body) =>
  fetch(url + route, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ requestId: randomUUID(), ...body }),
  });

test("Лимит на сервере отдельный для слотов; ошибка записи, повтор и подмена не расходуют лишнее", async (t) => {
  const { app, session, buy, connect, advance } = await setup(t),
    a = await session();
  await buy(a.cookie, "candy");
  await buy(a.cookie, "candy");
  await buy(a.cookie, "ice_cream");
  const client = await connect(a.cookie),
    player = app.arena.players.get(client.id),
    token = a.cookie.split("=")[1];
  const first = { boosterId: "candy", spawnSerial: player.spawnSerial, requestId: randomUUID() };
  const save = app.profiles.save;
  app.profiles.save = () => {
    throw Error("disk full");
  };
  assert.equal((await use(client.ws, first)).ok, false);
  app.profiles.save = save;
  assert.equal(player.boostersUsed, 0);
  assert.equal(player.mass, 20);
  assert.equal(app.profiles.find(token).inventory.candy, 20);
  let last;
  for (let i = 0; i < 10; i++) {
    last =
      i === 0
        ? first
        : { boosterId: "candy", spawnSerial: player.spawnSerial, requestId: randomUUID() };
    assert.equal((await use(client.ws, last)).ok, true);
    advance(100);
  }
  assert.equal(player.boostersUsed, 10);
  assert.equal((await use(client.ws, last)).replay, true);
  assert.equal(player.boostersUsed, 10);
  const before = structuredClone(app.profiles.find(token)),
    mass = player.mass;
  client.ws.send(
    JSON.stringify({
      type: "move",
      x: 500,
      y: 500,
      boostersUsed: 0,
      boosterLimit: 1000,
      level: 501,
    }),
  );
  advance(1000);
  const denied = await use(client.ws, { boosterId: "candy", spawnSerial: player.spawnSerial });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /Лимит/);
  assert.equal(player.boostersUsed, 10);
  assert.equal(player.mass, mass);
  assert.equal(player.level, 25);
  assert.deepEqual(app.profiles.find(token), before);
  assert.equal(
    (await use(client.ws, { boosterId: "ice_cream", spawnSerial: player.spawnSerial })).ok,
    true,
  );
  assert.equal(player.boosterUses.candy, 10);
  assert.equal(player.boosterUses.ice_cream, 1);
});
test("Сервер передаёт скин всем, не принимает подмену уровня и блокирует смену слотов на арене", async (t) => {
  const { app, url, session, connect, buy } = await setup(t),
    a = await session(),
    b = await session();
  await buy(a.cookie, "candy");
  await buy(a.cookie, "web");
  assert.equal(
    (
      await post(url, a.cookie, "/api/profile/personal", {
        name: "Страж",
        expectedName: "Путник",
        gender: "unspecified",
      })
    ).status,
    200,
  );
  const appearance = {
    name: "Страж",
    skinId: "forest-spirit",
    quickSlots: ["candy"],
    level: 999,
    clanPrefix: "FAKE",
  };
  assert.equal((await post(url, a.cookie, "/api/profile/loadout", appearance)).status, 200);
  const ca = await connect(a.cookie),
    cb = await connect(b.cookie);
  const state = await new Promise((resolve) => {
    const receive = (raw) => {
      const m = JSON.parse(raw);
      if (m.type === "state") {
        cb.ws.off("message", receive);
        resolve(m);
      }
    };
    cb.ws.on("message", receive);
    app.broadcast();
  });
  const visible = state.players.find((p) => p.id === ca.id);
  assert.equal(visible.skinId, "forest-spirit");
  assert.equal(visible.name, "Страж");
  assert.equal(visible.level, 25);
  assert.equal(visible.clanPrefix, "");
  assert.equal(
    (
      await post(url, a.cookie, "/api/profile/loadout", {
        ...appearance,
        skinId: "sun-phoenix",
        quickSlots: ["web"],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "create",
        name: "Test",
        prefix: "T",
        emblem: "grove",
      })
    ).status,
    409,
  );
  const denied = await use(ca.ws, {
    boosterId: "web",
    spawnSerial: 0,
    targetId: cb.id,
    targetSpawnSerial: 0,
  });
  assert.equal(denied.ok, false);
  assert.match(denied.message, /не выбран/);
  assert.equal(app.profiles.find(a.cookie.split("=")[1]).inventory.web, 10);
  const old = app.arena.players.get(ca.id);
  app.arena.resetPlayer(old, 8000);
  assert.equal(old.skinId, "forest-spirit");
  assert.equal(old.level, 25);
});

test("Принятие игрока на арене и редактирование префикса видны остальным сразу", async (t) => {
  const { app, url, session, connect } = await setup(t),
    a = await session(),
    b = await session();
  for (const who of [a, b]) {
    const p = app.profiles.byId(who.profile.id);
    p.level = 12;
    p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  }
  grantCoins(app.profiles, a.profile.id, 1500);
  await post(url, a.cookie, "/api/clans/action", {
    action: "create",
    name: "Лес",
    prefix: "ЛЕС",
    emblem: "grove",
    privacy: "closed",
  });
  const clanId = app.profiles.byId(a.profile.id).clanId;
  await post(url, b.cookie, "/api/clans/action", { action: "apply", clanId });
  const cb = await connect(b.cookie);
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "accept",
        clanId,
        memberId: b.profile.id,
      })
    ).status,
    200,
  );
  assert.equal(app.arena.players.get(cb.id).clanPrefix, "ЛЕС");
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "edit",
        clanId,
        name: "Лес",
        prefix: "TREE",
        emblem: "grove",
      })
    ).status,
    200,
  );
  assert.equal(app.arena.snapshot(5000).players.find((p) => p.id === cb.id).clanPrefix, "TREE");
});

test("Смена членства ждёт сохранения XP: старый пакет не переносится в новый клан и не теряется при исключении", async (t) => {
  const { app, url, session, connect, advance } = await setup(t),
    a = await session(),
    b = await session();
  for (const who of [a, b]) {
    const p = app.profiles.byId(who.profile.id);
    p.level = 12;
    p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  }
  grantCoins(app.profiles, a.profile.id, 1500);
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "create",
        name: "Лес",
        prefix: "ЛЕС",
        emblem: "grove",
        privacy: "closed",
      })
    ).status,
    200,
  );
  const clanId = app.profiles.byId(a.profile.id).clanId;
  assert.equal(
    (await post(url, b.cookie, "/api/clans/action", { action: "apply", clanId })).status,
    200,
  );
  const cb = await connect(b.cookie),
    p = app.arena.players.get(cb.id);
  Object.assign(p, {
    mass: 5000,
    radius: require("../../src/server/arena/arena-simulation").radiusForMass(5000),
    nextMassDecayAt: Infinity,
  });
  const save = app.profiles.save;
  // Advance the simulation while allowing its real WebSocket client to read.
  // A synchronous minute of snapshots can hit socket backpressure and end the
  // life before the membership assertion (the XP is then correctly in lastLife).
  const advanceTicks = async () => {
    for (let i = 0; i < 599; i++) {
      advance(50);
      app.tick();
      if (i % 20 === 0) await new Promise(setImmediate);
    }
  };
  app.tick();
  await advanceTicks();
  app.profiles.save = () => {
    throw Error("TEST pending XP");
  };
  advance(50);
  app.tick();
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "accept",
        clanId,
        memberId: b.profile.id,
      })
    ).status,
    503,
  );
  assert.equal(app.profiles.byId(b.profile.id).clanId, null);
  app.profiles.save = save;
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "accept",
        clanId,
        memberId: b.profile.id,
      })
    ).status,
    200,
  );
  assert.equal(app.profiles.data.clans[clanId].xp, 0);
  assert.equal(app.profiles.byId(b.profile.id).progress.session.xp, 25);
  await advanceTicks();
  app.profiles.save = () => {
    throw Error("TEST pending XP");
  };
  advance(50);
  app.tick();
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "kick",
        clanId,
        memberId: b.profile.id,
      })
    ).status,
    503,
  );
  app.profiles.save = save;
  assert.equal(
    (
      await post(url, a.cookie, "/api/clans/action", {
        action: "kick",
        clanId,
        memberId: b.profile.id,
      })
    ).status,
    200,
  );
  assert.equal(app.profiles.data.clans[clanId].xp, 25);
  assert.equal(app.profiles.byId(b.profile.id).progress.session.xp, 50);
  assert.equal(p.clanId, null);
  assert.equal(app.arena.snapshot(125000).clanLeaderboard.length, 0);
});

test("Параллельное создание одинакового префикса списывает монеты только победителю", async (t) => {
  const { app, url, session } = await setup(t),
    a = await session(),
    b = await session();
  for (const who of [a, b]) {
    const p = app.profiles.byId(who.profile.id);
    p.level = 12;
    p.progress.xp = require("../../src/server/progression/experience-progression").xpForLevel(12);
  }
  grantCoins(app.profiles, a.profile.id, 1500);
  grantCoins(app.profiles, b.profile.id, 1500);
  const responses = await Promise.all([
    post(url, a.cookie, "/api/clans/action", {
      action: "create",
      name: "Первый",
      prefix: "Ab",
      emblem: "astral",
    }),
    post(url, b.cookie, "/api/clans/action", {
      action: "create",
      name: "Второй",
      prefix: "aB",
      emblem: "grove",
    }),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  assert.equal(
    app.profiles.byId(a.profile.id).wallet.coins + app.profiles.byId(b.profile.id).wallet.coins,
    3500,
  );
  const foreign = await fetch(url + "/api/clans/action", {
    method: "POST",
    headers: {
      Cookie: a.cookie,
      Origin: "https://elsewhere.invalid",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(foreign.status, 403);
});

/* Интеграционные проверки сервера и протокола. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws");
const { createGameServer } = require("../../src/server/game-server"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const { xpForLevel } = require("../../src/server/progression/experience-progression");
async function setup(t) {
  let time = 0;
  const app = createGameServer({
    arena: new Arena({ etherCount: 0 }),
    autoTick: false,
    now: () => time,
    wallNow: () => 1000000 + time,
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  const session = async () => {
    const res = await fetch(url + "/api/profile"),
      cookie = res.headers.get("set-cookie").split(";")[0],
      data = await res.json();
    return { cookie, id: data.profile.id, token: cookie.split("=")[1] };
  };
  const connect = (who) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(url.replace("http:", "ws:"), { headers: { Cookie: who.cookie } }),
        messages = [];
      ws.on("error", reject);
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        messages.push(m);
        if (m.type === "welcome") resolve({ ws, messages, p: app.arena.players.get(m.id) });
      });
    });
  const disconnect = async (client) => {
    const closed = once(
      [...app.wss.clients].find((ws) => ws.playerId === client.p.id),
      "close",
    );
    client.ws.close();
    await closed;
  };
  return {
    app,
    url,
    session,
    connect,
    disconnect,
    at: (n) => {
      time = n;
    },
    getTime: () => time,
  };
}
const position = (p, mass, x = 800, y = 800) =>
  Object.assign(p, {
    mass,
    radius: radiusForMass(mass),
    x,
    y,
    targetX: x,
    targetY: y,
    protectedUntil: 0,
    nextMassDecayAt: Infinity, // Isolate XP/absorption accounting; decay has separate coverage.
  });
async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 25));
}
function activeTicks(app, at, from, to) {
  at(from);
  app.tick();
  for (let time = from + 50; time <= to; time += 50) {
    at(time);
    app.tick();
  }
}
function reply(client, message, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.ws.off("message", receive);
      reject(Error("No reply: " + type));
    }, 2000);
    function receive(raw) {
      const m = JSON.parse(raw);
      if (m.type !== type) return;
      clearTimeout(timer);
      client.ws.off("message", receive);
      resolve(m);
    }
    client.ws.on("message", receive);
    client.ws.send(JSON.stringify(message));
  });
}
const resume = (client) =>
  reply(client, { type: "continueLife", lifeId: client.p.lifeId }, "continueResult");

test("Часть даёт килл и 3 XP без смерти владельца; остальные части того же профиля — через 3 минуты", async (t) => {
  const { app, session, connect, at } = await setup(t),
    a = await session(),
    b = await session();
  const ca = await connect(a),
    cb = await connect(b);
  at(5000);
  await settled();
  position(ca.p, 1000);
  position(cb.p, 200, 1800, 800);
  // Wait for the actual snapshot; a fixed 25 ms sleep races other test workers.
  const splitState = (async () => {
    const signal = AbortSignal.timeout(2000);
    while (true) {
      const [raw] = await once(ca.ws, "message", { signal });
      const state = JSON.parse(raw);
      if (state.type === "state" && state.players.find((p) => p.id === cb.p.id)?.parts.length === 2)
        return state;
    }
  })();
  cb.ws.send(JSON.stringify({ type: "split", sequence: 1, spawnSerial: cb.p.spawnSerial }));
  for (let i = 0; i < 200 && !cb.p.parts; i++) await settled();
  app.broadcast(); // Inspect setup before collision simulation; input no longer broadcasts itself.
  const state = await splitState;
  assert.equal(cb.p.parts.length, 2);
  assert.equal(state.players.find((p) => p.id === cb.p.id).parts.length, 2);
  const life = cb.p.lifeId;
  Object.assign(cb.p.parts[0], { x: 800, y: 800, vx: 0, vy: 0 });
  Object.assign(cb.p.parts[1], { x: 2000, y: 1200, vx: 0, vy: 0 });
  app.arena.syncParts(cb.p);
  cb.p.stopped = true;
  app.tick();
  await settled();
  assert.equal(cb.p.dead, false);
  assert.equal(cb.p.lifeId, life);
  assert.equal(
    cb.messages.some((m) => m.type === "lifeEnded"),
    false,
  );
  assert.equal(app.profiles.find(a.token).progress.session.kills, 1);
  assert.equal(app.profiles.find(a.token).progress.session.xp, 3);
  position(ca.p, 1000, cb.p.x, cb.p.y);
  at(6000);
  app.tick();
  await settled();
  assert.equal(cb.p.dead, true);
  assert.equal(cb.messages.filter((m) => m.type === "lifeEnded").length, 1);
  assert.equal(app.profiles.find(a.token).progress.session.kills, 1);
  assert.equal(app.profiles.find(a.token).progress.session.xp, 3);
  await resume(cb);
  at(185000);
  position(cb.p, 100);
  position(ca.p, 1000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.session.kills, 2);
});

test("Сервер: 3 XP и новый уровень видны обоим игрокам; подмена XP и секунд не принимается", async (t) => {
  const { app, session, connect, at } = await setup(t),
    a = await session(),
    b = await session();
  app.profiles.find(a.token).progress.xp = 497;
  const ca = await connect(a),
    cb = await connect(b);
  at(3000);
  position(ca.p, 400);
  position(cb.p, 57);
  app.tick();
  await settled();
  assert.equal(ca.p.mass, 445);
  assert.equal(ca.p.level, 1);
  assert.equal(app.profiles.find(a.token).progress.xp, 497);
  assert.equal(app.profiles.find(a.token).progress.session.xp, 3);
  assert.equal(app.profiles.view(app.profiles.find(a.token)).progress.arenaKills, 1);
  assert.equal(app.profiles.find(a.token).progress.absorbedMass, 45);
  await resume(cb);
  at(6000);
  position(ca.p, 57);
  position(cb.p, 400);
  app.tick();
  await settled();
  const result = ca.messages.filter((m) => m.type === "lifeEnded").at(-1);
  assert.equal(result.result.earnedXp, 3);
  assert.equal(result.result.durationSeconds, 6);
  assert.equal(result.profile.level, 2);
  assert.equal(result.profile.progress.levelXp, 0);
  assert.equal(result.result.killer.name, cb.p.name);
  await resume(ca);
  at(6050);
  app.tick(); // Peers receive the respawn and new level on the next regular snapshot.
  await settled();
  assert.equal(app.profiles.view(app.profiles.find(a.token)).progress.arenaKills, 0);
  assert.equal(ca.p.boostersUsed, 0);
  assert.equal(
    cb.messages
      .filter((m) => m.type === "state")
      .at(-1)
      .players.find((p) => p.id === ca.p.id).level,
    2,
  );
  assert.equal(JSON.stringify(cb.messages).includes("recentVictims"), false);
  ca.ws.send(
    JSON.stringify({
      type: "progress",
      xp: 9999999,
      level: 10000,
      lifeSeconds: 60000,
      greatness: 999,
    }),
  );
  ca.ws.send(JSON.stringify({ type: "move", x: 800, y: 800, xp: 99999, lifeStartedAt: -9999999 }));
  await settled();
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 500);
  assert.equal(ca.p.level, 2);
});
test("Предел XP обрезает награду, сохраняется после смерти/продолжения/выхода с итогом и снимается после лобби", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    b = await session();
  app.profiles.find(a.token).progress.xp = 498;
  let ca = await connect(a);
  const cb = await connect(b);
  const progress = () => app.profiles.view(app.profiles.find(a.token)).progress;
  position(ca.p, 400);
  position(cb.p, 57);
  at(3000);
  app.tick();
  assert.equal(progress().arenaXp, 2);
  assert.equal(progress().arenaXpMax, true);
  assert.equal(progress().totalXp, 498);
  assert.equal(progress().level, 1);
  await resume(cb);
  position(cb.p, 57);
  position(ca.p, 400);
  at(183000);
  app.tick();
  assert.equal(progress().arenaXp, 2);
  assert.equal(progress().arenaKills, 2, "Киллы продолжают учитываться после макс");
  await resume(cb);
  position(ca.p, 57);
  position(cb.p, 400);
  at(186000);
  app.tick();
  assert.equal(progress().totalXp, 500);
  assert.equal(progress().lastLife.earnedXp, 2);
  await resume(ca);
  position(ca.p, 5000, 400, 400);
  position(cb.p, 10, 2000, 1300);
  at(246000);
  app.tick();
  assert.equal(progress().arenaXp, 0);
  assert.equal(progress().arenaXpMax, true);
  await reply(ca, { type: "leaveLife", spawnSerial: ca.p.spawnSerial }, "lifeEnded");
  await resume(ca);
  assert.equal(progress().arenaXpMax, true);
  await disconnect(ca);
  ca = await connect(a);
  assert.equal(progress().arenaXpMax, false);
  position(ca.p, 5000, 400, 400);
  activeTicks(app, at, 246000, 276000);
  at(306000);
  app.tick();
  assert.equal(progress().arenaXp, 5);
  await disconnect(ca);
  assert.equal(progress().totalXp, 505);
});

test("Сервер: масса в момент выплаты каждые 30 активных секунд, паузы не оплачиваются", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session();
  const base = xpForLevel(121);
  app.profiles.find(a.token).progress.xp = base;
  app.profiles.find(a.token).level = 121;
  const ca = await connect(a);
  // Проверяем границу формулы XP отдельно от сгорания (у сгорания свои тесты).
  ca.p.nextMassDecayAt = Infinity;
  // Explicitly empty field: this fixture assigns synthetic, over-cap masses.
  app.arena.hazards = new (require("../../src/server/arena/arena-hazards").ArenaHazards)(app.arena);
  app.arena.hazards.nextAt = Infinity;
  const xp = () => app.profiles.find(a.token).progress.session.xp;
  position(ca.p, 999);
  app.arena.ether = [{ id: "one", x: ca.p.x, y: ca.p.y, value: 1 }];
  at(1000);
  app.tick();
  assert.equal(xp(), 0);
  position(ca.p, 500);
  activeTicks(app, at, 1000, 10000);
  assert.equal(xp(), 0);
  position(ca.p, 75000);
  at(120000);
  app.tick();
  assert.equal(xp(), 0, "новая масса не оплачивает прошлую паузу");
  activeTicks(app, at, 120000, 129000);
  assert.equal(xp(), 0);
  position(ca.p, 100000);
  at(180000);
  app.tick();
  assert.equal(xp(), 0);
  activeTicks(app, at, 180000, 192000);
  assert.equal(xp(), 100, "пакет использует массу в момент выплаты");
  app.tick();
  assert.equal(xp(), 100, "повтор такта не начисляет опыт");
  assert.equal(app.arena.snapshot(192000).players[0].lifeSeconds, 192);
  assert.equal(app.profiles.find(a.token).progress.xp, base);
  await disconnect(ca);
  assert.equal(app.profiles.find(a.token).progress.xp, base + 100);
});
test("Сервер: гибель сбрасывает остаток, выход не даёт опыта вне арены", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  position(ca.p, 500);
  position(cb.p, 1000);
  at(59000);
  app.tick();
  assert.equal(ca.p.dead, true);
  assert.equal(ca.p.endedAt, 59000);
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  at(119000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  at(120000);
  await resume(ca);
  assert.equal(ca.p.lifeStartedAt, 120000);
  assert.equal(ca.p.mass, 20);
  position(ca.p, 5000, 200, 200);
  position(cb.p, 10000, 2000, 1300);
  activeTicks(app, at, 120000, 150000);
  at(180000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.session.xp, 5);
  at(239000);
  await disconnect(ca);
  at(1000000);
  const again = await connect(a);
  position(again.p, 5000, 200, 200);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 5);
  activeTicks(app, at, 1000000, 1030000);
  at(1060000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 5);
  await disconnect(again);
  assert.equal(app.profiles.find(a.token).progress.xp, 10);
});
test("Сервер: ограничение жертвы переживает перезаход, но повторное поглощение начисляет массу", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    b = await session();
  let ca = await connect(a),
    cb = await connect(b);
  const collide = () => {
    position(ca.p, 400);
    position(cb.p, 57);
    app.tick();
  };
  at(3000);
  collide();
  assert.equal(app.profiles.find(a.token).progress.kills, 1);
  at(5000);
  await resume(cb);
  at(6000);
  collide();
  assert.equal(ca.p.mass, 445);
  assert.equal(app.profiles.find(a.token).progress.kills, 1);
  await disconnect(ca);
  await disconnect(cb);
  ca = await connect(a);
  cb = await connect(b);
  at(10000);
  collide();
  assert.equal(app.profiles.find(a.token).progress.kills, 1);
  await resume(cb);
  at(182999);
  collide();
  assert.equal(app.profiles.find(a.token).progress.kills, 1);
  assert.equal(app.profiles.view(app.profiles.find(a.token)).progress.arenaKills, 0);
  await resume(cb);
  at(183000);
  collide();
  assert.equal(app.profiles.find(a.token).progress.kills, 2);
  assert.equal(app.profiles.view(app.profiles.find(a.token)).progress.arenaKills, 1);
});
test("Сервер: выход между тиками сжигает неполный пакет", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    ca = await connect(a);
  position(ca.p, 5000);
  activeTicks(app, at, 0, 950);
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  at(999);
  await disconnect(ca);
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  at(120001);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
});

for (const deathAt of [29950, 59950]) {
  test(`Поглощение на ${deathAt} мс сохраняет только выплаченные пакеты массы`, async (t) => {
    const { app, session, connect, at } = await setup(t),
      a = await session(),
      b = await session(),
      ca = await connect(a),
      cb = await connect(b);
    app.arena.hazards = new (require("../../src/server/arena/arena-hazards").ArenaHazards)(
      app.arena,
    );
    app.arena.hazards.nextAt = 1e9;
    position(ca.p, 50000, 800, 800);
    position(cb.p, 100000, 3000, 1500);
    activeTicks(app, at, 0, deathAt - 50);
    const before = app.profiles.find(a.token).progress.session;
    assert.equal(before.xp, deathAt < 30000 ? 0 : 50);
    assert.equal(before.kills, deathAt < 30000 ? 0 : 6);
    position(cb.p, 100000, ca.p.x, ca.p.y);
    at(deathAt);
    app.tick();
    const after = app.profiles.find(a.token).progress;
    assert.equal(ca.p.dead, true);
    assert.equal(after.session, null);
    assert.equal(after.xp, before.xp);
    assert.equal(after.lastLife.earnedXp, before.xp);
    assert.equal(after.lastLife.kills, before.kills);
  });
}

test("Обрыв соединения без команды выхода также зачисляет накопление", async (t) => {
  const { app, session, connect, at } = await setup(t),
    a = await session(),
    ca = await connect(a);
  position(ca.p, 5000);
  activeTicks(app, at, 0, 30000);
  at(60000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.session.xp, 5);
  const closed = once(
    [...app.wss.clients].find((ws) => ws.playerId === ca.p.id),
    "close",
  );
  at(75000);
  ca.ws.terminate();
  await closed;
  const p = app.profiles.find(a.token);
  assert.equal(p.progress.session, null);
  assert.equal(p.progress.xp, 5);
  assert.equal(p.progress.lastLife.durationSeconds, 75);
  at(180000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 5);
});
test("Сервер: повтор записи после сбоя не теряет и не удваивает событие поглощения", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  at(3000);
  position(ca.p, 400);
  position(cb.p, 57);
  const save = app.profiles.save;
  app.profiles.save = () => {
    throw Error("TEST disk unavailable");
  };
  app.tick();
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  app.profiles.save = save;
  app.tick();
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.session.xp, 3);
  await disconnect(ca);
  assert.equal(app.profiles.find(a.token).progress.xp, 3);
  assert.equal(app.profiles.find(a.token).progress.kills, 1);
});
test("Результат: нет сферы/сбора/XP в ожидании; продолжение один раз, старые команды не действуют", async (t) => {
  const { app, session, connect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  app.profiles.buy(a.token, "candy", randomUUID());
  ca.p.quickSlots = ["candy"];
  assert.equal((await resume(ca)).ok, false, "Нельзя начать вторую жизнь, пока жив");
  at(3000);
  position(ca.p, 500);
  position(cb.p, 1000);
  app.tick();
  await settled();
  const lifeId = ca.p.lifeId,
    serial = ca.p.spawnSerial,
    oldMass = ca.p.mass;
  assert.equal(
    app.arena.snapshot(3000).players.some((p) => p.id === ca.p.id),
    false,
  );
  app.arena.ether = [{ id: "test", x: ca.p.x, y: ca.p.y, value: 500 }];
  at(123000);
  app.tick();
  assert.equal(ca.p.mass, oldMass);
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  const bad = await reply(
    ca,
    { type: "useBooster", boosterId: "candy", spawnSerial: serial, requestId: randomUUID() },
    "boosterResult",
  );
  assert.equal(bad.ok, false);
  assert.equal(app.profiles.find(a.token).inventory.candy, 10);
  assert.equal(
    (await reply(ca, { type: "continueLife", lifeId: "forged" }, "continueResult")).ok,
    false,
  );
  assert.equal((await resume(ca)).ok, true);
  assert.equal(ca.p.mass, 20);
  assert.equal(ca.p.dead, false);
  assert.equal(ca.p.spawnSerial, serial + 1);
  const nextLife = ca.p.lifeId;
  assert.equal((await reply(ca, { type: "continueLife", lifeId }, "continueResult")).ok, true);
  assert.equal(ca.p.lifeId, nextLife);
  assert.equal(ca.p.spawnSerial, serial + 1);
  assert.equal(app.arena.snapshot(123000).players.find((p) => p.id === ca.p.id).lifeSeconds, 0);
});
test("Длительная пауза не даёт опыт; формат секунд/минут/часов сохраняется", async (t) => {
  const { formatDuration } = require("../../public/shared/player-identity");
  assert.equal(formatDuration(0), "00:00:00");
  assert.equal(formatDuration(59), "00:00:59");
  assert.equal(formatDuration(60), "00:01:00");
  assert.equal(formatDuration(3601), "01:00:01");
  assert.equal(formatDuration(360000), "100:00:00");
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  position(ca.p, 500);
  position(cb.p, 3000);
  at(3601000);
  app.tick();
  await settled();
  const p = app.profiles.find(a.token);
  assert.equal(p.progress.xp, 0);
  assert.equal(p.progress.lastLife.durationSeconds, 3601);
  assert.equal(p.progress.lastLife.earnedXp, 0);
  await disconnect(ca);
  assert.equal(
    app.profiles.find(a.token).progress.xp,
    0,
    "Выход из окна не начисляет результат второй раз",
  );
});

test("Ошибка записи итога/продолжения: нет раннего возрождения и повторного начисления", async (t) => {
  const { app, session, connect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  position(ca.p, 5000, 200, 200);
  position(cb.p, 10000, 2000, 1300);
  activeTicks(app, at, 0, 30000);
  at(60000);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.session.xp, 5);
  const save = app.profiles.save;
  app.profiles.save = () => {
    throw Error("TEST disk unavailable");
  };
  at(61000);
  position(ca.p, 500);
  position(cb.p, 1000);
  // This fixture tests durable absorption, not hazards. A random thorn at the
  // teleport destination can split the eater before the expected collision.
  app.arena.hazards.items = [];
  app.arena.hazards.nextAt = Infinity;
  app.tick();
  await settled();
  assert.equal(ca.p.dead, true);
  assert.equal(
    ca.messages.some((m) => m.type === "lifeEnded"),
    false,
  );
  assert.equal((await resume(ca)).ok, false);
  assert.equal(ca.p.dead, true);
  app.profiles.save = save;
  app.tick();
  await settled();
  assert.equal(app.profiles.find(a.token).progress.xp, 5);
  assert.equal(ca.messages.filter((m) => m.type === "lifeEnded").length, 1);
  app.profiles.save = () => {
    throw Error("TEST disk unavailable");
  };
  assert.equal((await resume(ca)).ok, false);
  assert.equal(ca.p.dead, true);
  app.profiles.save = save;
  assert.equal((await resume(ca)).ok, true);
  assert.equal(app.profiles.find(a.token).progress.xp, 5);
  assert.equal(app.profiles.find(a.token).progress.session.xp, 0);
});
test("Сервер: успешное применение бустера сохраняет награду с расходом; повтор не увеличивает счётчик", async (t) => {
  const { app, session, connect } = await setup(t),
    a = await session();
  app.profiles.buy(a.token, "candy", randomUUID());
  app.profiles.find(a.token).progress.boosterUses = 99;
  const ca = await connect(a),
    message = {
      type: "useBooster",
      boosterId: "candy",
      spawnSerial: ca.p.spawnSerial,
      requestId: randomUUID(),
    };
  ca.ws.send(JSON.stringify(message));
  await settled();
  ca.ws.send(JSON.stringify(message));
  await settled();
  const p = app.profiles.find(a.token);
  assert.equal(p.progress.boosterUses, 100);
  assert.equal(p.progress.xp, 0);
  assert.equal(p.greatness, 10);
  assert.equal(p.inventory.candy, 9);
  assert.equal(ca.messages.filter((m) => m.type === "boosterResult").at(-1).profile.greatness, 10);
});

test("Подтверждённый выход: серверный итог, активный опыт, повтор и новая жизнь", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session();
  app.profiles.find(a.token).progress.xp = 495;
  const ca = await connect(a);
  position(ca.p, 5000);
  activeTicks(app, at, 0, 30000);
  at(30000);
  app.tick();
  at(60001);
  const request = {
    type: "leaveLife",
    spawnSerial: ca.p.spawnSerial,
    earnedXp: 99999,
    durationSeconds: 99999,
    killer: { name: "Подмена" },
  };
  const ended = await reply(ca, request, "lifeEnded"),
    lifeId = ca.p.lifeId;
  assert.equal(ended.result.reason, "left");
  assert.equal(ended.result.killer, null);
  assert.equal(ended.result.earnedXp, 5);
  assert.equal(ended.result.durationSeconds, 60);
  assert.equal(ended.profile.level, 2);
  assert.equal(ended.profile.progress.levelXp, 0);
  assert.equal(app.profiles.find(a.token).progress.session, null);
  assert.equal(ca.p.dead, true);
  assert.equal(app.arena.snapshot(60001).players.length, 1);
  assert.ok(app.arena.snapshot(60001).players[0].departure);
  at(180000);
  app.tick();
  assert.deepEqual((await reply(ca, request, "lifeEnded")).result, ended.result);
  assert.equal(app.profiles.find(a.token).progress.xp, 500);
  assert.equal((await resume(ca)).ok, true);
  assert.equal(ca.p.mass, 20);
  assert.equal(ca.p.lifeStartedAt, 180000);
  assert.notEqual(ca.p.lifeId, lifeId);
  assert.equal(
    (await reply(ca, request, "leaveResult")).ok,
    false,
    "Старый выход не завершает следующую жизнь",
  );
  assert.equal(ca.p.dead, false);
  await disconnect(ca);
  assert.equal(app.profiles.find(a.token).progress.xp, 500);
});

test("Выход не принимает неверный номер жизни и не заменяет уже случившееся поглощение", async (t) => {
  const { app, session, connect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  for (const serial of [undefined, -1, 0.5, "0"]) {
    assert.equal(
      (await reply(ca, { type: "leaveLife", spawnSerial: serial }, "leaveResult")).ok,
      false,
    );
    assert.equal(ca.p.dead, false);
  }
  at(3000);
  position(ca.p, 500);
  position(cb.p, 1000);
  app.tick();
  await settled();
  const before = app.profiles.find(a.token).progress.lastLife;
  const answer = await reply(ca, { type: "leaveLife", spawnSerial: ca.p.spawnSerial }, "lifeEnded");
  assert.deepEqual(answer.result, before);
  assert.equal(answer.result.reason, "absorbed");
  assert.equal(answer.result.killer.name, cb.p.name);
});

test("Выход при ошибке записи: итог только после сохранения, ожидание и отключение без удвоения", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    ca = await connect(a);
  position(ca.p, 5000);
  activeTicks(app, at, 0, 30000);
  at(60000);
  app.tick();
  activeTicks(app, at, 60000, 68950);
  const save = app.profiles.save;
  app.profiles.save = () => {
    throw Error("TEST disk unavailable");
  };
  at(120001);
  const response = await reply(
    ca,
    { type: "leaveLife", spawnSerial: ca.p.spawnSerial },
    "leaveResult",
  );
  assert.equal(response.ok, false);
  assert.equal(ca.p.dead, true);
  assert.equal(
    ca.messages.some((m) => m.type === "lifeEnded"),
    false,
  );
  assert.equal(app.profiles.find(a.token).progress.xp, 0);
  assert.equal((await resume(ca)).ok, false);
  at(240000);
  app.profiles.save = save;
  app.tick();
  await settled();
  const result = ca.messages.filter((m) => m.type === "lifeEnded").at(-1).result;
  assert.equal(result.earnedXp, 5);
  assert.equal(result.durationSeconds, 120);
  assert.equal(result.reason, "left");
  await disconnect(ca);
  app.tick();
  assert.equal(app.profiles.find(a.token).progress.xp, 5);
});

test("Подтверждённый выход сохраняется после обрыва соединения во время сбоя диска", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    ca = await connect(a);
  position(ca.p, 500);
  activeTicks(app, at, 0, 9000);
  at(60001);
  const save = app.profiles.save;
  app.profiles.save = () => {
    throw Error("TEST disk unavailable");
  };
  await reply(ca, { type: "leaveLife", spawnSerial: ca.p.spawnSerial }, "leaveResult");
  await disconnect(ca);
  app.profiles.save = save;
  at(240000);
  app.tick();
  const p = app.profiles.find(a.token);
  assert.equal(p.progress.xp, 0);
  assert.equal(p.progress.lastLife.durationSeconds, 60);
  assert.equal(p.progress.lastLife.earnedXp, 0);
  assert.equal(p.progress.session, null);
});

test("Выход оставляет одну съедобную модель, поглощение не завершает новую жизнь владельца", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    b = await session(),
    ca = await connect(a),
    cb = await connect(b);
  at(5000);
  position(ca.p, 500);
  position(cb.p, 1500, 2000, 800);
  const request = { type: "leaveLife", spawnSerial: ca.p.spawnSerial },
    ended = await reply(ca, request, "lifeEnded");
  const remnants = () => [...app.arena.players.values()].filter((p) => p.isRemnant);
  assert.equal(remnants().length, 1);
  const remnant = remnants()[0];
  assert.equal(remnant.mass, 500);
  await reply(ca, request, "lifeEnded");
  await disconnect(ca);
  assert.equal(remnants().length, 1, "повтор команды и закрытие сокета не создают копий");
  const again = await connect(a),
    newLife = app.profiles.find(a.token).progress.session.id;
  position(again.p, 20, 3000, 2000);
  at(10000);
  position(cb.p, 1500, remnant.x, remnant.y);
  cb.p.nextMassDecayAt = Infinity;
  app.tick();
  assert.equal(cb.p.mass, 1900);
  assert.equal(app.profiles.find(b.token).progress.session.xp, 3);
  assert.equal(app.profiles.find(a.token).progress.session.id, newLife);
  assert.equal(app.profiles.find(a.token).progress.session.xp, 0);
  assert.deepEqual(app.profiles.find(a.token).progress.lastLife, ended.result);
  assert.equal(again.p.dead, false);
  at(10050);
  app.tick();
  assert.equal(remnants().length, 0);
});

test("Обрыв оставляет модель ровно на 15 секунд, без фонового прогресса", async (t) => {
  const { app, session, connect, disconnect, at } = await setup(t),
    a = await session(),
    ca = await connect(a);
  position(ca.p, 500);
  at(5000);
  await disconnect(ca);
  const saved = structuredClone(app.profiles.find(a.token).progress),
    remnant = [...app.arena.players.values()].find((p) => p.isRemnant);
  assert.ok(remnant);
  at(19500);
  app.tick();
  assert.equal(app.arena.snapshot(19500).players[0].departure.remainingMs, 500);
  at(19999);
  app.tick();
  assert.equal(app.arena.snapshot(19999).players[0].departure.remainingMs, 1);
  at(20000);
  app.tick();
  assert.equal(app.arena.players.size, 0);
  assert.deepEqual(app.profiles.find(a.token).progress, saved);
});

for (const exit of ["leaveLife", "disconnect"])
  test(`${exit}: оставшаяся модель поглощает игрока и сохраняет его итог, не затрагивая новую жизнь владельца`, async (t) => {
    const { app, session, connect, disconnect, at } = await setup(t),
      a = await session(),
      b = await session(),
      ca = await connect(a),
      cb = await connect(b);
    at(5000);
    position(ca.p, 1000);
    position(cb.p, 100, 2000, 800);
    app.profiles.find(b.token).progress.session.xp = 7;
    if (exit === "leaveLife")
      await reply(ca, { type: "leaveLife", spawnSerial: ca.p.spawnSerial }, "lifeEnded");
    await disconnect(ca);
    const remnant = [...app.arena.players.values()].find((p) => p.isRemnant),
      saved = structuredClone(app.profiles.find(a.token).progress.lastLife),
      again = await connect(a),
      newLife = app.profiles.find(a.token).progress.session.id;
    position(again.p, 20, 3000, 2000);
    at(6000);
    position(cb.p, 100, remnant.x, remnant.y);
    app.tick();
    await settled();
    const victim = app.profiles.find(b.token).progress;
    assert.equal(cb.p.dead, true);
    assert.equal(remnant.mass, 1080);
    assert.equal(remnant.removeAt, 20000);
    assert.equal(victim.lastLife.reason, "absorbed");
    assert.equal(victim.lastLife.killer.name, ca.p.name);
    assert.equal(victim.lastLife.earnedXp, 7);
    assert.equal(victim.session, null);
    assert.equal(cb.messages.filter((m) => m.type === "lifeEnded").length, 1);
    assert.equal(app.profiles.find(a.token).progress.session.id, newLife);
    assert.equal(app.profiles.find(a.token).progress.session.xp, 0);
    assert.deepEqual(app.profiles.find(a.token).progress.lastLife, saved);
    at(6050);
    app.tick();
    assert.equal(app.profiles.find(b.token).progress.xp, 7);
    assert.equal(again.p.dead, false);
  });

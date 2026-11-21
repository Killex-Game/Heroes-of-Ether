"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  { once } = require("node:events"),
  WebSocket = require("ws");
const { setup } = require("../fixtures/season-trophies");
const { createGameServer } = require("../../src/server/game-server");
const { Arena } = require("../../src/server/arena/arena-simulation");

test("Clan snapshots separate rankings, and unchanged update blocks are omitted", () => {
  const f = setup({ count: 12 }),
    head = f.heads[0];
  f.time(f.now() + 86400000);
  f.profiles.refreshCompetition();
  const state = (scope) => f.clans.state(head.token, "", 1, "", "greatness", 1, "greatness", scope);
  const full = state("all"),
    clan = state("clan"),
    rankings = state("rankings");
  assert.deepEqual(clan.competition, full.competition);
  assert.equal(clan.playerLeaders, undefined);
  assert.equal(clan.clans, undefined);
  assert.deepEqual(rankings.playerLeaders, full.playerLeaders);
  assert.equal(rankings.competition, undefined);
  assert.equal(rankings.mine.members, undefined);
  const initial = f.clans.updates(head.token, ["battle", "league", "members"]);
  assert.ok(initial.changes.identity.competition.trophies);
  assert.deepEqual(
    f.clans.updates(head.token, ["battle", "league", "members"], initial.versions).changes,
    {},
  );
  f.clans.state = () => {
    throw Error("Polling must not rebuild full state or rankings");
  };
  f.clans.details = () => {
    throw Error("Battle polling must not build member identities");
  };
  const battle = f.clans.updates(head.token, ["battle"]);
  assert.equal(battle.changes.battle.competition.group, undefined);
  assert.equal(battle.changes.identity, undefined);
  assert.equal(battle.changes.members, undefined);
  assert.ok(
    JSON.stringify(f.clans.updates(head.token, ["battle"], battle.versions)).length <
      JSON.stringify(full).length / 5,
  );
});

test("Changed identity and membership invalidate only their blocks; retries are read-only", () => {
  const f = setup({ count: 2 }),
    head = f.heads[0],
    all = ["battle", "league", "members"];
  const initial = f.clans.updates(head.token, all),
    wallet = { ...f.p(head).wallet };
  f.act(head, "edit", { clanId: f.c(head).id, description: "Обновлено" });
  const changed = f.clans.updates(head.token, all, initial.versions);
  assert.equal(changed.changes.identity.mine.description, "Обновлено");
  assert.equal(changed.changes.league, undefined);
  assert.equal(changed.changes.battle, undefined);
  assert.deepEqual(f.clans.updates(head.token, all, changed.versions).changes, {});
  assert.deepEqual(f.p(head).wallet, wallet);
  f.act(head, "disband", { clanId: f.c(head).id });
  const left = f.clans.updates(head.token, all, changed.versions);
  assert.equal(left.clanId, null);
  assert.equal(left.changes.members.mine, null);
  assert.equal(left.changes.battle.competition, null);
  assert.throws(() => f.clans.updates(head.token, ["private"], {}));
  assert.throws(() => f.clans.updates(head.token, ["battle"], null));
});

test("Split HTTP reads enforce authentication and recover after an interrupted request", async (t) => {
  const f = setup(),
    app = createGameServer({ profiles: f.profiles, autoTick: false });
  await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + app.httpServer.address().port,
    headers = { Cookie: "sferorumiya_session=" + f.heads[0].token };
  assert.equal((await fetch(base + "/api/clans/updates?parts=battle")).status, 401);
  assert.equal(
    (await fetch(base + "/api/clans/updates?parts=battle&known=null", { headers })).status,
    400,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetch(base + "/api/clans/updates?parts=battle", { headers, signal: controller.signal }),
  );
  const read = await fetch(base + "/api/clans/updates?parts=battle", { headers });
  assert.equal(read.status, 200);
  const data = await read.json(),
    repeat = await (
      await fetch(
        base +
          "/api/clans/updates?parts=battle&known=" +
          encodeURIComponent(JSON.stringify(data.versions)),
        { headers },
      )
    ).json();
  assert.deepEqual(repeat.changes, {});
  const clan = await (await fetch(base + "/api/clans?scope=clan", { headers })).json();
  assert.equal(clan.playerLeaders, undefined);
});

test("Arena sends movement every tick, rankings once a second, and a full snapshot on reconnect", async (t) => {
  let at = 5000;
  const arena = new Arena({ etherCount: 0 }),
    app = createGameServer({ arena, autoTick: false, now: () => at });
  await new Promise((r) => app.httpServer.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const url = "ws://127.0.0.1:" + app.httpServer.address().port;
  const ws = new WebSocket(url),
    messages = [];
  ws.on("message", (raw) => messages.push(JSON.parse(raw)));
  await once(ws, "open");
  t.after(() => ws.terminate());
  const flush = () => new Promise((r) => setTimeout(r, 15));
  await flush();
  assert.ok(messages.find((m) => m.type === "state")?.leaderboard);
  messages.length = 0;
  let calculations = 0;
  const original = arena.rankings.bind(arena);
  arena.rankings = (players) => {
    calculations++;
    return original(players);
  };
  for (let i = 0; i < 20; i++) {
    at += 50;
    app.tick();
  }
  await flush();
  const states = messages.filter((m) => m.type === "state");
  assert.equal(states.length, 20);
  assert.equal(states.filter((m) => Array.isArray(m.leaderboard)).length, 1);
  assert.equal(calculations, 1);
  for (const state of states) {
    assert.ok(Array.isArray(state.players));
    assert.ok(Array.isArray(state.projectiles));
  }
  at += 50;
  app.tick();
  await flush();
  assert.equal(calculations, 2);
  ws.close();
  await once(ws, "close");
  const reconnect = new WebSocket(url),
    again = [];
  reconnect.on("message", (raw) => again.push(JSON.parse(raw)));
  await once(reconnect, "open");
  t.after(() => reconnect.terminate());
  await flush();
  assert.ok(again.find((m) => m.type === "state")?.leaderboard);
});

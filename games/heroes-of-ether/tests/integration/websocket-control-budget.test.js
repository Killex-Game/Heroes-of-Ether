"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { once } = require("node:events"), WebSocket = require("ws");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { createGameServer } = require("../../src/server/game-server");

test("a peer unable to drain automatic pongs is disconnected; healthy clients and HTTP stay usable", { timeout: 5000 }, async t => {
  const profiles = new ProfileStore(), first = profiles.open(), second = profiles.open();
  const app = createGameServer({profiles, arena:new Arena({etherCount:0}), autoTick:false});
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
  t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  async function connect(auth) {
    const accepted = once(app.wss, "connection");
    const client = new WebSocket(url, {headers:{Cookie:"sferorumiya_session=" + auth.token}});
    t.after(() => client.terminate());
    const [server] = await accepted; await once(client,"open");
    return {client,server};
  }
  const slow = await connect(first), healthy = await connect(second);
  const pong = once(healthy.client,"pong"); healthy.client.ping("normal");
  assert.equal((await pong)[0].toString(), "normal");
  // Deterministic blocked transport: cap the number of pending control writes
  // without sending an unbounded stream or exhausting real process memory.
  let attempted = 0;
  t.mock.method(slow.server, "pong", () => { attempted++; });
  const closed = once(slow.client,"close");
  for (let n=0;n<80;n++) slow.client.ping("bounded-regression");
  await closed;
  assert.ok(attempted > 0 && attempted <= 60, "automatic responses have a finite backlog");
  const stillPong = once(healthy.client,"pong"); healthy.client.ping("still-alive");
  assert.equal((await stillPong)[0].toString(),"still-alive");
  assert.equal((await fetch(url + "/api/service-status")).status,200);
});

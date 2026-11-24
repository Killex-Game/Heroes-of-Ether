"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), path = require("node:path");
const { fork } = require("node:child_process"), { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { WebSocketServer } = require("ws");

test("real load driver keeps a delayed respawn in its original gap metric and records the boundary", { timeout: 10000 }, async t => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  t.after(() => { for (const socket of server.clients) socket.terminate(); server.close(); });
  let socket;
  server.on("connection", ws => { socket = ws; ws.send(JSON.stringify({ type: "welcome", id: "synthetic-player" })); });
  const child = fork(path.resolve(__dirname, "../../scripts/benchmarks/room-input-clients.cjs"), [], {
    windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, LOAD_REJOIN: "1", LOAD_CAPACITY: "1" },
  });
  t.after(() => { if (child.connected) child.disconnect(); if (!child.killed) child.kill(); });
  let next = 1;
  async function command(message) {
    const id = next++;
    const response = new Promise((resolve, reject) => {
      const receive = value => { if (value.id !== id) return; child.off("message", receive); value.error ? reject(Error(value.error)) : resolve(value.result); };
      child.on("message", receive);
    });
    child.send({ id, ...message });
    return response;
  }
  await command({ type: "connect", url: `ws://127.0.0.1:${server.address().port}`, token: "synthetic-only", roomId: "room-test", indexInRoom: 2, boosters: [] });
  await command({ type: "phase", name: "combined" });
  const state = serial => socket.send(JSON.stringify({ type: "state", stateSequence: serial,
    players: [{ id: "synthetic-player", spawnSerial: serial, x: 50, y: 60 }] }));
  state(1);
  await delay(100);
  socket.send(JSON.stringify({ type: "lifeEnded", result: { id: "life-one" } }));
  await delay(180);
  state(2);
  await delay(40);
  const result = await command({ type: "stats" });
  assert.equal(result.perClientBytes[0].packets, 2);
  assert(result.clientGaps.max >= 200);
  assert.equal(result.longestStateGaps.length, 1);
  const gap = result.longestStateGaps[0];
  assert.equal(gap.gapMs, result.clientGaps.max);
  assert.equal(gap.roomId, "room-test"); assert.equal(gap.slot, 2);
  assert.equal(gap.spansLifeEnd, true); assert.equal(gap.spawnChanged, true);
  await command({ type: "phase", name: "combined" });
  assert.deepEqual((await command({ type: "stats" })).longestStateGaps, []);
});

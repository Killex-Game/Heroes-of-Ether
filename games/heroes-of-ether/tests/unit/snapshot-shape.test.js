"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Arena } = require("../../src/server/arena/arena-simulation");
const { ArenaStateStream, STATE_PROTOCOL } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
test("Stable player snapshots retain identical wire bytes across departure and respawn", () => {
  for (const protocol of ["", STATE_PROTOCOL, wire.LEGACY_PROTOCOL, wire.ENTITY_PROTOCOL, wire.PRESENTATION_PROTOCOL,
    wire.MOTION_PROTOCOL, wire.HUD_PROTOCOL, wire.PRIVATE_STATE_PROTOCOL, wire.PROTOCOL]) {
    const arena = new Arena({ etherCount: 0 }), p = arena.addPlayer(0, "player");
    const setup = () => {
      const packets = [], ws = { protocol, readyState: 1, bufferedAmount: 0, playerId: p.id };
      return { packets, stream: new ArenaStateStream(ws, (_, packet) => packets.push(packet.toString()), () => 0) };
    };
    const actual = setup(), originalShape = setup();
    for (let tick = 1; tick <= 5; tick++) {
      arena.tick = tick; p.isRemnant = tick === 2 || tick === 3; p.removeAt = 5000; p.dead = tick === 5;
      const snapshot = arena.snapshot(tick * 100);
      const reference = { ...snapshot, players: snapshot.players.map(row => {
        const old = { ...row }; if (old.departure === undefined) delete old.departure; return old;
      }) };
      assert.equal(JSON.stringify(snapshot), JSON.stringify(reference));
      actual.stream.publish(snapshot); originalShape.stream.publish(reference);
      actual.stream.acknowledge(actual.stream.sequence); originalShape.stream.acknowledge(originalShape.stream.sequence);
      assert.deepEqual(actual.packets, originalShape.packets, protocol + ": tick " + tick);
    }
  }
});

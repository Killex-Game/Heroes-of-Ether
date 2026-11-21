"use strict";
// Isolated transport comparison; not a room/client capacity result.
const { performance } = require("node:perf_hooks");
const { FoodTransferEncoder, FoodTransferDecoder } = require("../../src/server/arena/worker-food-transfer");
function run(packed, moving) {
  const rooms = Array.from({ length: 10 }, () => ({ encoder: new FoodTransferEncoder({ packed }),
    decoder: new FoodTransferDecoder(), food: Array.from({ length: 1224 }, (_, i) => ({
      id: `e${i}`, x: i + 0.123456789, y: i * 2, value: 5, radius: 4,
      birth: { at: 1, origin: { x: i, y: 1 } }
    })) }));
  let encodeMs = 0, cloneMs = 0, decodeMs = 0;
  for (let tick = 0; tick < 120; tick++) for (const room of rooms) {
    for (let i = 0; i < moving; i++) { room.food[i].x += 0.001; room.food[i].y += 0.002; }
    if (tick % 10 === 0) room.food[500].value++;
    const start = performance.now(), packet = room.encoder.encode(room.food), encoded = performance.now();
    const copy = packed && packet ? structuredClone(packet,
      { transfer: [packet.refs.buffer, packet.positions.buffer] }) : structuredClone(packet);
    const cloned = performance.now();
    room.decoder.decode(copy);
    if (tick >= 20) { encodeMs += encoded - start; cloneMs += cloned - encoded; decodeMs += performance.now() - cloned; }
  }
  return { packed, moving, encodeMs, cloneMs, decodeMs, totalMs: encodeMs + cloneMs + decodeMs };
}
for (const moving of [0, 300, 1224]) for (const packed of [false, true, true, false]) console.log(JSON.stringify(run(packed, moving)));

/* Presentation only: this thread never opens profiles or runs game mechanics. */
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const output = workerData?.outputPort || parentPort;
const { performance } = require("node:perf_hooks");
const { ArenaStateStream, RoomFoodEncoder } = require("./state-stream");
const { FoodTransferDecoder } = require("./worker-food-transfer");
const { unpackPlayers } = require("./worker-part-transfer");
const rooms = new Map();
let at = 0,
  packets;
parentPort.on("message", (job) => {
  const started = performance.now();
  at = job.at;
  packets = [];
  const pendingRooms = [];
  for (const update of job.rooms) {
    let peers = rooms.get(update.id);
    if (!peers) {
      rooms.set(update.id, (peers = new Map()));
      peers.foodEncoder = new RoomFoodEncoder();
      peers.foodTransfer = new FoodTransferDecoder();
    }
    const active = new Set(update.peers.map((peer) => peer.id));
    for (const id of peers.keys()) if (!active.has(id)) peers.delete(id);
    for (const meta of update.peers) {
      let stream = peers.get(meta.id);
      if (!stream) {
        const ws = { ...meta, readyState: 1 };
        stream = new ArenaStateStream(
          ws,
          (_, data) => {
            packets.push({
              room: update.id,
              id: meta.id,
              sequence: stream.sequence,
              data: Buffer.isBuffer(data) ? data : Buffer.from(data),
            });
          },
          () => at,
          peers.foodEncoder,
        );
        peers.set(meta.id, stream);
      }
      stream.ws.playerId = meta.playerId;
      stream.ws.bufferedAmount = meta.bufferedAmount;
      stream.viewport = meta.viewport;
      if (!stream.acknowledge(meta.acknowledgedSequence)) stream.flush();
    }
    for (const group of update.states) {
      const snapshot = { ...group.snapshot, ether: peers.foodTransfer.decode(group.food) };
      if (group.partValues) snapshot.players = unpackPlayers(snapshot.players, group.partValues);
      for (const id of group.ids) peers.get(id)?.publish(snapshot);
    }
    if (!peers.size) rooms.delete(update.id);
    if ([...peers.values()].some((stream) => !!stream.pending)) pendingRooms.push(update.id);
  }
  // A dedicated transferable allocation avoids cloning pooled Node buffers.
  // Windows sends small server frames as one buffer. Reserve the maximum ws
  // header here so the main thread need not allocate/copy every whole packet.
  // Zero the reservation: unused headroom must never expose allocator bytes.
  const headroom = process.platform === "win32" ? 10 : 0;
  const bytes = Buffer.allocUnsafeSlow(packets.reduce((size, p) => size + headroom + p.data.length, 0));
  let offset = 0;
  const entries = packets.map((p) => {
    bytes.fill(0, offset, offset + headroom);
    offset += headroom;
    p.data.copy(bytes, offset);
    const result = { room: p.room, id: p.id, sequence: p.sequence, offset, length: p.data.length, headroom };
    offset += p.data.length;
    return result;
  });
  output.postMessage(
    {
      job: job.id,
      entries,
      buffer: bytes.buffer,
      pendingRooms,
      workerMs: performance.now() - started,
    },
    [bytes.buffer],
  );
});

"use strict";
// Isolated load adapter. Production authentication/admission is deliberately
// not provided here. Inputs cross real sockets and share the room's tick fence.
const { BoosterError } = require("../../../src/server/boosters/booster-catalog");
class SocketInputs {
  constructor(room) {
    this.room = room; this.moves = new Map(); this.actions = [];
    this.metrics = { moves: 0, feed: 0, split: 0, booster: 0, rejected: 0, maxQueue: 0,
      accepted:{feed:0,split:0} };
  }
  connect(ws, index) {
    const p = this.room.players[index];
    ws.send(JSON.stringify({ type: "fixtureWelcome", playerId: p.id, index,
      boosters: p.quickSlots, roomId: this.room.id }), { binary: false });
  }
  result(playerId, requestId, ok, message) {
    if(this.room.frameOwner?.capturing){
      this.room.frameOwner.defer(()=>this.sendResult(playerId,requestId,ok,message));return;
    }
    this.sendResult(playerId,requestId,ok,message);
  }
  sendResult(playerId, requestId, ok, message) {
    const ws = this.room.connectionsByPlayer.get(playerId)?.ws;
    if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "boosterResult", requestId, ok,
      ...(message ? { message } : {}) }), { binary: false });
  }
  receive(ws, message) {
    if (!message || typeof message !== "object") return;
    const p = this.room.arena.players.get(ws.playerId);
    if (!p) return;
    if (message.type === "move") {
      this.moves.set(p.id, message); this.metrics.moves++; return;
    }
    if (message.type === "viewport") {
      if ([message.x, message.y, message.width, message.height].every(Number.isFinite) &&
          message.width > 0 && message.width <= 12000 && message.height > 0 && message.height <= 12000)
        this.room.connectionsByPlayer.get(p.id).viewport = { x: message.x, y: message.y,
          width: message.width, height: message.height };
      return;
    }
    if (!["feed", "split", "booster"].includes(message.type)) return;
    this.metrics[message.type]++;
    if (this.actions.length >= 512) {
      this.metrics.rejected++;
      if (message.type === "booster") this.result(p.id, message.requestId, false, "Input queue full");
      return;
    }
    this.actions.push({ playerId: p.id, message });
    this.metrics.maxQueue = Math.max(this.metrics.maxQueue, this.actions.length);
  }
  drain(at) {
    // The fixture calls this only after checking cast reservations. A queued
    // feed/split cannot mutate the exact body awaiting its durable ACK.
    const { arena, casts } = this.room;
    for (const [id, input] of this.moves) arena.handleInput(id, input, at);
    this.moves.clear();
    for (const { playerId, message } of this.actions.splice(0)) {
      try {
        if (message.type !== "booster") {
          if(arena.handleInput(playerId, message, at))this.metrics.accepted[message.type]++;
          continue;
        }
        const p = arena.players.get(playerId);
        if (!p || p.dead || !this.room.readyLives.has(p.lifeId)) throw new BoosterError("Life not committed", 409);
        if (!casts) throw Error("Socket benchmark requires durable casts");
        casts.request(p, message);
      } catch (error) {
        if (!(error instanceof BoosterError)) throw error;
        this.metrics.rejected++;
        if (message.type === "booster") this.result(playerId, message.requestId, false, error.message);
      }
    }
  }
}
module.exports = { SocketInputs };

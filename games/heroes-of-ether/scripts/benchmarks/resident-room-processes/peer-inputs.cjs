"use strict";
const { randomUUID } = require("node:crypto");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const { Decoder } = require("../../../public/shared/arena-wire");
const { InputState } = require("./input-state.cjs");
const { summary } = require("./room-fixture.cjs");
class PeerInputs {
  constructor({ inputProjection = process.env.ROOM_BENCH_INPUT_PROJECTION === '1' } = {}) {
    this.inputProjection = inputProjection;
    this.clients = []; this.timer = null; this.requests = 0; this.success = 0;
    this.failed = {}; this.latencies = []; this.successLatencies = []; this.offered = {};
    this.confirmed=process.env.ROOM_BENCH_DURABLE_OWNER==='1'?[]:null;
    this.loop = monitorEventLoopDelay({ resolution: 10 }); this.loop.enable();
  }
  add(ws) {
    const client = { ws, sequence: 0, players: new Map(), decoder: this.inputProjection ? new InputState() : new Decoder(), pending: new Map(), ordinal: 0 };
    this.clients.push(client); return client;
  }
  receive(c, m, at) {
    if (m.type === "fixtureWelcome") Object.assign(c, { id: m.playerId, index: m.index, boosters: m.boosters });
    if (m.type === "boosterResult") {
      const request = c.pending.get(m.requestId);
      if (!request) return;
      c.pending.delete(m.requestId); this.latencies.push(at - request.at);
      if (m.ok) { this.success++; this.successLatencies.push(at - request.at);
        this.confirmed?.push({playerId:c.id,requestId:m.requestId,boosterId:request.boosterId}); }
      else this.failed[m.message] = (this.failed[m.message] || 0) + 1;
    }
    if (m.type !== "state") return;
    // The load driver uses the same decoder as the browser: removals, unset
    // fields, private HUD and packed formations must affect its next input.
    const state = c.decoder.decode(m);
    if (this.inputProjection) c.players = state;
    else if (Array.isArray(state.players)) c.players = new Map(state.players.map(p => [p.id, p]));
  }
  send(c, message) {
    if (c.ws.readyState !== 1) return;
    c.ws.send(JSON.stringify(message)); this.offered[message.type] = (this.offered[message.type] || 0) + 1;
  }
  start() {
    if (this.timer) return;
    this.started = performance.now(); this.loop.reset();
    for (const c of this.clients) { c.feedAt = this.started + 700; c.splitAt = this.started + 3700; c.boosterAt = this.started + 2000 + c.index * 10; }
    this.timer = setInterval(() => this.tick(performance.now()), 100);
  }
  tick(at) {
    for (const c of this.clients) {
      const p = c.players.get(c.id); if (!p || p.dead) continue;
      const elapsed = (at - this.started) / 1000, angle = elapsed + c.index;
      const x = 500 + c.index % 7 * 650 + Math.cos(angle) * 160;
      const y = 500 + Math.floor(c.index / 7) * 630 + Math.sin(angle) * 160;
      const common = { spawnSerial: p.spawnSerial };
      this.send(c, { ...common, type: "move", x, y });
      // Camera reports use 250 ms; movement follows the mixed-load 10 Hz canon.
      if (at >= (c.viewportAt || 0)) {
        c.viewportAt = at + 250;
        this.send(c, { type: "viewport", x: p.x, y: p.y, width: 1800, height: 1200 });
      }
      if (at >= c.feedAt) { c.feedAt = at + 700; this.send(c, { ...common, type: "feed", sequence: ++c.sequence, x, y }); }
      if (at >= c.splitAt) { c.splitAt = at + 3700; this.send(c, { ...common, type: "split", sequence: ++c.sequence, x, y }); }
      if (at < c.boosterAt || c.pending.size) continue;
      c.boosterAt = at + 2000;
      const other = [...c.players.values()].filter(o => o.id !== p.id && !o.dead && !o.departure)
        .sort((a,b) => Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      const requestId = randomUUID(), boosterId = c.boosters[c.ordinal++ % c.boosters.length];
      c.pending.set(requestId, { at, boosterId }); this.requests++;
      this.send(c, { ...common, type: "booster", sequence: ++c.sequence, requestId, boosterId,
        x, y, aimX: other?.x ?? x, aimY: other?.y ?? y, targetId: other?.id, targetSpawnSerial: other?.spawnSerial });
    }
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  report() {
    this.stop(); this.loop.disable();
    return { inputState: this.inputProjection ? 'headless-projection' : 'browser-decoder', offered: this.offered, requests: this.requests, successful: this.success, failures: this.failed,
      pending: this.clients.reduce((n,c)=>n+c.pending.size,0), latencyMs: summary(this.latencies),
      successfulLatencyMs: summary(this.successLatencies), driverLoopP95Ms: this.loop.percentile(95)/1e6,
      ...(this.confirmed?{confirmed:this.confirmed}:{}),
      driverLoopMaxMs: this.loop.max/1e6 };
  }
}
module.exports = { PeerInputs };

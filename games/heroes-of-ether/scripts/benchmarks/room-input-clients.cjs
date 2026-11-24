"use strict";
const WebSocket = require("ws"),
  { once } = require("node:events"),
  { randomUUID } = require("node:crypto"),
  { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const driverDelay = monitorEventLoopDelay({ resolution: 10 });
driverDelay.enable();
let driverCpu;
const { STATE_PROTOCOL } = require("../../src/server/arena/state-stream");
const wire = require("../../public/shared/arena-wire");
const gapContext = require("./state-gap-context.cjs");
const clients = [];
const realistic = process.env.LOAD_REALISTIC === "1";
// Optional bounded samples for offline wire-format comparisons. Synthetic
// load profiles only; never attached to the public game or every live packet.
let wireSamples = [], nextWireSample = 0;
let phase = "setup",
  beat = 0,
  timer,
  start;
const send = (c, m) => {
  if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ spawnSerial: c.serial, ...m }));
};
const reset = (c) =>
  Object.assign(c, {
    packets: 0,
    bytes: 0,
    gaps: [],
    longGaps: [],
    last: null,
    used: 0,
    usedByType: {},
    failures: {},
    fieldBytes: {},
    maxPacket: 0,
    requested: 0,
    actionLatency: [],
    successLatency: [],
  });
const q = (a) => {
  a.sort((a, b) => a - b);
  return {
    p50: a[Math.floor(a.length * 0.5)] || 0,
    p95: a[Math.floor(a.length * 0.95)] || 0,
    p99: a[Math.floor(a.length * 0.99)] || 0,
    max: a.at(-1) || 0,
  };
};
process.on("message", async (m) => {
  try {
    let result;
    if (m.type === "connect") {
      const c = {
        seq: 0,
        audit: require("./load-ack-audit.cjs").createAckAudit(m.token),
        boosters: m.boosters,
        potion:m.potion,potionPending:false,potionReadyAt:0,
        requests: new Map(),
        roomId: m.roomId,
        indexInRoom: m.indexInRoom ?? clients.length,
      };
      reset(c);
      clients.push(c);
      c.ws = new WebSocket(
        m.url,
        [process.env.LOAD_PROTOCOL || wire.PROTOCOL, ...(m.ticket ? ["ticket." + m.ticket] : [])],
        {
          headers: { Cookie: "sferorumiya_session=" + m.token },
        },
      );
      c.ws.on("error", () => {});
      const welcome = new Promise((resolve) =>
        c.ws.on("message", (raw) => {
          const v = JSON.parse(raw),
            at = performance.now();
          if (v.type === "welcome") {
            c.playerId = v.id;
            resolve({ playerId: v.id });
          }
          if (v.type === "lifeEnded" && v.result?.id) {
            c.lastLifeEndAt = at;
            if (process.env.LOAD_REJOIN === "1") send(c, { type: "continueLife", lifeId: v.result.id });
          }
          if (v.type === "boosterResult") {
            const request = c.requests.get(v.requestId);
            const type = request?.type || "unknown";
            if(type===c.potion){c.potionPending=false;if(v.ok)c.potionLife=c.serial;else c.potionReadyAt=at+2000;}
            if (request) c.actionLatency.push(at - request.at);
            c.requests.delete(v.requestId);
            if (v.ok) {
              c.audit(v.requestId, "booster:" + type);
              if (request) c.successLatency.push(at - request.at);
              c.used++;
              c.usedByType[type] = (c.usedByType[type] || 0) + 1;
            } else c.failures[v.message] = (c.failures[v.message] || 0) + 1;
          }
          if (v.type !== "state") return;
          if (process.env.LOAD_CAPTURE_WIRE && c === clients[0] && at >= nextWireSample && wireSamples.length < 5) {
            wireSamples.push(raw.toString());
            nextWireSample = at + 5000;
          }
          if (c === clients[0] && process.env.LOAD_CAPACITY !== "1")
            c.packetSizes = Object.fromEntries(
              Object.entries(v).map(([k, value]) => [k, Buffer.byteLength(JSON.stringify(value))]),
            );
          // The 35 renderers normally run on 35 other machines. This driver parses
          // actual packets and ACKs them, but does not render/decode 35 entire worlds
          // on the same two CPU cores as the server under test.
          const ownRow = (v.playersDelta?.upsert || v.players)?.find((p) =>
            (Array.isArray(p) ? p[0] : p.id) === c.playerId);
          const previousSerial = c.serial, me = wire.unpackPlayerChange(ownRow);
          if (me?.spawnSerial !== undefined) c.serial = me.spawnSerial;
          if (me?.x !== undefined) c.x = me.x;
          if (me?.y !== undefined) c.y = me.y;
          c.packets++;
          c.bytes += raw.length;
          c.maxPacket = Math.max(c.maxPacket, raw.length);
          if (process.env.LOAD_WIRE_DIAG === "1") {
            for (const [key, value] of Object.entries(v))
              c.fieldBytes[key] = (c.fieldBytes[key] || 0) + Buffer.byteLength(JSON.stringify(value));
            if (c === clients[0]) for (const p of v.playersDelta?.upsert || [])
              for (const [key, value] of Object.entries(wire.unpackPlayerChange(p))) {
                const label = "samplePlayer:" + key;
                c.fieldBytes[label] = (c.fieldBytes[label] || 0) + Buffer.byteLength(JSON.stringify(value));
              }
          }
          gapContext.record(c, at, previousSerial, v.stateSequence);
          if (c.last !== null) c.gaps.push(at - c.last);
          c.last = at;
          if (v.stateSequence)
            setTimeout(() => send(c, { type: "stateAck", sequence: v.stateSequence }), 60);
        }),
      );
      await once(c.ws, "open");
      result = await welcome;
    } else if (m.type === "phase") {
      phase = m.name;
      clients.forEach(reset);
      start = performance.now();
      wireSamples = [];
      nextWireSample = start + 1000;
      driverCpu = process.cpuUsage();
      driverDelay.reset();
    } else if (m.type === "start")
      timer = setInterval(() => {
        beat++;
        for (const [i, c] of clients.entries()) {
          const index = c.indexInRoom,
            x = 250 + (index % 7) * 480 + Math.cos(beat / 20 + index) * 160,
            y = 200 + Math.floor(index / 7) * 440 + Math.sin(beat / 20 + index) * 160;
          send(c, { type: "move", x, y });
          if(c.potion && c.serial!==undefined && c.potionLife!==c.serial && !c.potionPending && performance.now()>=c.potionReadyAt){
            const requestId=randomUUID();c.requests.set(requestId,{type:c.potion,at:performance.now()});c.requested++;c.potionPending=true;
            send(c,{type:"useBooster",boosterId:c.potion,requestId});
          }
          // Fixed, explicitly reported viewport, including a generous server margin.
          if (process.env.LOAD_VISIBILITY !== "0" && beat % 3 === 0)
            send(c, { type: "viewport", x: c.x ?? x, y: c.y ?? y, width: 1800, height: 1200 });
          if ((phase === "split" || phase === "combined") && (!realistic || beat % 37 === i % 37))
            send(c, { type: "split", sequence: ++c.seq });
          if ((phase === "feed" || phase === "combined") && (realistic ? beat % 7 === i % 7 : beat % 2 === 0))
            send(c, { type: "feed", sequence: ++c.seq, x, y });
          if(realistic && beat % 53 === i % 53)send(c,{type:"emote",index:Math.floor(beat/53)%9+1});
          if ((phase === "boosters" || phase === "combined") && beat % 20 === i % 20) {
            const boosterId =
              c.boosters[
                (Math.floor(beat / 20) + (process.env.LOAD_COMBAT === "1" ? i : 0)) %
                  c.boosters.length
              ];
            const requestId = randomUUID();
            c.requests.set(requestId, { type: boosterId, at: performance.now() });
            c.requested++;
            const peers = clients.filter((p) => p.roomId === c.roomId);
            const target =
              process.env.LOAD_COMBAT === "1" ? peers[(index + 1) % peers.length] : null;
            send(c, {
              type: "useBooster",
              boosterId,
              requestId,
              aimX: target?.x ?? x + 250,
              aimY: target?.y ?? y,
            });
          }
        }
      }, 100);
    else if (m.type === "stats") {
      if (process.env.LOAD_CAPTURE_WIRE) {
        const fs = require("node:fs"), path = require("node:path");
        fs.mkdirSync(process.env.LOAD_CAPTURE_WIRE, {recursive:true});
        fs.writeFileSync(path.join(process.env.LOAD_CAPTURE_WIRE, process.pid + "-" + phase + ".ndjson"), wireSamples.join("\n") + "\n");
      }
      const elapsed = performance.now() - start;
      const cpu = process.cpuUsage(driverCpu);
      result = {
        driver: { clients: clients.length, cpuPercent: (cpu.user + cpu.system) / elapsed / 10,
          loopP99Ms: driverDelay.percentile(99) / 1e6, loopMaxMs: driverDelay.max / 1e6 },
        connections: clients.filter((c) => c.ws.readyState === 1).length,
        rooms: [...new Set(clients.map((c) => c.roomId))].map((roomId) => {
          const peers = clients.filter((c) => c.roomId === roomId);
          return {
            roomId,
            connections: peers.filter((c) => c.ws.readyState === 1).length,
            updatesPerClient:
              ((peers.reduce((s, c) => s + c.packets, 0) / peers.length) * 1000) / elapsed,
            gaps: q(peers.flatMap((c) => c.gaps)),
          };
        }),
        updatesPerClient:
          ((clients.reduce((s, c) => s + c.packets, 0) / clients.length) * 1000) / elapsed,
        networkMbps: (clients.reduce((s, c) => s + c.bytes, 0) * 8) / elapsed / 1000,
        clientGaps: q(clients.flatMap((c) => c.gaps)),
        longestStateGaps: gapContext.combine(clients.map(c=>({longestStateGaps:c.longGaps}))),
        boosters: clients.reduce((s, c) => s + c.used, 0),
        actionRequests: clients.reduce((s, c) => s + c.requested, 0),
        actionPending: clients.reduce((s, c) => s + c.requests.size, 0),
        actionLatencyMs: q(clients.flatMap(c => c.actionLatency)),
        successfulActionLatencyMs: q(clients.flatMap(c => c.successLatency)),
        oldestPendingActionMs: Math.max(0, ...clients.flatMap(c => [...c.requests.values()].map(r => performance.now() - r.at))),
        usedByType: clients.reduce((a, c) => {
          for (const [key, n] of Object.entries(c.usedByType)) a[key] = (a[key] || 0) + n;
          return a;
        }, {}),
        failures: clients.reduce((a, c) => {
          for (const [key, n] of Object.entries(c.failures)) a[key] = (a[key] || 0) + n;
          return a;
        }, {}),
        wireFields: clients.reduce((a, c) => {
          for (const [key, n] of Object.entries(c.fieldBytes)) a[key] = (a[key] || 0) + n;
          return a;
        }, {}),
        perClientBytes: clients.map((c) => ({ packets: c.packets, bytes: c.bytes, max: c.maxPacket })),
      };
    }
    if (m.type === "stats") result.packetSizes = clients[0]?.packetSizes;
    process.send({ id: m.id, result });
  } catch (e) {
    process.send({ id: m.id, error: e.stack });
  }
});
process.on("disconnect", () => {
  clearInterval(timer);
  clients.forEach((c) => c.ws.terminate());
  process.exit();
});

/* Измеряет настоящую Arena и JSON, не запускает HTTP и не касается data/.
 * Это микробенчмарк, а не тест 400 сетевых клиентов или SQL.
 */
"use strict";
const { performance } = require("node:perf_hooks");
const os = require("node:os");
const { Arena, RULES, radiusForMass } = require("../../src/server/arena/arena-simulation");
function measure(partCount, feedCount) {
  let seed = 7;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  const arena = new Arena({ random, backgroundRandom: random });
  for (let i = 0; i < 35; i++) {
    const p = arena.addPlayer(0, `player-${i}`);
    // Сохраняем число тел между измерениями, отключив поглощение и слияние.
    // Это не худший боевой сценарий с огненным мечом/ловушками.
    p.protectedUntil = 1e12;
    p.mergeAt = 1e12;
    p.parts = Array.from({ length: partCount }, (_, j) => ({
      id: `part-${i}-${j}`,
      mass: 10,
      radius: radiusForMass(10),
      x: 120 + (i % 7) * 330 + (j % 4) * 12,
      y: 100 + Math.floor(i / 7) * 290 + Math.floor(j / 4) * 12,
    }));
    p.mainPartId = p.parts[0].id;
    arena.syncParts(p);
  }
  for (let i = 0; i < feedCount; i++)
    arena.ether.push({
      id: `feed-${i}`,
      x: 20 + (i % 60) * 39,
      y: 20 + Math.floor(i / 60) * 80,
      value: 1,
      radius: 4.5,
      color: "#ffd46e",
      artValue: 1,
      ejected: true,
      vx: 0,
      vy: 0,
      movedAt: 0,
      sourcePickupAt: 1e12,
      expiresAt: 1e12,
    });
  const samples = [],
    bytes = [];
  for (let tick = 0; tick < 160; tick++) {
    const now = tick * RULES.TICK_MS;
    const start = performance.now();
    const events = arena.step(now);
    const snapshot = JSON.stringify(arena.snapshot(now, events));
    const elapsed = performance.now() - start;
    if (tick >= 40) {
      samples.push(elapsed);
      bytes.push(Buffer.byteLength(snapshot));
    }
  }
  samples.sort((a, b) => a - b);
  const meanBytes = bytes.reduce((a, b) => a + b, 0) / bytes.length;
  const bytesPerSecond = meanBytes * (1000 / RULES.TICK_MS) * 400;
  return {
    partsPerPlayer: partCount,
    initialEjectedFood: feedCount,
    actualParts: [...arena.players.values()].reduce((sum, p) => sum + arena.bodies(p).length, 0),
    remainingFood: arena.ether.length,
    samples: samples.length,
    stepAndSerializationMedianMs: +samples[Math.floor(samples.length * 0.5)].toFixed(3),
    stepAndSerializationP95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
    snapshotMeanBytes: Math.round(meanBytes),
    estimated400PlayersMbps: +((bytesPerSecond * 8) / 1e6).toFixed(1),
    estimated400Players30DaysTB: +((bytesPerSecond * 86400 * 30) / 1e12).toFixed(1),
  };
}
console.log(
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      node: process.version,
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      tickMs: RULES.TICK_MS,
      playersPerArena: 35,
      scope: "Arena.step + JSON snapshot only; no socket/TLS/DB; protected stationary bodies",
      scenarios: [measure(1, 0), measure(16, 0), measure(16, RULES.FEED_MAX_PARTICLES)],
    },
    null,
    2,
  ),
);

/* Измерение производительности поиска столкновений. */
"use strict";
const { performance } = require("node:perf_hooks");
const { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");

function scene(spatialIndex, dense) {
  const arena = new Arena({ etherCount: 0, spatialIndex, world: { width: 12000, height: 12000 } });
  for (let i = 0; i < 32; i++) {
    const player = arena.addPlayer(0, `p-${i}`);
    player.protectedUntil = 0;
    player.parts = Array.from({ length: 16 }, (_, j) => {
      const k = i * 16 + j,
        mass = dense ? 1000 : 100 + (k % 32) * 50;
      return {
        id: `${i}-${j}`,
        mass,
        radius: radiusForMass(mass),
        x: dense ? 500 : 300 + (k % 24) * 450,
        y: dense ? 500 : 300 + Math.floor(k / 24) * 450,
      };
    });
    player.mainPartId = player.parts[0].id;
    arena.syncParts(player);
  }
  return arena;
}

function measure(spatialIndex, dense) {
  const arena = scene(spatialIndex, dense);
  for (let i = 0; i < 20; i++) arena.resolveAbsorptions(5000);
  const samples = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    arena.resolveAbsorptions(5000);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    medianMs: +samples[60].toFixed(3),
    p95Ms: +samples[114].toFixed(3),
    maxMs: +samples[119].toFixed(3),
  };
}

console.log(
  JSON.stringify(
    {
      node: process.version,
      parts: 512,
      iterations: 120,
      sparse: { linear: measure(false, false), indexed: measure(true, false) },
      dense: { linear: measure(false, true), indexed: measure(true, true) },
    },
    null,
    2,
  ),
);

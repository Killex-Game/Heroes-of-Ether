"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { performance } = require("node:perf_hooks");
const { capture, restore, install } = require("./step-state");
const { serialize, deserialize } = require("node:v8");
const { GraphDelta } = require("./graph-delta");
const signal = new Int32Array(workerData.signal), output = workerData.output;
let resident, codec;
parentPort.on("message", ({ id, state, randomValues, at, reset }) => {
  let used = 0;
  try {
    const random = () => {
      if (used >= randomValues.length) throw Error("RANDOM_TAPE_EXHAUSTED");
      return randomValues[used++];
    };
    if (workerData.delta && (reset || !codec)) { codec = new GraphDelta(1); resident = null; }
    const checkpoint = workerData.delta ? codec.decode(state) : deserialize(state);
    const arena = workerData.delta && resident ? install(resident, checkpoint) : restore(checkpoint, random);
    arena.random = random;
    if (workerData.delta) resident = arena;
    const start = performance.now();
    const events = arena.step(at);
    const result = workerData.delta ? codec.encode({ state: capture(arena), events }) : serialize({ state: capture(arena), events });
    output.postMessage({ id, result, used, computeMs: performance.now() - start }, workerData.delta ? [] : [result.buffer]);
  } catch (error) {
    output.postMessage({ id, error: error.message });
  } finally {
    // Post before waking the parent: no async message handler is needed there.
    Atomics.store(signal, 0, id);
    Atomics.notify(signal, 0);
  }
});
Atomics.store(signal, 0, -1);
Atomics.notify(signal, 0);

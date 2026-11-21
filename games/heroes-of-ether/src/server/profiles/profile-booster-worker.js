"use strict";
const fs = require("node:fs");
const { parentPort, workerData } = require("node:worker_threads");

// Write, flush and close without three extra round trips through the simulation
// loop. This file is never considered committed by crash recovery.
parentPort.on("message", (bytes) => {
  try {
    const fd = fs.openSync(workerData, "w", 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    parentPort.postMessage(null);
  } catch (error) {
    parentPort.postMessage(error.code || "write failed");
  }
});

"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const checkpoint = require("./profile-journal").createCheckpointWriter(workerData.file);
parentPort.on("message", () => {
  let result;
  try {
    result = checkpoint();
  } catch (error) {
    result = { error: "Profile checkpoint failed: " + (error.code || "invalid journal"),
      removedBytes: error.removedBytes || 0 };
  }
  parentPort.postMessage(result);
});

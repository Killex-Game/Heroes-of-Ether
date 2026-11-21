"use strict";
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const { MongoState, readLocal } = require("./mongodb-state");
const { safeError } = require("./mongodb-config");
const { atomicSnapshot } = require("../profiles/profile-journal");
const dataDir = path.join(workerData.root, "data");
const state = new MongoState(workerData.config);
const checkpoints = new (require('./checkpoint-cache').CheckpointCache)(dataDir,readLocal);
let status = { mode: "mongodb-with-local-journal", connected: false };
let metricTimer=null;
// Optional graph telemetry must not turn a successful database command into
// a failed persistence reply or an unhandled worker rejection.
let metricsError=null;
function telemetry(){
  try{return {metrics:state.metrics(),metricsError};}
  catch(_){metricsError='MONGO_METRICS_UNAVAILABLE';return {metrics:null,metricsError};}
}
function report(values) {
  status = { ...status, ...values, checkedAt: Date.now() };
  atomicSnapshot(path.join(dataDir, "mongodb-status.json"), status);
}
// Commands are serial and coalesced by the parent. No per-player work queue.
parentPort.on("message", async ({ id, command, type, enabled, profileSnapshot }) => {
  if(type==='metrics-control'){
    clearInterval(metricTimer);metricTimer=null;
    try{
      state.metrics.enable(enabled);metricsError=null;
      if(enabled){metricTimer=setInterval(()=>parentPort.postMessage({type:'metrics',...telemetry()}),5000);metricTimer.unref();}
    }catch(_){metricsError='MONGO_METRICS_UNAVAILABLE';}
    parentPort.postMessage({type:'metrics',...telemetry()});return;
  }
  try {
    let result;
    if (command === "open" || command === "resume") {
      await state.client.connect();
      result = await state.acquire(readLocal(dataDir, command === "open", profileSnapshot).snapshot);
      report({ ...result, connected: true, lastError: null });
    } else if (command === "sync") {
      result = await state.sync(checkpoints.snapshot(profileSnapshot));
      report({ ...result, connected: true, lastError: null });
    } else if (command === "close") {
      await state.close();
      report({ connected: false, stopped: true });
    } else throw Object.assign(Error("Unknown command"), { code: "MONGO_COMMAND" });
    parentPort.postMessage({ id, result, health:status, ...telemetry() });
  } catch (error) {
    const code = safeError(error);
    try {
      report({ connected: false, lastError: code });
    } catch (_) {
      /* Original failure retained. */
    }
    parentPort.postMessage({ id, error: code, health:status, ...telemetry() });
  }
});

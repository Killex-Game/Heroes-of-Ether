"use strict";
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const {readLocal}=require('./state-snapshot');
const { safeError } = require('./postgresql-config');
const { atomicSnapshot } = require("../profiles/profile-journal");
const dataDir = path.join(workerData.root, "data");
const State = require('./postgresql-state').PostgreSQLState;
const state = new State(workerData.config);
const checkpoints = new (require('./checkpoint-cache').CheckpointCache)(dataDir,readLocal);
let status = { mode:'postgresql-with-local-journal',backend:'postgresql', connected: false };
let metricTimer=null;
// Optional graph telemetry must not turn a successful database command into
// a failed persistence reply or an unhandled worker rejection.
let metricsError=null;
let prepared = null;
function telemetry(){
  try{return {metrics:state.metrics(),metricsError};}
  catch(_){metricsError='DATABASE_METRICS_UNAVAILABLE';return {metrics:null,metricsError};}
}
function report(values) {
  status = { ...status, ...values, checkedAt: Date.now() };
  atomicSnapshot(path.join(dataDir, 'postgresql-status.json'), status);
}
// Phase diagnostics never acknowledge a cloud revision or refresh syncedAt.
state.onProgress = values => report(values);
// Commands are serial and coalesced by the parent. No per-player work queue.
parentPort.on("message", async ({ id, command, type, enabled, profileSnapshot }) => {
  if(type==='metrics-control'){
    clearInterval(metricTimer);metricTimer=null;
    try{
      state.metrics.enable(enabled);metricsError=null;
      if(enabled){metricTimer=setInterval(()=>parentPort.postMessage({type:'metrics',...telemetry()}),5000);metricTimer.unref();}
    }catch(_){metricsError='DATABASE_METRICS_UNAVAILABLE';}
    parentPort.postMessage({type:'metrics',...telemetry()});return;
  }
  try {
    let result;
    if (command === "open" || command === "resume") {
      await state.client.connect();
      result = await state.acquire(readLocal(dataDir, command === "open", profileSnapshot).snapshot);
      report({ ...result, connected: true, lastError: null });
    } else if (command === 'prepare') {
      const started = Date.now(), snapshot = checkpoints.snapshot(profileSnapshot);
      state.prepare(snapshot);
      prepared = { snapshot, source: JSON.stringify(profileSnapshot), elapsedMs: Date.now() - started };
      result = { prepared: true, revision: snapshot.revision, prepareMs: prepared.elapsedMs };
    } else if (command === "sync") {
      const started = Date.now(), ready = prepared?.source === JSON.stringify(profileSnapshot) ? prepared : null;
      prepared = null;
      const snapshot = ready ? ready.snapshot : checkpoints.snapshot(profileSnapshot);
      result = await state.sync(snapshot);
      // PostgreSQL only needs acknowledged document hashes for the next delta.
      // The unchanged immutable checkpoint can reuse that compact index too.
      if (checkpoints.value === snapshot) checkpoints.value = state.previous;
      result = { ...result, prepareMs: ready?.elapsedMs ?? null, writeMs: Date.now() - started };
      report({ ...result, connected: true, lastError: null });
    } else if (command === "close") {
      await state.close();
      report({ connected: false, stopped: true });
    } else throw Object.assign(Error("Unknown command"), { code: "DATABASE_COMMAND" });
    parentPort.postMessage({ id, result, health:status, ...telemetry() });
  } catch (error) {
    prepared = null;
    const code = safeError(error);
    try {
      report({ connected: false, lastError: code });
    } catch (_) {
      /* Original failure retained. */
    }
    parentPort.postMessage({ id, error: code, health:status, ...telemetry() });
  }
});

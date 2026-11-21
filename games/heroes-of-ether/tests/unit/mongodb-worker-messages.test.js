"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { createRequire } = require("node:module");
function fixture() {
  class Worker extends EventEmitter {
    postMessage(message) { this.sent = message; }
    async terminate() {}
  }
  const filename = path.resolve(__dirname, "../../src/server/persistence/mongodb-sync.js");
  const sourceRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, __dirname: path.dirname(filename), console, setTimeout, clearTimeout,
    setInterval, clearInterval,
    require: name => name === "node:worker_threads" ? { Worker }
      : name === "./mongodb-config" ? { safeError: error => error.code } : sourceRequire(name),
  }, { filename });
  return new module.exports.MongoSync("unused", { intervalMs: 5000 });
}
test("Idle Mongo telemetry and disabled-metrics acknowledgement cannot crash or resolve a command", async () => {
  const sync = fixture();
  sync.worker.emit("message", { type: "metrics", metrics: { reads: 3 } });
  assert.equal(sync.metrics.reads, 3);
  sync.setMetrics(false);
  assert.equal(sync.worker.sent.type, "metrics-control");
  sync.worker.emit("message", { type: "metrics", metrics: null });
  assert.equal(sync.metrics, null);
  sync.worker.emit("message", null);
  assert.equal(sync.waiting, undefined);
});
test("Telemetry during a Mongo write leaves the durable response pending; late messages are ignored", async () => {
  const sync = fixture(), response = sync.command("sync");
  const pending = sync.waiting;
  sync.worker.emit("message", { type: "metrics", metrics: { writes: 1 } });
  sync.worker.emit("message", { id: pending.id + 1, result: "wrong" });
  assert.equal(sync.waiting, pending);
  sync.worker.emit("message", { id: pending.id, result: { revision: 23 }, health: { connected: true } });
  assert.equal((await response).revision, 23);
  assert.equal(sync.waiting, null);
  assert.equal(sync.health.connected, true);
  sync.worker.emit("message", { type: "metrics", metrics: null });
  sync.worker.emit("message", { id: pending.id, error: "LATE" });
  assert.equal(sync.waiting, null);
});
test("A replaced Mongo worker cannot overwrite telemetry or settle the new worker command", async () => {
  const sync = fixture(), old = sync.worker;
  sync.spawn();
  const response = sync.command("sync"), id = sync.waiting.id;
  old.emit("message", { id, result: "stale", metrics: { reads: 999 } });
  assert.equal(sync.metrics, undefined);
  assert.equal(sync.waiting.id, id);
  sync.worker.emit("message", { id, error: "MONGO_OPERATION_FAILED" });
  await assert.rejects(response, { code: "MONGO_OPERATION_FAILED" });
});
test("Optional Mongo telemetry transport failure does not mark persistence failed or cancel a write", async () => {
  const sync=fixture(),response=sync.command("sync"),id=sync.waiting.id;
  sync.worker.postMessage=()=>{throw Error('transport');};
  assert.doesNotThrow(()=>sync.setMetrics(true));assert.equal(sync.failed,false);assert.equal(sync.waiting.id,id);
  assert.equal(sync.metricsError,'MONGO_METRICS_UNAVAILABLE');
  sync.worker.emit('message',{id,result:{revision:24}});assert.equal((await response).revision,24);
});
test("Worker metric setup and sampling failures cannot change a successful persistence response", async () => {
  const filename=path.resolve(__dirname,'../../src/server/persistence/mongodb-worker.js'),port=new EventEmitter(),messages=[];
  const sourceRequire=createRequire(filename);
  port.postMessage=message=>messages.push(message);
  class State {
    constructor(){this.client={connect:async()=>{}};this.metrics=()=>{throw Error('optional sampling');};this.metrics.enable=()=>{throw Error('optional setup');};}
    async acquire(){return {revision:1};}
    async sync(){return {revision:2};}
  }
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),setInterval,clearInterval,
    require:name=>name==='node:worker_threads'?{parentPort:port,workerData:{root:'unused',config:{}}}
      :name==='./mongodb-state'?{MongoState:State,readLocal:()=>({snapshot:{}})}
      :name==='./mongodb-config'?{safeError:()=> 'MONGO_OPERATION_FAILED'}
      :name==='../profiles/profile-journal'?{atomicSnapshot(){}}:sourceRequire(name)
  },{filename});
  const receive=port.listeners('message')[0];
  await receive({type:'metrics-control',enabled:true});assert.equal(messages.at(-1).metricsError,'MONGO_METRICS_UNAVAILABLE');
  await receive({id:1,command:'open'});assert.equal(messages.at(-1).result.revision,1);assert.equal(messages.at(-1).error,undefined);
  await receive({id:2,command:'sync'});assert.equal(messages.at(-1).result.revision,2);assert.equal(messages.at(-1).health.connected,true);
});

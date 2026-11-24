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
  const filename = path.resolve(__dirname, "../../src/server/persistence/database-sync.js");
  const sourceRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, __dirname: path.dirname(filename), console, setTimeout, clearTimeout,
    setInterval, clearInterval,
    require: name => name === "node:worker_threads" ? { Worker }
      : name === "./postgresql-config" ? { safeError: error => error.code } : sourceRequire(name),
  }, { filename });
  return new module.exports.DatabaseSync("unused", { intervalMs: 5000 });
}

test("Slow cold verification does not extend ordinary write deadlines", async () => {
  const sync = fixture();
  for (const command of ['open', 'resume', 'prepare', 'sync']) {
    const result = sync.command(command);
    assert.equal(sync.waiting.timeout._idleTimeout, command === 'sync' ? 45000 : command === 'prepare' ? 120000 : 1260000);
    sync.worker.emit('message', { id: sync.waiting.id, result: { revision: 1 } });
    await result;
  }
});
test("Idle database telemetry and disabled-metrics acknowledgement cannot crash or resolve a command", async () => {
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
test("Telemetry during a database write leaves the durable response pending; late messages are ignored", async () => {
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
test("A replaced database worker cannot overwrite telemetry or settle the new worker command", async () => {
  const sync = fixture(), old = sync.worker;
  sync.spawn();
  const response = sync.command("sync"), id = sync.waiting.id;
  old.emit("message", { id, result: "stale", metrics: { reads: 999 } });
  assert.equal(sync.metrics, undefined);
  assert.equal(sync.waiting.id, id);
  sync.worker.emit("message", { id, error: "DATABASE_OPERATION_FAILED" });
  await assert.rejects(response, { code: "DATABASE_OPERATION_FAILED" });
});

test('Worker failure records a safe memory category and retains it across the following exit', async () => {
  const sync=fixture(),pending=sync.command('sync');
  const rejected=assert.rejects(pending,{code:'DATABASE_WORKER_FAILED'});
  sync.worker.emit('error',Object.assign(Error('postgresql://private:secret@hidden'),{code:'ERR_WORKER_OUT_OF_MEMORY'}));
  sync.worker.emit('exit',1);await rejected;
  assert.equal(sync.monitoring().lastWorkerFailure.code,'DATABASE_WORKER_OUT_OF_MEMORY');
  assert.equal(sync.monitoring().lastWorkerFailure.kind,'error');
  assert.doesNotMatch(JSON.stringify(sync.monitoring()),/secret|hidden|private/);
  const before=sync.workerFailure,old=sync.worker;sync.spawn();
  old.emit('error',Error('stale'));old.emit('exit',2);
  assert.equal(sync.failed,false);assert.equal(sync.workerFailure,before);
});

test('Unexpected worker error details are never copied into diagnostics', async () => {
  const sync=fixture();
  sync.worker.emit('error',Object.assign(Error('password=secret'),{code:'private-hostname'}));
  assert.equal(sync.workerFailure.code,'DATABASE_WORKER_ERROR');
  assert.doesNotMatch(JSON.stringify(sync.monitoring()),/secret|private-hostname/);
  sync.spawn();sync.worker.emit('exit',3);
  assert.equal(sync.workerFailure.code,'DATABASE_WORKER_EXIT');assert.equal(sync.workerFailure.exitCode,3);
});
test("Optional database telemetry transport failure does not mark persistence failed or cancel a write", async () => {
  const sync=fixture(),response=sync.command("sync"),id=sync.waiting.id;
  sync.worker.postMessage=()=>{throw Error('transport');};
  assert.doesNotThrow(()=>sync.setMetrics(true));assert.equal(sync.failed,false);assert.equal(sync.waiting.id,id);
  assert.equal(sync.metricsError,'DATABASE_METRICS_UNAVAILABLE');
  sync.worker.emit('message',{id,result:{revision:24}});assert.equal((await response).revision,24);
});
test("Worker metric setup and sampling failures cannot change a successful persistence response", async () => {
  const filename=path.resolve(__dirname,'../../src/server/persistence/database-worker.js'),port=new EventEmitter(),messages=[];
  const sourceRequire=createRequire(filename);
  port.postMessage=message=>messages.push(message);
  class State {
    constructor(){this.client={connect:async()=>{}};this.metrics=()=>{throw Error('optional sampling');};this.metrics.enable=()=>{throw Error('optional setup');};}
    async acquire(){return {revision:1};}
    async sync(){return {revision:2};}
  }
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),setInterval,clearInterval,
    require:name=>name==='node:worker_threads'?{parentPort:port,workerData:{root:'unused',config:{}}}
      :name==='./state-snapshot'?{readLocal:()=>({snapshot:{}})}
      :name==='./postgresql-state'?{PostgreSQLState:State}
      :name==='./postgresql-config'?{safeError:()=> 'DATABASE_OPERATION_FAILED'}
      :name==='../profiles/profile-journal'?{atomicSnapshot(){}}:sourceRequire(name)
  },{filename});
  const receive=port.listeners('message')[0];
  await receive({type:'metrics-control',enabled:true});assert.equal(messages.at(-1).metricsError,'DATABASE_METRICS_UNAVAILABLE');
  await receive({id:1,command:'open'});assert.equal(messages.at(-1).result.revision,1);assert.equal(messages.at(-1).error,undefined);
  await receive({id:2,command:'sync'});assert.equal(messages.at(-1).result.revision,2);assert.equal(messages.at(-1).health.connected,true);
});

test('preparing a pinned snapshot does not acknowledge persistence; sync consumes only the exact prepared source', async () => {
  const filename=path.resolve(__dirname,'../../src/server/persistence/database-worker.js'),port=new EventEmitter(),messages=[],reads=[],writes=[];
  const sourceRequire=createRequire(filename);let reports=0;
  port.postMessage=message=>messages.push(message);
  class State {
    constructor(){this.metrics=()=>null;this.metrics.enable=()=>{};}
    prepare(snapshot){this.prepared=snapshot;}
    async sync(snapshot){writes.push(snapshot);return {revision:snapshot.revision,syncedAt:Date.now()};}
  }
  class Cache {snapshot(source){reads.push(source);return {revision:source.revision};}}
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),setInterval,clearInterval,
    require:name=>name==='node:worker_threads'?{parentPort:port,workerData:{root:'unused',config:{}}}
      :name==='./postgresql-state'?{PostgreSQLState:State}
      :name==='./checkpoint-cache'?{CheckpointCache:Cache}
      :name==='./postgresql-config'?{safeError:()=> 'DATABASE_OPERATION_FAILED'}
      :name==='../profiles/profile-journal'?{atomicSnapshot(){reports++;}}:sourceRequire(name)
  },{filename});
  const receive=port.listeners('message')[0],source={file:'/immutable/pin',revision:5};
  await receive({id:1,command:'prepare',profileSnapshot:source});
  assert.equal(reports,0);assert.equal(writes.length,0);assert.equal(messages.at(-1).health.syncedAt,undefined);
  await receive({id:2,command:'sync',profileSnapshot:source});
  assert.equal(reads.length,1);assert.equal(reports,1);assert.equal(writes[0].revision,5);assert.equal(messages.at(-1).result.prepareMs>=0,true);
  await receive({id:3,command:'prepare',profileSnapshot:source});
  await receive({id:4,command:'sync',profileSnapshot:{...source,revision:6}});
  assert.equal(reads.length,3);assert.equal(writes.at(-1).revision,6);
});

test('flush holds the durable pin through preparation and the real sync acknowledgement', async () => {
  const sync=fixture();let released=false;
  sync.profiles={journal:{pinSnapshot:async()=>({file:'/immutable/pin',revision:4,release(){released=true;}})}};
  const pending=sync.flush();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(sync.worker.sent.command,'prepare');assert.equal(released,false);
  sync.worker.emit('message',{id:sync.worker.sent.id,result:{prepared:true,revision:4}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(sync.worker.sent.command,'sync');assert.equal(released,false);
  sync.worker.emit('message',{id:sync.worker.sent.id,result:{revision:4}});
  assert.equal((await pending).revision,4);assert.equal(released,true);
});

test('prepare diagnostics distinguish unchanged cache hits, incremental replay and a new checkpoint', async () => {
  const filename=path.resolve(__dirname,'../../src/server/persistence/database-worker.js'),port=new EventEmitter(),messages=[];
  const sourceRequire=createRequire(filename); let reader;
  port.postMessage=message=>messages.push(message);
  class Reader { constructor(){reader=this;this.stats=null;} }
  class State {
    constructor(){this.metrics=()=>null;this.metrics.enable=()=>{};}
    prepare(){}
    async sync(snapshot){this.previous={...snapshot};return{revision:snapshot.revision};}
  }
  class Cache {
    snapshot(source){
      if(this.value?.revision===source.revision)return this.value;
      reader.stats={incremental:source.revision!==1,replayed:source.revision===1?0:1,readFiles:source.revision===1?3:1};
      return this.value={revision:source.revision};
    }
  }
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{__dirname:path.dirname(filename),setInterval,clearInterval,
    require:name=>name==='node:worker_threads'?{parentPort:port,workerData:{root:'unused',config:{}}}
      :name==='./postgresql-state'?{PostgreSQLState:State}
      :name==='./checkpoint-cache'?{CheckpointCache:Cache}
      :name==='./pinned-world-reader'?{PinnedWorldReader:Reader}
      :name==='./postgresql-config'?{safeError:()=> 'DATABASE_OPERATION_FAILED'}
      :name==='../profiles/profile-journal'?{atomicSnapshot(){}}:sourceRequire(name)
  },{filename});
  const receive=port.listeners('message')[0];
  for(const revision of [1,1,2]){
    const source={file:'/private/location-must-not-appear-in-metrics',revision};
    await receive({id:revision,command:'prepare',profileSnapshot:source});
    const before=JSON.parse(JSON.stringify(messages.at(-1).result.pinnedRead));
    await receive({id:revision,command:'sync',profileSnapshot:source});
    assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1).result.pinnedRead)),before);
  }
  const diagnostics=messages.filter(m=>m.result.prepared).map(m=>JSON.parse(JSON.stringify(m.result.pinnedRead)));
  assert.deepEqual(diagnostics,[{cacheHit:false,incremental:false,replayed:0,readFiles:3},
    {cacheHit:true,readFiles:0,replayed:0},{cacheHit:false,incremental:true,replayed:1,readFiles:1}]);
});

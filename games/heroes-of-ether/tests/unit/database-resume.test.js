"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {DatabaseSync}=require("../../src/server/persistence/database-sync");
test("A failed resume never sends sync to an uninitialized worker; the next flush reacquires first",async()=>{
  const calls=[];let rejectResume=true;
  const owner={failed:true,profiles:{journal:{async pinSnapshot(){calls.push("pin");return {file:'snapshot',revision:17,release(){calls.push("release");}};}}},
    worker:{async terminate(){calls.push("terminate");}},
    spawn(){calls.push("spawn");this.failed=false;},
    async command(name,source){assert.deepEqual(source,{file:'snapshot',revision:17});calls.push(name);if(name==="resume"&&rejectResume)throw Object.assign(Error("read failed"),{code:"DATABASE_OPERATION_FAILED"});return {revision:17};}
  };
  await assert.rejects(DatabaseSync.prototype.flush.call(owner),{code:"DATABASE_OPERATION_FAILED"});
  assert.equal(owner.failed,true);assert.equal(owner.running,null);assert.equal(calls.includes("sync"),false);
  rejectResume=false;
  const result=await DatabaseSync.prototype.flush.call(owner);
  assert.deepEqual(result,{revision:17});assert.equal(owner.failed,false);
  assert.deepEqual(calls,["pin","terminate","spawn","resume","terminate","release","pin","terminate","spawn","resume","prepare","sync","release"]);
});
test("Cold snapshot acquisition can outlast 45 seconds but remains bounded; write timeout stays 45 seconds",async t=>{
  t.mock.timers.enable({apis:["setTimeout"]});
  const owner=()=>({serial:0,failed:false,worker:{postMessage(){},terminate(){return Promise.resolve();}}});
  const reader=owner(),reading=DatabaseSync.prototype.command.call(reader,"resume");
  const readRejected=assert.rejects(reading,{code:"DATABASE_SYNC_TIMEOUT"});
  t.mock.timers.tick(46000);assert.equal(reader.failed,false);assert.ok(reader.waiting);
  t.mock.timers.tick(1213999);assert.equal(reader.failed,false);
  t.mock.timers.tick(1);await readRejected;assert.equal(reader.failed,true);
  const writer=owner(),writing=DatabaseSync.prototype.command.call(writer,"sync");
  const writeRejected=assert.rejects(writing,{code:"DATABASE_SYNC_TIMEOUT"});
  t.mock.timers.tick(45000);await writeRejected;assert.equal(writer.failed,true);
});

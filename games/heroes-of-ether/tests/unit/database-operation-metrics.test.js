'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {observeDatabase}=require('../../src/server/persistence/database-metrics');
test('Disabled observation preserves the exact operation promise',async()=>{
 const metrics=observeDatabase(),promise=Promise.resolve({ok:1});
 assert.equal(metrics.run('write',()=>promise),promise);assert.equal(metrics(),null);
 metrics.enable(true);assert.deepEqual(await metrics.run('write',()=>promise),{ok:1});assert.equal(metrics().write,1);
 metrics.enable(false);assert.equal(metrics.run('write',()=>promise),promise);assert.equal(metrics(),null);
});
test('Old in-flight operations cannot pollute a new monitoring lease; sync and async failures retain identity',async()=>{
 const metrics=observeDatabase(),error=Error('original DB error');let finish;
 metrics.enable(true);const old=metrics.run('write',()=>new Promise(r=>finish=r));
 metrics.enable(false);metrics.enable(true);finish(7);assert.equal(await old,7);assert.equal(metrics().write,0);
 assert.throws(()=>metrics.run('write',()=>{throw error}),e=>e===error);assert.equal(metrics().failed,1);
 await assert.rejects(metrics.run('read',()=>Promise.reject(error)),e=>e===error);assert.equal(metrics().failed,2);
 const result=await metrics.run('read',async()=>[1,2,3]);assert.deepEqual(result,[1,2,3]);assert.equal(metrics().read,1);
 const epoch=metrics().epoch;metrics.enable(true);assert.equal(metrics().epoch,epoch);assert.equal(metrics().read,1);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {observeMongo}=require('../../src/server/persistence/mongodb-metrics');
test('Disabled observation preserves the exact DB promise; enabling uses the same connection and receiver',async()=>{
 const metrics=observeMongo(),promise=Promise.resolve({ok:1}),raw={name:'state',calls:0,bulkWrite(...args){assert.equal(this,raw);assert.deepEqual(args,[[{insertOne:{document:{x:1}}}],{ordered:true}]);this.calls++;return promise;},find(){assert.equal(this,raw);return this.name;}};
 const collection=metrics.collection(raw),args=[[{insertOne:{document:{x:1}}}],{ordered:true}];
 assert.equal(collection.bulkWrite(...args),promise);assert.equal(metrics(),null);assert.equal(collection.find(),'state');
 metrics.enable(true);assert.deepEqual(await collection.bulkWrite(...args),{ok:1});assert.equal(metrics().write,1);assert.equal(raw.calls,2);
 metrics.enable(false);assert.equal(collection.bulkWrite(...args),promise);assert.equal(metrics(),null);
});
test('Old in-flight operations cannot pollute a new monitoring lease; sync and async failures retain identity',async()=>{
 const metrics=observeMongo(),error=Error('original DB error');let finish;
 metrics.enable(true);const old=metrics.run('write',()=>new Promise(r=>finish=r));
 metrics.enable(false);metrics.enable(true);finish(7);assert.equal(await old,7);assert.equal(metrics().write,0);
 assert.throws(()=>metrics.run('write',()=>{throw error}),e=>e===error);assert.equal(metrics().failed,1);
 await assert.rejects(metrics.run('read',()=>Promise.reject(error)),e=>e===error);assert.equal(metrics().failed,2);
 const result=await metrics.run('read',async()=>[1,2,3]);assert.deepEqual(result,[1,2,3]);assert.equal(metrics().read,1);
 const epoch=metrics().epoch;metrics.enable(true);assert.equal(metrics().epoch,epoch);assert.equal(metrics().read,1);
});

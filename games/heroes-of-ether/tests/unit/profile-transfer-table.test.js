"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {applyTransfer}=require('../../src/server/profiles/profile-transfer');
const {copyRecord}=require('../../src/server/profiles/copy-record');
const {keysForCopy}=require('../../src/server/profiles/immutable-table-delta');
test('large profile transfer isolates edited rows and preserves all other keys and references',()=>{
 const profiles=Object.fromEntries(Array.from({length:1280},(_,i)=>['p'+i,Object.freeze({id:'p'+i,revision:0,wallet:Object.freeze({coins:100})})]));
 Object.defineProperty(profiles,'__proto__',{value:Object.freeze({id:'special'}),enumerable:true});
 const symbol=Symbol('marker');profiles[symbol]='kept';Object.freeze(profiles);
 const base=Object.freeze({profiles,clans:Object.freeze({})});
 const patch={set:{},remove:[],tables:{profileEdits:{p0:{set:{revision:1},remove:[],nested:{wallet:{set:{coins:90},remove:[]}}}}}};
 const next=applyTransfer(base,patch);
 assert.equal(next.profiles.p0.revision,1);assert.equal(next.profiles.p0.wallet.coins,90);
 assert.equal(base.profiles.p0.wallet.coins,100);
 assert.strictEqual(next.profiles.p1279,base.profiles.p1279);
 assert.deepEqual(Object.keys(next.profiles),Object.keys(base.profiles));
 assert.strictEqual(next.profiles.__proto__,base.profiles.__proto__);
 assert.equal(next.profiles[symbol],'kept');assert.strictEqual(Object.getPrototypeOf(next.profiles),Object.prototype);
 assert.strictEqual(next.clans,base.clans);
});

test('transferred profile copies keep additions, removals and envelope changes after repeated edits',()=>{
 let world={profiles:Object.fromEntries(Array.from({length:150},(_,i)=>['p'+i,{id:'p'+i,n:0}])),clans:{}};
 const edit=()=>({set:{},remove:[],tables:{profileEdits:{p0:{set:{n:world.profiles.p0.n+1},remove:[]}}}});
 function check(){assert.deepEqual(copyRecord(world.profiles),{...world.profiles});assert.deepEqual(keysForCopy(world.profiles),Object.keys(world.profiles));}
 for(let i=0;i<20;i++){world=applyTransfer(world,edit());check();}
 for(const tables of [
   {profiles:{set:{pNew:{id:'pNew',n:1}},remove:[]}},
   {profiles:{set:{},remove:['p149']}},
   {profileEdits:edit().tables.profileEdits,profiles:{set:{p149:{id:'p149',n:2}},remove:['pNew']}},
 ]){
   world=applyTransfer(world,{set:{},remove:[],tables});check();
   for(let i=0;i<3;i++){world=applyTransfer(world,edit());check();}
 }
 assert.equal(world.profiles.pNew,undefined);assert.equal(world.profiles.p149.n,2);
 world=applyTransfer(world,{set:{},remove:[],nested:{profiles:{set:{pOther:{id:'pOther',n:3}},remove:['p148']}},tables:{}});check();
 world=applyTransfer(world,edit());check();
 assert.equal(world.profiles.p148,undefined);assert.equal(world.profiles.pOther.n,3);
 world=applyTransfer(world,{set:{profiles:{p0:{id:'p0',n:50},fresh:{id:'fresh'}}},remove:[]});check();
 world=applyTransfer(world,edit());check();assert.deepEqual(Object.keys(world.profiles),['p0','fresh']);
});

test('empty shard tables retain existing data but initialize missing tables before edits',()=>{
 const empty={set:{},remove:[]};
 const initialized=applyTransfer({}, {set:{},remove:[],tables:{profiles:empty,clans:empty,profileEdits:{}}});
 assert.deepEqual(initialized,{profiles:{},clans:{}});
 const base={profiles:{a:{id:'a',n:1},b:{id:'b',n:2}},clans:{one:{xp:10}}};
 const noop=applyTransfer(base,{set:{revision:2},remove:[],tables:{profiles:empty,profileEdits:{},clans:empty}});
 assert.strictEqual(noop.profiles,base.profiles);assert.strictEqual(noop.clans,base.clans);
 const row={a:{set:{n:3},remove:[]}};
 for(const tables of [{profiles:empty,profileEdits:row,clans:empty},{profileEdits:row,profiles:empty,clans:empty}]){
   const result=applyTransfer(base,{set:{},remove:[],tables});
   assert.deepEqual(result,{profiles:{a:{id:'a',n:3},b:base.profiles.b},clans:base.clans});
   assert.strictEqual(result.profiles.b,base.profiles.b);assert.strictEqual(result.clans,base.clans);
   assert.equal(base.profiles.a.n,1);
   assert.deepEqual(copyRecord(result.profiles),result.profiles);
 }
});

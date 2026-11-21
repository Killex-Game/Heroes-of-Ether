"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {createProfileBatch,sealProfileBatch}=require('../../src/server/profiles/profile-batch');
const {BOOSTERS}=require('../../src/server/boosters/booster-catalog');
function freeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);Object.freeze(value); }return value;}
test('all casts preserve frozen life, pet and absorption histories while awards and stock change',()=>{
  const at=Date.parse('2026-11-12T12:00:00Z'),store=new ProfileStore({now:()=>at});
  const user=store.open();store.startLife(user.profile.id,'cast-draft-life');
  const p=store.find(user.token);
  p.progress.boosterUses=99;p.greatness=99;
  p.progress.recentVictims={victim:at-100};p.progress.absorptionVictims={victim:at-100};
  p.progress.session.splitVictims=['victim'];
  p.alchemy={version:1,natural:0,ingredients:{},learned:[],equipped:null};
  p.easter={runs:{},chests:[],trophies:[],batches:[{count:10,expiresAt:require('../../src/server/events/easter-hunt').expiresAt(at)}]};
  const all=[...BOOSTERS.values()].filter(b=>b.ready);
  for(const b of all)p.inventory[b.id]=10;
  const base=freeze(store.data),original=structuredClone(base);
  for(const b of all){
    const batch=createProfileBatch(base),request='cast-draft-'+b.id+'-0001';
    const result=store.consume(user.token,b.id,request,'cast:'+b.id,()=>({mass:30000,lifeId:'cast-draft-life'}),true,batch);
    sealProfileBatch(batch);
    assert.equal(result.replay,false);
    const next=store.find(user.token,batch.next);
    assert.equal(next.inventory[b.id],9);assert.equal(next.progress.boosterUses,100);
    assert.equal(next.progress.claimed.boosters,1);assert.ok(next.greatness>99);
    for(const key of ['session','lastLife','recentVictims','absorptionVictims'])
      assert.strictEqual(next.progress[key],p.progress[key]);
    assert.strictEqual(next.pets,p.pets);
    assert.deepEqual(base,original);
    const replay=store.consume(user.token,b.id,request,'cast:'+b.id,()=>{throw Error('replayed validation');},true,{next:batch.next});
    assert.equal(replay.replay,true);
  }
  const failed=createProfileBatch(base);
  assert.throws(()=>store.consume(user.token,'meat','cast-draft-rejected-0001','bad',()=>{throw Error('bad target');},true,failed),/bad target/);
  assert.strictEqual(failed.next,base);assert.deepEqual(base,original);
});

test('failed cast publication cannot change stock, progress or nested immutable histories',()=>{
  const at=Date.parse('2026-11-12T12:00:00Z'),store=new ProfileStore({now:()=>at});
  const user=store.open();store.startLife(user.profile.id,'cast-failure-life');
  store.find(user.token).inventory.meat=5;
  const base=freeze(store.data),original=structuredClone(base);
  store.writeSnapshot=()=>{throw Error('failed durable write');};
  assert.throws(()=>store.consume(user.token,'meat','cast-write-failure-0001','meat',()=>({mass:50000}),true),/failed durable write/);
  assert.strictEqual(store.data,base);assert.deepEqual(base,original);
});

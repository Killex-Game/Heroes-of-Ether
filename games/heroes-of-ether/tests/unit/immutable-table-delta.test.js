"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const delta=require("../../src/server/profiles/immutable-table-delta");
const {difference}=require("../../src/server/profiles/profile-journal");
const {applyTransfer}=require("../../src/server/profiles/profile-transfer");
const {createProfileBatch,replaceBatchProfile,sealProfileBatch}=require("../../src/server/profiles/profile-batch");
const {copyRecord}=require("../../src/server/profiles/copy-record");
test("copy key reuse is limited to sealed replacements and preserves insertions, removals and key order",()=>{
  const source={a:{v:1},b:{v:2}}, mutable=copyRecord(source);
  source.c={v:3}; delete source.a;
  assert.deepEqual(copyRecord(source),{b:{v:2},c:{v:3}});
  assert.deepEqual(mutable,{a:{v:1},b:{v:2}});
  let prior={...source};delta.remember(prior,source,[]);
  const first=delta.keysForCopy(prior);assert.ok(Object.isFrozen(first));
  for(let i=0;i<100;i++){
    const next=copyRecord(prior);next.b={v:i};
    delta.remember(next,prior,['b'],true);
    assert.equal(delta.keysForCopy(next),first);
    assert.deepEqual(copyRecord(next),{...next});prior=next;
  }
  for(const modify of [p=>{p.d={v:4}},p=>{delete p.b},p=>{delete p.c;p.c={v:5}}]){
    const next={...prior};modify(next);delta.remember(next,prior,Object.keys(next));
    assert.deepEqual(Object.keys(copyRecord(next)),Object.keys(next));
    assert.deepEqual(copyRecord(next),{...next});prior=next;
  }
  const special=Object.create(null);Object.defineProperty(special,'__proto__',{value:{safe:true},enumerable:true});
  special[Symbol.for('copy-test')]={v:6};
  assert.deepEqual(copyRecord(special),{...special});
});
test("diverging immutable drafts keep exact journal changes in either direction",()=>{
  let seed=971; const random=()=> (seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  const base={profiles:{a:{n:0},b:{n:1},c:{n:2}},clans:{}}, history=[base];
  for(let turn=0;turn<300;turn++) {
    const parent=history[Math.floor(random()*history.length)], profiles={...parent.profiles}, keys=[];
    for(let j=0;j<3;j++) {
      const key='p'+Math.floor(random()*30);keys.push(key);
      if(random()<.3)delete profiles[key];else profiles[key]={n:turn+j};
    }
    delta.remember(profiles,parent.profiles,keys);
    const next={...base,profiles};history.push(next);
    const old=history[Math.floor(random()*history.length)];
    for(const [from,to] of [[old,next],[next,old]]) {
      const actual=delta.changedKeys(from.profiles,to.profiles);
      assert.notEqual(actual,null);
      const expected=[...new Set([...Object.keys(from.profiles),...Object.keys(to.profiles)])]
        .filter(k=>Object.hasOwn(from.profiles,k)!==Object.hasOwn(to.profiles,k)||from.profiles[k]!==to.profiles[k]);
      assert.deepEqual(actual.sort(),expected.sort());
      assert.deepEqual(applyTransfer(from,difference(to,from)),to);
    }
  }
});
test("sealed table hints preserve journal reconstruction through replacement, deletion and recreation",()=>{
  let seed=71,world={profiles:{},clans:{}};
  const random=()=> (seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  for(let i=0;i<40;i++)world.profiles['p'+i]={id:'p'+i,n:0,progress:{xp:0}};
  const history=[world];
  for(let turn=0;turn<220;turn++){
    const before=world, profiles={...world.profiles},keys=[];
    for(let j=0;j<3;j++){
      const key='p'+Math.floor(random()*50);keys.push(key);
      if(random()<.2)delete profiles[key];
      else profiles[key]={id:key,n:turn,progress:{xp:Math.floor(random()*10000)}};
    }
    delta.remember(profiles,before.profiles,keys);
    world={profiles,clans:world.clans};history.push(world);
    const old=history[Math.max(0,history.length-1-Math.floor(random()*75))];
    const patch=difference(world,old), full=difference({...world,profiles:{...world.profiles}},old);
    // Removal order is immaterial; the optimized traversal follows write
    // provenance rather than the original table's insertion order.
    for (const candidate of [patch,full]) for (const table of Object.values(candidate.tables || {}))
      if (Array.isArray(table.remove)) table.remove.sort();
    assert.deepEqual(patch,full);
    assert.deepEqual(applyTransfer(old,patch),world);
    assert.deepEqual(applyTransfer(old,full),world);
  }
});
test("unknown ancestry and long chains fall back; input key mutation cannot change sealed hints",()=>{
  const first={a:{n:1}},keys=['a'],next={...first,a:{n:2}};
  delta.remember(next,first,keys);keys.length=0;
  assert.deepEqual(delta.changedKeys(first,next),['a']);
  assert.equal(delta.changedKeys({...first},next),null);
  let row=next; const history=[first,next];
  for(let i=0;i<70;i++){const n={...row,a:{n:i}};delta.remember(n,row,['a']);row=n;history.push(n);}
  assert.equal(delta.changedKeys(first,row),null);
  assert.deepEqual(difference({profiles:row},{profiles:first}),difference({profiles:structuredClone(row)},{profiles:structuredClone(first)}));
});
test("mutable transaction batches publish table hints only after sealing",()=>{
  const base={profiles:{a:{id:'a'},b:{id:'b'}}},batch=createProfileBatch(base);
  const first=replaceBatchProfile(batch,base,'a',{id:'a',coins:1});
  const second=replaceBatchProfile(batch,first,'b',{id:'b',coins:2});
  assert.equal(delta.changedKeys(base.profiles,second.profiles),null);
  sealProfileBatch(batch);
  assert.deepEqual(delta.changedKeys(base.profiles,second.profiles),['a','b']);
  assert.deepEqual(applyTransfer(base,difference(second,base)),second);
});

test("repeated sealed comparisons remain isolated from callers and later unknown drafts",()=>{
  const seed={a:{n:0},b:{n:0}}, first={...seed}, second={...first,b:{n:1},a:{n:2}};
  delta.remember(first,seed,[]);delta.remember(second,first,['b','a']);
  const keys=delta.changedKeys(first,second);keys.sort();keys.pop();
  assert.deepEqual(delta.changedKeys(first,second),['b','a']);
  const again=delta.changedKeys(first,second);again.length=0;
  assert.deepEqual(delta.changedKeys(first,second),['b','a']);
  const draft={...second,a:{n:3}};
  assert.equal(delta.changedKeys(first,draft),null);
  delta.remember(draft,second,['a']);
  assert.deepEqual(new Set(delta.changedKeys(first,draft)),new Set(['a','b']));
  assert.deepEqual(applyTransfer({profiles:first},difference({profiles:draft},{profiles:first})),{profiles:draft});
});

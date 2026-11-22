"use strict";
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const assert=require('node:assert/strict');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const file=require.resolve('../../src/server/profiles/settlement-cache');
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_SETTLEMENT_CACHE,'utf8'),file);
const variants=[old.exports,require(file)],at=Date.parse('2026-11-11T12:00:00Z');
const fixture=require('./database-room-fixture.cjs').createFixture(at),results=[];
const comparable=data=>{const out=structuredClone(data);for(const p of Object.values(out.profiles))
  for(const [i,e] of p.transactions.entries.entries())e.id='entry-'+i;return out;};
let expected;
for(const variant of [0,1,1,0]){
  let time=at;const store=new ProfileStore({now:()=>time,incrementalSettlement:true});
  store.settlementCache=new variants[variant].SettlementCache();
  store.data=structuredClone(fixture.data);store.save(store.data);
  const ids=Object.keys(store.data.clans);let ms=0;
  for(let i=0;i<400;i++){
    time=at+i*50;const id=ids[i%ids.length],before=store.data;
    const next={...before,clans:{...before.clans,[id]:{...before.clans[id],xp:before.clans[id].xp+10}}};
    const start=performance.now();store.save(next);
    if(i>=50)ms+=performance.now()-start;
  }
  const actual=comparable(store.data);
  if(expected)assert.deepEqual(actual,expected);else expected=actual;
  results.push({variant:variant?'after':'before',profiles:1280,clans:128,settlements:350,ms});
}
console.log(JSON.stringify({exact:true,scope:'Full settlement CPU, no disk/network',results}));

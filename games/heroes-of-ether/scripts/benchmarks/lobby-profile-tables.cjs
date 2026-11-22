"use strict";
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const assert=require("node:assert/strict"),{performance}=require("node:perf_hooks");
const current=require("../../src/server/profiles/profile-store");
const file=require.resolve("../../src/server/profiles/profile-store");
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_PROFILE_STORE,"utf8"),file);
const at=Date.parse("2026-11-11T12:00:00Z"),fixture=require("./database-room-fixture.cjs").createFixture(at);
const variants=[old.exports,current],results=[];let expected;
function comparable(data) {
  const copy=structuredClone(data);
  for(const p of Object.values(copy.profiles))for(const [i,e] of p.transactions.entries.entries())e.id="entry-"+i;
  return copy;
}
for(const k of [0,1,1,0]) {
  let time=at;
  const store=new variants[k].ProfileStore({now:()=>time,incrementalSettlement:true});
  store.data=structuredClone(fixture.data);store.save(store.data);
  let ms=0;
  for(let i=0;i<180;i++) {
    time=at+i*50;
    const start=performance.now();
    store.transact(fixture.tokens[i%30],"lobby-table-test-"+String(i).padStart(8,"0"),"fixture-reward",
      p=>{p.wallet.coins++;},p=>({coins:p.wallet.coins}));
    if(i>=30)ms+=performance.now()-start;
  }
  const actual=comparable(store.data);
  if(expected)assert.deepEqual(actual,expected);else expected=actual;
  results.push({variant:k?"after":"before",profiles:1280,lobby:30,transactions:150,ms});
}
console.log(JSON.stringify({exact:true,scope:"CPU preparation only, no disk or sockets",results}));

"use strict";
const fs=require("node:fs"),path=require("node:path"),Module=require("node:module");
const assert=require("node:assert/strict"),{performance}=require("node:perf_hooks");
const current=require("../../src/server/clans/clan-competition-service");
const file=require.resolve("../../src/server/clans/clan-competition-service");
const old=new Module(file,module);old.filename=file;old.paths=Module._nodeModulePaths(path.dirname(file));
old._compile(fs.readFileSync(process.env.BASELINE_CLAN_SCORE,"utf8"),file);
const variants=[old.exports,current],at=Date.parse("2026-11-11T12:00:00Z");
const root=require("./mongodb-room-fixture.cjs").createFixture(at).data;
const keys=Object.keys(root.profiles).slice(0,35),results=[];
for(const receipts of [0,1000,10000]) {
  const history=Object.freeze(Object.fromEntries(Array.from({length:receipts},(_,i)=>[
    "synthetic-cast-"+String(i).padStart(8,"0"),"consume:rocket"] )));
  const base=variants.map(v=>v.capture(root,root,at));
  for(const world of base) {
    world.profiles={...world.profiles};
    for(const key of keys)world.profiles[key]={...world.profiles[key],receipts:history};
  }
  assert.deepEqual(base[0],base[1]);
  const inputs=base.map(world=>Array.from({length:90},(_,i)=>{
    const changed=[keys[i%keys.length],keys[(i+13)%keys.length]],profiles={...world.profiles};
    for(const key of changed){const p=profiles[key];profiles[key]={...p,greatness:i%3?90:1999990,
      progress:{...p.progress,kills:p.progress.kills+1+i*17}};}
    return {next:{...world,profiles},changed};
  }));
  // Validate the whole persisted result, including rewards and all histories.
  for(let i=0;i<90;i++) {
    const out=variants.map((v,k)=>v.capture(inputs[k][i].next,base[k],at,
      {incremental:true,validatedPrevious:true,profileKeys:inputs[k][i].changed}));
    assert.deepEqual(out[0],out[1]);
    for(const k of [0,1])for(const key of keys)assert.equal(base[k].profiles[key].receipts,history);
  }
  for(const k of [0,1,1,0]) {
    let total=0;const start=performance.now();
    for(let round=0;round<3;round++)for(const {next,changed} of inputs[k]) {
      const out=variants[k].capture(next,base[k],at,
        {incremental:true,validatedPrevious:true,profileKeys:changed});
      total+=out.profiles[changed[0]].revision;
    }
    results.push({variant:k?"after":"before",receipts,calls:270,total,ms:performance.now()-start});
  }
}
console.log(JSON.stringify({exact:true,results}));

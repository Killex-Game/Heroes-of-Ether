"use strict";
const path=require("node:path"),fs=require("node:fs"),assert=require("node:assert/strict");
const {performance}=require("node:perf_hooks"),{createHash}=require("node:crypto");
const [runtime,output,iterationsText="1000"]=process.argv.slice(2),iterations=Number(iterationsText);
assert(runtime&&output&&Number.isInteger(iterations)&&iterations>=100&&iterations<=10000);
const root=path.resolve(runtime),{ProfileStore}=require(path.join(root,"src/server/profiles/profile-store"));
const at=Date.parse("2026-11-24T10:00:00Z");
const fixture=require(path.join(root,"scripts/benchmarks/database-room-fixture.cjs")).createFixture();
const store=Object.create(ProfileStore.prototype);store.data=fixture.data;store.now=()=>at;
const profiles=Object.values(fixture.data.profiles).slice(0,60).map((p,i)=>({...p,account:{...p.account,vipUntil:at+1000000,premiumUntil:at+1000000},skinId:i%2?"forest-spirit":"moon-dragon"}));
for(const p of profiles)store.arenaAppearance(p);
global.gc?.();
const hash=createHash("sha256"),before=process.cpuUsage(),started=performance.now();
for(let round=0;round<iterations;round++)for(let i=0;i<profiles.length;i++){
  const p=profiles[i];profiles[i]={...p,revision:p.revision+1,wallet:{...p.wallet,coins:round},progress:{...p.progress,maxMass:round}};
  hash.update(JSON.stringify(store.arenaAppearance(profiles[i])));
}
const elapsedMs=performance.now()-started,cpu=process.cpuUsage(before);
const report={runtime:root,node:process.version,iterations,profiles:profiles.length,calls:iterations*profiles.length,elapsedMs,cpuMs:(cpu.user+cpu.system)/1000,hash:hash.digest("hex"),rssMiB:process.memoryUsage().rss/1048576,scope:"Offline immutable profile replacement/appearance projection, not complete server capacity or frame time"};
fs.writeFileSync(output,JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(report));

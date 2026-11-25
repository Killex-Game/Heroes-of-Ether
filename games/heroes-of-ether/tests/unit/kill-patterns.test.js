'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const patterns=require('../../src/server/arena/kill-patterns'),{validate,KillDetector}=require('../../src/server/arena/kill-detector');
const epoch=Date.UTC(2026,10,26),wrap=e=>({id:randomUUID(),createdAt:epoch+1000000,status:'new',...e});
function runner(){const state=patterns.session(),cases=[];return {state,cases,send(at,message,extra={}){const e=patterns.observe(state,message,at,{wallAt:epoch+at,spawn:1,width:10000,height:10000,...extra});if(e){validate(wrap(e));cases.push(e);}return e;}};}
test('three regular manual windows create a review, not a ban; timestamps are wall clock',()=>{
 const r=runner();for(let at=0;at<240000;at+=1000)r.send(at,{type:'split'});
 assert.equal(r.cases.length,1);const e=r.cases[0];assert.equal(e.patternEvidence.kind,'manual-cadence');assert.equal(e.features,null);
 assert.equal(e.patternEvidence.samples.length,3);assert(e.patternEvidence.samples[0].start>=epoch);assert.equal(e.modelReady,false);
});
test('manual targeted boosters and pet/accessory commands are observed, repeated request ids are ignored',()=>{
 for(const type of ['useBooster','usePetBooster','useAccessoryBooster']) {
  const r=runner();for(let at=0;at<240000;at+=2000)r.send(at,{type,boosterId:'rocket',requestId:randomUUID()});assert.equal(r.cases.length,1,type);
 }
 const r=runner(),requestId=randomUUID();for(let at=0;at<240000;at+=1000)r.send(at,{type:'useBooster',boosterId:'rocket',requestId});assert.equal(r.cases.length,0);
});
test('normal 50ms movement, W, feeding hold, straight travel and stationary aim are excluded',()=>{
 const r=runner();for(let at=0;at<300000;at+=50){r.send(at,{type:'move',x:500+at/100,y:600});r.send(at,{type:'feed'});
  if(at%100===0)r.send(at,{type:'useBooster',boosterId:'meat',requestId:randomUUID()});}
 assert.equal(r.cases.length,0);assert(r.state.route.rows.length<=patterns.HISTORY);assert.equal(r.state.channels.size,0);
 const still=runner();for(let at=0;at<300000;at+=50)still.send(at,{type:'move',x:1000,y:1000});assert.equal(still.cases.length,0);assert.equal(still.state.route.rows.length,1);
});
test('human jitter, gaps, stalls, stale lives and one network batch do not become a regular rhythm',()=>{
 const r=runner();let seed=123;for(let at=0;at<300000;){seed=(seed*1664525+1013904223)>>>0;at+=500+seed%1700;r.send(at,{type:'split'});}assert.equal(r.cases.length,0);
 for(const mode of ['stall','spawn','gap','batch','stale']) {const r=runner();for(let at=0;at<300000;at+=1000){
   if(mode==='gap'&&at%40000>20000)continue;
   r.send(mode==='batch'?Math.floor(at/60000)*60000:at,{type:'split',...(mode==='stale'?{spawnSerial:0}:{})},
     mode==='stall'?{stalled:at%40000===0}:mode==='spawn'?{spawn:Math.floor(at/40000)}:{});
 }assert.equal(r.cases.length,0,mode);}
});
test('four repeated multi-turn routes with repeated cadence are reviewable; straight and jittering loops are not',()=>{
 const r=runner(),points=[[200,200],[1200,200],[1200,1200],[200,1200]];
 for(let at=0;at<210000;at+=1000){const [x,y]=points[Math.floor(at/9000)%4];r.send(at,{type:'move',x,y});}
 assert.equal(r.cases.length,1);assert.equal(r.cases[0].patternEvidence.kind,'repeated-route');
 const random=runner();let step=0;for(let at=0;at<300000;at+=1000){if(at%(step%2?7000:11000)===0)step++;const [x,y]=points[step%4];random.send(at,{type:'move',x,y});}assert.equal(random.cases.length,0);
});
test('invalid and oversized evidence rejected; separate patterns never train the booster burst model',()=>{
 const r=runner();for(let at=0;at<240000;at+=1000)r.send(at,{type:'split'});const c=wrap(r.cases[0]);
 assert.throws(()=>validate({...c,patternEvidence:{...c.patternEvidence,samples:[]}}));
 assert.throws(()=>validate({...c,createdAt:epoch}));
 const rows=Array.from({length:40},(_,i)=>({action:'killReview',targetId:String(i),after:{case:{...c,status:i%2?'confirmed':'dismissed',features:[1,1,1,1,1]}}}));
 assert.equal(require('../../src/server/arena/kill-model').train(rows).ready,false);
});
test('detector stores one durable review; WAL recovery preserves inventory and no automatic ban',async t=>{
 const fs=require('node:fs'),path=require('node:path'),{ProfileStore}=require('../../src/server/profiles/profile-store');
 const dir=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'pattern-wal-')),file=path.join(dir,'profiles.json');
 const profiles=new ProfileStore({filePath:file,journal:true,now:()=>epoch+300000}),u=profiles.open(),before=structuredClone(profiles.byId(u.profile.id));
 t.after(async()=>{await profiles.close();fs.rmSync(dir,{recursive:true,force:true});});const detector=new KillDetector({profiles,now:()=>epoch+300000});
 const r=runner();for(let at=0;at<240000;at+=1000)r.send(at,{type:'split'});
 assert(await detector.report(u.profile.id,r.cases[0]));assert.equal(await detector.report(u.profile.id,r.cases[0]),false);
 const p=profiles.byId(u.profile.id);validate(p.kill);assert(!p.moderation?.ban);assert.deepEqual(p.inventory,before.inventory);
 const saved=Object.values(require('../../src/server/profiles/profile-journal').recover(file).data.profiles).find(x=>x.id===p.id);assert.deepEqual(saved.kill,p.kill);
 const old=profiles.save,world=profiles.data;const second=profiles.open();profiles.save=()=>{throw Error('disk full');};
 await assert.rejects(detector.report(second.profile.id,r.cases[0]),/disk full/);assert(!profiles.byId(second.profile.id).kill);profiles.save=old;
});

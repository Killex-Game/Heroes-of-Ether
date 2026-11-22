'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{randomUUID}=require('crypto');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {KillDetector,validate}=require('../../src/server/arena/kill-detector');
const {ArenaBoosterQueue}=require('../../src/server/profiles/arena-booster-queue');
const {recover}=require('../../src/server/profiles/profile-journal');
const {OwnerService}=require('../../src/server/admin/owner-service');
const {OwnerAccess}=require('../../src/server/admin/owner-access');
const model=require('../../src/server/arena/kill-model');
const evidence=()=>({version:1,features:[.8,.9,.6,.8,.9],windows:[0,15000,30000].map(start=>({start,end:start+15000,count:300,kinds:3,rate:20,shortFraction:.9,maxBurst:18})),modelReady:false,modelScore:null,reason:'repeated-mixed-bursts'});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kill-review-')),file=path.join(dir,'profiles.json'),at=Date.UTC(2026,10,21,10);
 const profiles=new ProfileStore({filePath:file,journal:true,incrementalSettlement:true,now:()=>at});const a=profiles.open(),b=profiles.open();
 const queue=new ArenaBoosterQueue(profiles),kill=new KillDetector({profiles,actionQueue:queue,now:()=>at});
 const access=new OwnerAccess({ownerId:a.profile.id,now:()=>at}),owner=profiles.find(a.token),target=profiles.find(b.token);profiles.ownerId=owner.id;
 const service=new OwnerService({profiles,access,inArena:()=>true,now:()=>at});
 t.after(async()=>{await profiles.close();fs.rmSync(dir,{recursive:true,force:true});});
 const command=verdict=>({action:'killReview',targetId:target.id,requestId:randomUUID(),revision:profiles.byId(target.id).revision,moderationRevision:profiles.byId(target.id).moderation?.version||0,caseId:profiles.byId(target.id).kill.id,verdict,reason:'Проверено по записи и серверным действиям'});
 return {profiles,kill,service,owner,target,command,file,at};
}
test('suspicion is durable, bounded, deduplicated and never bans; manual dismissal is audited and repeat-safe',async t=>{
 const f=await fixture(t),before=structuredClone(f.profiles.byId(f.target.id));
 assert(await f.kill.report(f.target.id,evidence()));assert.equal(await f.kill.report(f.target.id,evidence()),false);
 const p=f.profiles.byId(f.target.id);assert.equal(p.kill.status,'new');assert(!p.moderation?.ban);validate(p.kill);
 const restored=Object.values(recover(f.file).data.profiles).find(x=>x.id===p.id);assert.deepEqual(restored.kill,p.kill);
 assert.deepEqual(p.wallet,before.wallet);assert.deepEqual(p.inventory,before.inventory);
 assert.equal(f.service.players('',1,{view:'kill'}).total,1);
 const cmd=f.command('dismissed');f.service.apply(f.owner,cmd);assert.equal(f.profiles.byId(p.id).kill.status,'dismissed');assert(!f.profiles.byId(p.id).moderation.ban);
 assert(f.service.apply(f.owner,cmd).duplicate);assert.equal(f.profiles.data.administration.audit.filter(e=>e.action==='killReview').length,1);
 assert.throws(()=>f.service.apply(f.owner,{...f.command('confirmed'),requestId:randomUUID()}),/уже обработана/);
});
test('confirmed manual review gives 180 days, appears in violators, unauthorized actor cannot review',async t=>{
 const f=await fixture(t);await f.kill.report(f.target.id,evidence());const cmd=f.command('confirmed');
 assert.throws(()=>f.service.apply(f.target,cmd),/Нет права/);f.service.apply(f.owner,cmd);
 const p=f.profiles.byId(f.target.id);assert.equal(p.moderation.ban.until,f.at+180*86400000);assert.equal(p.moderation.ban.reason,'Нарушение правил игры по пункту 3.2');
 assert.equal(f.service.players('',1,{view:'violators'}).players[0].id,p.id);assert.equal(p.kill.status,'confirmed');
 const replay=new ProfileStore({filePath:f.file,now:()=>f.at});assert.deepEqual(replay.byId(p.id).kill,p.kill);
});
test('failed durable commit does not publish suspicion; successful retry retains one case',async t=>{
 const f=await fixture(t),before=f.profiles.data,original=f.profiles.journal.stage;
 f.profiles.journal.stage=()=>Promise.reject(Error('disk failed'));
 await assert.rejects(f.kill.report(f.target.id,evidence()),/disk failed/);assert.strictEqual(f.profiles.data,before);assert(!f.profiles.byId(f.target.id).kill);
 f.profiles.journal.stage=original;assert(await f.kill.report(f.target.id,evidence()));
});

test('admin lists and player card expose compact suspicion and unfiltered new-case count without mutations', async t=>{
 const f=await fixture(t);await f.kill.report(f.target.id,evidence());
 const p=f.profiles.byId(f.target.id),before=structuredClone(f.profiles.data);
 const summary={id:p.kill.id,status:'new',createdAt:p.kill.createdAt};
 assert.deepEqual(f.service.player(p.id).killReview,summary);
 for(const view of ['settings','online','registrations','kill']) {
  const list=f.service.players('',1,{view});assert.equal(list.killPending,1);
  const row=list.players.find(r=>r.id===p.id);assert(row);assert.deepEqual(row.killReview,summary);
  if(view!=='kill')assert(!Object.hasOwn(row,'kill'),'large evidence is confined to the review page');
 }
 assert.equal(f.service.players('no-such-player').killPending,1);
 assert.deepEqual(f.profiles.data,before);
 f.service.apply(f.owner,f.command('dismissed'));
 assert.equal(f.service.players().killPending,0);
 assert.equal(f.service.player(p.id).killReview.status,'dismissed');
});
test('cadence detector ignores legitimate hold, UUID retries, single TCP burst and server stalls',async()=>{
 const detector=new KillDetector({profiles:{data:{}}});let reports=0;detector.report=async()=>{reports++;};
 const send=(s,at,id='ice_cream',requestId=randomUUID(),stalled=false)=>detector.observe(s,'p',{type:'useBooster',boosterId:id,requestId},at,{stalled});
 const hold=detector.session();for(let at=0;at<=90000;at+=100)send(hold,at);
 const retry=detector.session(),id=randomUUID();for(let at=0;at<=90000;at+=5)send(retry,at,'ice_cream',id);
 const batch=detector.session();for(let n=0;n<60;n++)send(batch,n,'ice_cream');send(batch,20000);
 const stall=detector.session();for(let at=0;at<90000;at+=100)send(stall,at,at%200?'candy':'ice_cream',randomUUID(),true);
 assert.equal(reports,0);assert(hold.seen.size<=256&&hold.recent.length<=256);
});
test('three sustained mixed burst windows create review evidence, without an automatic ban',()=>{
 const detector=new KillDetector({profiles:{data:{}}}),s=detector.session(),cases=[];detector.report=async(id,e)=>cases.push(e);
 for(let sec=0;sec<=50;sec++)for(let k=0;k<12;k++)detector.observe(s,'p',{type:'useBooster',boosterId:k%2?'candy':'ice_cream',requestId:randomUUID()},sec*1000+k);
 assert.equal(cases.length,1);assert.equal(cases[0].windows.length,3);assert.equal(cases[0].modelReady,false);
});
test('model waits for independently labelled classes, learns locally, does not treat score as a ban',()=>{
 const row=(id,y)=>({action:'killReview',targetId:id,after:{case:{status:y?'confirmed':'dismissed',features:y?[.9,.9,.7,.8,.9]:[.1,.05,.2,.1,.1]}}});
 assert.equal(model.train(Array.from({length:60},()=>row('one-player',1))).ready,false);
 const examples=Array.from({length:40},(_,i)=>row('p'+i,i%2)),m=model.train(examples);assert(m.ready);assert.equal(m.positive,20);assert.equal(m.negative,20);
 assert(model.predict(m,[.9,.9,.7,.8,.9])>model.predict(m,[.1,.05,.2,.1,.1]));assert.deepEqual(m,model.train(examples));
});

test('historical gift evidence is durable and reviewable without manufacturing booster training labels',async t=>{
 const f=await fixture(t),g={version:1,domain:'gift-dispatch-v1',sourceSha256:'a'.repeat(64),eventsSha256:'b'.repeat(64),start:f.at-3600000,end:f.at-1000,count:1000,recipients:3,longestSeries:800,medianIntervalMs:1300,peakPerMinute:46,relatedIds:[]};
 const e={version:1,reason:'gift-dispatch-pattern',features:null,windows:[],modelReady:false,modelScore:null,giftEvidence:g};
 assert(await f.kill.report(f.target.id,e));const p=f.profiles.byId(f.target.id);validate(p.kill);
 assert(!p.moderation?.ban);assert.equal(f.service.players('',1,{view:'kill'}).players[0].kill.giftEvidence.count,1000);
 const saved=Object.values(recover(f.file).data.profiles).find(x=>x.id===p.id);assert.deepEqual(saved.kill,p.kill);
 f.service.apply(f.owner,f.command('dismissed'));
 const trained=model.train(f.profiles.data.administration.audit);assert.equal(trained.positive,0);assert.equal(trained.negative,0);
 const fabricated=Array.from({length:40},(_,i)=>({action:'killReview',targetId:String(i),after:{case:{...p.kill,status:i%2?'confirmed':'dismissed',features:[1,1,1,1,1]}}}));
 assert.equal(model.train(fabricated).ready,false);assert.equal(model.train(fabricated).positive,0);
});
test('historical review import preserves all other fields and refuses duplicate players or an existing open case',()=>{
 const {register}=require('../../src/server/arena/kill-gift-evidence'),id=randomUUID();
 const record={id:randomUUID(),version:1,status:'new',createdAt:1,reason:'gift-dispatch-pattern',features:null,windows:[],modelReady:false,modelScore:null,
 giftEvidence:{version:1,domain:'gift-dispatch-v1',sourceSha256:'a'.repeat(64),eventsSha256:'b'.repeat(64),start:1,end:2,count:10,recipients:1,longestSeries:10,medianIntervalMs:1,peakPerMinute:10,relatedIds:[]}};
 const p={id,revision:1,wallet:{coins:42},gifts:{history:[1,2,3]}},world={profiles:{key:p},clans:{c:{members:[id]}},events:{},_journalRevision:9};
 const entry={playerId:id,record},result=register(world,[entry],100);
 assert.deepEqual(result.world.profiles.key.wallet,p.wallet);assert.strictEqual(result.world.clans,world.clans);assert.equal(p.kill,undefined);
 assert.equal(result.world.profiles.key.revision,2);assert.equal(result.world.profiles.key.kill.status,'new');assert.equal(result.world.profiles.key.moderation,undefined);
 assert.strictEqual(register(result.world,[entry],200).world,result.world);
 assert.throws(()=>register(world,[entry,entry],100),/Duplicate/);
 assert.throws(()=>register(result.world,[{playerId:id,record:{...record,id:randomUUID()}}],100),/open case/);
});

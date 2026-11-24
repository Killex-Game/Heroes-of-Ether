'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {recover}=require('../../src/server/profiles/profile-journal');
const at=Date.parse('2026-11-24T09:00:00.000Z');
// Kill only a spawned isolated writer. This tests process death at publication
// boundaries; it does not simulate a filesystem losing power or lying on fsync.
const childSource=String.raw`
const fs=require('node:fs'),assert=require('node:assert/strict');
const [storePath,writerPath,filePath,stage,time]=process.argv.slice(1);
const {ProfileStore}=require(storePath),writer=require(writerPath),at=Number(time);
function crash(){fs.writeFileSync(filePath+'.stage',stage);process.kill(process.pid,'SIGKILL');}
const store=new ProfileStore({filePath,journal:true,now:()=>at});
store.journal.asyncArenaWrites=true;
const id=store.open().profile.id;store.startLife(id,'life');
fs.writeFileSync(filePath+'.initial',JSON.stringify({...store.data,_journalRevision:store.journal.revision}));
const realWrite=writer.writePending;
writer.writePending=async(file,bytes)=>{
 if(stage==='partial'){await fs.promises.writeFile(file,bytes.subarray(0,Math.floor(bytes.length/2)));crash();}
 await realWrite(file,bytes);if(stage==='synced')crash();
};
const publish=store.journal.publishSealed.bind(store.journal);
store.journal.publishSealed=(...args)=>{const result=publish(...args);if(result)fs.writeFileSync(filePath+'.published',JSON.stringify({...args[1],_journalRevision:store.journal.revision}));if(stage==='promoted'){assert.equal(result,true);crash();}return result;};
const event={type:'absorbed',profileId:id,victimProfileId:'other',gain:35,lifeId:'life'};
store.applyArenaProgress('confirmed',[event],at,true).then(result=>{
 assert.deepEqual(result,[id]);assert.equal(stage,'acknowledged');
 fs.writeFileSync(filePath+'.ack','confirmed');crash();
}).catch(error=>{console.error(error);process.exit(1);});
`;
for(const stage of ['partial','synced','promoted','acknowledged'])test('Async arena process recovery at '+stage+' preserves acknowledged data and exact replay',{timeout:30000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arena-process-recovery-')),filePath=path.join(dir,'profiles.json');let store;
 try{
  const child=spawn(process.execPath,['-e',childSource,require.resolve('../../src/server/profiles/profile-store'),require.resolve('../../src/server/profiles/profile-arena-file'),filePath,stage,String(at)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const timer=setTimeout(()=>child.kill('SIGKILL'),20000);
  try{await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});}finally{clearTimeout(timer);}
  assert(fs.existsSync(filePath+'.stage'),stderr||'Writer exited before the requested stage');
  assert.equal(fs.readFileSync(filePath+'.stage','utf8'),stage);
  assert.equal(fs.existsSync(filePath+'.ack'),stage==='acknowledged');
  const committed=['promoted','acknowledged'].includes(stage),before=recover(filePath);
  assert.deepEqual(before.data,JSON.parse(fs.readFileSync(filePath+(committed?'.published':'.initial'))));
  assert.equal(Object.values(before.data.profiles)[0].progress.absorbedMass,committed?35:0);
  store=new ProfileStore({filePath,journal:true,now:()=>at});store.journal.asyncArenaWrites=true;
  const id=Object.values(store.data.profiles)[0].id,event={type:'absorbed',profileId:id,victimProfileId:'other',gain:35,lifeId:'life'};
  assert.deepEqual(await store.applyArenaProgress('confirmed',[event],at,true),committed?[]:[id]);
  const exact=structuredClone(store.byId(id));
  assert.equal(exact.progress.absorbedMass,35);
  assert.deepEqual(await store.applyArenaProgress('confirmed',[event],at,true),[]);
  assert.deepEqual(store.byId(id),exact);
  // Startup settles the interrupted life in memory. A replay is deliberately
  // read-only; explicitly persist that startup settlement before comparing its
  // new profile revision with disk. The pre-startup WAL was checked above.
  store.save(store.data,at);
  await store.close();store=null;
  const durable=recover(filePath);assert.equal(durable.data.progressReceipt,'confirmed');
  assert.deepEqual(Object.values(durable.data.profiles)[0],exact);
 }finally{
  if(store)await store.close();
  const target=path.resolve(dir),root=path.resolve(os.tmpdir());assert(target.startsWith(root+path.sep+'arena-process-recovery-'));
  fs.rmSync(target,{recursive:true,force:true});
 }
});

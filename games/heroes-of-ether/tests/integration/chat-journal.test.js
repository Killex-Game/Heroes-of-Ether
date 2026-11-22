'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {ChatService}=require('../../src/server/chat/chat-service');
const {recover}=require('../../src/server/profiles/profile-journal');
const {readLocal}=require('../../src/server/persistence/state-snapshot');
const {temporary}=require('../temp');
const input=text=>({requestId:randomUUID(),text});
function fixture(t,seed){
  let cleanup;
  const dir=temporary({after:fn=>{cleanup=fn;}},'chat-journal'),file=path.join(dir,'clan-chat.json');let at=1000;
  if(seed)fs.writeFileSync(file,JSON.stringify(seed));
  const chat=new ChatService({filePath:file,journal:true,now:()=>at});
  t.after(async()=>{try{await chat.close();}finally{cleanup();}});
  return {chat,file,dir,at:n=>{at=n;},p:{id:'player',name:'Игрок'}};
}
test('chat publishes and acknowledges only after asynchronous fsync; socket loop remains free',async t=>{
  const f=fixture(t);await f.chat.writer.tail;
  const real=fs.fsync;let release,entered;
  const waiting=new Promise(r=>{entered=r;});
  const mock=t.mock.method(fs,'fsync',(fd,cb)=>{release=()=>real(fd,cb);entered();});
  let accepted=false;
  const pending=f.chat.send(f.p,null,'clan',input('Привет')).then(r=>{accepted=true;return r;});
  await waiting;await new Promise(r=>setImmediate(r));
  assert.equal(accepted,false);assert.equal(f.chat.history('clan').messages.length,0);
  assert.equal(f.chat.achievementCounts.player,undefined);
  mock.mock.restore();release();const reply=await pending;
  assert.equal(reply.duplicate,false);assert.equal(f.chat.achievementCounts.player,1);
  assert.equal(recover(f.file).data.clans.clan[0].id,reply.message.id);
});
test('failed fsync rolls back message, receipt and count; same request retries once',async t=>{
  const f=fixture(t),request=input('Сохранение');await f.chat.writer.tail;
  const before=JSON.stringify(recover(f.file).data);
  const fault=t.mock.method(fs,'fsync',(fd,cb)=>setImmediate(()=>cb(Error('injected disk failure'))));
  await assert.rejects(f.chat.send(f.p,null,'clan',request),/disk failure/);fault.mock.restore();
  assert.equal(JSON.stringify(recover(f.file).data),before);assert.equal(f.chat.achievementCounts.player,undefined);
  const sent=await f.chat.send(f.p,null,'clan',request);
  assert.equal(sent.duplicate,false);assert.equal((await f.chat.send(f.p,null,'clan',request)).duplicate,true);
  assert.equal(f.chat.achievementCounts.player,1);
});
test('parallel distinct authors and concurrent repeats retain every receipt without double credit',async t=>{
  const f=fixture(t),credits=new Map();f.chat.onAccepted=(id,n)=>credits.set(id,n);
  const messages=Array.from({length:80},(_,i)=>({p:{id:'p'+i,name:'Имя '+i},request:input('Сообщение '+i)}));
  const replies=await Promise.all(messages.flatMap(({p,request})=>[
    f.chat.send(p,null,'clan',request),f.chat.send(p,null,'clan',request),
  ]));
  assert.equal(replies.filter(r=>!r.duplicate).length,80);assert.equal(credits.size,80);
  assert([...credits.values()].every(n=>n===1));
  const saved=recover(f.file).data;assert.equal(Object.keys(saved.messageReceipts).length,80);
  assert.equal(saved.clans.clan.length,80);
  await f.chat.writer.checkpoint();assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),saved);
});
test('queued clan authorization is checked again before committing',async t=>{
  const f=fixture(t);let release;f.chat.writer.enqueue(()=>new Promise(r=>{release=r;}));
  await new Promise(r=>setImmediate(r));let member=true;
  const pending=f.chat.send(f.p,null,'clan',input('Позже'),'arena-1',()=>{
    if(!member)throw Error('membership removed');return {profile:f.p};
  });
  member=false;release();await assert.rejects(pending,/membership removed/);
  assert.equal(f.chat.achievementCounts.player,undefined);assert.equal(f.chat.history('clan').messages.length,0);
});
test('expired text is hidden immediately, removed durably and old replay protection remains',async t=>{
  const f=fixture(t),request=input('История');await f.chat.send(f.p,null,'clan',request);
  f.at(1000+48*3600000);assert.equal(f.chat.history('clan').messages.length,0);
  await f.chat.writer.tail;assert.deepEqual(recover(f.file).data.clans,{});
  assert.equal((await f.chat.send(f.p,null,'clan',request)).duplicate,true);
  assert.equal(f.chat.achievementCounts.player,1);assert.equal(Object.keys(recover(f.file).data.messageReceipts).length,1);
});
test('large legacy history is retained while one new WAL entry stays bounded',async t=>{
  const receipts=Object.fromEntries(Array.from({length:10000},(_,i)=>{
    const key=createHash('sha256').update('legacy'+i).digest('hex');return[key,{signature:key,id:'old-'+i,at:1}];
  }));
  const f=fixture(t,{version:1,clans:{},achievementCounts:{old:10000},messageReceipts:receipts});
  await f.chat.send(f.p,null,null,input('Новое'));
  assert(fs.statSync(f.file+'.wal').size<1500);
  const saved=recover(f.file).data;assert.equal(Object.keys(saved.messageReceipts).length,10001);
  for(const [id,value]of Object.entries(receipts))assert.deepEqual(saved.messageReceipts[id],value);
  await f.chat.writer.checkpoint();assert.deepEqual(JSON.parse(fs.readFileSync(f.file)),saved);
});
test('offline PostgreSQL source includes acknowledged chat WAL before its first checkpoint',async t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.dir,'profiles.json'),JSON.stringify({version:13,profiles:{},clans:{}}));
  const reply=await f.chat.send(f.p,null,'clan',input('Облачная копия'));
  const offline=readLocal(f.dir,true);assert.equal(offline.auxiliary['clan-chat.json'].clans.clan[0].id,reply.message.id);
  await f.chat.writer.checkpoint();assert.deepEqual(readLocal(f.dir).auxiliary,offline.auxiliary);
});

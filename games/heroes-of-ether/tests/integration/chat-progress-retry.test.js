'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {ChatService}=require('../../src/server/chat/chat-service');
const {ProfileStore}=require('../../src/server/profiles/profile-store');
const {recover}=require('../../src/server/profiles/profile-journal');
const {temporary}=require('../temp');

test('chat startup reconciles saved authors once, retries failures and keeps independent credits moving',t=>{
 const file=path.join(temporary(t,'chat-pending-credits'),'chat.json');
 fs.writeFileSync(file,JSON.stringify({version:1,clans:{},achievementCounts:{a:4,b:7},messageReceipts:{}}));
 const chat=new ChatService({filePath:file}),calls=[];let fail=true;
 chat.onAccepted=(id,count)=>{calls.push([id,count]);if(id==='a'&&fail)throw Error('disk unavailable');};
 assert.throws(()=>chat.syncProgress(),/disk unavailable/);
 assert.deepEqual(calls,[['a',4],['b',7]]);
 fail=false;chat.syncProgress();chat.syncProgress();chat.syncProgress();
 assert.deepEqual(calls,[['a',4],['b',7],['a',4]]);
 const restarted=new ChatService({filePath:file});const restored=[];
 restarted.onAccepted=(id,count)=>restored.push([id,count]);restarted.syncProgress();
 assert.deepEqual(restored,[['a',4],['b',7]],'a restart never loses unrecorded profile credits');
});

test('accepted message survives failed profile fsync and credits exactly once on retry/restart',async t=>{
 const dir=temporary(t,'chat-durable-retry'),filePath=path.join(dir,'profiles.json');
 const profiles=new ProfileStore({filePath,journal:true,incrementalSettlement:true});
 t.after(()=>profiles.close());
 const auth=profiles.open(),id=auth.profile.id,chat=new ChatService({filePath:path.join(dir,'chat.json')});
 chat.onAccepted=(pid,count)=>profiles.chatAccepted(pid,count);
 const before=structuredClone(profiles.data),request={requestId:randomUUID(),text:'Проверка сохранения'};
 const fault=t.mock.method(profiles.journal,'commit',()=>{throw Error('injected fsync failure');});
 t.mock.method(console,'error',()=>{});
 const result=chat.send(profiles.byId(id),null,'clan',request);
 assert.equal(result.duplicate,false);assert.deepEqual(profiles.data,before);
 assert.equal(new ChatService({filePath:path.join(dir,'chat.json')}).achievementCounts[id],1);
 fault.mock.restore();chat.syncProgress();
 const credited=structuredClone(profiles.data);
 chat.syncProgress();assert.deepEqual(profiles.data,credited);
 assert.equal(chat.send(profiles.byId(id),null,'clan',request).duplicate,true);
 assert.deepEqual(profiles.data,credited);
 await profiles.close();
 const saved=Object.values(recover(filePath).data.profiles).find(p=>p.id===id);
 assert.equal(saved.activity.chatAccepted,1);assert.equal(saved.activity.values.sociable,1);
});

test('chat awards detach modified branches, preserve old snapshots and retain identical rewards',t=>{
 const profiles=new ProfileStore({incrementalSettlement:true}),auth=profiles.open(),id=auth.profile.id;
 const current=profiles.byId(id),before=structuredClone(current),expected=structuredClone(current);
 const count=5000,at=profiles.now();profiles.now=()=>at;
 expected.activity.values.sociable+=count;expected.activity.chatAccepted=count;
 require('../../src/server/progression/activity-achievements').awardExtra(expected,at);
 require('../../src/server/progression/title-chest-rewards').awardTitles(expected,at);expected.revision++;
 const save=t.mock.method(profiles,'save',()=>{throw Error('write rejected');});
 assert.throws(()=>profiles.chatAccepted(id,count),/write rejected/);assert.deepEqual(current,before);
 save.mock.restore();profiles.chatAccepted(id,count);
 const after=profiles.byId(id);
 assert.deepEqual(current,before,'published source remains immutable');
 for(const field of ['activity','honors','greatness','revision'])assert.deepEqual(after[field],expected[field],field);
 for(const field of ['wallet','inventory','receipts','roulette','transactions'])assert.deepEqual(after[field],before[field],field);
 profiles.chatAccepted(id,count);assert.equal(profiles.byId(id),after,'repeat does not write');
 profiles.chatAccepted('missing',count);assert.throws(()=>profiles.chatAccepted(id,-1),/счётчик/);
});

test('async chat credits coalesce newer counts and retain failed authors for retry',async t=>{
 const chat=new ChatService(),calls=[];let finish,fail=true;
 chat.onAccepted=(id,count)=>{
   calls.push([id,count]);
   if(id==='b'&&fail)return Promise.reject(Error('profile write unavailable'));
   if(id==='a'&&count===1)return new Promise(resolve=>{finish=resolve;});
   return Promise.resolve();
 };
 t.mock.method(console,'error',()=>{});
 chat.achievementCounts={a:1,b:2};chat.credit('a');chat.credit('b');
 chat.achievementCounts.a=3;chat.credit('a');chat.syncProgress();
 assert.equal(calls.filter(([id])=>id==='a').length,1,'only one pending credit per author');
 finish();while(chat.creditJobs.size)await Promise.all([...chat.creditJobs.values()]);
 assert.deepEqual(calls.filter(([id])=>id==='a'),[['a',1],['a',3]]);
 assert.deepEqual([...chat.pendingCredits],['b']);
 fail=false;await chat.close();assert.equal(chat.pendingCredits.size,0);
});

test('live chat achievement uses async profile queue, survives failed stage and replays once',async t=>{
 let cleanup;
 const dir=temporary({after:fn=>{cleanup=fn;}},'chat-async-profile'),filePath=path.join(dir,'profiles.json');
 const profiles=new ProfileStore({filePath,journal:true,incrementalSettlement:true});
 const auth=profiles.open(),id=auth.profile.id;
 const chat=new ChatService({filePath:path.join(dir,'clan-chat.json'),journal:true});
 const app=require('../../src/server/game-server').createGameServer({profiles,chat,autoTick:false});
 t.after(()=>app.close());t.after(()=>cleanup());
 t.mock.method(console,'error',()=>{});
 const original=profiles.journal.stage.bind(profiles.journal);let reject=true,stages=0;
 t.mock.method(profiles.journal,'stage',async(...args)=>{stages++;if(reject)throw Error('injected stage failure');return original(...args);});
 const message={requestId:randomUUID(),text:'Подтверждённое сообщение'};
 assert.equal((await chat.send(profiles.byId(id),null,null,message)).duplicate,false);
 while(chat.creditJobs.size)await Promise.all([...chat.creditJobs.values()]);
 assert(stages>0);assert.equal(profiles.byId(id).activity.chatAccepted||0,0);
 assert.equal(chat.pendingCredits.has(id),true);
 assert.equal(recover(path.join(dir,'clan-chat.json')).data.achievementCounts[id],1);
 reject=false;chat.syncProgress();
 while(chat.creditJobs.size)await Promise.all([...chat.creditJobs.values()]);
 assert.equal(profiles.byId(id).activity.chatAccepted,1);
 assert.equal((await chat.send(profiles.byId(id),null,null,message)).duplicate,true);
 await app.close();
 const saved=Object.values(recover(filePath).data.profiles).find(p=>p.id===id);
 assert.equal(saved.activity.chatAccepted,1);assert.equal(saved.activity.values.sociable,1);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {BSON}=require('mongodb');
const {pack,unpack,assertCompatible,changes,sameContents}=require('../../src/server/persistence/mongodb-state');
const world={version:13,_journalRevision:1,profiles:{},clans:{}};
const key=n=>createHash('sha256').update('message-'+n).digest('hex');
function chat(count){return {version:1,_journalRevision:7,clans:{c:[{id:'m',text:'История'}]},
  achievementCounts:{a:count},messageReceipts:Object.fromEntries(Array.from({length:count},(_,i)=>{
    const hash=key(i);return[hash,{signature:hash,id:'message-'+i,at:1}];
  }))};}
test('chat snapshot larger than the old document limit survives bounded Mongo documents intact',()=>{
  const saved=chat(85000);
  assert(BSON.calculateObjectSize(saved)>14*1024*1024);
  const snapshot=pack(world,{'clan-chat.json':saved});
  assert([...snapshot.docs.values()].every(d=>BSON.calculateObjectSize(d)<3*1024*1024));
  const restored=unpack([...snapshot.docs.values()].reverse(),snapshot);
  assert.deepEqual(restored.auxiliary['clan-chat.json'],saved);
  assert.equal(snapshot.chatRevision,7);
});
test('legacy single-document chat migrates without changing text, receipts or counters',()=>{
  const saved=chat(50),old=pack(world,{'clan-chat.json':saved},{chatFormat:0});
  const manifest={...old,version:1,sourceId:'source'};
  delete manifest.chatFormat;delete manifest.chatRevision;delete manifest.chatHash;
  const read=unpack([...old.docs.values()],manifest);
  assert.deepEqual(read.auxiliary['clan-chat.json'],saved);
  const next=pack(read.world,read.auxiliary);
  assert.doesNotThrow(()=>assertCompatible(manifest,next,'source'));
  assert(changes(old,next).some(op=>op.insertOne?.document._id.startsWith('auxchat:')));
  assert.deepEqual(unpack([...next.docs.values()],next).auxiliary,read.auxiliary);
});

test('offline verification accepts storage-format migration but rejects any world, event, chat or receipt change',()=>{
  const auxiliary={'clan-chat.json':chat(12),'game-events.json':{revision:3,runs:[{id:'event',at:42}]}};
  const legacy=pack(world,auxiliary,{chatFormat:0}),modern=pack(world,auxiliary);
  assert.notEqual(legacy.digest,modern.digest);
  const old=unpack([...legacy.docs.values()],legacy),current=unpack([...modern.docs.values()],modern);
  assert(sameContents(old,current));
  for(const edit of [
    data=>data.world._journalRevision++,
    data=>data.world.profiles.player={wallet:{coins:1}},
    data=>data.auxiliary['game-events.json'].runs[0].at++,
    data=>data.auxiliary['clan-chat.json'].clans.c[0].text+='!',
    data=>data.auxiliary['clan-chat.json']._journalRevision++,
    data=>delete data.auxiliary['clan-chat.json'].messageReceipts[key(0)],
    data=>delete data.auxiliary['clan-chat.json'],
  ]) {
    const changed=structuredClone(current);edit(changed);assert.equal(sameContents(old,changed),false);
  }
});
test('chat journal rollback and same-revision divergence are refused independently of game progress',()=>{
  const saved=chat(3),snapshot=pack(world,{'clan-chat.json':saved});
  const manifest={...snapshot,version:1,sourceId:'source'};
  const older=structuredClone(saved);older._journalRevision--;
  assert.throws(()=>assertCompatible(manifest,pack(world,{'clan-chat.json':older}),'source'),/CHAT_CLOUD_AHEAD/);
  const changed=structuredClone(saved);changed.achievementCounts.a++;
  assert.throws(()=>assertCompatible(manifest,pack(world,{'clan-chat.json':changed}),'source'),/CHAT_DIVERGED/);
  changed._journalRevision++;assert.doesNotThrow(()=>assertCompatible(manifest,pack(world,{'clan-chat.json':changed}),'source'));
});
test('missing, duplicate and corrupt chat bucket rows fail before a snapshot is accepted',()=>{
  const snapshot=pack(world,{'clan-chat.json':chat(5)}),docs=[...snapshot.docs.values()];
  const index=docs.findIndex(d=>d._id.startsWith('auxchat:messageReceipts:'));
  assert.throws(()=>unpack(docs.filter((_,i)=>i!==index),snapshot),/CHECKSUM/);
  assert.throws(()=>unpack([...docs,docs[index]],snapshot),{code:'MONGO_INVALID_DOCUMENT_FRAGMENTS'});
  const corrupt=structuredClone(docs);Object.values(corrupt[index].value)[0].at++;
  assert.throws(()=>unpack(corrupt,snapshot),/CHECKSUM/);
});

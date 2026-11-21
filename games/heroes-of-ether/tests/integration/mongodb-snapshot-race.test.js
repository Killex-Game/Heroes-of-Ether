'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {MongoState,pack}=require('../../src/server/persistence/mongodb-state');
test('Atlas full read rejects a committed concurrent write instead of mixing metadata and state',
 {skip:!process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS,timeout:120000},async t=>{
 const database='hero_ether_test_'+randomUUID().replaceAll('-','').slice(0,20);
 const config={credentialsFile:process.env.HERO_ETHER_ATLAS_TEST_CREDENTIALS,database,sourceId:randomUUID()};
 const writer=new MongoState(config),reader=new MongoState(config);let owned=false;
 t.after(async()=>{
  await reader.close();
  try{if(owned&&/^hero_ether_test_[a-f0-9]{20}$/.test(database)&&writer.db.databaseName===database)await writer.db.dropDatabase();}
  finally{await writer.close();}
 });
 assert.equal((await writer.db.listCollections({},{nameOnly:true}).toArray()).length,0);owned=true;
 const before={version:14,_journalRevision:1,profiles:{p:{wallet:{coins:100},receipts:{}}},clans:{}};
 await writer.initialize(pack(before));await writer.acquire(pack(before));
 const after=structuredClone(before);after._journalRevision=2;after.profiles.p.wallet.coins=75;
 after.profiles.p.receipts.purchase={spent:25};
 assert.equal(writer.client.options.socketTimeoutMS,20000);
 assert.equal(reader.reader.options.socketTimeoutMS,120000);
 const find=reader.readMeta.findOne.bind(reader.readMeta);let changed=false;
 reader.readMeta.findOne=async(...args)=>{
  const manifest=await find(...args);
  if(!changed){changed=true;await writer.sync(pack(after));}
  return manifest;
 };
 await assert.rejects(reader.read(),{code:'MONGO_CONCURRENT_READ'});
 assert(changed);
 assert.deepEqual((await reader.read()).world,after);
});

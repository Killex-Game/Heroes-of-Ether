"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path"),fs=require("node:fs");
const {difference,ProfileJournal,recover}=require("../../src/server/profiles/profile-journal");
const {applyTransfer}=require("../../src/server/profiles/profile-transfer");
const {temporary}=require("../temp");
function world(entries){return {profiles:{p:{id:"p",transactions:{version:1,entries}}},clans:{}};}
function freeze(value){if(value&&typeof value==="object"&&!Object.isFrozen(value)){Object.freeze(value);Object.values(value).forEach(freeze);}return value;}
test("history tails use the existing nested patch and preserve array type across transfer/checkpoint/recovery",async t=>{
  const file=path.join(temporary(t,"history-tail"),"profiles.json"),journal=new ProfileJournal(file);
  try{
    let current=freeze(world(Array.from({length:1500},(_,i)=>({id:String(i),at:i,amount:i}))));
    journal.commit(current);
    for(let batch=0;batch<8;batch++){
      const entries=current.profiles.p.transactions.entries,next=world([...entries,{id:"new-"+batch,at:2000+batch,amount:7}]);
      const patch=JSON.parse(JSON.stringify(difference(next,current)));
      assert.ok(JSON.stringify(patch).length<450);
      const set=patch.tables.profileEdits.p.nested.transactions.nested.entries.set;
      assert.deepEqual(Object.keys(set),[String(entries.length)]);
      const transferred=applyTransfer(current,patch);
      assert.ok(Array.isArray(transferred.profiles.p.transactions.entries));
      assert.deepEqual(transferred,next);assert.equal(entries.length,1500+batch);
      journal.commit(next);
      assert.deepEqual(recover(file).data.profiles,next.profiles);
      if(batch===3)await journal.requestCheckpoint();
      current=freeze(next);
    }
    await journal.close();assert.deepEqual(recover(file).data.profiles,current.profiles);
  }finally{if(!journal.closed)await journal.close();}
});
test("history rewrites, truncation, initialization and removal keep their full fallback",()=>{
  const entries=[{id:"a"},{id:"b"}],before=freeze(world(entries));
  for(const replacement of [[{id:"a"},{id:"changed"}],entries.slice(0,1),[],null]){
    const next=world(replacement),patch=JSON.parse(JSON.stringify(difference(next,before)));
    assert.deepEqual(applyTransfer(before,patch),next);
    assert.ok(!patch.tables.profileEdits.p.nested.transactions?.nested?.entries);
  }
  const absent={profiles:{p:{id:"p"}},clans:{}};
  assert.deepEqual(applyTransfer(absent,JSON.parse(JSON.stringify(difference(before,absent)))),before);
  assert.deepEqual(applyTransfer(before,JSON.parse(JSON.stringify(difference(absent,before)))),absent);
});
test("failed fsync does not publish or duplicate an appended history tail",async t=>{
  const file=path.join(temporary(t,"history-tail-failure"),"profiles.json"),journal=new ProfileJournal(file);
  try{
    const before=world([{id:"first"}]);journal.commit(before);
    const next=world([...before.profiles.p.transactions.entries,{id:"second"}]);
    const sync=fs.fsyncSync;let failOnce=true;
    const mock=t.mock.method(fs,"fsyncSync",fd=>{if(failOnce){failOnce=false;throw Error("sync failed");}return sync(fd);});
    assert.throws(()=>journal.commit(next),/sync failed/);mock.mock.restore();
    assert.strictEqual(journal.previous,before);assert.deepEqual(recover(file).data.profiles,before.profiles);
    journal.commit(next);assert.deepEqual(recover(file).data.profiles,next.profiles);
  }finally{await journal.close();}
});

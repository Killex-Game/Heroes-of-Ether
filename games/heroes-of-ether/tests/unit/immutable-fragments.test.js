"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {SnapshotBuilder}=require("../../src/server/persistence/snapshot-builder");
const {pack,unpack}=require("../../src/server/persistence/state-snapshot");
const {encode,decode,differences}=require("../../src/server/persistence/postgresql-state");
function exact(actual,expected){
  for(const key of ["revision","worldHash","digest","chatHash","documentFormat"])assert.equal(actual[key],expected[key],key);
  assert.deepEqual([...actual.docs.keys()],[...expected.docs.keys()]);
  for(const [id,doc] of expected.docs){
    const value=actual.docs.get(id);assert.equal(value.hash,doc.hash,id);assert.equal(value.chunked,doc.chunked,id);
    assert.deepEqual(value.value,doc.value,id);assert.deepEqual(encode(value),encode(doc),id);
  }
}
function fixture(){
  const arenaReceipts={};
  for(let bucket=0;bucket<32;bucket++){
    const values={};for(let i=0;i<1000;i++)values[`receipt-${bucket}-${i}`]='🧪я"\\'.repeat(36);
    arenaReceipts[`bucket-${bucket}`]=values;
  }
  return {_journalRevision:1,profiles:{p:{wallet:{coins:7},arenaReceipts}},clans:{}};
}
test("immutable oversized receipt profiles preserve every fragment, compression byte and previous snapshot through sibling changes",()=>{
  let owned=fixture();const builder=new SnapshotBuilder({immutableSource:{owns:value=>value===owned}});
  const initial=builder.pack(owned),baseline=pack(owned);assert.equal(initial.docs.get("profiles:p").chunked,true);exact(initial,baseline);
  const rows=[...initial.docs.values()].map(doc=>{const row=encode(doc);return decode({...row,id:row._id});});
  assert.deepEqual(unpack(rows,initial).world,owned);
  initial.docs.get("profiles:p").value.count=1;
  for(let n=0;n<3;n++){
    owned={...owned,_journalRevision:owned._journalRevision+1,profiles:{p:{...owned.profiles.p,wallet:{coins:8+n}}}};
    exact(builder.pack(owned),pack(owned));
  }
  const receipts=owned.profiles.p.arenaReceipts;
  owned={...owned,_journalRevision:5,profiles:{p:{...owned.profiles.p,arenaReceipts:{...receipts,"bucket-2":{...receipts["bucket-2"],last:"new😀"}}}}};
  exact(builder.pack(owned),pack(owned));exact(initial,baseline);
  const before=builder.pack(owned);exact(builder.pack(owned,{}, {documentFormat:0}),pack(owned,{}, {documentFormat:0}));
  owned={...owned,_journalRevision:6,profiles:{p:{wallet:{coins:11},arenaReceipts:{}}}};
  const small=builder.pack(owned);assert.equal(small.docs.get("profiles:p").chunked,undefined);
  const delta=differences(before,small);assert(delta.deletes.length>1);exact(small,pack(owned));exact(initial,baseline);
});

test("format zero keeps the 14 MiB rejection while immutable format one preserves larger values",()=>{
  let owned={profiles:{p:{history:{text:'x'.repeat(15*1024*1024)}}},clans:{},_journalRevision:1};
  const builder=new SnapshotBuilder({immutableSource:{owns:value=>value===owned}});
  assert.throws(()=>builder.pack(owned,{}, {documentFormat:0}),{code:"DATABASE_DOCUMENT_TOO_LARGE"});
  const first=builder.pack(owned);exact(first,pack(owned));
  assert.deepEqual(unpack([...first.docs.values()],first).world,owned);
  const previous=builder.records;
  assert.throws(()=>builder.pack(owned,{'clan-chat.json':{_journalRevision:-1}}),/DATABASE_INVALID_CHAT_REVISION/);
  assert.strictEqual(builder.records,previous);exact(builder.pack(owned),first);
});

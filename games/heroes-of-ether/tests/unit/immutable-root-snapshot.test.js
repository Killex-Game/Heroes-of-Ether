'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pack,unpack}=require('../../src/server/persistence/state-snapshot');
const {SnapshotBuilder,gzipDocumentValue}=require('../../src/server/persistence/snapshot-builder');
const {gunzipSync}=require('node:zlib');
function exact(actual,expected){
  for(const key of ['revision','documentFormat','chatFormat','chatRevision','chatHash','worldHash','digest'])assert.equal(actual[key],expected[key],key);
  assert.deepEqual([...actual.docs.keys()],[...expected.docs.keys()]);
  for(const [id,doc]of expected.docs){const other=actual.docs.get(id);assert.equal(other.hash,doc.hash,id);assert.equal(other.chunked,doc.chunked,id);assert.equal(JSON.stringify(other.value),JSON.stringify(doc.value),id);assert.equal(gunzipSync(gzipDocumentValue(other)).toString(),JSON.stringify(doc.value),id);}
}
test('Pinned global fields retain exact snapshots across sibling edits, removals, failure and mutable fallback',()=>{
  const shared=Object.fromEntries([['10',{text:'я😀'}],['2',[undefined,null,-0]],['__proto__',{kept:true}],['omitted',undefined]]);
  let owned={profiles:{p:{wallet:{coins:10}}},clans:{},_journalRevision:1,events:shared,alias:shared,'2':{a:2},'10':false,omitted:undefined};
  const builder=new SnapshotBuilder({immutableSource:{owns:value=>value===owned}}),first=builder.pack(owned),original=pack(owned);
  exact(first,original);
  first.docs.get('world').value.events['10'].text='caller-owned mutation';
  for(let tick=0;tick<24;tick++){
    owned={...owned,_journalRevision:tick+2,profiles:{p:{wallet:{coins:tick}}}};
    if(tick===4)owned={...owned,events:{...shared,next:'changed'}};
    if(tick===8){const {alias,...rest}=owned;owned=rest;}
    if(tick===12)owned={...owned,events:{retained:false},'__proto__':{safe:true}};
    if(tick===15)assert.throws(()=>builder.pack(owned,{'clan-chat.json':{_journalRevision:-1}}),/DATABASE_INVALID_CHAT_REVISION/);
    exact(builder.pack(owned),pack(owned));exact(first,original);
  }
  const mutable=JSON.parse(JSON.stringify(owned));exact(builder.pack(mutable),pack(mutable));
  mutable.events.retained='mutated';exact(builder.pack(mutable),pack(mutable));
  exact(builder.pack(owned),pack(owned));
});
test('Pinned oversized global root preserves fragmentation, format changes and old values',()=>{
  let owned={profiles:{p:{id:'p'}},clans:{},_journalRevision:1,events:{payload:'😀я'.repeat(1500000)}};
  const builder=new SnapshotBuilder({immutableSource:{owns:value=>value===owned}});
  const first=builder.pack(owned),expected=pack(owned);assert.equal(first.docs.get('world').chunked,true);exact(first,expected);
  assert.deepEqual(unpack([...first.docs.values()],first).world,owned);
  for(const documentFormat of [0,1])exact(builder.pack(owned,{}, {documentFormat}),pack(owned,{}, {documentFormat}));
  owned={...owned,_journalRevision:2,events:{payload:'small'}};exact(builder.pack(owned),pack(owned));exact(first,expected);
});

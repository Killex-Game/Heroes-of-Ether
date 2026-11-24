"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {gzipSync,gunzipSync}=require('node:zlib');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const {pack}=require('../../src/server/persistence/state-snapshot');
const {encode,decode,differences}=require('../../src/server/persistence/postgresql-state');
const legacy=doc=>({_id:doc._id,value:gzipSync(Buffer.from(JSON.stringify(doc.value)),{level:1}),hash:doc.hash,chunked:!!doc.chunked});
test('Immutable snapshot compression preserves every stored byte and survives caller mutation',()=>{
  const source={_journalRevision:1,profiles:JSON.parse('{"__proto__":{"name":"😀я","wallet":{"coins":5}},"a":{"history":["\\n\\\"\\\\","漢"]}}'),clans:{}};
  const builder=new SnapshotBuilder(),first=builder.pack(source),expected=pack(source);
  for(const [id,doc] of first.docs)assert.deepEqual(encode(doc),legacy(expected.docs.get(id)));
  const doc=first.docs.get('profiles:__proto__'),before=encode(doc);
  doc.value.wallet.coins=900;source.profiles.__proto__.wallet.coins=1;
  const next=builder.pack(source);assert.deepEqual(encode(doc),before);
  const compressed=encode(doc);compressed.value.fill(0);assert.deepEqual(encode(doc),before);
  const delta=differences(first,next);
  assert.equal(delta.writes.length,1);assert.equal(decode({id:delta.writes[0]._id,...delta.writes[0]}).value.wallet.coins,1);
});
test('Fragmented Unicode snapshots and generic mutable documents keep the legacy encoding',()=>{
  const source={profiles:{a:{history:'😀\\\"\n漢'.repeat(1100000)}},clans:{}};
  const builder=new SnapshotBuilder(),first=builder.pack(source),expected=pack(source);
  assert.equal(first.docs.get('profiles:a').chunked,true);
  for(const [id,doc]of first.docs)assert.deepEqual(encode(doc),legacy(expected.docs.get(id)),id);
  const generic={_id:'profiles:x',value:{coins:5},hash:'0'.repeat(64)};
  const before=encode(generic);generic.value.coins=6;
  assert.notDeepEqual(encode(generic).value,before.value);
  assert.equal(JSON.parse(gunzipSync(encode(generic).value)).coins,6);
});

'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {pack,unpack}=require('../../src/server/persistence/state-snapshot');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const world=()=>({_journalRevision:17,version:13,profiles:{a:{wallet:{coins:12},receipts:{one:{amount:10}}},b:{wallet:{coins:7}}},clans:{c:{members:['a','b']}},calendar:{season:3}});
function equivalent(actual,expected){
  for(const key of ['revision','documentFormat','chatFormat','chatRevision','chatHash','worldHash','digest'])assert.equal(actual[key],expected[key],key);
  assert.deepEqual([...actual.docs.keys()],[...expected.docs.keys()]);
  for(const [id,doc]of expected.docs){const other=actual.docs.get(id);assert.equal(other.hash,doc.hash,id);assert.equal(other.chunked,doc.chunked,id);assert.equal(JSON.stringify(other.value),JSON.stringify(doc.value),id);}
}

test('unchanged canonical records share frozen documents while returned values and replaced records remain isolated',()=>{
  const {gzipDocumentValue}=require('../../src/server/persistence/snapshot-builder');
  const builder=new SnapshotBuilder(),source=world(),first=builder.pack(source),original=pack(source);
  const unchanged=builder.pack(source);
  for(const [id,doc]of first.docs){assert.strictEqual(unchanged.docs.get(id),doc);assert(Object.isFrozen(doc));}
  const retained=first.docs.get('profiles:a'),compressed=gzipDocumentValue(retained);
  const returned=retained.value;returned.wallet.coins=999;returned.receipts.one.amount=999;
  source.profiles.a.wallet.coins=11;source._journalRevision++;
  const changed=builder.pack(source);
  assert.notStrictEqual(changed.docs.get('profiles:a'),retained);
  assert.strictEqual(changed.docs.get('profiles:b'),first.docs.get('profiles:b'));
  assert.deepEqual(gzipDocumentValue(retained),compressed);equivalent(first,original);equivalent(changed,pack(source));
  delete source.profiles.b;builder.pack(source);assert(!builder.records.has('profiles:b'));
  source.profiles.b={wallet:{coins:7}};
  const restored=builder.pack(source);assert.notStrictEqual(restored.docs.get('profiles:b'),first.docs.get('profiles:b'));
  equivalent(restored,pack(source));
});
test('Snapshot builder preserves every manifest and document across edits, removals, cache hits and chat formats',()=>{
  const builder=new SnapshotBuilder(),source=world(),aux={'game-events.json':{events:[{id:'one'}]},'clan-chat.json':{_journalRevision:2,clans:{c:{messages:['hello']}},messageReceipts:{a:{one:1}},achievementCounts:{a:3}}};
  equivalent(builder.pack(source,aux),pack(source,aux));
  equivalent(builder.pack(source,aux),pack(source,aux));assert.equal(builder.stats.rebuilt,0);
  source.profiles.a.receipts.two={amount:20};source._journalRevision++;aux['clan-chat.json'].clans.c.messages.push('next');aux['clan-chat.json']._journalRevision++;
  equivalent(builder.pack(source,aux),pack(source,aux));assert.ok(builder.stats.reused>=2);
  delete source.profiles.b;source.clans.c.members=['a'];delete aux['game-events.json'];source._journalRevision++;
  const removed=builder.pack(source,aux);equivalent(removed,pack(source,aux));assert.ok(!builder.records.has('profiles:b'));assert.ok(!builder.records.has('aux:game-events.json'));
  for(const chatFormat of [0,1])for(const documentFormat of [0,1])equivalent(builder.pack(source,aux,{chatFormat,documentFormat}),pack(source,aux,{chatFormat,documentFormat}));
});
test('Pending snapshots and later cache hits are isolated from input and returned-value mutation',()=>{
  const builder=new SnapshotBuilder(),source=world(),first=builder.pack(source),expected=pack(source);
  first.docs.get('profiles:a').value.wallet.coins=1000000;
  equivalent(builder.pack(source),expected);
  source.profiles.a.wallet.coins=1;delete source.profiles.b;source.calendar.season=4;
  equivalent(builder.pack(source),pack(source));equivalent(first,expected);
  const before=builder.records;
  assert.throws(()=>builder.pack(source,{'clan-chat.json':{_journalRevision:-1}}),/DATABASE_INVALID_CHAT_REVISION/);
  assert.equal(builder.records,before);equivalent(builder.pack(source),pack(source));
});
test('Streaming world checksum retains numeric, Unicode, prototype and omitted JSON keys',()=>{
  const builder=new SnapshotBuilder();let seed=19373;
  const random=()=>((seed=Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
  const names=['z','a','10','2','__proto__','constructor','🧪','é','a.b'];
  const tree=depth=>depth<=0?[null,true,false,Math.floor(random()*1000),'текст😀',undefined][Math.floor(random()*6)]:random()<.3?Array.from({length:3},()=>tree(depth-1)):Object.fromEntries(names.filter(()=>random()<.6).map(k=>[k,tree(depth-1)]));
  for(let i=0;i<50;i++){
    const source=Object.assign(Object.fromEntries(names.map(k=>[k,tree(2)])),{profiles:Object.fromEntries(names.map(k=>[k,{data:tree(2)}])),clans:{'2':{},'10':{}},_journalRevision:i});
    equivalent(builder.pack(source),pack(source));equivalent(builder.pack(source),pack(source));
  }
});
test('Large fragmented Unicode profiles keep exact storage boundaries and round trip without retaining mutable values',()=>{
  const builder=new SnapshotBuilder(),source=world();source.profiles.a.history='a'.repeat(524250)+'😀漢я'.repeat(1500000);
  const baseline=pack(source),first=builder.pack(source);equivalent(first,baseline);assert.equal(first.docs.get('profiles:a').chunked,true);
  const restored=unpack([...first.docs.values()],first);assert.deepEqual(restored.world,source);
  equivalent(builder.pack(source),baseline);assert.equal(builder.stats.rebuilt,0);
  source.profiles.a.history+='последняя😀';source._journalRevision++;
  equivalent(builder.pack(source),pack(source));equivalent(first,baseline);
});

test('Owned field segments preserve numeric keys, omitted fields, aliases and compressed canonical bytes',()=>{
  const {encode}=require('../../src/server/persistence/postgresql-state');
  let owned;const builder=new SnapshotBuilder({immutableSource:{owns:value=>value===owned}});
  for(let i=0;i<40;i++){
    const shared=Object.fromEntries([['10',{text:'😀'+i}],['2',[null,true,-0]],['__proto__',{value:i}],['z',undefined]]);
    owned={_journalRevision:i,profiles:Object.fromEntries([['10',{shared,alias:shared,arenaReceipts:{'2':shared,'10':{old:'kept'}},missing:undefined}],
      ['__proto__',{values:[undefined,'я',3]}]]),clans:{'2':{members:['10']}}};
    const actual=builder.pack(owned),expected=pack(owned);equivalent(actual,expected);
    for(const [id,doc]of expected.docs)assert.deepEqual(encode(actual.docs.get(id)),encode(doc));
    equivalent(builder.pack(owned),expected);assert.equal(builder.stats.identityReused,3);
  }
});

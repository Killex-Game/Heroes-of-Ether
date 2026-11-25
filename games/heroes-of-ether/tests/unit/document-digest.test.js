'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {hash,pack}=require('../../src/server/persistence/state-snapshot');
const {DocumentDigest}=require('../../src/server/persistence/document-digest');
const {SnapshotBuilder}=require('../../src/server/persistence/snapshot-builder');
const legacy=docs=>hash([...docs].map(([id,doc])=>[id,doc.hash]).sort(([a],[b])=>a.localeCompare(b)));
test('Document manifest digest preserves Unicode collation ties and changing insertion order',()=>{
 const cache=new DocumentDigest(),a={hash:'a'},b={hash:'b'},ids=['é','e\u0301','2','10','__proto__','😀'];
 assert.equal(ids[0].localeCompare(ids[1]),0);
 const maps=[new Map(),new Map(ids.map((id,i)=>[id,i%2?a:b])),new Map(ids.slice().reverse().map((id,i)=>[id,i%2?b:a]))];
 for(let i=0;i<3;i++)for(const docs of maps)assert.equal(cache.digest(docs),legacy(docs));
 assert.notEqual(legacy(maps[1]),legacy(maps[2]));
});
test('Manifest digest sees same-size replacements, removals, changed hashes and shared document aliases',()=>{
 const cache=new DocumentDigest(),shared={hash:'one'},docs=new Map([['a',shared],['b',shared],['z',{hash:'last'}]]);
 const check=()=>assert.equal(cache.digest(docs),legacy(docs));check();check();
 shared.hash='two';check();docs.set('a',{hash:'three'});check();docs.delete('b');docs.set('c',shared);check();
 docs.clear();check();docs.set('a',shared);check();
});
test('Snapshot builder keeps full legacy hashes through reordered equal-collation profile keys and failed packs',()=>{
 const builder=new SnapshotBuilder();
 let world={_journalRevision:1,profiles:Object.fromEntries([['é',{value:1}],['e\u0301',{value:2}],['2',{value:3}]]),clans:{}};
 const check=()=>{const actual=builder.pack(world),expected=pack(world);assert.equal(actual.digest,expected.digest);assert.equal(actual.worldHash,expected.worldHash);};
 check();check();world={...world,profiles:Object.fromEntries(Object.entries(world.profiles).reverse())};check();
 assert.throws(()=>builder.pack(world,{'clan-chat.json':{_journalRevision:-1}}));check();
 delete world.profiles['é'];world.profiles.new={value:4};world._journalRevision++;check();
});

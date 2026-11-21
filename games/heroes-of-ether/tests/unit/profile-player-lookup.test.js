"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createBotLookup}=require('../../src/server/arena/profile-player-lookup');
test('batch lookup preserves first bot match and never substitutes another human or an old batch',()=>{
  const human={profileId:'same'},first={profileId:'same',isTestBot:true},second={profileId:'same',isTestBot:true};
  const players=new Map([['human',human],['first',first],['second',second]]),rooms=new Map([['a',{arena:{players}}]]);
  const lookup=createBotLookup(rooms);
  assert.equal(lookup('same'),first);assert.equal(lookup('missing'),undefined);
  players.delete('first');
  assert.equal(createBotLookup(rooms)('same'),second);
  players.delete('second');assert.equal(createBotLookup(rooms)('same'),undefined);
});
test('the fallback is lazy and walks every room once for many changed bot profiles',()=>{
  let scans=0;
  const rooms = { *values() {
    scans++;
    for (let r=0;r<20;r++) yield { arena: { players: new Map(
      Array.from({length:35},(_,i)=>[i,{profileId:r+':'+i,isTestBot:true}]),
    ) } };
  } };
  const lookup=createBotLookup(rooms);assert.equal(scans,0);
  for(let r=0;r<20;r++)for(let i=0;i<35;i++)assert.equal(lookup(r+':'+i).profileId,r+':'+i);
  assert.equal(scans,1);
});

"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const {createFixture}=require('../../scripts/benchmarks/database-room-fixture.cjs');
const {detachLobby}=require('../../scripts/benchmarks/realistic-lobby-plan.cjs');
test('Mixed lobby retains related arena clans and separate clan creation actors',()=>{
  const source=createFixture(1795500000000),hash=t=>createHash('sha256').update(t).digest('hex');
  for(const players of [30,60,90]){
    const fixture=structuredClone(source);detachLobby(fixture,players,5,2);
    const arena=fixture.tokens.slice(0,players).map(t=>fixture.data.profiles[hash(t)]);
    const lobby=fixture.tokens.slice(players,players+5).map(t=>fixture.data.profiles[hash(t)]);
    assert.equal(lobby.filter(p=>!p.clanId).length,3);
    for(const p of lobby.filter(p=>p.clanId)){
      assert(arena.some(a=>a.clanId===p.clanId),'Lobby must interact with an actually occupied clan');
      const c=fixture.data.clans[p.clanId];assert.equal(c.members.filter(id=>id===p.id).length,1);
      assert.equal(c.roles[p.id],'manager');
    }
    assert.equal(Object.keys(fixture.data.profiles).length,1280);
    for(const c of Object.values(fixture.data.clans))assert(c.members.includes(c.ownerId));
  }
  const before=JSON.stringify(source);assert.throws(()=>detachLobby(source,60,5,5));assert.equal(JSON.stringify(source),before);
});

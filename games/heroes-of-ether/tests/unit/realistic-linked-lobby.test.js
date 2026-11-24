"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createFixture}=require("../../scripts/benchmarks/database-room-fixture.cjs");
const {detachLobby}=require("../../scripts/benchmarks/realistic-lobby-plan.cjs");
const {createHash}=require("node:crypto");
test("Mixed lobby retains active arena clan members while other actors can create clans",()=>{
  const fixture=createFixture(Date.parse("2026-11-24T10:00:00Z"));
  const profile=index=>fixture.data.profiles[createHash("sha256").update(fixture.tokens[index]).digest("hex")];
  detachLobby(fixture,60,5,2);
  for(let i=60;i<63;i++)assert.equal(profile(i).clanId,null);
  for(const [lobbyIndex,arenaIndex] of [[63,0],[64,30]]){
    const lobby=profile(lobbyIndex),arena=profile(arenaIndex),clan=fixture.data.clans[arena.clanId];
    assert.equal(lobby.clanId,arena.clanId);
    assert.equal(clan.roles[lobby.id],"manager");
    assert(clan.members.includes(arena.id));
    assert.equal(clan.members.filter(id=>id===lobby.id).length,1);
    assert(clan.members.length<=clan.capacity);
  }
});

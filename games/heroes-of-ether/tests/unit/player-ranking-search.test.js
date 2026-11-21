"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {ProfileStore}=require("../../src/server/profiles/profile-store"),{ClanService}=require("../../src/server/clans/clan-service");
test("Player search preserves global ranks, pagination, own place and other ranking sections",()=>{
 const profiles=new ProfileStore({now:()=>1795290000000}), sessions=[];
 for(let i=0;i<26;i++){const s=profiles.open();sessions.push(s);const p=profiles.find(s.token);p.name=i%2?"Искатель "+i:"Другой "+i;p.greatness=i*10;p.level=i+1;}
 const service=new ClanService(profiles),token=sessions[0].token;
 const read=(query="",page=1,order="greatness")=>service.state(token,"",1,"",order,page,"greatness","rankings",query);
 const baseline=read(),before=JSON.stringify(profiles.data),first=read("  ИСКАТЕЛЬ  "),second=read("искатель",2);
 assert.equal(first.playerMatches,13);assert.equal(first.playerTotal,26);assert.equal(first.playerPages,2);
 assert.equal(first.playerLeaders.length,10);assert.equal(second.playerLeaders.length,3);
 const all=[...first.playerLeaders,...second.playerLeaders];assert.equal(new Set(all.map(p=>p.id)).size,13);
 assert.deepEqual(all.map(p=>p.rank),Array.from({length:13},(_,i)=>i*2+1));
 assert.equal(first.myRank,baseline.myRank);assert.deepEqual(first.clans,baseline.clans);assert.deepEqual(first.eventRanking,baseline.eventRanking);
 assert.equal(read("[.*]").playerLeaders.length,0);assert.equal(read("[.*]").playerPages,1);
 assert.equal(read("искатель",999).playerPage,2);assert.equal(read("искатель",1,"level").playerLeaders[0].rank,1);
 assert.equal(read("искатель",1,"dailyKills").playerMatches,13);
 assert.equal(read().playerLeaders.length,10);assert.equal(JSON.stringify(profiles.data),before);
});

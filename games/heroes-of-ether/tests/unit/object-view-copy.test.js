"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const competition=require("../../src/server/clans/clan-competition-service");
const {Renderer}=require("../../public/shared/projectile-renderer");
test("clan competition view never copies unrelated battle history",()=>{
 const clan={id:"clan",name:"Clan",members:[],competition:{league:0,wins:0,joined:{},recruits:{},frames:[],frame:null,medals:{},trophies:[]}};
 const data={clans:{clan},profiles:{}};
 const expected=competition.publicState(data,clan,Date.UTC(2026,10,16));
 Object.defineProperty(clan,"battleHistory",{enumerable:true,get(){throw Error("large history read");}});
 const actual=competition.publicState(data,clan,Date.UTC(2026,10,16));assert.deepEqual(actual,expected);
 actual.frames.push("local");assert.deepEqual(clan.competition.frames,[]);
});
test("projectile drawing resolves anchors with immutable source and exact old precedence",()=>{
 const r=new Renderer(),positions=[],ctx={save(){},restore(){},rotate(){},beginPath(){},stroke(){},fill(){},arc(){},translate(x,y){positions.push([x,y]);}};
 const base={id:"s",boosterId:"web",x:10,y:20,dx:1,dy:0,length:10,ownerId:"o",partId:"p"};
 const options={now:50,scale:1,left:0,top:0,right:1000,bottom:1000,bodyFor:()=>({x:100,y:200,radius:30}),ownerFor:()=>({x:300,y:400})};
 for(const flags of [{},{followPart:true},{followOwner:true},{held:true},{followPart:true,followOwner:true,held:true}]){
  const shot=Object.freeze({...base,...flags});r.draw(ctx,{...options,shots:[shot]});assert.equal(shot.x,10);assert.equal(shot.y,20);
 }
 assert.deepEqual(positions,[[10,20],[100,200],[300,400],[135,200],[135,200]]);
 r.draw(ctx,{...options,bodyFor:()=>null,shots:[Object.freeze({...base,held:true})]});assert.equal(positions.length,5);
});

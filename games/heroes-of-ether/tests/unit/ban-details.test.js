"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {publicBan,validate}=require("../../src/server/admin/moderation");
const {newBanId,banId}=require("../../src/server/admin/ban-identifiers");
const profile=(extra={})=>({id:"player-a",moderation:{ban:{by:"owner-a",at:100,until:10000,reason:"Проверка",...extra}}});
test("old bans use matching audit IDs and names without changing saves",()=>{
 const p=profile(),event={id:"record-123456",action:"ban",targetId:p.id,actorId:"owner-a",at:100,reason:"Проверка",after:{until:10000}},data={administration:{audit:[event]}};
 const before=JSON.stringify({p,data}),owner=publicBan(p,data,"owner-a",500);
 assert.match(owner.banId,/^[2-9A-HJ-NP-Z]{6}$/);assert.equal(owner.moderatorName,"Killex");
 const mod=profile({by:"moderator:old"});data.administration.audit.push({...event,actorId:mod.moderation.ban.by,actorName:"Помощник",id:"record-moderator"});
 assert.equal(publicBan(mod,data,"owner-a",500).moderatorName,"Помощник");
 data.administration.audit.pop();assert.equal(JSON.stringify({p,data}),before);
 assert.equal(publicBan(p,data,"owner-a",10000),null);
});
test("legacy ID is deterministic, player-specific, and does not expose private records",()=>{
 const a=profile({by:"system:chat"}),b={...structuredClone(a),id:"player-b"},data={profiles:{},private:"secret"};
 const view=publicBan(a,data,null,500);assert.equal(view.moderatorName,"Системная блокировка");
 assert.match(view.banId,/^[2-9A-HJ-NP-Z]{6}$/);
 assert.equal(publicBan(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(data)),null,900).banId,view.banId);
 assert.notEqual(publicBan(b,data,null,500).banId,view.banId);
 assert.deepEqual(Object.keys(view).sort(),["banId","moderatorName","reason","until"]);
 assert.equal(publicBan(profile({by:"unrecorded"}),data,null,500).moderatorName,"Не указан");
});
test("stored details stay independent of later moderator renaming and validate optional fields",()=>{
 const p=profile({id:"K7M2Q9",by:"moderator:test",byName:"Имя при блокировке"}),data={profiles:{a:p}};
 validate(data);assert.equal(publicBan(p,data,"owner-a",500).moderatorName,"Имя при блокировке");
 assert.equal(publicBan(p,data,"owner-a",500).banId,"K7M2Q9");
 for(const value of [null,23,{},"", "x".repeat(101)]){
  const bad=structuredClone(data);bad.profiles.a.moderation.ban.byName=value;assert.throws(()=>validate(bad),/блокировок/);
 }
 const bad=structuredClone(data);bad.profiles.a.moderation.ban.id={};assert.throws(()=>validate(bad),/блокировок/);
});
test("short IDs avoid collisions, reserve expired bans and keep legacy IDs stable after append/reload",()=>{
 const p=profile(),event={id:"original-record",action:"ban",targetId:p.id,actorId:"owner-a",at:100,reason:"Проверка",after:{until:10000}},data={profiles:{a:p},administration:{audit:[event]}};
 const first=banId(p,data);let calls=0;
 data.administration.audit.push({id:"another-record",action:"ban",banId:"222222"});
 assert.equal(newBanId(data,()=>Buffer.alloc(6,calls++)),"333333");assert.equal(calls,2);
 assert.equal(banId(p,data),first);
 data.administration.audit.push({id:"unban-record",action:"unban",targetId:p.id,before:{...p.moderation.ban,id:first}});
 assert.equal(banId(p,JSON.parse(JSON.stringify(data))),first);
 assert.throws(()=>newBanId(data,()=>Buffer.alloc(6)),/свободный ID/);
 const second={id:"player-z",moderation:{ban:{...p.moderation.ban,id:newBanId(data)}}};data.profiles.z=second;
 assert.equal(banId(p,data),first);assert.notEqual(second.moderation.ban.id,first);
});

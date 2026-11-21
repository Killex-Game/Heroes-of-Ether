"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),{randomUUID}=require("node:crypto");
const {ChatService}=require("../../src/server/chat/chat-service"),{temporary}=require("../temp");
const HOUR=3600000;
test("clan chat delta refreshes old author names/status without rewriting text or saved history",t=>{
  const filePath=path.join(temporary(t,"chat-current-author"),"chat.json");let now=1000;
  const chat=new ChatService({filePath,now:()=>now}),p={id:"p",name:"Старый ник",level:12,account:{vipUntil:0,premiumUntil:0}};
  chat.profileFor=()=>p;chat.clanFor=()=>({prefix:"NEW"});
  const sent=chat.send(p,{prefix:"OLD"},"clan",{requestId:randomUUID(),text:"История"}).message;
  const saved=fs.readFileSync(filePath,"utf8");p.name="Новый ник";p.level=13;p.account.vipUntil=now+HOUR;
  let delta=chat.history("clan",sent.id);assert.deepEqual(delta.messages,[]);assert.equal(delta.reset,false);
  assert.deepEqual(delta.authors.p,{id:"p",name:"Новый ник",clanTag:"NEW",level:13,status:"vip"});
  p.account.premiumUntil=now+HOUR;assert.equal(chat.history("clan",sent.id).authors.p.status,"premium");
  now+=HOUR;assert.equal(chat.history("clan",sent.id).authors.p.status,"basic");
  assert.equal(chat.history("clan").messages[0].text,"История");assert.equal(fs.readFileSync(filePath,"utf8"),saved);
  chat.profileFor=()=>null;assert.equal(chat.history("clan").messages[0].author.name,"Старый ник");
});
test("48h rolling retention persists, preserves retry protection/counts and restores after restart",t=>{
  const filePath=path.join(temporary(t,"chat-retention"),"chat.json");let now=1000;
  const chat=new ChatService({filePath,now:()=>now}),p={id:"p",name:"Игрок"},input={requestId:randomUUID(),text:"Старое"};
  chat.send(p,null,"clan",input);now+=HOUR;
  const recent=chat.send(p,null,"clan",{requestId:randomUUID(),text:"Новое"}).message;
  now=1000+48*HOUR;assert.deepEqual(chat.history("clan").messages.map(m=>m.id),[recent.id]);
  assert.equal(chat.achievementCounts.p,2);
  const restored=new ChatService({filePath,now:()=>now});assert.equal(restored.history("clan").messages.length,1);
  assert.equal(restored.send(p,null,"clan",input).duplicate,true);assert.equal(restored.achievementCounts.p,2);
  assert.equal(restored.history("clan").messages.length,1);
  now+=HOUR;assert.equal(restored.history("clan").messages.length,0);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath,"utf8")).clans,{});
});
test("retention failed write keeps published history intact and retries safely",t=>{
  const filePath=path.join(temporary(t,"chat-retention-write"),"chat.json");let now=1000;
  const chat=new ChatService({filePath,now:()=>now});chat.send({id:"p",name:"Игрок"},null,"clan",{requestId:randomUUID(),text:"Текст"});
  const saved=fs.readFileSync(filePath,"utf8"),before=chat.clans;now+=48*HOUR;
  fs.mkdirSync(filePath+".tmp");assert.throws(()=>chat.history("clan"));assert.equal(chat.clans,before);assert.equal(fs.readFileSync(filePath,"utf8"),saved);
  fs.rmdirSync(filePath+".tmp");assert.equal(chat.history("clan").messages.length,0);
});

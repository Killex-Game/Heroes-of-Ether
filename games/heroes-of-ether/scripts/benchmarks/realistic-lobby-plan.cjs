"use strict";
// Every operation goes through the same HTTP API as the player. No mutation
// shortcuts during measurement; only the initial synthetic fixture is funded.
const {randomUUID} = require("node:crypto");
const crest = require("../../public/shared/clan-crest-rules").DEFAULT;
const rulesVersion = require("../../public/shared/roulette-rules").version;
const REQUIRED = ["clan-create", "clan-deposit", "clan-buy", "clan-edit", "clan-view",
  "roulette-prepare", "roulette-spin", "pet-buy", "pet-food", "pet-equip", "chat"];
const COUNT = 21;
const count = alchemy => alchemy ? COUNT + 1 : COUNT;
const required = alchemy => alchemy ? [...REQUIRED.filter(id => !id.startsWith("roulette-")),
  "alchemy-view", "alchemy-exchange", "alchemy-brew", "alchemy-equip"] : REQUIRED;
function extra(client, step, { alchemy = false } = {}) {
  const post = (label, url, body) => [label,url,{...body,requestId:randomUUID()}];
  const clan = (action, body={}) => post("clan-"+action,"/api/clans/action",{action,clanId:client.clanId,...body});
  const potion = () => require("../../public/shared/alchemy-rules").potions[
    (Math.floor(step/count(alchemy)) + client.slot - 1) % 16].id;
  switch (step % count(alchemy)) {
    case 8: return client.clanId ? ["clan-view","/api/clans?scope=clan"] :
      clan("create",{name:"Испытатели нагрузки "+client.slot,prefix:"L"+client.slot,emblem:"astral",privacy:"open",crest});
    case 9: return client.clanId ? clan("deposit",{amount:1000}) : ["profile","/api/profile"];
    case 10: return client.clanId ? ["clan-buy","/api/clans/action",{action:"buyBooster",clanId:client.clanId,boosterId:"warheads",requestId:randomUUID()}] : ["profile","/api/profile"];
    case 11: return client.clanId ? clan("edit",{description:"Проверка сессии "+Math.floor(step/COUNT)}) : ["profile","/api/profile"];
    case 12: return ["clan-view","/api/clans?scope=clan"];
    case 13: return alchemy ? ["alchemy-view", "/api/profile"] : post("roulette-prepare","/api/roulette/action",{action:"prepare",rulesVersion});
    case 14: return alchemy ? post("alchemy-brew", "/api/alchemy/action", {action:"brew",potionId:potion(),runId:client.alchemyRunId})
      : client.offerId ? post("roulette-spin","/api/roulette/action",{action:"spin",rulesVersion,offerId:client.offerId}) : ["profile","/api/profile"];
    case 15: return post(client.ownsPet?"pet-equip":"pet-buy","/api/pets/action",{action:client.ownsPet?"equip":"buy",petId:"zaya"});
    case 16: return post("pet-food","/api/pets/action",{action:"food"});
    case 17: return client.clanId ? post("chat","/api/clans/chat",{clanId:client.clanId,text:"Сбор команды "+step}) : ["profile","/api/profile"];
    case 18: return ["news","/api/news"];
    case 19: return ["presence","/api/presence"];
    case 20: return alchemy ? post("alchemy-exchange", "/api/alchemy/action", {action:"exchange"}) : ["clan-view","/api/clans?scope=clan"];
    case 21: return post("alchemy-equip", "/api/alchemy/action", {action:"equip",potionId:potion()});
    default: return null;
  }
}
function update(client,data) {
  const p=data.profile;
  if(!p)return;
  if(Object.hasOwn(p,"clanId"))client.clanId=p.clanId;
  client.offerId=p.roulette?.offer?.id || null;
  client.ownsPet=!!p.pets?.owned?.zaya;
}
function detachLobby(fixture,first,count,linked=0) {
  if(!Number.isInteger(linked)||linked<0||linked>=count||linked>first)
    throw Error("Invalid linked lobby count");
  for(const token of fixture.tokens.slice(first,first+count)) {
    const key=require("node:crypto").createHash("sha256").update(token).digest("hex"),p=fixture.data.profiles[key];
    const c=fixture.data.clans[p.clanId];
    if(c){c.members=c.members.filter(id=>id!==p.id);delete c.roles[p.id];
      if(c.ownerId===p.id){if(!c.members.length)throw Error("Fixture clan emptied");c.ownerId=c.members[0];c.roles[c.ownerId]="head";}
    }
    p.clanId=null;
  }
  // Keep some lobby actors in clans whose other members are actually playing.
  // The remaining actors still exercise clan creation through the HTTP API.
  for(let i=0;i<linked;i++) {
    const hash=token=>require("node:crypto").createHash("sha256").update(token).digest("hex");
    const arena=fixture.data.profiles[hash(fixture.tokens[Math.floor(i*first/linked)])];
    const lobby=fixture.data.profiles[hash(fixture.tokens[first+count-linked+i])];
    const clan=fixture.data.clans[arena.clanId];
    if(!clan||clan.members.length>=clan.capacity)throw Error("Linked clan has no slot");
    clan.members.push(lobby.id);clan.roles[lobby.id]="manager";lobby.clanId=clan.id;
  }
  require("../../src/server/clans/clan-service").validateWorld(fixture.data);
}
module.exports={extra,update,detachLobby,REQUIRED,COUNT,count,required};

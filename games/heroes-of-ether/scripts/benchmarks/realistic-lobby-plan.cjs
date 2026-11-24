"use strict";
// Every operation goes through the same HTTP API as the player. No mutation
// shortcuts during measurement; only the initial synthetic fixture is funded.
const {randomUUID} = require("node:crypto");
const crest = require("../../public/shared/clan-crest-rules").DEFAULT;
const rulesVersion = require("../../public/shared/roulette-rules").version;
const REQUIRED = ["clan-create", "clan-deposit", "clan-buy", "clan-edit", "clan-view",
  "roulette-prepare", "roulette-spin", "pet-buy", "pet-food", "pet-equip", "chat"];
const COUNT = 21;
function extra(client, step) {
  const post = (label, url, body) => [label,url,{...body,requestId:randomUUID()}];
  const clan = (action, body={}) => post("clan-"+action,"/api/clans/action",{action,clanId:client.clanId,...body});
  switch (step % COUNT) {
    case 8: return client.clanId ? ["clan-view","/api/clans?scope=clan"] :
      clan("create",{name:"Испытатели нагрузки "+client.slot,prefix:"L"+client.slot,emblem:"astral",privacy:"open",crest});
    case 9: return client.clanId ? clan("deposit",{amount:1000}) : ["profile","/api/profile"];
    case 10: return client.clanId ? ["clan-buy","/api/clans/action",{action:"buyBooster",clanId:client.clanId,boosterId:"warheads",requestId:randomUUID()}] : ["profile","/api/profile"];
    case 11: return client.clanId ? clan("edit",{description:"Проверка сессии "+Math.floor(step/COUNT)}) : ["profile","/api/profile"];
    case 12: return ["clan-view","/api/clans?scope=clan"];
    case 13: return post("roulette-prepare","/api/roulette/action",{action:"prepare",rulesVersion});
    case 14: return client.offerId ? post("roulette-spin","/api/roulette/action",{action:"spin",rulesVersion,offerId:client.offerId}) : ["profile","/api/profile"];
    case 15: return post(client.ownsPet?"pet-equip":"pet-buy","/api/pets/action",{action:client.ownsPet?"equip":"buy",petId:"zaya"});
    case 16: return post("pet-food","/api/pets/action",{action:"food"});
    case 17: return client.clanId ? post("chat","/api/clans/chat",{clanId:client.clanId,text:"Сбор команды "+step}) : ["profile","/api/profile"];
    case 18: return ["news","/api/news"];
    case 19: return ["presence","/api/presence"];
    case 20: return ["clan-view","/api/clans?scope=clan"];
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
function detachLobby(fixture,first,count) {
  for(const token of fixture.tokens.slice(first,first+count)) {
    const key=require("node:crypto").createHash("sha256").update(token).digest("hex"),p=fixture.data.profiles[key];
    const c=fixture.data.clans[p.clanId];
    if(c){c.members=c.members.filter(id=>id!==p.id);delete c.roles[p.id];
      if(c.ownerId===p.id){if(!c.members.length)throw Error("Fixture clan emptied");c.ownerId=c.members[0];c.roles[c.ownerId]="head";}
    }
    p.clanId=null;
  }
  require("../../src/server/clans/clan-service").validateWorld(fixture.data);
}
module.exports={extra,update,detachLobby,REQUIRED,COUNT};

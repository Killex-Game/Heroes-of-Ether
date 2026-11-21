"use strict";
// Explicit local fixture, never an automatic population or reward generator.
const { randomUUID } = require("node:crypto");
const assert = require("node:assert/strict");
const { ProfileStore } = require("../profiles/profile-store");
const { validateWorld } = require("../clans/clan-service");
const competition = require("../clans/clan-competition-service");
const { freshProgress } = require("../progression/experience-progression");
const { MARKER } = require("./arena-test-bots");
const crests = require("../../../public/shared/clan-crest-rules");
const { skins } = require("../../../public/shared/player-identity");
const BATCH = "championship-opponents-20261107";
const GROUP_SIZE = 16;

function prepareChampionshipOpponents(data, at) {
  if (Object.values(data.clans).some(c => c.testSeedKey?.startsWith(BATCH + ":")))
    return { data, summary: { addedClans: 0, addedBots: 0, addedGroups: 0, addedPairs: 0 } };
  const next = structuredClone(data), fresh = new ProfileStore({ now: () => at });
  const existing = Object.values(data.clans);
  const counts = Array.from({length:6}, (_, league) => existing.filter(c => (c.competition?.league || 0) === league).length);
  const needed = counts.map(count => Math.max(0, GROUP_SIZE - count));
  const total = needed.reduce((a,b)=>a+b,0) * 4;
  const prefixes = new Set(existing.map(c=>c.prefix.toUpperCase()));
  const names = new Set(existing.map(c=>c.name.toLowerCase()));
  const added = []; let botIndex = 0;
  const adjectives = ["Бронзовые", "Серебряные", "Золотые", "Платиновые", "Алмазные", "Чемпионские"];
  const nouns = ["стражи", "соколы", "львы", "рыцари", "грифоны", "драконы", "волки", "фениксы", "искатели", "титаны", "барсы", "воины", "магистры", "хранители", "витязи", "герои"];
  for (let league=0; league<6; league++) for (let n=0; n<needed[league]; n++) {
    let serial=1, prefix;
    do {prefix="BSGPDC"[league]+String(serial++).padStart(2,"0");} while(prefixes.has(prefix));
    if(prefix.length>4) throw Error("Нет свободного префикса.");
    prefixes.add(prefix);
    const title=adjectives[league]+" "+nouns[n % nouns.length];
    let name=title, suffix=2;
    while(names.has(name.toLowerCase())) name=title+" "+suffix++;
    names.add(name.toLowerCase());
    const id=randomUUID(), members=[];
    for(let j=0;j<4;j++) {
      const opened=fresh.open(), p=fresh.find(opened.token);
      p.name=`Бот ${prefix} ${["Искра","Ветер","Луч","Гром"][j]}`;
      p.testBot=MARKER;
      require('./bot-identity').assignBotGender(p);
      p.level=12+Math.round(488*botIndex/Math.max(1,total-1));
      p.progress=freshProgress(p.level);
      p.skinId=skins[botIndex++ % skins.length].id;
      members.push(p.id);
    }
    const clan={id,name,prefix,testOnly:MARKER,testSeedKey:`${BATCH}:${league}:${n}`,
      description:"Тестовый состав для проверки продвижения по всем лигам.",
      emblem:n%2?"grove":"astral",privacy:"open",
      crest:{frame:crests.frames[n%crests.frames.length].id,color:crests.colors[(n+league)%crests.colors.length].id,symbol:crests.symbols[(n+league)%crests.symbols.length].id},
      ownerId:members[0],members,roles:Object.fromEntries(members.map((id,j)=>[id,["head","manager","officer","member"][j]])),
      xp:0,treasury:0,capacity:15,applications:[],applicationFees:{},createdAt:at};
    competition.clanState(clan).league=league;
    next.clans[id]=clan; added.push(clan);
  }
  for(const clan of added) for(const id of clan.members) fresh.byId(id).clanId=clan.id;
  Object.assign(next.profiles,fresh.data.profiles);
  const state=next.competition;
  if(!state?.week) throw Error("Нет текущего расписания клановых битв.");
  const assigned=new Set(state.week.groups.flatMap(g=>g.clans)), groups=[];
  for(let league=0;league<6;league++) {
    const waiting=Object.values(next.clans).filter(c=>(c.competition?.league||0)===league&&!assigned.has(c.id)).map(c=>c.id);
    for(const size of competition.groupSizes(waiting.length)) {
      const group={id:state.week.id+"-test-"+randomUUID(),league,clans:waiting.splice(0,size)};
      state.week.groups.push(group); groups.push(group);
    }
  }
  let pairs=0;
  if(state.day && state.day.start<=at && at<state.day.end) {
    const paired=new Set(state.day.pairs.flatMap(p=>[p.a,p.b]));
    for(const group of groups) for(let i=0;i+1<group.clans.length;i+=2) {
      const a=group.clans[i], b=group.clans[i+1];
      if(paired.has(a)||paired.has(b)) throw Error("Клан уже участвует в битве.");
      state.day.pairs.push({a,b}); pairs++;
      for(const id of [a,b]) {
        const clan=next.clans[id];
        state.day.rosters[id]=clan.members.filter(m=>competition.eligible(clan,m,at));
        paired.add(id);
      }
    }
  }
  validateWorld(next); competition.validate(next);
  for(const table of ["profiles","clans"]) for(const [key,value] of Object.entries(data[table])) assert.deepEqual(next[table][key],value);
  assert.deepEqual(next.competition.week.scores,data.competition.week.scores);
  if(data.competition.day) {
    assert.deepEqual(next.competition.day.pairs.slice(0,data.competition.day.pairs.length),data.competition.day.pairs);
    assert.deepEqual(next.competition.day.scores,data.competition.day.scores);
  }
  return {data:next,summary:{addedClans:added.length,addedBots:total,addedGroups:groups.length,addedPairs:pairs,leagueCounts:counts.map((n,i)=>n+needed[i]),botLevelRange:[12,500]}};
}
module.exports={prepareChampionshipOpponents,BATCH};

"use strict";
const rules = require("../../../public/shared/alchemy-rules");
const stages = require("../progression/achievement-stages");
const { findRunAt } = require("./event-run-lookup");
const integer = n => Number.isSafeInteger(n) && n >= 0;
const object = n => n && typeof n === "object" && !Array.isArray(n);
const add = (a,b) => { if (!integer(a) || !integer(b) || !integer(a+b)) throw Error("Неверный счёт алхимии."); return a+b; };
const entry = (id,name,unit,thresholds,description) => ({ id,name,unit,thresholds,description,
  rewards:[10,20,40,80,150],category:"event",exception:false,cumulative:false,available:true,fixedReward:true });
const definitions = [
  entry("alchemy_ingredients","Дары арены","ингредиентов",[50,150,400,1000,2500],"Собирать ингредиенты на арене."),
  ...rules.potions.map(p => entry("alchemy_potion_"+p.id,"Алхимик: "+p.name,"зелий",[5,15,40,100,250],"Получать "+p.name.toLocaleLowerCase("ru-RU")+" во время события.")),
  entry("alchemy_brews","Котёл мастера","варок",[1,5,15,40,100],"Успешно варить партии зелий."),
  entry("alchemy_marriage_levels","Растём вместе","уровней",[1,3,10,25,50],"Получать личные уровни, заработав нужный опыт на одной арене с супругом."),
  entry("alchemy_marriage_games","Верные спутники","заходов",[1,5,15,40,100],"Завершать заходы на арену, проведя на ней с супругом не менее 60 секунд во время события."),
];
const lookup = new Map(definitions.map(d=>[d.id,d]));
const runAt = (manager,at) => findRunAt(manager,at,rules.manifest.contentPack);
function record(p,run,counts,at) {
  if (!run || !Object.values(counts).some(n=>n>0)) return;
  const old=p.alchemy?.achievements?.[run.id];
  const state={values:{...old?.values},claimed:{...old?.claimed},...(old?.stageSpent && {stageSpent:{...old.stageSpent}})};
  stages.ensure(state,definitions,d=>state.values[d.id]||0);
  for(const [id,n] of Object.entries(counts)) {
    const d=lookup.get(id); if(!d || !integer(n)) throw Error("Неизвестный прогресс алхимии.");
    state.values[id]=add(state.values[id]||0,n);
    let claimed=state.claimed[id]||0;
    while(claimed<d.thresholds.length && stages.current(state,d,state.values[id])>=d.thresholds[claimed]) {
      stages.consume(state,d);p.greatness=add(p.greatness,d.rewards[claimed++]);state.claimed[id]=claimed;
    }
    state.claimed[id]=claimed;
  }
  p.alchemy={version:1,natural:0,ingredients:{},learned:[],equipped:null,...p.alchemy,achievements:{...p.alchemy?.achievements,[run.id]:state}};
  require("../progression/title-chest-rewards").awardTitles(p,at);
}
function observe(p,manager,event,at) {
  const session=p.progress.session;
  if(!session || session.id!==event.lifeId) return;
  if(event.type==="lifeTime" && integer(event.durationSeconds)) {
    const run=runAt(manager,at),partnerId=p.social?.marriage?.partnerId;
    const prior=session.alchemyTogether;
    if(!run || !partnerId){if(prior)delete session.alchemyTogether;return;}
    const seconds=event.durationSeconds;
    const same=run && prior?.runId===run.id && prior.partnerId===partnerId;
    const together=!!partnerId && event.spouseOnArena===partnerId;
    // Never attribute a gap, an earlier event or time in another marriage/run.
    const elapsed=same && together && prior.together ? Math.min(2,Math.max(0,seconds-prior.lastSeconds)) : 0;
    if(run) session.alchemyTogether={runId:run.id,partnerId:partnerId||null,together,
      seconds:add(same?prior.seconds:0,elapsed),lastSeconds:Math.max(same?prior.lastSeconds:0,seconds)};
    else delete session.alchemyTogether;
  }
}
function arena(p,manager,event,before,previousLevel,mark,together,at) {
  const run=runAt(manager,at),session=p.progress.session;
  if(event.type==="lifeStarted" && session && session.id===event.lifeId && !session.alchemyTogether && run && p.social?.marriage?.partnerId) {
    const partnerId=p.social?.marriage?.partnerId;
    session.alchemyTogether={runId:run.id,partnerId:partnerId||null,seconds:0,lastSeconds:0,
      together:!!partnerId && event.spouseOnArena===partnerId};
  }
  if(session && before<p.progress.arenaXpTarget && p.progress.xp+session.xp>=p.progress.arenaXpTarget &&
      run && p.social?.marriage?.partnerId && p.social.marriage.partnerId===event.spouseOnArena)
    session.alchemyLevel={runId:run.id};
  if(event.type!=="lifeEnded" || p.progress.lastLife?.id!==event.lifeId || session) return;
  const counts={};
  if(p.level>previousLevel && mark?.runId===run?.id) counts.alchemy_marriage_levels=p.level-previousLevel;
  if(together && together.runId===run?.id && together.seconds>=60 &&
      together.partnerId===p.social?.marriage?.partnerId) counts.alchemy_marriage_games=1;
  record(p,run,counts,at);
  delete p.progress.lastLife.pendingAlchemy;
}
const needsRecovery = p => !!p.progress.lastLife?.pendingAlchemy;
const recoveryKeys = (world,cache) => cache
  ? cache.matchingProfiles("alchemyRecovery",world.profiles,needsRecovery)
  : Object.keys(world.profiles).filter(key=>needsRecovery(world.profiles[key]));
const recoveryDue = (world,manager,cache) => !!manager && (cache
  ? recoveryKeys(world,cache).size>0 : recoveryKeys(world,cache).length>0);
function recover(world,manager,at,cache) {
  if(!manager)return world;
  const keys=[...recoveryKeys(world,cache)];if(!keys.length)return world;
  const next={...world,profiles:{...world.profiles}};
  for(const key of keys) {
    const p=require("../profiles/owned-profile-draft").copyProfile(world.profiles[key]);
    const life=p.progress.lastLife,mark=life.pendingAlchemy;
    arena(p,manager,{type:"lifeEnded",lifeId:life.id},0,p.level-(life.levelReward?.levels||0),mark.level,mark.together,at);
    validate(p);p.revision++;next.profiles[key]=p;
  }
  require("../profiles/immutable-table-delta").remember(next.profiles,world.profiles,keys);
  return next;
}
function view(p,manager,at) {
  const run=runAt(manager,at);if(!run)return [];
  const s=p.alchemy?.achievements?.[run.id];
  return definitions.map(d=>({...d,eventRunId:run.id,description:"Эфирная алхимия. "+d.description,
    value:s?stages.current(s,d,s.values[d.id]||0):0,claimed:s?.claimed[d.id]||0}));
}
function capture(p,previous,manager,at) {
  if(!previous || p.inventory===previous.inventory)return p;
  const counts={};
  for(const potion of rules.potions) {
    const amount=(p.inventory[potion.boosterId]||0)-(previous.inventory[potion.boosterId]||0);
    if(amount>0)counts["alchemy_potion_"+potion.id]=amount;
  }
  if(!Object.keys(counts).length)return p;
  const run=runAt(manager,at);if(!run)return p;
  const next=require("../profiles/owned-profile-draft").copyProfile(p);
  record(next,run,counts,at);validate(next);return next;
}
function validate(p) {
  const runs=p.alchemy?.achievements;if(runs===undefined)return;
  if(!object(runs))throw Error("Повреждена история алхимии.");
  for(const [id,s] of Object.entries(runs)) {
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !object(s) || !object(s.values) || !object(s.claimed)) throw Error("Повреждён запуск алхимии.");
    for(const key of new Set([...Object.keys(s.values),...Object.keys(s.claimed)])) {
      const d=lookup.get(key),count=s.claimed[key]||0;
      if(!d || !integer(s.values[key]) || !integer(count) || count>d.thresholds.length ||
        s.values[key]<d.thresholds.slice(0,count).reduce((a,b)=>a+b,0))throw Error("Повреждены награды алхимии.");
    }
    stages.validate(s,definitions,d=>s.values[d.id]||0);
  }
}
module.exports={definitions,record,observe,arena,view,validate,capture,recover,recoveryDue};

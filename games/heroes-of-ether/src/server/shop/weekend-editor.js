"use strict";
const { createHash, randomUUID } = require('node:crypto');
const catalog = require('../../../public/shared/weekend-promotion-catalog');
const calendar = require('./weekend-promotions');
const { BOOSTERS, BoosterError } = require('../boosters/booster-catalog');
const fail = (text, status=400) => { throw new BoosterError(text,status); };
const currencies = [
  {kind:'currency',id:'coins',name:'Монеты',icon:'assets/menu-icons/128/currency_coins.webp'},
  {kind:'currency',id:'crystals',name:'Кристаллы',icon:'assets/menu-icons/128/currency_crystals.webp'},
  {kind:'currency',id:'bucks',name:'Эфир',icon:'assets/menu-icons/128/currency_bucks.webp'},
];
const choices = Object.freeze([...currencies, ...BOOSTERS.values()].map(b=>b.kind==='currency'?b:{kind:'booster',id:b.id,name:b.name,icon:b.icon}));
const freeze = value => { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value; };
function normalizeOffer(input) {
  if(!input||!catalog.get(input.id)||typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>80||
    !Number.isSafeInteger(input.votes)||input.votes<1||input.votes>100000||
    !Number.isSafeInteger(input.purchaseLimit)||input.purchaseLimit<1||input.purchaseLimit>5||
    !Array.isArray(input.rewards)||!input.rewards.length||input.rewards.length>choices.length) fail('Проверь название, цену, лимит покупок и состав набора.');
  if(!catalog.products.some(p=>p.id===input.id))fail('Неизвестный номер набора.');
  const seen=new Set(), rewards=input.rewards.map(r=>{
    const item=choices.find(c=>c.kind===r?.kind&&c.id===r.id),key=r?.kind+':'+r?.id;
    if(!item||seen.has(key)||!Number.isSafeInteger(r.amount)||r.amount<1||r.amount>10000000)fail('Неверная награда, повтор или количество (1–10 000 000).');
    seen.add(key);return {...item,amount:r.amount};
  });
  return {id:input.id,name:input.name.trim(),votes:input.votes,purchaseLimit:input.purchaseLimit,rewards};
}
function normalizeSchedule(input) {
  if(!input||typeof input!=='object')fail('Укажи расписание.');
  let result;
  try {result=calendar.configuration({...input,custom:true,revision:0});}catch(e){fail(e.message);}
  if(result.offerIds.some(id=>!catalog.products.some(p=>p.id===id)))fail('В расписании неизвестный набор.');
  return result;
}
function validate(world) {
  const state=world.weekendPromotions;if(state===undefined)return;
  if(!state||state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<1||!state.offers||typeof state.offers!=='object'||Array.isArray(state.offers))fail('Повреждены настройки пятничных акций.');
  normalizeSchedule(state.schedule);
  if(Object.keys(state.offers).length>26)fail('Слишком много пятничных наборов.');
  for(const [id,offer] of Object.entries(state.offers)){if(id!==offer.id)fail('Неверный идентификатор набора.');normalizeOffer(offer);}
}
function product(offer) {
  return freeze({...offer,type:'promotion',number:catalog.get(offer.id).number,weekendId:offer.id,
    wallet:Object.fromEntries(offer.rewards.filter(r=>r.kind==='currency').map(r=>[r.id,r.amount])),
    exactBoosters:Object.fromEntries(offer.rewards.filter(r=>r.kind==='booster').map(r=>[r.id,r.amount])),boosters:{},
    icon:offer.rewards[0].icon,description:offer.rewards.map(r=>r.name+': '+r.amount.toLocaleString('ru-RU')).join(', ')});
}
// The immutable branch is the cache key. No catalogue rebuild or world copy per player/tick.
const cache=new WeakMap();
function resolve(base,state) {
  if(!state)return base;
  const hit=cache.get(state);if(hit?.base===base)return hit.config;
  validate({weekendPromotions:state});
  const offers=Object.fromEntries(catalog.products.map(p=>[p.id,state.offers[p.id]?product(normalizeOffer(state.offers[p.id])):p]));
  const config=Object.freeze({...base,enabled:base.enabled||state.schedule.enabled,
    productIds:base.enabled?base.productIds:Object.freeze([]),levelMilestones:base.enabled&&base.levelMilestones,
    weekend:calendar.configuration({...state.schedule,custom:true,revision:state.revision}),weekendOffers:freeze(offers)});
  cache.set(state,{base,config});return config;
}
function settings(store){return resolve(store.promotionConfig,store.data.weekendPromotions);}
function view(store) {
  const config=settings(store),state=store.data.weekendPromotions,at=store.now(),schedule=config.weekend;
  const products=config.weekendOffers||Object.fromEntries(catalog.products.map(p=>[p.id,p]));
  const anchor=schedule.startsOn?Date.parse(schedule.startsOn+'T'+(schedule.startTime||'12:00')+':00+03:00'):null;
  const first=anchor===null?0:Math.max(0,Math.floor((at-anchor)/(7*86400000)));
  const upcoming=[];
  if(anchor!==null)for(let w=first;w<first+8;w++){
    const entry=calendar.current({...schedule,enabled:true},anchor+w*7*86400000);
    if(entry&&entry.endsAt>at)upcoming.push({...entry,name:products[entry.offerId].name,votes:products[entry.offerId].votes});
  }
  return {revision:state?.revision||0,serverNow:at,enabled:config.enabled,
    schedule:{...schedule,startTime:schedule.startTime||'12:00',durationHours:schedule.durationHours||60},
    offers:catalog.products.map(p=>normalizeOffer(products[p.id])),choices,active:calendar.current(schedule,at),upcoming};
}
function apply(store,access,actor,input) {
  if(!access.isOwner(actor))fail('Только владелец может менять пятничные акции.',403);
  if(!input||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId)||typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>500)fail('Укажи причину изменения, версию и номер операции.');
  const command=input.action==='offer'?{action:'offer',offer:normalizeOffer(input.offer)}:
    input.action==='schedule'?{action:'schedule',schedule:normalizeSchedule(input.schedule)}:fail('Неизвестное действие.');
  const signature=createHash('sha256').update(JSON.stringify(['weekendPromotions',command,input.revision,input.reason.trim()])).digest('hex');
  const admin=store.data.administration||{version:1,audit:[],receipts:{}},receipt=admin.receipts[input.requestId];
  if(receipt){if(receipt.signature!==signature)fail('Номер операции уже использован.',409);return {...view(store),replay:true};}
  const old=store.data.weekendPromotions||{version:1,revision:0,schedule:normalizeSchedule(store.promotionConfig.weekend),offers:{}};
  if(old.revision!==input.revision)fail('Настройки изменились в другой вкладке. Обнови редактор.',409);
  const state={...old,revision:old.revision+1,...(command.action==='offer'?{offers:{...old.offers,[command.offer.id]:command.offer}}:{schedule:command.schedule})};
  validate({weekendPromotions:state});
  const id=command.offer?.id||'schedule',at=store.now(),event={id:randomUUID(),at,actorId:actor.id,targetId:'weekendPromotions:'+id,
    targetName:command.offer?.name||'Расписание пятничных акций',action:'weekendPromotions',label:'Пятничные акции',reason:input.reason.trim(),requestId:input.requestId,
    before:command.action==='offer'?(old.offers[id]||normalizeOffer(catalog.get(id))):old.schedule,
    after:command.offer||command.schedule};
  store.save({...store.data,weekendPromotions:freeze(state),administration:{...admin,audit:[...admin.audit,event],receipts:{...admin.receipts,[input.requestId]:{signature,eventId:event.id,targetId:id}}}},at);
  return {...view(store),replay:false};
}
module.exports={settings,resolve,view,apply,validate,normalizeOffer,normalizeSchedule};

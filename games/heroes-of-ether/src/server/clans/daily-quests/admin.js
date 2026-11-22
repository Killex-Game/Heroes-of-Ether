"use strict";
const {randomUUID,createHash}=require('node:crypto');
const {BoosterError}=require('../../boosters/booster-catalog');
const seasons=require('./seasons'), service=require('./service');
const calendar=require('../../../../public/shared/clan-season-calendar');
const fail=(message,status=400)=>{throw new BoosterError(message,status);};
function view(store){const s=store.data.clanQuests;return {revision:s?.revision||0,seasons:structuredClone(s?.seasons||[]),serverNow:store.now(),automatic:s?.calendarVersion===1,current:calendar.season(store.now())};}
function apply(store,access,actor,input){
  if(!access.isOwner(actor))fail('Сезонами кланов управляет владелец.',403);
  if(store.data.clanQuests?.calendarVersion===1)fail('Сезоны сменяются автоматически каждые два месяца по утверждённому календарю.',409);
  if(!input || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId) || !Number.isSafeInteger(input.revision) || typeof input.reason!=='string' || input.reason.trim().length<3 || input.reason.length>500)fail('Укажи версию и причину изменения.');
  const signature=createHash('sha256').update(JSON.stringify(['clan-season',input])).digest('hex');
  const log=store.data.administration||{version:1,audit:[],receipts:{}};
  if(log.receipts[input.requestId]){if(log.receipts[input.requestId].signature!==signature)fail('Номер операции уже использован.',409);return {replay:true,...view(store)};}
  const at=store.now(), data=service.initialize(store.data,at), before=data.clanQuests;
  if(input.revision!==before.revision)fail('Расписание изменилось. Обнови список.',409);
  let next;
  if(input.action==='announce'){
    const startsAt=input.immediate===true?at:input.startsAt;
    if(!Number.isSafeInteger(startsAt)||startsAt<at||!Number.isSafeInteger(input.endsAt)||input.endsAt<=startsAt||input.endsAt>8640000000000000||typeof input.name!=='string'||input.name.trim().length>80)fail('Укажи название и будущий период сезона.');
    try{next=seasons.announce(before.seasons,{id:randomUUID(),name:input.name,startsAt,endsAt:input.endsAt},{role:'owner'});}catch{fail('Период некорректен или пересекается с другим сезоном.');}
  } else if(input.action==='stop'){
    const selected=before.seasons.find(s=>s.id===input.id && !s.cancelled && s.endsAt>at);
    if(!selected)fail('Сезон уже завершён или отменён.',409);
    next=before.seasons.map(s=>s!==selected?s:s.startsAt>=at?{...s,cancelled:true}:{...s,endsAt:at});
  }else fail('Неизвестное действие сезона.');
  const after={...before,revision:before.revision+1,seasons:next,nextAt:0};
  const event={id:randomUUID(),at,actorId:actor.id,targetId:'clanSeasons',targetName:'Сезоны клановых битв',action:'clanSeason',label:input.action==='announce'?'Объявление сезона кланов':'Завершение сезона кланов',reason:input.reason.trim(),before:before.seasons,after:next,requestId:input.requestId};
  store.save({...data,clanQuests:after,administration:{...log,audit:[...log.audit,event],receipts:{...log.receipts,[input.requestId]:{signature,eventId:event.id,targetId:'clanSeasons'}}}},at);
  return {replay:false,...view(store)};
}
module.exports={view,apply};

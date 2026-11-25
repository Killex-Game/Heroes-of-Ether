"use strict";
const {randomUUID,createHash}=require('node:crypto');
const {BoosterError}=require('../../boosters/booster-catalog');
const seasons=require('./seasons'), service=require('./service');
const calendar=require('../../../../public/shared/clan-season-calendar');
const fail=(message,status=400)=>{throw new BoosterError(message,status);};
function view(store){
  const s=store.data.clanQuests,now=store.now(),schedule=s?.calendarSchedule||[],current=calendar.season(now,schedule),upcoming=[];
  for(let at=current.end;upcoming.length<12;){const season=calendar.season(at,schedule);upcoming.push(season);at=season.end;}
  const minimum=require('../../../../public/shared/clan-competition-rules').BATTLE_MIN_MEMBERS;
  return {revision:s?.revision||0,seasons:structuredClone(s?.seasons||[]),serverNow:now,automatic:s?.calendarVersion===1,current,upcoming,
    readiness:{clans:Object.keys(store.data.clans).length,eligibleClans:Object.values(store.data.clans).filter(c=>c.members.length>=minimum).length,minimumMembers:minimum}};
}
function apply(store,access,actor,input){
  if(!access.isOwner(actor))fail('Сезонами кланов управляет владелец.',403);
  if(store.data.clanQuests?.calendarVersion===1 && !['schedule','switch'].includes(input?.action))fail('Выбери изменение расписания или досрочную смену сезона.',409);
  if(!input || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId) || !Number.isSafeInteger(input.revision) || typeof input.reason!=='string' || input.reason.trim().length<3 || input.reason.length>500)fail('Укажи версию и причину изменения.');
  const signature=createHash('sha256').update(JSON.stringify(['clan-season',input])).digest('hex');
  const log=store.data.administration||{version:1,audit:[],receipts:{}};
  if(log.receipts[input.requestId]){if(log.receipts[input.requestId].signature!==signature)fail('Номер операции уже использован.',409);return {replay:true,...view(store)};}
  const at=store.now(); let data=service.initialize(store.data,at); const before=data.clanQuests;
  if(input.revision!==before.revision)fail('Расписание изменилось. Обнови список.',409);
  let next, schedule;
  if(input.action==='switch'){
    const current=calendar.season(at,before.calendarSchedule);
    if(before.calendarVersion!==1 || input.seasonId!==current.id)fail('Текущий сезон изменился. Обнови список.',409);
    try { data=require('./early-switch').prepare(data,at,input.mode); }
    catch(error) { fail(error.message,409); }
    schedule=data.clanQuests.calendarSchedule; next=before.seasons;
  } else if(input.action==='schedule'){
    if(!Array.isArray(input.changes)||!input.changes.length||input.changes.length>12)fail('Выбери будущие сезоны.');
    const allowed=new Set(view(store).upcoming.map(s=>s.start)),seen=new Set(),entries=new Map((before.calendarSchedule||[]).map(row=>[row.start,row]));
    for(const row of input.changes){
      if(!row||Object.keys(row).sort().join(',')!=='mode,start'||!allowed.has(row.start)||seen.has(row.start)||!['quests','battle'].includes(row.mode))fail('Можно изменять только будущие двухмесячные сезоны.',409);
      seen.add(row.start);entries.set(row.start,{start:row.start,mode:row.mode});
    }
    schedule=[...entries.values()].sort((a,b)=>a.start-b.start);calendar.validateSchedule(schedule);next=before.seasons;
  } else if(input.action==='announce'){
    const startsAt=input.immediate===true?at:input.startsAt;
    if(!Number.isSafeInteger(startsAt)||startsAt<at||!Number.isSafeInteger(input.endsAt)||input.endsAt<=startsAt||input.endsAt>8640000000000000||typeof input.name!=='string'||input.name.trim().length>80)fail('Укажи название и будущий период сезона.');
    try{next=seasons.announce(before.seasons,{id:randomUUID(),name:input.name,startsAt,endsAt:input.endsAt},{role:'owner'});}catch{fail('Период некорректен или пересекается с другим сезоном.');}
  } else if(input.action==='stop'){
    const selected=before.seasons.find(s=>s.id===input.id && !s.cancelled && s.endsAt>at);
    if(!selected)fail('Сезон уже завершён или отменён.',409);
    next=before.seasons.map(s=>s!==selected?s:s.startsAt>=at?{...s,cancelled:true}:{...s,endsAt:at});
  }else fail('Неизвестное действие сезона.');
  const after={...data.clanQuests,revision:before.revision+1,seasons:next,...(schedule?{calendarSchedule:schedule}:{}),nextAt:0};
  const event={id:randomUUID(),at,actorId:actor.id,targetId:'clanSeasons',targetName:'Сезоны кланов',action:'clanSeason',label:schedule?'Изменение расписания сезонов':input.action==='announce'?'Объявление сезона кланов':'Завершение сезона кланов',reason:input.reason.trim(),before:schedule?before.calendarSchedule||[]:before.seasons,after:schedule||next,requestId:input.requestId};
  if(input.action==='switch')event.label='Досрочные итоги и запуск нового сезона';
  store.save({...data,clanQuests:after,administration:{...log,audit:[...log.audit,event],receipts:{...log.receipts,[input.requestId]:{signature,eventId:event.id,targetId:'clanSeasons'}}}},at);
  return {replay:false,...view(store)};
}
module.exports={view,apply};

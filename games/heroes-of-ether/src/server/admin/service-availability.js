"use strict";
const {createHash,randomUUID}=require('node:crypto');
const {BoosterError}=require('../boosters/booster-catalog');
const modes=Object.freeze([
  {id:'maintenance',name:'Технические работы',title:'Техническое обновление'},
  {id:'failure',name:'Сбой',title:'Что-то пошло не так'},
  {id:'unavailable',name:'Недоступность',title:'Игра временно недоступна'},
]);
const empty=()=>({version:1,revision:0,windows:modes.map(m=>({mode:m.id,enabled:false,startsAt:null,endsAt:null}))});
const fail=(text,status=400)=>{throw new BoosterError(text,status);};
function normalize(windows){
  if(!Array.isArray(windows)||windows.length!==modes.length||new Set(windows.map(w=>w?.mode)).size!==modes.length)fail('Нужны три режима доступности.');
  return modes.map(m=>{
    const w=windows.find(w=>w?.mode===m.id);
    if(!w||typeof w.enabled!=='boolean')fail('Некорректный режим доступности.');
    const valid=n=>Number.isSafeInteger(n)&&n>=0&&n<=8640000000000000;
    if(w.enabled&&(!valid(w.startsAt)||!valid(w.endsAt)||w.endsAt<=w.startsAt))fail('Укажи начало и окончание: окончание должно быть позже начала.');
    if(!w.enabled&&(![null,undefined].includes(w.startsAt)||![null,undefined].includes(w.endsAt))&&(!valid(w.startsAt)||!valid(w.endsAt)||w.endsAt<=w.startsAt))fail('Некорректное время отключённого режима.');
    return {mode:m.id,enabled:w.enabled,startsAt:w.startsAt??null,endsAt:w.endsAt??null};
  });
}
function validate(world){
  const v=world.serviceAvailability;if(v===undefined)return;
  if(!v||v.version!==1||!Number.isSafeInteger(v.revision)||v.revision<0)throw Error('Повреждено расписание доступности.');
  normalize(v.windows);
}
function selected(value,at){
  const active=(value?.windows||[]).filter(w=>w.enabled&&w.startsAt<=at&&at<w.endsAt);
  return ['unavailable','failure','maintenance'].map(id=>active.find(w=>w.mode===id)).find(Boolean)||null;
}
function view(store,maintenance){return {...structuredClone(store.data.serviceAvailability||empty()),modes,status:maintenance.status(),automatic:{active:!!maintenance.automatic?.length,since:maintenance.failureAt||null,faults:maintenance.automatic||[]},serverNow:store.now()};}
function apply(store,access,actor,input){
  if(!access.isOwner(actor))fail('Только владелец может менять доступность игры.',403);
  if(!input||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,80}$/.test(input.requestId)||typeof input.reason!=='string'||input.reason.trim().length<3||input.reason.length>500)fail('Укажи версию и причину изменения.');
  const windows=normalize(input.windows),signature=createHash('sha256').update(JSON.stringify([windows,input.revision,input.reason.trim()])).digest('hex');
  const administration=store.data.administration||{version:1,audit:[],receipts:{}};
  if(administration.receipts[input.requestId]){
    if(administration.receipts[input.requestId].signature!==signature)fail('Номер операции уже использован.',409);
    return {replay:true};
  }
  const before=store.data.serviceAvailability||empty();
  if(before.revision!==input.revision)fail('Расписание изменилось. Обнови его перед сохранением.',409);
  const at=store.now();
  for(const w of windows)if(w.enabled&&w.endsAt<=at&&!before.windows.some(old=>JSON.stringify(old)===JSON.stringify(w)))fail('Новый период уже закончился. Укажи будущее окончание.');
  const after={version:1,revision:before.revision+1,windows};
  const event={id:randomUUID(),at,actorId:actor.id,targetId:'serviceAvailability',targetName:'Доступность игры',action:'serviceAvailability',label:'Технические работы',reason:input.reason.trim(),before,after,requestId:input.requestId};
  store.save({...store.data,serviceAvailability:after,administration:{...administration,audit:[...administration.audit,event],receipts:{...administration.receipts,[input.requestId]:{signature,eventId:event.id,targetId:'serviceAvailability'}}}},at);
  return {replay:false};
}
module.exports={modes,empty,normalize,validate,selected,view,apply};

/* Moscow is UTC+03:00. Slots are derived from an anchor, never advanced by timers. */
'use strict';
const DAY=86400000,WEEK=7*DAY,OPEN_HOURS=60;
const draft=Object.freeze({enabled:false,startsOn:null,repeat:true,offerIds:Object.freeze([])});
function configuration(input=draft){
  const {enabled=false,startsOn=null,repeat=true,offerIds=[]}=input;
  if(typeof enabled!=='boolean'||repeat!==true||!Array.isArray(offerIds)||
    (offerIds.length!==0&&offerIds.length!==26)||new Set(offerIds).size!==offerIds.length||
    offerIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9:_-]{1,80}$/.test(id)))throw Error('Неверный цикл: нужны 26 уникальных акций.');
  if(startsOn!==null){
    if(typeof startsOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(startsOn))throw Error('Неверная дата начала цикла.');
    const d=new Date(startsOn+'T12:00:00+03:00');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==startsOn||d.getUTCDay()!==5)throw Error('Первая акция должна начинаться в пятницу.');
  }
  if(enabled&&(!startsOn||offerIds.length!==26))throw Error('Для запуска нужны дата первой пятницы и 26 акций.');
  return Object.freeze({enabled,startsOn,repeat,offerIds:Object.freeze([...offerIds])});
}
function current(config,at){
  if(!config.enabled||!Number.isSafeInteger(at))return null;
  const anchor=Date.parse(config.startsOn+'T12:00:00+03:00');
  if(at<anchor)return null;
  const week=Math.floor((at-anchor)/WEEK),startsAt=anchor+week*WEEK,endsAt=startsAt+OPEN_HOURS*3600000;
  if(at>=endsAt)return null;
  return Object.freeze({offerId:config.offerIds[week%26],position:week%26+1,cycle:Math.floor(week/26)+1,
    occurrenceId:config.startsOn+':'+week,startsAt,endsAt});
}
function requireActive(config,offerId,at){
  const active=current(config,at);
  if(!active||active.offerId!==offerId){const error=Error('Акция доступна с пятницы 12:00 до конца воскресенья по Москве.');error.status=409;throw error;}
  return active;
}
function version(config,at){const active=current(config||draft,at);return active?active.offerId+':'+active.occurrenceId:'';}
module.exports={configuration,current,requireActive,draft,version};

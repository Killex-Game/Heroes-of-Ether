/* Moscow is UTC+03:00. Slots are derived from an anchor, never advanced by timers. */
'use strict';
const DAY=86400000,WEEK=7*DAY,OPEN_HOURS=60;
const draft=Object.freeze({enabled:false,startsOn:null,repeat:true,offerIds:Object.freeze([])});
function configuration(input=draft){
  const {enabled=false,startsOn=null,repeat=true,offerIds=[],custom=false,startTime='12:00',durationHours=60,revision=0}=input;
  if(typeof enabled!=='boolean'||typeof custom!=='boolean'||typeof repeat!=='boolean'||(!custom&&repeat!==true)||!Array.isArray(offerIds)||
    (custom?offerIds.length>26:(offerIds.length!==0&&offerIds.length!==26))||new Set(offerIds).size!==offerIds.length||
    offerIds.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9:_-]{1,80}$/.test(id)))throw Error('Неверный цикл: нужны 26 уникальных акций.');
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)||!Number.isSafeInteger(durationHours)||durationHours<1||durationHours>168||!Number.isSafeInteger(revision)||revision<0)throw Error('Неверное время или длительность акции.');
  if(startsOn!==null){
    if(typeof startsOn!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(startsOn))throw Error('Неверная дата начала цикла.');
    const d=new Date(startsOn+'T12:00:00+03:00');
    if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==startsOn||d.getUTCDay()!==5)throw Error('Первая акция должна начинаться в пятницу.');
  }
  if(enabled&&(!startsOn||!offerIds.length))throw Error('Для запуска нужны дата первой пятницы и акции.');
  return Object.freeze({enabled,startsOn,repeat,offerIds:Object.freeze([...offerIds]),...(custom?{custom,startTime,durationHours,revision}:{})});
}
function current(config,at){
  if(!config.enabled||!Number.isSafeInteger(at))return null;
  const anchor=Date.parse(config.startsOn+'T'+(config.startTime||'12:00')+':00+03:00');
  if(at<anchor)return null;
  const count=config.offerIds.length,week=Math.floor((at-anchor)/WEEK),startsAt=anchor+week*WEEK,endsAt=startsAt+(config.durationHours||OPEN_HOURS)*3600000;
  if(!count||at>=endsAt||(!config.repeat&&week>=count))return null;
  return Object.freeze({offerId:config.offerIds[week%count],position:week%count+1,cycle:Math.floor(week/count)+1,
    occurrenceId:config.startsOn+':'+week,startsAt,endsAt});
}
function requireActive(config,offerId,at){
  const active=current(config,at);
  if(!active||active.offerId!==offerId){const error=Error('Акция доступна с пятницы 12:00 до конца воскресенья по Москве.');error.status=409;throw error;}
  return active;
}
function version(config,at){const active=current(config||draft,at),base=active?active.offerId+':'+active.occurrenceId:'';return config?.revision?config.revision+':'+base:base;}
module.exports={configuration,current,requireActive,draft,version};

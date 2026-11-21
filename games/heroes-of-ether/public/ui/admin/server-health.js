"use strict";
(function(root,factory) { const api=factory(); if(typeof module==="object"&&module.exports)module.exports=api;else root.KillexServerHealth=api; })(typeof globalThis!=="undefined"?globalThis:this,()=>{
  const neutral = reason => ({level:"unknown",reason});
  const high = (value, warning, critical, unit) => !Number.isFinite(value) ? neutral("Нет замера") : ({level:value>=critical?"critical":value>=warning?"warning":"normal",reason:`Внимание ≥ ${warning} ${unit}; критично ≥ ${critical} ${unit}.`});
  function timings(v) {
    const target=Number.isFinite(v.targetTickMs)&&v.targetTickMs>0?v.targetTickMs:null;
    const resolution=Number.isFinite(v.eventLoop?.resolutionMs)&&v.eventLoop.resolutionMs>0?v.eventLoop.resolutionMs:null;
    const excess=(total,base)=>base!==null&&Number.isFinite(total)?Math.max(0,total-base):null;
    return {target,resolution,intervalExcess:excess(v.tickIntervalMs?.p95,target),loopExcess:v.eventLoop?.samples>0?excess(v.eventLoop.p95Ms,resolution):null};
  }
  function assess(v) {
    if(v.stale||v.available===false)return Array.from({length:8},()=>neutral("Сохранённый замер. Текущая нагрузка игры неизвестна."));
    const tick=v.targetTickMs;
    const enough = v.ticks >= 20 && v.windowMs >= 1000 && Number.isFinite(tick) && tick > 0;
    const target = enough ? 1000/tick : null;
    const rate = enough ? {level:v.updatesHz<target*.75?"critical":v.updatesHz<target*.95?"warning":"normal",reason:`Цель ${target} Гц. Внимание < ${target*.95} Гц; критично < ${target*.75} Гц.`} : neutral("Недостаточно тактов для оценки.");
    const p=v.persistence;
    const queue = p.paused ? {level:"critical",reason:"Арена приостановлена до сохранения прогресса."} : high(Math.max(p.arenaBatches*10,p.queuedActions),20,100,"ед. очереди");
    queue.reason = p.paused ? queue.reason : "Внимание: ≥ 2 пакетов прогресса или ≥ 20 действий. Критично: ≥ 10 пакетов или ≥ 100 действий.";
    const memory=v.memoryMiB.limit>0?high(v.memoryMiB.resident/v.memoryMiB.limit*100,75,90,"% лимита памяти контейнера"):neutral("Лимит памяти процесса не задан; по одному объёму оценка не выставляется.");
    const wal=p.maxWalBytes>0?high(p.pendingWalBytes/p.maxWalBytes*100,50,80,"% предела журнала"):neutral("Лимит журнала неизвестен.");
    return [neutral("Число игроков и комнат само по себе не означает перегрузку."),rate,
      enough?high(v.tickWorkMs.p95,tick*.4,tick,"мс"):neutral("Недостаточно тактов для оценки."),
      enough?high(v.tickIntervalMs.p95,tick*1.5,tick*2,"мс"):neutral("Недостаточно тактов для оценки."),
      v.eventLoop?.samples>0&&tick>0?high(v.eventLoop.p95Ms,tick,tick*2,"мс"):neutral("Нет замера задержки цикла."),queue,memory,wal];
  }
  function paint(element,state) {
    element.dataset.health=state.level; element.title=state.reason;
    element.querySelector(":scope > .owner-health-reason")?.remove();
    if (["warning","critical"].includes(state.level)) {const text=document.createElement("small");text.className="owner-health-reason";text.textContent=(state.level==="critical"?"Критично. ":"Внимание. ")+state.reason;element.append(text);}
  }
  return {assess,paint,timings};
});

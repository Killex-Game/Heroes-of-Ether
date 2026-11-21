/* Availability screens share one bounded poll; no timers in a hidden tab. */
(() => {
  'use strict';
  const standalone=document.documentElement.dataset.maintenance==='true';
  const titles={maintenance:'Техническое обновление',failure:'Что-то пошло не так',unavailable:'Игра временно недоступна'};
  let blocked=standalone,server=null,localFailure=false,brokenAssets=false,failures=0,timer,checking=false,dialog,title,copy,status,button,dates,art,lastMode='maintenance',generation=0;
  function show(mode){
    mode=Object.hasOwn(titles,mode)?mode:'unavailable';lastMode=mode;
    if(!dialog){
      dialog=document.createElement('dialog');dialog.id='maintenanceDialog';dialog.setAttribute('aria-labelledby','maintenanceTitle');
      dialog.innerHTML='<img class="maintenance-banner" src="/assets/service/maintenance-v1.png" alt="" width="2048" height="683"><div class="maintenance-symbol" aria-hidden="true"></div><h1 id="maintenanceTitle"></h1><p class="maintenance-copy"></p><p class="maintenance-dates"></p><p class="maintenance-status" role="status"></p><button type="button" hidden>Вернуться в игру</button>';
      document.body.append(dialog);title=dialog.querySelector('h1');copy=dialog.querySelector('.maintenance-copy');status=dialog.querySelector('.maintenance-status');dates=dialog.querySelector('.maintenance-dates');button=dialog.querySelector('button');art=dialog.querySelector('img');
      art.onerror=()=>{art.hidden=true;};button.onclick=()=>location.assign('/');dialog.addEventListener('cancel',e=>e.preventDefault());
    }
    dialog.dataset.mode=mode;title.textContent=titles[mode];
    art.hidden=mode!=='maintenance'||(art.complete&&!art.naturalWidth);
    dialog.querySelector('.maintenance-symbol').textContent=mode==='failure'?'!':mode==='unavailable'?'⌛':'';
    dialog.querySelector('.maintenance-symbol').hidden=mode==='maintenance';
    const first=!blocked||!dialog.open;blocked=true;
    if(!dialog.open)dialog.showModal();
    if(first)document.dispatchEvent(new CustomEvent('killex:maintenance'));
  }
  function paint(){
    const active=server?.maintenance===true;
    if(active||localFailure)show(active?server.mode||'maintenance':'failure');
    if(!dialog)return;
    dates.hidden=!(active&&server.endsAt);
    if(!dates.hidden){
      const end=new Date(server.endsAt),zone={timeZone:'Europe/Moscow'};
      dates.textContent='До '+end.toLocaleDateString('ru-RU',{...zone,day:'numeric',month:'long'})+' '+end.toLocaleTimeString('ru-RU',{...zone,hour:'2-digit',minute:'2-digit'})+' МСК';
    }
    copy.textContent=active?(lastMode==='maintenance'?'Устанавливаем обновление игры.':'Вход в игру временно закрыт.'):
      localFailure?(brokenAssets?'Не удалось загрузить игру. Попробуй открыть её снова.':'Не удалось связаться с игрой. Проверь соединение.'):'Игра снова доступна.';
    status.textContent='';
    button.hidden=active||(localFailure&&!brokenAssets);
    button.textContent=brokenAssets?'Попробовать снова':'Вернуться в игру';
  }
  function update(value){
    if(typeof value?.maintenance!=='boolean')return;
    server=value;failures=0;if(!brokenAssets)localFailure=false;paint();
  }
  function failure({assets=false}={}){
    localFailure=true;brokenAssets||=assets;paint();
  }
  async function check(){
    clearTimeout(timer);if(checking||document.hidden)return;
    checking=true;const request=++generation;
    try{
      const response=await fetch('/api/service-status',{cache:'no-store',signal:AbortSignal.timeout(4000)}),value=await response.json();
      if(typeof value.maintenance!=='boolean')throw Error('No availability status');
      if(request===generation)update(value);
    }catch(_){
      if(request===generation&&++failures>=2){if(!server?.maintenance)failure();else {show(server.mode||'maintenance');status.textContent='';button.hidden=true;}}
    }finally{checking=false;if(!document.hidden)timer=setTimeout(check,blocked?3000:10000);}
  }
  window.KillexMaintenance={get blocked(){return blocked;},update,check,failure};
  if(standalone){show('unavailable');copy.textContent='';button.hidden=true;}
  if(window.KillexStartupFailure)failure({assets:true});
  document.addEventListener('killex:startup-failed',()=>failure({assets:true}));
  document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden)check();});
  addEventListener('online',check);
  document.addEventListener('submit',e=>{if(blocked&&e.target.id==='joinForm'){e.preventDefault();e.stopImmediatePropagation();}},true);
  check();
})();

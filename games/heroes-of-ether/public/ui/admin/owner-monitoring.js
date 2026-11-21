"use strict";
(() => {
  const $=id=>document.getElementById(id),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  const reasons={LOCAL_JOURNAL_FAILED:'Ошибка локального журнала сохранений',CHECKPOINT_FAILED:'Не удалось создать снимок сохранений',ARENA_SAVE_FAILED:'Не удалось сохранить прогресс арены',MONGODB_FAILED:'Ошибка связи или синхронизации MongoDB',MONGODB_STALE:'MongoDB не подтверждает синхронизацию вовремя',SERVER_UNREACHABLE:'Сервер не ответил на проверку доступности'};
  const titles={maintenance:'Технические работы',failure:'Сбой',unavailable:'Недоступность'};
  const time=n=>new Date(n).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'});
  const number=n=>Number(n).toLocaleString('ru-RU',{maximumFractionDigits:2});
  const svg=(name,attributes)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attributes))n.setAttribute(k,v);return n;};
  class OwnerMonitoring{
    static reason(value){return reasons[value]||value;}
    constructor({api,onState}){
      this.api=api;this.onState=onState;this.generation=0;
      document.addEventListener('visibilitychange',()=>this.schedule());
    }
    view(id){this.visible=id;this.schedule();}
    lock(){this.visible=null;this.generation++;clearTimeout(this.timer);$('monitorGraphs').replaceChildren();$('monitorStatus').textContent='';}
    schedule(){clearTimeout(this.timer);if(document.hidden||!['overview','maintenance'].includes(this.visible))return;this.load();}
    async load(){
      if(this.busy)return;this.busy=true;const generation=this.generation;
      try{
        const data=await this.api('monitoring?graphs='+(this.visible==='overview'?'1':'0'));if(generation!==this.generation)return;
        this.onState(data.availability,data);if(this.visible==='overview')this.render(data);
      }catch(_){if(generation===this.generation){$('monitorStatus').textContent='Нет связи с сервером. Текущее состояние не подтверждено.';$('monitorStatus').dataset.health='critical';}}
      finally{this.busy=false;if(!document.hidden&&['overview','maintenance'].includes(this.visible))this.timer=setTimeout(()=>this.load(),generation===this.generation?5000:0);}
    }
    render(data){
      const state=data.availability,warning=data.stale||data.logError;
      const current=$('monitorStatus');current.dataset.health=state.automatic.active?'critical':warning?'warning':'normal';
      current.textContent=state.automatic.active?'Сбой · '+state.automatic.faults.map(OwnerMonitoring.reason).join(', '):state.status.maintenance?state.status.title:warning?'Мониторинг: нет свежих измерений':'Игра доступна';
      const watch=data.watchdog,watchFresh=watch&&Date.now()-watch.checkedAt<20000;
      $('monitorUpdated').textContent=(data.checkedAt?'Проверка админкой: '+time(data.checkedAt)+' МСК. ':'')+(data.at?(data.stale?'Последний игровой замер: ':'Игровой замер: ')+time(data.at)+' МСК. ':'Свежих игровых замеров нет. ')+(watchFresh?'Внешняя проверка: '+(watch.active?'сбой':watch.healthy?'отвечает':'проверяем')+'.':'Внешняя проверка: нет свежего ответа.')+(data.logError?' Ошибка записи/чтения журнала мониторинга.':'');
      const graphs=$('monitorGraphs');graphs.replaceChildren();
      for(const [key,title,unit,scale,description]of [['mongo','MongoDB','операций/с',1,'Завершённые операции хранилища игры. Пакетная запись и чтение курсора считаются одной операцией; это не число документов и не вся нагрузка Atlas.'],['disk','Диск VPS','КиБ/с',1024,data.disk?.available?'Устройство '+data.disk.device+' · весь ввод-вывод диска.':data.disk?.reason||'Нет измерений диска.']]){
        const card=node('article');card.className='monitor-chart';card.append(node('h3',title));
        const independent=key==='disk'&&data.independent;
        const finish=data.checkedAt||Date.now(),begin=finish-3600000;
        const points=(independent?independent.series:data.series||[]).filter(p=>p.at>=begin&&p.at<=finish),latest=points.at(-1)?.[key],legend=node('div');legend.className='monitor-legend';
        const fresh=latest&&finish-points.at(-1).at<15000&&(independent?independent.disk.available:!warning&&data.collecting);
        for(const [field,label]of [['read','Чтение'],['write','Запись']]){const item=node('span',label+': '+(fresh?number(latest[field]/scale)+' '+unit:'—'));item.dataset.series=field;legend.append(item);}card.append(legend);
        const plot=svg('svg',{viewBox:'0 0 600 170',role:'img','aria-label':title+': чтение и запись за последний час',preserveAspectRatio:'none'});
        const values=points.flatMap(p=>p[key]?[p[key].read/scale,p[key].write/scale]:[]),max=Math.max(1,...values);
        for(let row=0;row<4;row++){const y=15+row*42;plot.append(svg('line',{x1:48,y1:y,x2:590,y2:y,class:'monitor-grid'}));const text=svg('text',{x:44,y:y+4,'text-anchor':'end'});text.textContent=number(max*(1-row/3));plot.append(text);}
        for(const field of ['read','write']){
          let d='',previous=0;
          for(const p of points){if(!p[key]||p.at<begin){previous=0;continue;}const x=48+(p.at-begin)/3600000*542,y=141-p[key][field]/scale/max*126;d+=(previous&&p.at-previous<20000?' L':' M')+x.toFixed(2)+' '+y.toFixed(2);previous=p.at;}
          plot.append(svg('path',{d,'data-series':field,fill:'none','stroke-width':2.5,'vector-effect':'non-scaling-stroke'}));
        }
        card.append(plot);const axis=node('div');axis.className='monitor-axis';axis.append(node('span','−60 мин'),node('span','−30 мин'),node('span','Сейчас'));card.append(axis,node('p',independent?(independent.disk.available?'Независимый замер админки · устройство '+independent.disk.device+' · весь ввод-вывод диска.':independent.disk.reason||'Нет измерений диска.'):description));
        if(key==='mongo'&&data.stale)card.append(node('p','Игра недоступна. Показана история; свежие операции MongoDB не измеряются.'));
        else if(key==='mongo'&&!data.mongo?.enabled)card.append(node('p','MongoDB не подключена.'));
        else if(!values.length)card.append(node('p','Недостаточно измерений для графика.'));
        graphs.append(card);
      }
    }
  }
  window.KillexOwnerMonitoring=OwnerMonitoring;
})();

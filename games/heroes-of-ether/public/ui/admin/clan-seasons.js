"use strict";
(() => {
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const date=n=>new Date(n).toLocaleString('ru-RU');
  const inputDate=n=>new Date(n+3*3600000).toISOString().slice(0,16);
  class ClanSeasons {
    constructor({api}){this.api=api;this.root=document.getElementById('clanSeasonsPanel');this.generation=0;}
    lock(){this.generation++;this.pending=null;this.root.replaceChildren();}
    async load(){const g=this.generation;try{const data=await this.api('clan-seasons');if(g===this.generation)this.render(data);}catch(e){if(g===this.generation)this.root.textContent=e.message;}}
    renderSchedule(data){
      const range=s=>new Date(s.start+10800000).toLocaleDateString('ru-RU',{timeZone:'UTC'})+' - '+new Date(s.end-1+10800000).toLocaleDateString('ru-RU',{timeZone:'UTC'});
      this.root.append(node('p','Сейчас '+data.current.name.toLowerCase()+' с '+range(data.current)));
      this.root.append(node('p','В расписании выбирай тип будущих двухмесячных периодов. Досрочная смена ниже завершает текущий сезон и запускает новый до конца этого периода.'));
      this.renderSwitch(data);
      if(data.readiness)this.root.append(node('p','Кланов с составом от '+data.readiness.minimumMembers+' участников: '+data.readiness.eligibleClans+' из '+data.readiness.clans+'. Для группы лиги нужно от 10 кланов.'));
      const form=node('form'),table=node('div'),inputs=[];form.className='clan-schedule-form';table.className='clan-schedule-grid';
      for(const season of data.upcoming){
        const label=node('label',range(season)),select=node('select');select.setAttribute('aria-label','Тип сезона '+range(season));
        for(const [value,title]of [['quests','Клановые задания'],['battle','Клановые битвы']]){const option=node('option',title);option.value=value;select.append(option);}select.value=season.mode;
        label.append(select);table.append(label);inputs.push({season,select});
      }
      const presets=node('div');presets.className='clan-schedule-presets';
      for(const count of [1,2]){const button=node('button',count===1?'Сначала 1 сезон заданий':'Сначала 2 сезона заданий');button.type='button';button.onclick=()=>{for(let i=0;i<=count;i++)inputs[i].select.value=i<count?'quests':'battle';};presets.append(button);}
      const reasonLabel=node('label','Причина изменения'),reason=node('input');reason.type='text';reason.required=true;reason.minLength=3;reason.maxLength=500;reasonLabel.append(reason);
      const submit=node('button','Сохранить расписание'),status=node('p');submit.type='submit';status.setAttribute('role','status');
      form.append(presets,table,reasonLabel,submit,status);this.root.append(form);
      form.onsubmit=async event=>{
        event.preventDefault();if(this.busy)return;
        const changes=inputs.filter(x=>x.select.value!==x.season.mode).map(x=>({start:x.season.start,mode:x.select.value}));
        if(!changes.length){status.textContent='Расписание не изменилось';return;}
        const payload={action:'schedule',revision:data.revision,changes,reason:reason.value.trim()},signature=JSON.stringify(payload);
        if(this.pending?.signature!==signature)this.pending={signature,requestId:KillexRequestIds.create()};
        const generation=this.generation;this.busy=true;submit.disabled=true;
        try{const next=await this.api('clan-seasons',{...payload,requestId:this.pending.requestId});if(generation===this.generation){this.pending=null;this.render(next);this.root.append(node('p','Расписание сохранено'));}}
        catch(error){if(generation===this.generation)status.textContent=error.message;}
        finally{this.busy=false;submit.disabled=false;}
      };
    }
    renderSwitch(data){
      const form=node('form');form.className='clan-schedule-form clan-season-switch';
      const mode=data.current.mode==='quests'?'battle':'quests',name=mode==='battle'?'Сезон клановых битв':'Сезон клановых заданий';
      form.append(node('h3','Досрочная смена сезона'),node('p','Завершится: '+data.current.name+'. Заработанные награды будут выданы сразу.'),
        node('p','Начнётся: '+name+'. Окончание: '+date(data.current.end)+'. Вклад ещё не вышедших с арены игроков в завершённый сезон не попадёт.'));
      const label=node('label','Причина для журнала'),reason=node('input');reason.required=true;reason.minLength=3;reason.maxLength=500;label.append(reason);
      const confirmation=node('label','Подвести итоги текущего сезона и начать новый'),check=node('input');check.type='checkbox';check.required=true;confirmation.prepend(check);
      const button=node('button','Подвести итоги и начать: '+name),status=node('p');button.type='submit';status.setAttribute('role','status');
      form.append(label,confirmation,button,status);this.root.append(form);
      form.onsubmit=async event=>{
        event.preventDefault();if(this.busy || !check.checked)return;
        const payload={action:'switch',revision:data.revision,seasonId:data.current.id,mode,reason:reason.value.trim()},signature=JSON.stringify(payload);
        if(this.pending?.signature!==signature)this.pending={signature,requestId:KillexRequestIds.create()};
        const generation=this.generation;this.busy=true;button.disabled=true;
        try{const next=await this.api('clan-seasons',{...payload,requestId:this.pending.requestId});if(generation===this.generation){this.pending=null;this.render(next);this.root.append(node('p','Итоги подведены. Новый сезон начался.'));}}
        catch(error){if(generation===this.generation)status.textContent=error.message;}
        finally{this.busy=false;button.disabled=false;}
      };
    }
    render(data){
      this.root.replaceChildren(node('h2','Сезоны кланов'));
      if(data.automatic){this.renderSchedule(data);return;}
      this.root.append(node('p','Во время сезона клановые битвы и лиги заменяют ежедневные задания. После его окончания задания возвращаются, если ещё не наступило 20:00 МСК. Уже заработанные награды сохраняются.'));
      const form=node('form'), fields={};
      for(const [key,label,type] of [['name','Название сезона','text'],['startsAt','Начало, МСК','datetime-local'],['endsAt','Окончание, МСК','datetime-local'],['reason','Причина для журнала','text']]){
        const l=node('label',label),input=node('input');input.type=type;input.required=true;input.maxLength=key==='name'?80:500;
        if(type==='datetime-local')input.value=inputDate(data.serverNow+(key==='endsAt'?7*86400000:3600000));
        l.append(input);form.append(l);fields[key]=input;
      }
      const nowLabel=node('label','Начать сразу'),now=node('input');now.type='checkbox';nowLabel.prepend(now);form.append(nowLabel);
      now.onchange=()=>{fields.startsAt.disabled=now.checked;fields.startsAt.required=!now.checked;};
      const submit=node('button','Объявить сезон');submit.type='submit';form.append(submit);
      const status=node('p');status.setAttribute('role','status');form.append(status);this.root.append(form);
      const run=async payload=>{
        if(this.busy)return;
        const signature=JSON.stringify(payload);if(this.pending?.signature!==signature)this.pending={signature,requestId:KillexRequestIds.create()};
        const g=this.generation;this.busy=true;submit.disabled=true;
        try{const updated=await this.api('clan-seasons',{...payload,revision:data.revision,requestId:this.pending.requestId});if(g===this.generation){this.pending=null;this.render(updated);}}
        catch(e){if(g===this.generation)status.textContent=e.message;}
        finally{this.busy=false;submit.disabled=false;}
      };
      form.onsubmit=e=>{e.preventDefault();run({action:'announce',name:fields.name.value,reason:fields.reason.value,immediate:now.checked,startsAt:Date.parse(fields.startsAt.value+':00+03:00'),endsAt:Date.parse(fields.endsAt.value+':00+03:00')});};
      for(const s of [...data.seasons].reverse()){
        const row=node('article');row.className='clan-season-admin-row';
        row.append(node('strong',s.name),node('p',`${date(s.startsAt)} — ${date(s.endsAt)} МСК`),node('p',s.cancelled?'Отменён':s.endsAt<=data.serverNow?'Завершён':s.startsAt<=data.serverNow?'Идёт сейчас':'Запланирован'));
        if(!s.cancelled && s.endsAt>data.serverNow){const stop=node('button',s.startsAt>data.serverNow?'Отменить сезон':'Завершить сезон');stop.type='button';stop.onclick=()=>{const reason=prompt('Причина изменения для журнала');if(reason?.trim().length>=3)run({action:'stop',id:s.id,reason});};row.append(stop);}
        this.root.append(row);
      }
    }
  }
  window.KillexClanSeasons=ClanSeasons;
})();

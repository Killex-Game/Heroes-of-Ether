"use strict";
(() => {
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const stamp=ms=>ms===null?'':new Date(ms+3*3600000).toISOString().slice(0,16);
  const instant=s=>s?Date.parse(s+':00+03:00'):null;
  class MaintenancePanel {
    constructor({api}){this.api=api;this.generation=0;this.root=document.getElementById('maintenancePanel');}
    lock(){this.generation++;this.state=null;this.pending=null;this.root.replaceChildren();}
    async load(){
      if(this.busy)return;const generation=++this.generation;
      try{const state=await this.api('maintenance');if(generation!==this.generation)return;this.state=state;this.render();}
      catch(error){if(generation===this.generation)this.root.textContent=error.message;}
    }
    render(){
      const s=this.state;this.root.replaceChildren();
      const header=node('div');header.className='section-title';const title=node('h2','Технические работы'),refresh=node('button','Обновить');refresh.type='button';refresh.onclick=()=>this.load();header.append(title,refresh);
      const current=node('p');current.className='service-current';this.current=current;
      const hint=node('p','Время указано по МСК. Выбранный режим действует с начала включительно до окончания. При закрытии прогресс сохраняется, игровые сеансы завершаются; админка остаётся доступна.');hint.className='muted';
      const form=node('form');form.id='maintenanceForm';const rows=[];
      for(const mode of s.modes){
        const value=s.windows.find(w=>w.mode===mode.id),box=node('fieldset');box.className='service-mode';
        const legend=node('legend'),label=node('label'),check=node('input');check.type='checkbox';check.id='service-'+mode.id;check.checked=value.enabled;label.append(check,document.createTextNode(mode.name));legend.append(label);box.append(legend);
        box.append(node('p','Заглушка: «'+mode.title+'»'));
        const grid=node('div');grid.className='service-dates';
        const inputs=['startsAt','endsAt'].map((key,i)=>{
          const label=node('label',i?'До (МСК)':'С (МСК)'),input=node('input');input.type='datetime-local';input.id='service-'+mode.id+'-'+key;
          input.value=stamp(value[key]??(s.serverNow+i*3600000));label.append(input);grid.append(label);return input;
        });
        const automatic=node('p');automatic.className='service-automatic';box.append(automatic);
        const row={mode:mode.id,check,inputs,manual:value.enabled,automatic};
        const sync=()=>{row.manual=check.checked;for(const input of inputs){input.disabled=!row.manual;input.required=row.manual;}};check.onchange=sync;sync();box.append(grid);form.append(box);rows.push(row);
      }
      const priority=node('p','Автоматический сбой имеет приоритет и снимается после подтверждённого восстановления. Ручные периоды: Недоступность → Сбой → Технические работы. Снятие галочки и сохранение отменяет ручной период.');priority.className='muted';
      const reasonLabel=node('label','Причина изменения для журнала'),reason=node('input');reason.id='service-reason';reason.required=true;reason.minLength=3;reason.maxLength=500;reasonLabel.append(reason);
      const save=node('button','Сохранить расписание');save.className='primary';save.type='submit';
      const status=node('p');status.id='service-save-status';status.setAttribute('role','status');
      form.append(priority,reasonLabel,save,status);this.root.append(header,current,hint,form);
      this.rows=rows;this.updateStatus(s);
      form.onsubmit=async event=>{
        event.preventDefault();if(this.busy)return;
        const payload={revision:s.revision,windows:rows.map(r=>({mode:r.mode,enabled:r.manual,startsAt:instant(r.inputs[0].value),endsAt:instant(r.inputs[1].value)})),reason:reason.value};
        const signature=JSON.stringify(payload);if(this.pending?.signature!==signature)this.pending={signature,requestId:KillexRequestIds.create()};
        const generation=this.generation;this.busy=true;save.disabled=true;refresh.disabled=true;status.textContent='Сохраняем…';
        try{
          const next=await this.api('maintenance',{...payload,requestId:this.pending.requestId});
          if(generation!==this.generation)return;this.state=next;this.pending=null;this.render();this.root.querySelector('#service-save-status').textContent='Расписание сохранено.';
        }catch(error){if(generation===this.generation)status.textContent=error.message;}
        finally{this.busy=false;save.disabled=false;refresh.disabled=false;}
      };
    }
    updateStatus(s){
      if(!this.current||!this.rows)return;
      this.current.textContent=s.status.maintenance?s.status.title+(s.status.draining?' · Сохраняем прогресс и завершаем сеансы':' · Вход закрыт'):'Игра доступна';this.current.dataset.closed=String(s.status.maintenance);
      for(const row of this.rows){
        const auto=row.mode==='failure'&&s.automatic?.active;
        row.check.checked=auto||row.manual;row.check.disabled=!!auto;
        row.automatic.textContent=auto?'Обнаружен автоматически: '+s.automatic.faults.map(v=>window.KillexOwnerMonitoring.reason(v)).join(', ')+'. С '+new Date(s.automatic.since).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК.':'';
        row.automatic.hidden=!auto;
      }
    }
  }
  window.KillexMaintenancePanel=MaintenancePanel;
})();

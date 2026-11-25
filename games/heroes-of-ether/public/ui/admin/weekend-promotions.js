"use strict";
(() => {
  const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
  const button=(text,run)=>{const b=node('button',text);b.type='button';b.onclick=run;return b;};
  const date=at=>new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
  const field=(form,label,type,value,min,max)=>{
    const wrap=node('label',label),input=node('input');input.type=type;input.value=value??'';
    if(min!==undefined)input.min=min;if(max!==undefined)input.max=max;
    if(type!=='checkbox')input.required=true;else input.checked=!!value;
    wrap.append(input);form.append(wrap);return input;
  };
  class WeekendPromotions {
    constructor({api}){this.api=api;this.root=document.getElementById('weekendPromotionsPanel');this.generation=0;}
    lock(){this.generation++;this.data=null;this.pending=null;this.busy=false;this.dirty=false;this.root.replaceChildren();}
    async load(force=false){
      if(this.busy||this.data&&!force)return;
      if(this.dirty&&!confirm('Отменить несохранённые изменения и обновить редактор?'))return;
      const generation=this.generation;
      try{const data=await this.api('weekend-promotions');if(generation===this.generation)this.render(data);}
      catch(e){if(generation===this.generation){if(this.status)this.status.textContent=e.message;else this.root.textContent=e.message;}}
    }
    render(data){
      this.data=data;this.dirty=false;this.offerDirty=false;this.scheduleDirty=false;this.root.replaceChildren();
      const header=node('div',null,'friday-heading');header.append(node('h2','Пятничные акции'),button('Обновить',()=>this.load(true)));this.root.append(header);
      this.root.append(node('p','26 наборов: меняй название, цену, состав и лимит покупок. Расписание — по московскому времени. Сохранение сразу применяется в игре; ранее выданные награды сохраняются.'));
      const state=node('p',!data.enabled?'Общий показ акций выключен в настройках игры.':!data.schedule.enabled?'Пятничные акции на паузе.':data.active?'Сейчас: '+data.offers.find(o=>o.id===data.active.offerId).name+' · до '+date(data.active.endsAt)+' МСК':'Показ включён. Ожидается ближайшая акция.','friday-state');this.root.append(state);
      this.status=node('p',null,'friday-message');this.status.setAttribute('role','status');this.root.append(this.status);
      const layout=node('div',null,'friday-columns');this.root.append(layout);
      this.renderOffers(layout,data);this.renderSchedule(layout,data);
      this.root.oninput=e=>{if(e.target.closest('form'))this.dirty=true;};
      this.root.onchange=e=>{if(e.target.closest('form'))this.dirty=true;};
    }
    renderOffers(layout,data){
      const panel=node('section',null,'friday-editor');panel.append(node('h3','Содержимое набора'));
      const label=node('label','Набор'),select=node('select');select.setAttribute('aria-label','Набор');
      data.offers.forEach((o,i)=>{const option=node('option',String(i+1).padStart(2,'0')+' · '+o.name);option.value=o.id;select.append(option);});
      select.value=this.selected||data.offers[0].id;this.selected=select.value;label.append(select);panel.append(label);layout.append(panel);
      const area=node('div');panel.append(area);
      const draw=()=>{
        area.replaceChildren();this.offerDirty=false;
        const offer=data.offers.find(o=>o.id===select.value),form=node('form',null,'friday-form');area.append(form);
        const name=field(form,'Название','text',offer.name);name.maxLength=80;
        const pricing=node('div',null,'friday-fields');form.append(pricing);
        const votes=field(pricing,'Цена, голоса','number',offer.votes,1,100000),limit=field(pricing,'Покупок за показ','number',offer.purchaseLimit,1,5);
        form.append(node('p','Сохраняется общий предел тестовых покупок: 5 за сутки.','muted'));
        const rewards=node('div',null,'friday-rewards');form.append(rewards);
        let rows=offer.rewards.map(r=>({kind:r.kind,id:r.id,amount:r.amount}));
        const preview=node('div',null,'friday-preview');preview.setAttribute('aria-label','Предпросмотр набора');
        const showPreview=()=>{
          preview.replaceChildren(node('h4',name.value||'Название набора'),node('strong','Цена: '+votes.value+' гол.'));
          const list=node('ul');rows.forEach(r=>{const c=data.choices.find(c=>c.kind===r.kind&&c.id===r.id);list.append(node('li',c.name+' × '+Number(r.amount).toLocaleString('ru-RU')));});preview.append(list);
        };
        const drawRewards=()=>{
          rewards.replaceChildren(node('h4','Награды'));
          rows.forEach((r,i)=>{
            const line=node('div',null,'friday-reward'),choice=node('select');choice.setAttribute('aria-label','Награда '+(i+1));
            data.choices.forEach(c=>{const o=node('option',c.name);o.value=c.kind+':'+c.id;choice.append(o);});choice.value=r.kind+':'+r.id;
            const amount=node('input');amount.type='number';amount.min=1;amount.max=10000000;amount.required=true;amount.value=r.amount;amount.setAttribute('aria-label','Количество награды '+(i+1));
            choice.onchange=()=>{[r.kind,r.id]=choice.value.split(':');this.offerDirty=this.dirty=true;showPreview();};
            amount.oninput=()=>{r.amount=Number(amount.value);this.offerDirty=this.dirty=true;showPreview();};
            const remove=button('Убрать',()=>{rows.splice(i,1);this.offerDirty=this.dirty=true;drawRewards();showPreview();});remove.disabled=rows.length===1;
            line.append(choice,amount,remove);rewards.append(line);
          });
          const add=button('+ Награда',()=>{const c=data.choices.find(c=>!rows.some(r=>c.kind===r.kind&&c.id===r.id));if(c){rows.push({kind:c.kind,id:c.id,amount:1});this.offerDirty=this.dirty=true;drawRewards();showPreview();}});add.disabled=rows.length>=data.choices.length;rewards.append(add);
        };
        drawRewards();showPreview();form.append(preview);
        const reason=field(form,'Причина изменения (для журнала)','text','');reason.minLength=3;reason.maxLength=500;
        const save=node('button','Сохранить набор');save.type='submit';form.append(save);
        form.oninput=()=>{this.offerDirty=true;showPreview();};
        form.onsubmit=e=>{e.preventDefault();if(this.scheduleDirty&&!confirm('Расписание тоже изменено. Сохранить только набор и отменить изменения расписания?'))return;
          this.save({action:'offer',offer:{id:offer.id,name:name.value,votes:Number(votes.value),purchaseLimit:Number(limit.value),rewards:rows},reason:reason.value});};
      };
      select.onchange=()=>{if(this.offerDirty&&!confirm('Отменить несохранённые изменения набора?')){select.value=this.selected;return;}this.selected=select.value;draw();};draw();
    }
    renderSchedule(layout,data){
      const panel=node('section',null,'friday-editor'),form=node('form',null,'friday-form');panel.append(node('h3','Расписание и порядок'),form);layout.append(panel);
      const enabled=field(form,'Показывать пятничные акции','checkbox',data.schedule.enabled);
      const timing=node('div',null,'friday-fields');form.append(timing);
      const start=field(timing,'Первая пятница','date',data.schedule.startsOn),time=field(timing,'Начало, МСК','time',data.schedule.startTime),duration=field(timing,'Длительность, часы','number',data.schedule.durationHours,1,168);
      const repeat=field(form,'Повторять цикл после последнего набора','checkbox',data.schedule.repeat);
      form.append(node('p','Один набор в неделю. Стрелки меняют порядок; убранный набор сохраняется в редакторе. Перенос первой пятницы начинает новый отсчёт показов и покупок.','muted'));
      let ids=[...data.schedule.offerIds];const order=node('ol',null,'friday-order');form.append(order);
      const drawOrder=()=>{
        order.replaceChildren();ids.forEach((id,i)=>{
          const row=node('li'),offer=data.offers.find(o=>o.id===id),up=button('↑',()=>move(i,-1)),down=button('↓',()=>move(i,1));
          up.disabled=i===0;down.disabled=i===ids.length-1;up.setAttribute('aria-label','Выше: '+offer.name);down.setAttribute('aria-label','Ниже: '+offer.name);
          row.append(node('span',(i+1)+'. '+offer.name),up,down,button('Убрать',()=>{ids.splice(i,1);this.scheduleDirty=this.dirty=true;drawOrder();}));order.append(row);
        });
        const rest=data.offers.filter(o=>!ids.includes(o.id));
        if(rest.length){const row=node('li'),select=node('select');select.setAttribute('aria-label','Добавить набор в расписание');rest.forEach(o=>{const op=node('option',o.name);op.value=o.id;select.append(op);});row.append(select,button('Добавить',()=>{ids.push(select.value);this.scheduleDirty=this.dirty=true;drawOrder();}));order.append(row);}
      };
      const move=(i,delta)=>{[ids[i],ids[i+delta]]=[ids[i+delta],ids[i]];this.scheduleDirty=this.dirty=true;drawOrder();};drawOrder();
      const reason=field(form,'Причина изменения расписания','text','');reason.minLength=3;reason.maxLength=500;
      const save=node('button','Сохранить расписание');save.type='submit';form.append(save);
      form.oninput=()=>{this.scheduleDirty=true;};form.onchange=()=>{this.scheduleDirty=true;};
      form.onsubmit=e=>{e.preventDefault();if(this.offerDirty&&!confirm('Набор тоже изменён. Сохранить только расписание и отменить изменения набора?'))return;
        this.save({action:'schedule',schedule:{enabled:enabled.checked,startsOn:start.value||null,startTime:time.value,durationHours:Number(duration.value),repeat:repeat.checked,offerIds:ids},reason:reason.value});};
      panel.append(node('h3','Ближайшие показы · МСК'),node('p','По сохранённому расписанию'+(data.schedule.enabled?'':', показ на паузе')+'.','muted'));
      const list=node('ul',null,'friday-upcoming');data.upcoming.forEach(p=>list.append(node('li',date(p.startsAt)+' — '+date(p.endsAt)+' · '+p.name+' · '+p.votes+' гол.')));panel.append(list);
    }
    async save(payload){
      if(this.busy)return;
      const body={...payload,revision:this.data.revision},signature=JSON.stringify(body);
      if(this.pending?.signature!==signature)this.pending={signature,requestId:window.KillexRequestIds.create()};
      const generation=this.generation;this.busy=true;
      const controls=[...this.root.querySelectorAll('input,select,button')].map(n=>[n,n.disabled]);controls.forEach(([n])=>{n.disabled=true;});this.status.textContent='Сохранение…';
      try{const data=await this.api('weekend-promotions',{...body,requestId:this.pending.requestId});if(generation===this.generation){this.pending=null;this.render(data);this.status.textContent='Сохранено. Изменения применены в игре.';}}
      catch(e){if(generation===this.generation)this.status.textContent=e.message;}
      finally{if(generation===this.generation)this.busy=false;controls.forEach(([n,disabled])=>{n.disabled=disabled;});}
    }
  }
  window.KillexWeekendPromotions=WeekendPromotions;
})();

"use strict";
(() => {
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const date=n=>new Date(n).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'});
  const inputDate=n=>new Date(n+3*3600000).toISOString().slice(0,16);
  class ClanSeasons {
    constructor({api}){this.api=api;this.root=document.getElementById('clanSeasonsPanel');this.generation=0;}
    lock(){this.generation++;this.pending=null;this.root.replaceChildren();}
    async load(){const g=this.generation;try{const data=await this.api('clan-seasons');if(g===this.generation)this.render(data);}catch(e){if(g===this.generation)this.root.textContent=e.message;}}
    render(data){
      this.root.replaceChildren(node('h2','Сезоны клановых битв'));
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

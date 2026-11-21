"use strict";
(() => {
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const date=at=>new Date(at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК';
  class FeedbackPanel {
    constructor({api}) {
      this.api=api;this.page=1;this.serial=0;this.active=false;this.deadlineTimer=null;
      const root=document.getElementById('feedbackPanel'),bar=node('div',undefined,'section-title');bar.append(node('h2','Отзывы'));
      this.filter=node('select');this.filter.setAttribute('aria-label','Статус отзывов');
      for(const [value,label] of [['all','Все статусы'],['new','Новое'],['processed','Обработано']]){const o=node('option',label);o.value=value;this.filter.append(o);}
      const refresh=node('button','Обновить');refresh.type='button';refresh.onclick=()=>this.load();this.filter.onchange=()=>{this.page=1;this.load();};bar.append(this.filter,refresh);
      this.message=node('p');this.message.setAttribute('role','status');this.rows=node('div',undefined,'feedback-list');this.detail=node('section',undefined,'card feedback-detail');this.detail.hidden=true;
      const pager=node('div',undefined,'pager');this.previous=node('button','←');this.next=node('button','→');this.counter=node('span');this.previous.setAttribute('aria-label','Предыдущая страница отзывов');this.next.setAttribute('aria-label','Следующая страница отзывов');
      this.previous.onclick=()=>{this.page--;this.load();};this.next.onclick=()=>{this.page++;this.load();};pager.append(this.previous,this.counter,this.next);root.append(bar,this.message,this.rows,pager,this.detail);
    }
    ready(){this.active=true;}
    lock(){this.active=false;this.serial++;clearTimeout(this.deadlineTimer);this.rows.replaceChildren();this.detail.replaceChildren();this.detail.hidden=true;this.message.textContent='';}
    async load(){
      if(!this.active)return;const serial=++this.serial;this.message.textContent='';
      try{const data=await this.api('feedback?status='+this.filter.value+'&page='+this.page);if(!this.active||serial!==this.serial)return;
        this.page=data.page;clearTimeout(this.deadlineTimer);this.rows.replaceChildren();this.counter.textContent=data.page+' / '+data.pages;this.previous.disabled=data.page<=1;this.next.disabled=data.page>=data.pages;
        if(!data.items.length)this.rows.append(node('p','Отзывов пока нет.','muted'));
        for(const ticket of data.items){const b=node('button',undefined,'feedback-row');b.type='button';b.dataset.status=ticket.status;b.dataset.dueAt=ticket.dueAt;
          b.append(node('strong','№ '+ticket.number+' · '+ticket.playerName),node('span',ticket.status==='new'?'Новое':'Обработано','feedback-status'),node('span','Создано: '+date(ticket.createdAt)),node('span','Обработать до: '+date(ticket.dueAt)));
          b.onclick=()=>this.open(ticket.number);this.rows.append(b);
        }
        const receivedAt=performance.now();
        const update=()=>{if(!this.active)return;const now=data.serverNow+performance.now()-receivedAt;let next=Infinity;
          for(const row of this.rows.querySelectorAll('.feedback-row')){const due=Number(row.dataset.dueAt),overdue=row.dataset.status==='new'&&due<=now;row.dataset.overdue=String(overdue);
            if(overdue&&!row.querySelector('.feedback-overdue'))row.append(node('span','Срок обработки истёк','feedback-overdue'));
            if(row.dataset.status==='new'&&due>now)next=Math.min(next,due-now);
          }
          if(Number.isFinite(next))this.deadlineTimer=setTimeout(update,Math.min(2147483647,Math.ceil(next)+1));
        };update();
      }catch(e){if(this.active&&serial===this.serial)this.message.textContent=e.message;}
    }
    async open(number){
      const serial=++this.serial;this.message.textContent='';
      try{const t=await this.api('feedback?number='+number);if(!this.active||serial!==this.serial)return;this.paint(t);}
      catch(e){if(this.active&&serial===this.serial)this.message.textContent=e.message;}
    }
    paint(t){
      const box=this.detail;box.replaceChildren();box.hidden=false;
      const heading=node('div',undefined,'section-title'),close=node('button','Закрыть');close.type='button';close.onclick=()=>{this.serial++;box.hidden=true;};heading.append(node('h3','Отзыв № '+t.number),close);
      const metadata=node('div',undefined,'feedback-metadata');for(const value of ['Заявитель: '+t.playerName,'ID игрока: '+t.playerId,'Создано: '+date(t.createdAt),'Обработать до: '+date(t.dueAt)])metadata.append(node('p',value));
      const text=node('p',t.text,'feedback-text'),form=node('form',undefined,'feedback-status-form'),label=node('label','Статус'),select=node('select'),save=node('button','Сохранить','primary'),notice=node('p');notice.setAttribute('role','status');
      for(const [value,name] of [['new','Новое'],['processed','Обработано']]){const o=node('option',name);o.value=value;select.append(o);}select.value=t.status;label.append(select);save.type='submit';form.append(label,save);
      let request=null;
      form.onsubmit=async event=>{event.preventDefault();if(save.disabled)return;if(!request||request.status!==select.value)request={number:t.number,version:t.version,status:select.value,requestId:window.KillexRequestIds.create()};
        save.disabled=true;select.disabled=true;const serial=this.serial;
        try{const result=await this.api('feedback',request);if(!this.active||serial!==this.serial)return;this.paint(result);this.load();}
        catch(e){if(this.active&&serial===this.serial)notice.textContent=e.message;}
        finally{save.disabled=false;select.disabled=false;}
      };
      box.append(heading,metadata,text);if(t.handledAt)box.append(node('p','Обработал: '+t.handledBy+' · '+date(t.handledAt),'muted'));box.append(form,notice);
    }
  }
  window.KillexFeedbackPanel=FeedbackPanel;
})();

"use strict";
(() => {
 const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const date=n=>new Date(n).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК';
 class JournalPanels {
  constructor({api}) {
   this.api=api;
   this.panels=[['security','Доступ в админку'],['runtime','Доступность игры'],['watchdog','Внешняя проверка сервера']].map(([source,title])=>{
    const root=document.getElementById(source+'Journal'),heading=node('div',undefined,'section-title'),refresh=node('button','Обновить'),list=node('div'),status=node('p','', 'muted'),pager=node('div',undefined,'pager'),prev=node('button','←'),label=node('span','1'),next=node('button','→');
    refresh.type=prev.type=next.type='button';prev.setAttribute('aria-label','Новее: '+title);next.setAttribute('aria-label','Раньше: '+title);status.setAttribute('role','status');list.className='journal-entries';
    heading.append(node('h2',title),refresh);pager.append(prev,label,next);root.append(heading,status,list,pager);
    const p={source,root,refresh,list,status,prev,label,next,page:1,cursor:null,history:[],serial:0};
    refresh.onclick=()=>{p.page=1;p.cursor=null;p.history=[];this.load(p);};
    prev.onclick=()=>{if(p.busy)return;p.page=Math.max(1,p.page-1);if(source!=='security')p.cursor=p.history.pop()??null;this.load(p);};
    next.onclick=()=>{if(p.busy)return;p.page++;if(source!=='security'){p.history.push(p.cursor);p.cursor=p.nextCursor;}this.load(p);};
    prev.disabled=next.disabled=true;return p;
   });
  }
  show(){for(const p of this.panels)this.load(p);}
  lock(){for(const p of this.panels){p.serial++;p.busy=false;p.page=1;p.cursor=null;p.history=[];p.list.replaceChildren();p.status.textContent='';p.prev.disabled=p.next.disabled=true;}}
  async load(p){
   if(p.busy)return;p.busy=true;const serial=++p.serial;p.prev.disabled=p.next.disabled=p.refresh.disabled=true;p.status.textContent='';
   try{
    const result=await this.api(p.source==='security'?'audit?source=security&page='+p.page:'service-journal?source='+p.source+(p.cursor===null?'':'&cursor='+p.cursor));
    if(serial!==p.serial)return;p.list.replaceChildren();
    for(const e of result.entries){
     const row=node('details',undefined,'audit-entry'),summary=node('summary');
     const title=p.source==='security'?e.label:({maintenance:'Технические работы',failure:'Сбой',unavailable:'Недоступность'}[e.mode]||'Проверка')+' · '+(e.kind==='started'?'Начало':'Завершение');
     summary.append(node('strong',title),node('time',date(e.at)));row.append(summary);
     if(p.source==='security'){
      row.append(node('p','Кто: '+(e.actorName||e.actorId)),node('p','Учётная запись: '+(e.targetName||e.targetId)));
      if(e.before?.login)row.append(node('p','Было: '+e.before.name+' · '+e.before.login),node('p','Стало: '+e.after.name+' · '+e.after.login));
      if(e.passwordChanged)row.append(node('p','Пароль изменён.'));
     }
     if(e.reason)row.append(node('p',p.source==='security'?e.reason:window.KillexOwnerMonitoring.reason(e.reason)));
     row.append(node('small','ID записи: '+e.id,'identifier'));p.list.append(row);
    }
    if(!result.entries.length)p.list.append(node('p','Записей пока нет.','muted'));
    if(p.source==='security'){p.page=result.page;p.label.textContent=result.page+' / '+result.pages;p.next.disabled=result.page>=result.pages;p.status.textContent='Записей: '+result.total;}
    else{p.nextCursor=result.cursor;p.next.disabled=result.cursor===null;p.label.textContent='Страница '+p.page;}
    p.prev.disabled=p.page<=1;
   }catch(e){if(serial===p.serial)p.status.textContent=e.message+' Повтори обновление.';}
   finally{if(serial===p.serial){p.busy=false;p.refresh.disabled=false;}}
  }
 }
 window.KillexJournalPanels=JournalPanels;
})();

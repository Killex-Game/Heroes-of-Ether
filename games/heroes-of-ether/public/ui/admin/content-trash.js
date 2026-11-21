"use strict";
(() => {
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const button=(text,fn)=>{const b=el("button",text);b.type="button";b.onclick=fn;return b;};
  class ContentTrash {
    constructor({api,onRestored}) {
      Object.assign(this,{api,onRestored,page:1,generation:0,busy:false,loading:false});
      const root=document.getElementById("trashPanel"),heading=el("div",undefined,"section-title");
      this.refresh=button("Обновить корзину",()=>this.load());heading.append(el("h2","Корзина"),this.refresh);
      this.search=el("input");this.search.type="search";this.search.maxLength=100;this.search.placeholder="Поиск по названию или коду";this.search.setAttribute("aria-label","Поиск в корзине");
      this.filter=el("select");this.filter.setAttribute("aria-label","Тип объекта в корзине");for(const [value,label] of [["all","Все объекты"],["gameNews","Новости"],["promoCodes","Промокоды"]]){const o=el("option",label);o.value=value;this.filter.append(o);}
      const filters=el("form",undefined,"content-toolbar"),find=el("button","Найти");find.type="submit";filters.append(this.search,this.filter,find);filters.onsubmit=e=>{e.preventDefault();this.page=1;this.load();};
      this.status=el("p","","content-status");this.status.setAttribute("role","status");this.list=el("div",undefined,"content-list");this.form=el("form",undefined,"content-editor");this.form.hidden=true;
      this.prev=button("←",()=>{this.page--;this.load();});this.next=button("→",()=>{this.page++;this.load();});this.prev.setAttribute("aria-label","Предыдущая страница корзины");this.next.setAttribute("aria-label","Следующая страница корзины");this.pageLabel=el("span");const pager=el("nav",undefined,"pager");pager.append(this.prev,this.pageLabel,this.next);
      root.append(heading,el("p","Удалённые новости и промокоды. Автоматическая очистка отключена; финансовая история, игроки и журналы сюда не перемещаются.","muted"),filters,this.status,this.list,pager,this.form);
    }
    lock(){this.generation++;this.busy=this.loading=false;this.list.replaceChildren();this.form.replaceChildren();this.form.hidden=true;this.status.textContent="";this.pageLabel.textContent="";this.pending=null;}
    async load(){
      if(this.loading||this.busy)return;const generation=++this.generation;this.loading=true;window.KillexControls.state(this.refresh,true,false);
      try {const data=await this.api("trash?"+new URLSearchParams({page:this.page,q:this.search.value,domain:this.filter.value}));if(generation!==this.generation)return;this.page=data.page;this.list.replaceChildren();
        for(const item of data.items){const row=el("article",undefined,"content-row"),info=el("div");info.append(el("strong",item.code?item.code+" — "+item.title:item.title),el("p",(item.domain==="promoCodes"?"Промокод":"Новость")+" · удалено "+new Date(item.deletedAt).toLocaleString("ru-RU")),el("small",item.description),el("p","Причина: "+item.reason,"muted"));row.append(info,button("Восстановить",()=>this.confirm(item)));this.list.append(row);}
        if(!data.items.length)this.list.append(el("p",data.total?"Нет записей на странице.":"Корзина пуста.","muted"));this.pageLabel.textContent=data.page+" / "+data.pages+" · всего "+data.total;window.KillexControls.state(this.prev,data.page<=1);window.KillexControls.state(this.next,data.page>=data.pages);this.status.textContent="";
      }catch(error){if(generation===this.generation)this.status.textContent=error.message;}finally{if(generation===this.generation){this.loading=false;window.KillexControls.state(this.refresh,false);}}
    }
    confirm(item){
      if(this.busy)return;this.form.hidden=false;this.form.replaceChildren();this.pending=null;
      const label=el("label","Причина восстановления"),reason=el("input");reason.required=true;reason.minLength=3;reason.maxLength=500;reason.value="Восстановление из корзины";reason.id="trash-restore-reason";label.append(reason);
      const submit=el("button","Восстановить объект","primary");submit.type="submit";
      this.form.append(el("h3","Восстановить «"+(item.code||item.title)+"»?"),el("p",item.domain==="promoCodes"?"Вернутся прежние код, состав, сроки, состояние и счётчик активаций. Уже получившие награду игроки не смогут активировать его повторно.":"Вернутся текст, дата, раздел и прежний статус публикации новости."),label,submit,button("Отмена",()=>{if(!this.busy)this.form.hidden=true;}));
      this.form.onsubmit=async e=>{e.preventDefault();if(this.busy)return;const body={trashId:item.id,revision:item.revision,confirmed:true,reason:reason.value},signature=JSON.stringify(body);if(this.pending?.signature!==signature)this.pending={signature,requestId:window.KillexRequestIds.create()};const generation=this.generation;this.busy=true;window.KillexControls.state(submit,true,false);let success=false,queued=false;
        try{const result=await this.api("trash",{...body,requestId:this.pending.requestId});if(generation!==this.generation)return;this.pending=null;this.form.hidden=true;this.onRestored?.();success=true;queued=!!result.queued;}
        catch(error){if(generation===this.generation)this.status.textContent=error.message+" При потере ответа можно повторить тот же запрос.";}
        finally{if(generation===this.generation){this.busy=false;window.KillexControls.state(submit,false);}}
        if(success){await this.load();this.status.textContent=queued?"Восстановление сохранено в редакции и ожидает запуска игры.":"Объект восстановлен. История сохранена.";}
      };reason.focus();
    }
  }
  window.KillexContentTrash=ContentTrash;
})();

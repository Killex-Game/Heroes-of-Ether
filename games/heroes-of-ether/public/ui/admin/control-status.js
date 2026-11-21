"use strict";
(() => {
  const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  class ControlStatus{
    constructor({api}){
      this.api=api;this.root=document.getElementById('controlStatus');this.active=false;
      window.KillexActivity.every(()=>this.refresh(),5000);
      document.addEventListener('visibilitychange',()=>this.refresh());
    }
    ready(role){this.active=role==='owner';this.disabled=false;this.serial=(this.serial||0)+1;if(this.active)this.refresh();}
    lock(){this.formOpen=false;this.signature=null;this.active=false;this.serial=(this.serial||0)+1;this.root.hidden=true;this.root.replaceChildren();}
    async refresh(){
      if(!this.active||this.disabled||this.busy||document.hidden)return;
      this.busy=true;const serial=this.serial;
      try{const state=await this.api('control-status');if(!this.active||serial!==this.serial)return;this.render(state);}
      catch(e){if(e.status===404||e.status===403)this.disabled=true;else if(this.active&&serial===this.serial){this.root.hidden=false;this.root.textContent='Проверяем доступность сервиса управления…';}}
      finally{this.busy=false;}
    }
    render(state){
      const editor=state.editor||{};this.root.hidden=state.gameReady&&!editor.pending&&!editor.error;
      if(this.root.hidden){this.root.replaceChildren();return;}
      // Keep a conflict form intact while typing, including its focus/caret.
      const signature=JSON.stringify(state);if(signature===this.signature)return;
      this.signature=signature;if(this.formOpen)return;
      this.root.replaceChildren(el('strong',state.gameReady?'Редакция':'Игра обновляется — админка доступна'));
      if(editor.pending)this.root.append(el('p','Ожидают применения правки: '+editor.pending+'. Они сохранены отдельно от игрового сервера.'));
      else this.root.append(el('p','Обзор, новости и корзина доступны. Игровые замеры помечены как сохранённые; правки редакции применятся после запуска игры.'));
      if(editor.error){this.root.append(el('p',editor.error));const review=el('button','Проверить ожидающие правки');review.type='button';review.onclick=()=>this.review(state);this.root.append(review);}
    }
    review(state){
      this.formOpen=true;const form=el('form'),list=el('ul');for(const row of state.editor.operations||[])list.append(el('li',row));
      const label=el('label','Причина отмены ожидающих правок'),reason=el('input');reason.required=true;reason.minLength=3;reason.maxLength=500;label.append(reason);
      const submit=el('button','Отменить очередь и загрузить текущие данные');submit.type='submit';
      const cancel=el('button','Закрыть');cancel.type='button';cancel.onclick=()=>{this.formOpen=false;form.remove();this.signature=null;this.refresh();};
      const status=el('p');status.setAttribute('role','status');form.append(list,el('p','В игре эти правки ещё не применены. Их отмена сохранится в журнале редакции.'),label,submit,cancel,status);this.root.append(form);
      form.onsubmit=async e=>{e.preventDefault();submit.disabled=cancel.disabled=true;try{await this.api('control-discard',{confirmed:true,reason:reason.value});this.formOpen=false;this.signature=null;form.remove();await this.refresh();}catch(error){status.textContent=error.message;}finally{submit.disabled=cancel.disabled=false;}};
    }
  }
  window.KillexControlStatus=ControlStatus;
})();

"use strict";
(() => {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const fmt=n=>Number(n).toLocaleString('ru-RU');
  const date=at=>new Date(at).toLocaleString('ru-RU');
  let profile, box;
  const acknowledged=new Set();
  function show(){
    if(box || !profile || document.hidden || document.body.dataset.screen!=='lobby' || window.KillexBoot?.active || document.querySelector('dialog[open],dialog[data-required="true"]'))return;
    const adjustment=profile.administrativeNotices?.find(n=>!acknowledged.has(n.id));
    const n=adjustment||profile.gameGiftNotices?.find(n=>!acknowledged.has(n.id));if(!n)return;const gift=!adjustment;
    const ownerId=profile.id,dialog=el('dialog','social-dialog admin-adjustment-dialog'),header=el('header','personal-heading'),title=el('h2','',gift?(n.title||'Подарок от игры'):'Изменение профиля'),close=el('button','personal-close','×'),body=el('div','social-content'),status=el('p','social-status'),accept=el('button','sf-button sf-primary',gift?'Спасибо!':'Понятно');
    title.id='admin-adjustment-title';dialog.setAttribute('aria-labelledby',title.id);close.type=accept.type='button';close.setAttribute('aria-label','Закрыть');status.setAttribute('role','status');
    header.append(title,close);
    if(gift){
      body.append(el('p','admin-adjustment-reason',n.message));
      const list=el('ul','game-gift-rewards');
      for(const reward of n.rewards){const row=el('li','');if(reward.icon){const icon=el('img','');icon.src=reward.icon;icon.alt='';icon.width=icon.height=48;row.append(icon);}row.append(el('span','',reward.name+' × '+fmt(reward.amount)));list.append(row);}
      body.append(list,accept);
    }else{
    const change=n.action==='account' ? n.days ? n.item+': добавлено '+fmt(n.days)+' дн.' : n.item+': статус отключён' : n.item+': '+(n.amount>0?'добавлено ':'списано ')+fmt(Math.abs(n.amount));
    body.append(el('h3','',change),el('p','', 'Модератор: '+n.actorName),el('p','admin-adjustment-reason','Причина: '+n.reason));
    body.append(el('p','',n.action==='account' ? (n.after ? 'Действует до: '+date(n.after) : 'Прежний срок: '+(n.before?date(n.before):'-')) : 'Было: '+fmt(n.before)+' → Стало: '+fmt(n.after)),accept);
    }
    dialog.append(header,body,status);document.body.append(dialog);box=dialog;
    const requestId=window.KillexRequestIds.create();let busy=false;
    async function read(){
      if(busy)return;busy=true;accept.disabled=close.disabled=true;status.textContent='';
      try{
        const response=await fetch(gift?'/api/profile/game-gifts/read':'/api/profile/admin-notices/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:n.id,requestId}),signal:AbortSignal.timeout(10000)});
        const result=await response.json();if(!response.ok)throw Error(result.error||'Не удалось подтвердить прочтение.');
        if(profile.id===ownerId){acknowledged.add(n.id);document.dispatchEvent(new CustomEvent('killex:profile',{detail:result.profile}));}
        dialog.close();
      }catch(e){status.textContent=e.message+' Повтори ещё раз.';}finally{busy=false;accept.disabled=close.disabled=false;}
    }
    close.onclick=accept.onclick=read;dialog.addEventListener('cancel',e=>{e.preventDefault();read();});
    dialog.addEventListener('close',()=>{dialog.remove();box=null;queueMicrotask(show);},{once:true});window.KillexWindows.open(dialog);
  }
  document.addEventListener('killex:profile',e=>{
    const next=e.detail;if(!next?.id)return;
    if(profile?.id!==next.id){acknowledged.clear();box?.close();}
    if(profile?.id===next.id && next.revision<profile.revision)return;
    profile=next;show();
  });
  document.addEventListener('close',()=>queueMicrotask(show),true);
  document.addEventListener('visibilitychange',show);document.addEventListener('killex:boot-ready',show);
  new MutationObserver(show).observe(document.getElementById('lobby'),{attributes:true,attributeFilter:['hidden']});
})();

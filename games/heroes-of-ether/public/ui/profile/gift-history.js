/* Bounded gift history: one page of forty rows, including anonymous gifts. */
"use strict";
(() => {
  const el = (tag, cls, text) => { const n=document.createElement(tag); n.className=cls||""; if(text!==undefined)n.textContent=text; return n; };
  function open(player, gift) {
    const dialog=el("dialog","social-dialog gift-history-dialog"), header=el("header","personal-heading"),
      title=el("h2","",gift.info.name), close=el("button","personal-close","×"), body=el("div","social-content"),
      list=el("div","gift-history-list"), status=el("p","social-status"), nav=el("nav","social-invitation-pages"),
      previous=el("button","sf-button","‹"), next=el("button","sf-button","›"), counter=el("span");
    title.id="gift-history-"+window.KillexRequestIds.create(); dialog.setAttribute("aria-labelledby",title.id);
    close.type=previous.type=next.type="button"; close.setAttribute("aria-label","Закрыть");
    previous.setAttribute("aria-label","Предыдущие подарки"); next.setAttribute("aria-label","Следующие подарки");
    status.setAttribute("role","status"); nav.setAttribute("aria-label","Страницы подарков");
    header.append(title,close); nav.append(previous,counter,next); body.append(list,status,nav); dialog.append(header,body);
    let abort, generation=0, page=0, nextBefore=null; const cursors=[null];
    const load=async()=>{
      abort?.abort(); abort=new AbortController(); const current=++generation;
      window.KillexControls.state(previous,true);window.KillexControls.state(next,true);status.textContent="";
      const query=new URLSearchParams({playerId:player.id,giftId:gift.id});if(cursors[page]!==null)query.set("before",String(cursors[page]));
      try {
        const response=await fetch("/api/social/gifts?"+query,{signal:abort.signal,cache:"no-store"});const result=await response.json();
        if(!response.ok)throw Error(result.error||"Не удалось загрузить подарки.");if(current!==generation||!dialog.open)return;
        list.replaceChildren();for(const received of result.history){
          const row=el("div","gift-history-row"), image=el("img");image.src=window.KillexArtRevision.url(gift.info.icon);image.alt="";
          const text=el("div");text.append(el("strong","",received.anonymous?"Анонимно":"От "+received.fromName),
            el("small","",new Date(received.at).toLocaleString("ru-RU")));row.append(image,text);list.append(row);
        }
        if(!result.history.length)list.append(el("p","","Подарки больше не отображаются в витрине."));
        nextBefore=result.nextBefore;counter.textContent=String(page+1);status.textContent="";
        window.KillexControls.state(previous,page===0);window.KillexControls.state(next,nextBefore===null);list.scrollTop=0;
      }catch(error){if(error.name!=="AbortError"&&current===generation&&dialog.open){status.replaceChildren(el("span","",error.message));const retry=el("button","sf-button","Повторить");retry.type="button";retry.onclick=load;status.append(retry);}}
    };
    previous.onclick=()=>{if(page>0){page--;load();}};next.onclick=()=>{if(nextBefore!==null){cursors[++page]=nextBefore;load();}};
    close.onclick=()=>dialog.close();dialog.addEventListener("close",()=>{generation++;abort?.abort();dialog.remove();},{once:true});
    document.body.append(dialog);window.KillexWindows.open(dialog);load();
  }
  window.KillexGiftHistory={open};
})();

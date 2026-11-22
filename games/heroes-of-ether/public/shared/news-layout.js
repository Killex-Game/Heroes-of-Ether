(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.KillexNewsLayout=api;})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  'use strict';
  const defaultLayout='banner';
  const layouts=Object.freeze({banner:'Баннер сверху',left:'Картинка слева',right:'Картинка справа',columns:'Газета в две колонки'});
  const banners=Object.freeze({news:'assets/news/v1/news.webp?art=20261122d',event:'assets/news/v1/event.webp?art=20261122d',release:'assets/news/v1/release.webp?art=20261122d'});
  const builtinArt = new Set([...Object.values(banners).map(url=>url.split('?')[0]),
    'assets/events/black-friday/banner-v2.webp','assets/events/easter-hunt/banner.png','assets/events/ether-alchemy/v1/banner-v2.webp']);
  const imageSource = url => typeof url==='string' && builtinArt.has(url.split('?')[0]) ? url.split('?')[0]+'?art=20261122d' : url;
  const day=value=>new Date(value).toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'});
  const date=value=>new Date(value+'T12:00:00Z').toLocaleDateString('ru-RU',{year:'numeric',month:'long',day:'numeric'});
  function sources(releases,event,scheduledEvent){
    const changes=releases.filter(Boolean).map(r=>({id:r.id,sourceId:r.id,category:'release',date:r.date,title:'Что нового в «Героях Эфира»',version:r.version,body:r.changes.map(text=>'• '+text).join('\n\n'),layout:defaultLayout,image:banners.release,visible:true}));
    const events=[[event,false],[scheduledEvent,true]].filter(([e])=>e).map(([e,future])=>{
      const friday=e.contentPack==='black-friday-v1',easter=e.contentPack==='easter-hunt-v1',alchemy=e.contentPack==='ether-alchemy-v1';
      const details=friday?'Лавка Мани ждёт помощников. Выполняй заказы на арене, собирай жетоны и выбирай подарки в лавке. Каждый день доступны 12 заказов.\n\nЗа 50 выполненных заказов можно получить регалию и уникальную картину для Альбома. Загляни в книгу заказов: там указаны условия и награды каждого поручения.':e.description||'Открой раздел события, чтобы узнать условия участия и посмотреть награды.';
      return {id:'event:'+e.runId,sourceId:'event:'+e.runId,runId:e.runId,category:'event',date:day(e.startsAt),title:e.title||e.name||'Событие в игре',future,visible:true,layout:defaultLayout,image:friday?'assets/events/black-friday/banner-v2.webp?art=20261122d':easter?'assets/events/easter-hunt/banner.png?art=20261122-zaya':alchemy?'assets/events/ether-alchemy/v1/banner-v2.webp?art=20261122d':banners.event,caption:future?'Скоро в Эфире':'',
        action:future?null:friday?['В Лавку Мани','blackFridayButton']:easter?['К событию','eventsSection']:alchemy?['В лабораторию','alchemyButton']:e.features?.roulette?['К рулетке','rouletteButton']:['К событию','eventsSection'],
        body:(future?'Начало: '+date(day(e.startsAt))+'\n\n':'')+details+(e.endsAt?'\n\nЗавершение события: '+date(day(e.endsAt)):'')};
    });return [...changes,...events];
  }
  const releaseIds=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
  function articleOrder(a,b){
    const dated=b.date.localeCompare(a.date),category=a.category.localeCompare(b.category);
    if(dated||category)return dated||category;
    // Several releases may share one date. Keep their numeric versions newest
    // first, including an editor override whose own ID is an unrelated UUID.
    return (a.category==='release'?releaseIds.compare(b.sourceId||b.id,a.sourceId||a.id):0)||a.id.localeCompare(b.id);
  }
  function merge(base,custom,admin=false){const rows=new Map(base.map(x=>[x.id,x]));for(const n of custom){const key=n.sourceId||n.id;rows.set(key,{...rows.get(key),...n,image:n.image||rows.get(key)?.image||banners[n.category]});}return [...rows.values()].filter(x=>admin||x.visible!==false).sort(articleOrder);}
  function paint(article,item){article.replaceChildren();article.dataset.layout=item.layout||defaultLayout;
    const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
    const figure=el('figure','news-event-figure'),image=el('img','');image.src=imageSource(item.image||banners[item.category]);image.alt='';image.width=1200;image.height=600;figure.append(image);if(item.caption && item.caption!=='Событие в разгаре')figure.append(el('figcaption','',item.caption));
    const stamp=el('time','news-date',date(item.date));stamp.dateTime=item.date;const copy=el('div','news-copy');for(const p of item.body.split(/\n\s*\n/))copy.append(el('p','',p));article.append(figure,stamp,el('h3','',item.title),copy);
  }
  return {defaultLayout,layouts,banners,sources,merge,paint,imageSource};
});

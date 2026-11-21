"use strict";
(() => {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const num=n=>Number(n||0).toLocaleString('ru-RU');
  const descriptions={xp:'Получить опыт на арене',food:'Собрать частицы еды',absorbedMass:'Поглотить массу соперников',hazards:'Поглотить колючки',kills:'Поглотить соперников',hazardHits:'Попасть колючкой в соперников',splitParts:'Разделить соперников на части',freezeHits:'Заморозить соперников',hookHits:'Притянуть соперников крюком',gifts:'Подарить подарки или усилители',poisonHits:'Отравить соперников',commonUses:'Использовать обычные бустеры',advancedUses:'Использовать улучшенные бустеры',rareUses:'Использовать редкие бустеры',shieldUses:'Использовать щиты',boosterUses:'Использовать бустеры',arenaMs:'Провести время на арене',top10Ms:'Провести время в топ-10 арены',top1Ms:'Провести время на первом месте арены'};
  const rewardName=r=>r.kind==='clanChest'?window.KillexClanRules.CHESTS[r.tier].name:({coins:'Монеты',crystals:'Кристаллы',bucks:'Эфир'})[r.kind];
  function panel(state){
    const root=el('section','clan-panel clan-daily-panel'), data=state.dailyQuests;
    root.append(el('h3','','Клановые задания'));
    if(!data?.active&&!data?.resultsVisible){root.append(el('p','clan-daily-wait','Задания обновляются...'));return root;}
    root.dataset.clanQuestUntil=String(data.resultsUntil||data.end+7200000);
    const time=el('p','clan-daily-deadline');
    if(data.active)time.dataset.clanQuestEnd=String(data.end);
    if(Number.isFinite(data.serverNow)) {
      time.dataset.clanQuestClock=String(data.serverNow);
      time.dataset.clanQuestReceived=String(performance.now());
      root.dataset.clanQuestClock=time.dataset.clanQuestClock;
      root.dataset.clanQuestReceived=time.dataset.clanQuestReceived;
    }
    time.setAttribute('role','timer');time.setAttribute('aria-live','off');
    if(data.active)time.append(el('span','clan-daily-clock-label','До окончания'),el('strong','clan-daily-clock-value'));
    else {time.classList.add('is-finished');time.append(el('strong','clan-daily-clock-value',data.settled?'Итоги дня':'Подводим итоги…'));}
    root.append(time);
    updateCountdown(root);
    for(const q of data.quests){
      const row=el('article','clan-daily-row'); if(q.completedAt!==null) row.classList.add('completed');
      const text=el('div','clan-daily-copy');text.append(el('h4','',q.name),el('p','',window.KillexClanQuestDescriptions?.[q.id]||q.description||descriptions[q.metric]||q.name));
      const bar=el('div','clan-daily-bar');bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',q.name);bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax',String(q.target));bar.setAttribute('aria-valuenow',String(q.progress));
      const fill=el('i');fill.style.width=Math.min(100,q.progress/q.target*100)+'%';bar.append(fill);
      const unit=q.metric.endsWith('Ms')?60000:1;
      const meta=el('div','clan-daily-progress-meta'),greatness=el('span','clan-daily-greatness');
      const bonus=q.greatness??(q.metric==='xp'?15:q.metric==='kills'?10:5);
      greatness.title=`Величие: +${num(bonus)}`;greatness.setAttribute('aria-label',greatness.title);
      const medal=el('img');medal.src='assets/menu-icons/128/nav_achievements.webp';medal.alt='';
      greatness.append(medal,el('span','',`+${num(bonus)}`));
      meta.append(greatness,el('span','clan-daily-value',`${num(Math.floor(q.progress/unit))} / ${num(q.target/unit)}${unit===60000?' мин.':''}`));text.append(bar,meta);
      const reward=el('div','clan-daily-reward');reward.title=rewardName(q.reward)+' × '+num(q.reward.amount);
      const image=el('img');image.alt=rewardName(q.reward);image.src=q.reward.kind==='clanChest'?window.KillexProgressionArt.clanChest(q.reward.tier):`assets/menu-icons/128/currency_${q.reward.kind}.webp`;
      reward.append(image,el('strong','',num(q.reward.amount)));row.append(text,reward);root.append(row);
    }
    return root;
  }
  function ranking(state,clan,owner){
    owner.questRankingCleanup?.();
    const root=el('section','clan-panel clan-daily-ranking');root.append(el('h3','','Лидеры по заданиям'));
    const rows=state.dailyRanking||[], list=el('div','clan-daily-ranking-list');
    let pageSize=owner.questRankingPageSize||10, pages=1, stopped=false;
    const controls=el('div','clan-daily-pager'), pageLabel=el('span'), buttons=[];
    for(const [label,step] of [['‹',-1],['›',1]]){
      const b=el('button','sf-button sf-tertiary',label);b.type='button';b.setAttribute('aria-label',step<0?'Предыдущая страница':'Следующая страница');
      b.onclick=()=>{owner.questRankingPage+=step;paint();};controls.append(b);buttons.push(b);
      if(step<0)controls.append(pageLabel);
    }
    function paint(){
      pages=Math.max(1,Math.ceil(rows.length/pageSize));
      owner.questRankingPage=Math.max(1,Math.min(pages,owner.questRankingPage||1));
      owner.questRankingPageSize=pageSize;
      const items=rows.slice((owner.questRankingPage-1)*pageSize,owner.questRankingPage*pageSize).map(r=>{
        const row=el('button','clan-daily-rank');row.type='button';
        row.setAttribute('aria-label',`Посмотреть клан [${r.prefix}] ${r.name}`);
        row.title=`[${r.prefix}] ${r.name}`;
        row.onclick=()=>owner.openClan(r.id);if(r.id===clan.id)row.classList.add('own');
        row.append(el('b','',r.rank),el('span','',row.title),el('strong','',num(r.completed)));return row;
      });
      list.replaceChildren(...items);
      buttons[0].disabled=owner.questRankingPage===1;buttons[1].disabled=owner.questRankingPage===pages;
      pageLabel.textContent=`${owner.questRankingPage} / ${pages}`;
    }
    function fit(){
      if(stopped || !root.isConnected || !list.clientHeight)return;
      const rowHeight=parseFloat(getComputedStyle(list).getPropertyValue('--clan-rank-row-height'))||44;
      const capacity=Math.max(1,Math.floor(list.clientHeight/rowHeight));
      if(capacity===pageSize)return;
      const first=(owner.questRankingPage-1)*pageSize;
      pageSize=capacity;owner.questRankingPage=Math.floor(first/pageSize)+1;paint();
    }
    root.append(list,controls);paint();
    // Measure only when this visible panel changes size, never on the game tick.
    const observer=new ResizeObserver(fit);observer.observe(list);
    owner.questRankingCleanup=()=>{stopped=true;observer.disconnect();};
    return root;
  }
  function updateCountdown(container,now) {
    const currentTime=node=>Number.isFinite(now)?now:node.dataset.clanQuestClock!==undefined
      ? Number(node.dataset.clanQuestClock)+performance.now()-Number(node.dataset.clanQuestReceived):Date.now();
    const panels=[...(container?.matches?.('[data-clan-quest-until]')?[container]:[]),...(container?.querySelectorAll('[data-clan-quest-until]')||[])];
    for(const panel of panels)if(currentTime(panel)>=Number(panel.dataset.clanQuestUntil)){
      panel.replaceChildren(el('h3','','Клановые задания'),el('p','clan-daily-wait','Задания обновляются...'));
      delete panel.dataset.clanQuestUntil;
    }
    for(const node of container?.querySelectorAll('[data-clan-quest-end]')||[]) {
      const current=currentTime(node);
      const seconds=Math.max(0,Math.ceil((Number(node.dataset.clanQuestEnd)-current)/1000));
      const value=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60]
        .map(n=>String(n).padStart(2,'0')).join(':');
      const label=node.querySelector('.clan-daily-clock-label'), clock=node.querySelector('.clan-daily-clock-value');
      if(label)label.hidden=!seconds;
      const text=seconds?value:'Подводим итоги…';
      if(clock && clock.textContent!==text)clock.textContent=text;
      node.classList.toggle('is-finished',!seconds);
    }
  }
  window.KillexClanDailyQuests={panel,ranking,updateCountdown};
})();

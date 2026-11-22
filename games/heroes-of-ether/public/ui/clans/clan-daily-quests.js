"use strict";
(() => {
  const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
  const calendar=window.KillexClanCalendar;
  const waitText=at=>'Новые задания появятся '+new Date(at).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'.';
  function info(state) {
    let dialog=document.getElementById('clanQuestSeasonInfo');
    if(!dialog){dialog=el('dialog','clan-dialog clan-league-info clan-quest-season-info');dialog.id='clanQuestSeasonInfo';document.body.append(dialog);}
    const head=el('header','clan-heading'),close=el('button','booster-close','×');close.type='button';close.setAttribute('aria-label','Закрыть');close.onclick=()=>dialog.close();
    head.append(el('h2','','Сезон клановых заданий'),close);
    const now=state?.dailyQuests?.serverNow??window.KillexAppearance?.now?.()??Date.now(),season=state?.calendarSeason??calendar.season(now);
    const text=el('p','','Сезон длится 2 месяца. Клановые битвы проходят в январе–феврале, мае–июне и сентябре–октябре; задания — в марте–апреле, июле–августе и ноябре–декабре.');
    const hours=el('p','','Задания доступны ежедневно '+calendar.localRange(now)+'. На выполнение — 13 часов. Итоги дня видны ещё 2 часа. Все часы показаны по твоему местному времени.');
    const total=el('p','','Каждое полностью выполненное задание даёт 1 очко в рейтинг сезона. При равенстве выше клан, раньше достигший результата; затем сравниваются уровень и постоянный номер клана.');
    const payout=el('p','','Медаль и валютный приз выдаются один раз в конце сезона всем участникам клана на момент подведения итогов. Для награды нужно выполнить хотя бы 1 задание и занять призовое место. Статусы не увеличивают эти призы.');
    const list=el('div','clan-quest-prize-list');
    for(const p of calendar.QUEST_PRIZES){const row=el('article','clan-quest-prize');row.dataset.tier=p.id;const image=el('img');image.src=window.KillexProgressionArt.leagueMedal(p.id,128);image.alt='';const copy=el('div');copy.append(el('h3','',p.from+'–'+p.to+' места · '+p.name+' медаль'),el('p','',p.reward.bucks+' эфира · '+num(p.reward.coins)+' монет · '+p.reward.crystals+' кристаллов каждому участнику'));row.append(image,copy);list.append(row);}
    dialog.replaceChildren(head,text,hours,total,payout,el('p','','Текущий сезон: '+calendar.localDate(season.start)+' — '+calendar.localDate(season.end-1)),list);
    window.KillexWindows.open(dialog);
  }
  const num=n=>Number(n||0).toLocaleString('ru-RU');
  const descriptions={xp:'Получить опыт на арене',food:'Собрать частицы еды',absorbedMass:'Поглотить массу соперников',hazards:'Поглотить колючки',kills:'Поглотить соперников',hazardHits:'Попасть колючкой в соперников',splitParts:'Разделить соперников на части',freezeHits:'Заморозить соперников',hookHits:'Притянуть соперников крюком',gifts:'Подарить подарки или усилители',poisonHits:'Отравить соперников',commonUses:'Использовать обычные бустеры',advancedUses:'Использовать улучшенные бустеры',rareUses:'Использовать редкие бустеры',shieldUses:'Использовать щиты',boosterUses:'Использовать бустеры',arenaMs:'Провести время на арене',top10Ms:'Провести время в топ-10 арены',top1Ms:'Провести время на первом месте арены'};
  const rewardName=r=>r.kind==='clanChest'?window.KillexClanRules.CHESTS[r.tier].name:({coins:'Монеты',crystals:'Кристаллы',bucks:'Эфир'})[r.kind];
  function panel(state){
    const root=el('section','clan-panel clan-daily-panel'), data=state.dailyQuests;
    root.append(el('h3','','Клановые задания'));
    if(!data?.active&&!data?.resultsVisible){root.append(el('p','clan-daily-wait',waitText(data?.nextStart??calendar.daily(Date.now()).nextStart)));return root;}
    root.dataset.clanQuestNext=String(data.nextStart);
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
    else {time.classList.add('is-finished');time.append(el('strong','clan-daily-clock-value',data.settled?'Итоги дня':'Задания завершены'));}
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
      const medal=el('img');medal.src='assets/menu-icons/128/nav_achievements.webp?art=20261122b';medal.alt='';
      greatness.append(medal,el('span','',`+${num(bonus)}`));
      meta.append(greatness,el('span','clan-daily-value',`${num(Math.floor(q.progress/unit))} / ${num(q.target/unit)}${unit===60000?' мин.':''}`));text.append(bar,meta);
      const reward=el('div','clan-daily-reward');reward.title=rewardName(q.reward)+' × '+num(q.reward.amount);
      const image=el('img');image.alt=rewardName(q.reward);image.src=q.reward.kind==='clanChest'?window.KillexProgressionArt.clanChest(q.reward.tier):`assets/menu-icons/128/currency_${q.reward.kind}.webp?art=20261122b`;
      reward.append(image,el('strong','',num(q.reward.amount)));row.append(text,reward);root.append(row);
    }
    return root;
  }
  function ranking(state,clan,owner){
    owner.questRankingCleanup?.();
    const root=el('section','clan-panel clan-daily-ranking'),head=el('div','clan-quest-ranking-heading'),help=el('button','sf-button sf-tertiary','Награды');help.type='button';help.onclick=()=>info(state);head.append(el('h3','','Лидеры по заданиям'),help);root.append(head);
    if(state.calendarSeason)root.append(el('p','clan-quest-season-dates',calendar.localDate(state.calendarSeason.start)+' — '+calendar.localDate(state.calendarSeason.end-1)));
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
        const row=el('button','clan-daily-rank');row.type='button';if(r.prize)row.dataset.tier=r.prize;
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
      panel.replaceChildren(el('h3','','Клановые задания'),el('p','clan-daily-wait',waitText(Number(panel.dataset.clanQuestNext)||calendar.daily(currentTime(panel)).nextStart)));
      delete panel.dataset.clanQuestUntil;
    }
    for(const node of container?.querySelectorAll('[data-clan-quest-end]')||[]) {
      const current=currentTime(node);
      const seconds=Math.max(0,Math.ceil((Number(node.dataset.clanQuestEnd)-current)/1000));
      const value=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60]
        .map(n=>String(n).padStart(2,'0')).join(':');
      const label=node.querySelector('.clan-daily-clock-label'), clock=node.querySelector('.clan-daily-clock-value');
      if(label)label.hidden=!seconds;
      const text=seconds?value:'Задания завершены';
      if(clock && clock.textContent!==text)clock.textContent=text;
      node.classList.toggle('is-finished',!seconds);
    }
  }
  window.KillexClanDailyQuests={panel,ranking,updateCountdown,info};
})();

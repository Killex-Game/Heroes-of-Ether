"use strict";
(() => {
  const $ = id => document.getElementById(id), fmt = n => Number(n).toLocaleString('ru-RU');
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, click) => { const b = el('button', text); b.type = 'button'; b.onclick = click; return b; };
  const stamp = at => new Date(at).toLocaleString('ru-RU');
  class PlayerTabs {
    constructor({ api, selectPlayer }) {
      Object.assign(this, { api, selectPlayer, active: false, view: 'settings', serial: 0, page: 1, historyPage: 1 });
      this.buttons = new Map();
      for (const [id, name] of [['settings','Настройка игроков'], ['online','Онлайн'], ['violators','Игроки нарушители'], ['grants','Начисления'], ['registrations','Регистрации'], ['kill','Kill']]) {
        const b = button(name, () => this.select(id)); b.dataset.playerTab = id; this.buttons.set(id, b); $('playerTabs').append(b);
      }
      this.buildDirectory(); this.buildGrants(); this.paint();
    }
    ready(role) { this.active = true; this.role = role; this.buttons.get('grants').hidden = role !== 'owner'; if (role !== 'owner' && this.view === 'grants') this.view = 'settings'; this.paint(); }
    killCount(count) {
      const n = Number.isSafeInteger(count) && count > 0 ? count : 0, b = this.buttons.get('kill');
      b.textContent = n ? 'Kill: ' + fmt(n) : 'Kill';
      b.dataset.pending = String(n > 0);
      b.setAttribute('aria-label', n ? 'Kill: новых проверок ' + fmt(n) : 'Kill');
    }
    reviewPlayer(id) { this.page = 1; this.query.value = id; this.select('kill'); }
    lock() { this.active = false; this.serial++; this.view = 'settings'; this.preview = null; this.pending = null; this.catalog = null; this.history.replaceChildren(); this.rows.replaceChildren(); this.giftForm.reset(); this.rewardRows.replaceChildren(); this.previewBox.replaceChildren(); this.paint(); }
    paint() {
      $('playerSettings').hidden = this.view !== 'settings'; $('playerDirectory').hidden = !['online','violators','registrations','kill'].includes(this.view); $('gameGrants').hidden = this.view !== 'grants';
      this.handbook.hidden = this.view !== 'violators';
      for (const [id, b] of this.buttons) b.setAttribute('aria-pressed', String(id === this.view));
    }
    select(id) {
      if (!this.buttons.has(id) || (id === 'grants' && this.role !== 'owner')) return;
      if (this.view !== id) { this.serial++; this.page = 1; this.configureSort(id); }
      this.view = id; this.paint(); this.open();
    }
    open() { if (!this.active) return; if (this.view === 'grants') this.loadGrants(); else if (this.view !== 'settings') this.loadDirectory(); }
    buildDirectory() {
      const panel = $('playerDirectory'); this.heading = el('h2'); this.hint = el('p', '', 'muted');
      this.handbook = window.KillexModerationCatalog.createHandbook();
      const form = el('form', undefined, 'player-directory-filters');
      const search = el('label', 'Поиск по нику или ID'), sort = el('label', 'Сортировка');
      this.query = el('input'); this.query.maxLength = 64; this.query.placeholder = 'Ник или ID'; search.append(this.query);
      this.sort = el('select'); this.sort.setAttribute('aria-label','Сортировка'); this.configureSort(this.view);
      sort.append(this.sort); const refresh = el('button', 'Показать'); refresh.type = 'submit'; form.append(search, sort, refresh);
      form.onsubmit = e => { e.preventDefault(); this.page = 1; this.loadDirectory(); }; this.sort.onchange = () => { this.page = 1; this.loadDirectory(); };
      this.rows = el('div', undefined, 'player-directory-rows'); this.directoryStatus = el('p', '', 'muted'); this.directoryStatus.setAttribute('role','status');
      this.previous = button('←', () => { this.page--; this.loadDirectory(); }); this.next = button('→', () => { this.page++; this.loadDirectory(); });
      this.previous.setAttribute('aria-label','Предыдущая страница'); this.next.setAttribute('aria-label','Следующая страница'); this.pageText = el('span');
      const pager = el('div', undefined, 'pager'); pager.append(this.previous, this.pageText, this.next); panel.append(this.heading, this.hint, this.handbook, form, this.rows, this.directoryStatus, pager);
    }
    configureSort(view) {
      const choices = [['name:asc','Ник: А–Я'],['name:desc','Ник: Я–А'],['level:desc','Уровень: по убыванию'],['level:asc','Уровень: по возрастанию']];
      if (view === 'registrations') choices.unshift(['registeredAt:desc','Сначала новые'],['registeredAt:asc','Сначала старые']);
      this.sort.replaceChildren();
      for (const [value, label] of choices) { const o = el('option', label); o.value = value; this.sort.append(o); }
    }
    async loadDirectory() {
      if (!this.active || !['online','violators','registrations','kill'].includes(this.view)) return;
      const serial = ++this.serial, view = this.view, [sort, order] = this.sort.value.split(':');
      this.heading.textContent = view === 'registrations' ? 'Регистрации' : view === 'online' ? 'Игроки онлайн' : 'Игроки нарушители';
      this.hint.textContent = view === 'registrations' ? 'Реальные аккаунты. Время: МСК. Для старых аккаунтов дата восстановлена по первым сохранениям.' : view === 'online' ? 'Реальные игроки в лобби и на арене.' : 'Действующие страйки, ограничения чата и блокировки.';
      if(view==='kill'){this.heading.textContent='Kill: проверка подозрений';this.hint.textContent='Ритм команд и серии отправки подарков служат поводом для проверки, а не доказательством. Отклоняйте случаи, вызванные задержками сети или обычной игрой. Подтверждение скрипта блокирует аккаунт на 180 дней по п. 3.2.';}
      this.rows.replaceChildren();
      this.directoryStatus.textContent = '';
      try {
        const result = await this.api('players?' + new URLSearchParams({view,sort,order,q:this.query.value,page:this.page}));
        if (!this.active || serial !== this.serial) return;
        this.killCount(result.killPending);
        this.page = result.page; this.rows.replaceChildren();
        for (const p of result.players) {
          if(view==='kill'){this.rows.append(this.killRow(p,serial));continue;}
          const row = button('', () => this.selectPlayer(p.id)); row.className = 'player-directory-row';
          row.append(el('strong',p.name));
          if(p.killReview?.status==='new')row.append(el('span','Kill: На проверке','kill-review-badge'));
          if (view === 'registrations') {
            const date = el('time', p.registeredAt == null ? 'Дата не сохранена' : stamp(p.registeredAt));
            if (p.registeredAt != null) date.dateTime = new Date(p.registeredAt).toISOString();
            row.append(date, el('span','Уровень '+fmt(p.level)));
          } else row.append(el('span','Уровень '+fmt(p.level)), el('span',p.inArena?'На арене':p.online?'В лобби':'Не в сети'));
          if (view === 'violators') {
            const m = p.chatModeration, summary = el('span', [
              m.flood.strikes ? 'Флуд: '+m.flood.strikes+': п. 2.1' : '',
              m.profanity.strikes ? 'Мат: '+m.profanity.strikes+': п. 2.2' : '',
              m.mute ? 'Чат ограничен до '+stamp(m.mute.until) : '',
            ].filter(Boolean).join(': '));
            summary.className = 'player-violation-summary';
            if (p.ban) {
              const rule = window.KillexModerationCatalog.forReason(p.ban.reason);
              summary.append(el('strong', 'Блокировка: '+(rule ? rule.name+': п. '+rule.id : 'Причина указана вручную')),
                el('span', p.ban.until === null ? 'Бессрочно' : 'До '+stamp(p.ban.until)), el('span', p.ban.reason));
            }
            row.append(summary);
          }
          this.rows.append(row);
        }
        if (!result.players.length) this.rows.append(el('p',view === 'kill' && !this.query.value.trim() ? 'Система Kill пока не зарегистрировала подозрительных случаев.' : 'Игроки не найдены.'));
        this.previous.disabled = result.page <= 1; this.next.disabled = result.page >= result.pages;
        this.pageText.textContent = result.page+' / '+result.pages; this.directoryStatus.textContent = 'Всего: '+fmt(result.total)+': Обновлено: '+stamp(result.capturedAt);
      } catch (error) { if (this.active && serial === this.serial) this.directoryStatus.textContent = error.message; }
    }
    killRow(p,serial) {
      const c=p.kill,row=el('article',undefined,'player-directory-row');row.dataset.killCase=c.id;
      row.append(button(p.name,()=>this.selectPlayer(p.id)),el('strong',c.status==='new'?'На проверке':c.status==='confirmed'?'Скрипт подтверждён':'Подозрение отклонено'),el('time',stamp(c.createdAt)));
      const details=el('div',undefined,'player-violation-summary');
      details.append(el('span','ID игрока: '+p.id));
      if(c.reason==='owner-reported-automation'){
        const e=c.ownerEvidence, names={'clan-deposit':'Взносы в клан','roulette':'Запуски рулетки','booster-purchase':'Покупки бустеров','gift-send':'Отправки подарков'};
        details.append(el('strong','Подтверждено владельцем'),el('span',e.summary));
        for(const o of e.observations)details.append(el('span',names[o.kind]+': '+o.count+', '+stamp(o.start)+' по '+stamp(o.end)+', медианный интервал '+o.medianIntervalMs+' мс'));
        details.append(el('span','Ручная отметка сохранена для Kill. Это отдельный пример поведения в лобби, он не обучает модель нажатий на бустеры. Блокировка оформляется отдельным решением.'),el('span','Контрольная сумма источника: '+e.sourceSha256));
      }
      if(c.reason==='gift-dispatch-pattern'){
        const g=c.giftEvidence;
        details.append(el('strong','Ночная рассылка подарков'),
          el('span',stamp(g.start)+' по '+stamp(g.end)),
          el('span',g.count+' подарков, получателей '+g.recipients),
          el('span','Серия без пауз более 10 секунд: '+g.longestSeries+' подарков'),
          el('span','Медианный интервал '+g.medianIntervalMs+' мс, максимум за минуту '+g.peakPerMinute),
          el('span','Материалы для обучения после ручной проверки. Автоматизация пока не подтверждена. Это отдельный тип примеров, он не обучает модель нажатий на бустеры.'),
          el('span','Контрольная сумма источника: '+g.sourceSha256));
      }
      if(c.reason==='lobby-repeated-actions'){
        const e=c.lobbyEvidence,names={'gift-send':'Отправки подарков','clan-deposit':'Взносы в клан','roulette':'Запуски рулетки','booster-purchase':'Покупки бустеров','currency-purchase':'Покупки валюты','currency-purchase-attempt':'Команды покупки валюты'};
        details.append(el('strong','Подозрение на автоматизацию: '+names[e.kind]),
          el('span',e.kind==='currency-purchase-attempt'?'Пять продолжительных серий разных команд покупки, включая отказы по суточному лимиту. Повторы известных номеров исключены.':'Пять продолжительных серий успешных действий. Повторы запросов и отказы не учитываются.'),
          el('span','Kill включён по сигналу: '+(e.trigger.kind==='rapid-commands'?'высокая скорость команд':'длинная серия повторений')+'. Это основание для проверки, а не доказательство читов.'));
        for(const w of e.samples)details.append(el('span',stamp(w.start)+' по '+stamp(w.end)+': '+w.count+' действий, медианный интервал '+w.medianIntervalMs+' мс, близкие интервалы '+Math.round(w.regularFraction*100)+'%'));
        details.append(el('span',e.modelReady?'Отдельная модель этого вида действий использует рассмотренные примеры. Оценка не назначает наказание.':'Сработало правило похожих повторяющихся серий. Для обучения отдельной модели ещё недостаточно подтверждённых и отклонённых примеров.'));
      }
      if(c.reason==='arena-repeated-patterns'){
        const e=c.patternEvidence;
        details.append(el('strong',e.kind==='manual-cadence'?'Повторяющийся ритм команд':'Повторяющийся маршрут'));
        if(e.kind==='manual-cadence'){
          details.append(el('span','Команда: '+e.command));
          for(const w of e.samples)details.append(el('span',stamp(w.start)+' — '+stamp(w.end)+': '+w.count+' команд; интервал '+w.medianIntervalMs+' мс ±'+w.toleranceMs+' мс; совпадение '+Math.round(w.regularFraction*100)+'%.'));
        }else details.append(el('span',stamp(e.start)+' — '+stamp(e.end)+': '+e.cycles+' повторения маршрута по '+e.pointsPerCycle+' точкам; цикл '+e.cycleMs+' мс; совпадение ритма '+Math.round(e.regularFraction*100)+'%.'));
        details.append(el('span','Это повод для проверки, а не доказательство автоматизации. Записаны входящие команды, успешное применение проверяется отдельно. Штатные таймеры движения, W и удержания кормящих бустеров не считаются кликером. Автоматической блокировки по этому сигналу нет.'));
      }
      for(const w of c.windows)details.append(el('span',`${Math.round((w.end-w.start)/1000)} с: ${w.count} команд, ${w.kinds} видов бустеров, ${w.rate}/с; короткие интервалы ${Math.round(w.shortFraction*100)}%.`));
      if(!['gift-dispatch-pattern','owner-reported-automation','lobby-repeated-actions','arena-repeated-patterns'].includes(c.reason))details.append(el('span',c.modelReady?'Сигнал локальной модели и серверной телеметрии. Оценка не является доказательством.':'Сбор обучающих примеров. Локальная модель ещё не обучена.'));
      if(c.status!=='new'){details.append(el('p',c.reviewReason));row.append(details);return row;}
      const reason=el('textarea');reason.maxLength=500;reason.rows=2;reason.placeholder='Основание решения: что проверено';reason.setAttribute('aria-label','Основание решения Kill');
      const result=el('p');result.setAttribute('role','status');let pending=null,busy=false;
      const controls=el('div',undefined,'actions');
      const send=async verdict=>{
        if(busy||!this.active||this.serial!==serial)return;
        if(reason.value.trim().length<3){result.textContent='Укажи основание решения.';return;}
        if(!pending||pending.verdict!==verdict||pending.reason!==reason.value.trim())pending={action:'killReview',targetId:p.id,revision:p.revision,moderationRevision:p.moderationRevision,caseId:c.id,verdict,reason:reason.value.trim(),requestId:window.KillexRequestIds.create()};
        busy=true;for(const b of controls.querySelectorAll('button'))b.disabled=true;
        try{await this.api('action',pending);if(this.active&&this.serial===serial)this.loadDirectory();}
        catch(e){if(this.active&&this.serial===serial)result.textContent=e.message;}
        finally{busy=false;for(const b of controls.querySelectorAll('button'))b.disabled=false;}
      };
      const confirmation=el('div');confirmation.hidden=true;confirmation.append(el('p','Подтверждено использование скрипта? Аккаунт будет заблокирован на 180 дней.'),button('Подтвердить блокировку',()=>send('confirmed')),button('Отмена',()=>{confirmation.hidden=true;}));
      controls.append(button('Отклонить подозрение',()=>send('dismissed')),button('Подтвердить скрипт…',()=>{confirmation.hidden=false;}),confirmation);
      details.append(reason,controls,result);row.append(details);return row;
    }
    buildGrants() {
      const panel = $('gameGrants'); panel.append(el('h2','Подарок от игры'),el('p','Всем реальным игрокам, включая офлайн. Тестовые боты не получают подарки.','muted'));
      this.giftForm = el('form', undefined, 'game-grant-form');
      const field = (label, tag, limit) => { const l=el('label',label), n=el(tag); n.required=true;n.maxLength=limit;l.append(n);this.giftForm.append(l);return n; };
      this.title = field('Название подарка','input',100); this.message = field('Сообщение игрокам','textarea',500);this.message.minLength=3;this.message.rows=2;
      this.rewardRows = el('div',undefined,'promo-reward-rows'); this.giftForm.append(this.rewardRows,button('Добавить награду',()=>this.addReward()));
      const review = el('button','Предпросмотр','primary');review.type='submit';this.review=review;this.giftForm.append(review);
      this.previewBox = el('div',undefined,'game-grant-preview'); this.giftStatus=el('p');this.giftStatus.setAttribute('role','status');
      this.giftForm.oninput=()=>{this.preview=null;this.pending=null;this.previewBox.replaceChildren();};
      this.giftForm.onsubmit=e=>{e.preventDefault();this.prepare();};
      const heading=el('div',undefined,'section-title');heading.append(el('h3','История начислений'),button('Обновить',()=>this.loadGrants()));
      this.history=el('div',undefined,'game-grant-history'); const pager=el('div',undefined,'pager');
      this.historyPrev=button('←',()=>{this.historyPage--;this.loadGrants();});this.historyNext=button('→',()=>{this.historyPage++;this.loadGrants();});this.historyPageText=el('span');pager.append(this.historyPrev,this.historyPageText,this.historyNext);
      this.historyPrev.setAttribute('aria-label','Предыдущие начисления');this.historyNext.setAttribute('aria-label','Следующие начисления');
      panel.append(this.giftForm,this.previewBox,this.giftStatus,heading,this.history,pager);
    }
    addReward() {
      if (!this.catalog || this.rewardRows.children.length >= 50 || this.busy) return;
      const row=el('div',undefined,'promo-reward-row'),choice=el('select'),amount=el('input');
      choice.setAttribute('aria-label','Награда');amount.setAttribute('aria-label','Количество');
      for (const category of new Set(this.catalog.map(r=>r.category))) { const group=el('optgroup');group.label=category;for(const r of this.catalog.filter(r=>r.category===category)){const o=el('option',r.name);o.value=r.kind+':'+r.id;group.append(o);}choice.append(group); }
      amount.type='number';amount.required=true;amount.min=1;amount.step=1;amount.value=1;
      const update=()=>{amount.max=this.catalog.find(r=>r.kind+':'+r.id===choice.value).max;};choice.onchange=update;update();
      row.append(choice,amount,button('Убрать',()=>{if(this.busy)return;row.remove();this.giftForm.dispatchEvent(new Event('input'));}));this.rewardRows.append(row);this.giftForm.dispatchEvent(new Event('input'));
    }
    async loadGrants() {
      if (!this.active || this.role!=='owner' || this.view!=='grants') return;
      const serial=++this.serial;
      try {
        const data=await this.api('game-grants?page='+this.historyPage);if(!this.active||serial!==this.serial)return;
        this.catalog=data.catalog;if(!this.rewardRows.children.length)this.addReward();this.history.replaceChildren();
        for(const c of data.campaigns){const row=el('article',undefined,'game-grant-record');row.append(el('h4',c.title+': '+c.id),el('p',stamp(c.at),'muted'),el('p',c.rewards.map(r=>r.name+' × '+fmt(r.amount)).join(': ')),el('p',`Начислено: ${fmt(c.delivered)} / ${fmt(c.total)}: Ожидают: ${fmt(c.pending)}`));
          if(c.pending)row.append(el('p','Игроки на арене получат подарок после выхода в лобби.','muted'));
          if(c.excluded)row.append(el('p','Исключено: '+fmt(c.excluded)));
          if(c.errors.length){row.append(el('p','Не начислено: '+c.errors.map(e=>e.name+' — '+e.message).join('; ')));
            const requestId=window.KillexRequestIds.create(), retry=button('Повторить недоставленные',async()=>{retry.disabled=true;try{await this.api('game-grants/retry',{id:c.id,requestId,confirmed:true});if(this.active)await this.loadGrants();}catch(e){if(this.active)this.giftStatus.textContent=e.message;}finally{retry.disabled=false;}});row.append(retry);}
          this.history.append(row);
        }
        if(!data.campaigns.length)this.history.append(el('p','Начислений пока нет.','muted'));
        this.historyPage=data.page;this.historyPageText.textContent=data.page+' / '+data.pages;this.historyPrev.disabled=data.page<=1;this.historyNext.disabled=data.page>=data.pages;
      }catch(error){if(this.active&&serial===this.serial)this.giftStatus.textContent=error.message;}
    }
    setBusy(value){this.busy=value;for(const n of this.giftForm.querySelectorAll('input,select,textarea,button'))n.disabled=value;}
    async prepare(){
      if(this.busy||!this.active)return;this.setBusy(true);this.giftStatus.textContent='';const serial=++this.serial;
      try{
        const rewards=[...this.rewardRows.children].map(row=>{const[kind,id]=row.querySelector('select').value.split(':');return{kind,id,amount:Number(row.querySelector('input').value)};});
        const p=await this.api('game-grants/preview',{title:this.title.value,message:this.message.value,rewards});if(!this.active||serial!==this.serial)return;
        this.preview=p;this.pending={previewId:p.previewId,requestId:window.KillexRequestIds.create(),confirmed:true};this.previewBox.replaceChildren(el('h3',p.title),el('p',p.message),el('p',p.rewards.map(r=>r.name+' × '+fmt(r.amount)).join(': ')),el('strong','Получателей: '+fmt(p.recipients)),el('p','Полный набор каждому. Новые аккаунты после предпросмотра не включаются.','muted'));
        this.send=button('Подтвердить начисление',()=>this.submit());this.send.className='primary';this.previewBox.append(this.send);
      }catch(error){if(this.active)this.giftStatus.textContent=error.message;}finally{this.setBusy(false);}
    }
    async submit(){
      if(this.busy||!this.pending||!this.active)return;this.setBusy(true);this.send.disabled=true;const serial=++this.serial;
      try{const result=await this.api('game-grants/send',this.pending);if(!this.active||serial!==this.serial)return;this.pending=null;this.preview=null;this.previewBox.replaceChildren();this.giftStatus.textContent='Начисление '+result.campaign.id+' сохранено. Подарки доставляются.';this.historyPage=1;await this.loadGrants();}
      catch(error){if(this.active&&serial===this.serial)this.giftStatus.textContent=error.message+' При потере ответа повтори подтверждение — второй выдачи не будет.';}
      finally{this.setBusy(false);if(this.send)this.send.disabled=false;}
    }
  }
  window.KillexPlayerTabs=PlayerTabs;
})();

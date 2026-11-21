"use strict";
(() => {
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, click, cls) => { const n = el("button", text, cls); n.type = "button"; n.onclick = click; return n; };
  const stamp = value => value ? new Date(value + 3 * 3600000).toISOString().slice(0, 16) : "";
  const instant = value => value ? Date.parse(value + ":00+03:00") : 0;
  class ContentManager {
    constructor({ api }) {
      this.api = api; this.busy = false; this.active = false; this.generation = 0;
      this.panels = [this.build("promo-codes", "Промокоды", "promoCodesPanel"), this.build("news", "Новости газеты", "newsAdminPanel")];
    }
    build(route, title, id) {
      const root = document.getElementById(id), summary = el("summary", title), content = el("div", undefined, "content-admin"),
        toolbar = el("div", undefined, "content-toolbar"), search = el("input"), list = el("div", undefined, "content-list"),
        form = el("form", undefined, "content-editor"), status = el("p", "", "content-status"), pager = el("nav", undefined, "pager");
      const panel = { route, root, content, search, list, form, status, pager, data: null, page: 0, pending: null, selected: new Set() };
      search.placeholder = "Поиск по названию"; search.setAttribute("aria-label", "Поиск: " + title);
      search.oninput = () => { panel.page = 0; this.renderList(panel); };
      toolbar.append(button("Обновить список", () => this.loadPanel(panel)), button("Создать", () => this.edit(panel)), search);
      if (route === 'news') {
        const label=el('label',undefined,'news-select-all');panel.selectAll=el('input');panel.selectAll.type='checkbox';label.append(panel.selectAll,el('span','Выбрать страницу'));
        panel.selectAll.onchange=()=>{if(this.busy)return;for(const item of panel.visible||[]){if(panel.selectAll.checked)panel.selected.add(item.id);else panel.selected.delete(item.id);}this.renderList(panel);};
        panel.bulkDelete=button('Удалить выбранные',()=>this.removeSelected(panel),'danger');panel.selectionCount=el('span','','muted');
        toolbar.append(label,panel.selectionCount,panel.bulkDelete);
      }
      status.setAttribute("role", "status");
      content.append(toolbar, status, list, pager, form); root.append(summary, content);
      form.hidden = true;
      root.addEventListener("toggle", () => { if (root.open && !panel.data && this.active) this.loadPanel(panel); });
      return panel;
    }
    lock() {
      this.active = false; this.generation++;
      for (const p of this.panels) { p.editor?.dispose(); p.selected.clear(); p.data = null; p.pending = null; p.root.open = false; p.form.replaceChildren(); p.form.hidden = true; p.list.replaceChildren(); p.pager.replaceChildren(); p.status.textContent = ""; }
    }
    async load() { this.active = true; for (const p of this.panels) if (p.root.open) await this.loadPanel(p); }
    async loadPanel(p) {
      if (this.busy || !this.active) return;
      const generation = this.generation;
      try {
        const data = await this.api(p.route);
        if (!this.active || generation !== this.generation) return;
        p.data = data; p.status.textContent = ""; this.renderList(p);
      } catch (error) { if (this.active) p.status.textContent = error.message; }
    }
    renderList(p) {
      const q = p.search.value.toLocaleLowerCase("ru-RU"), all = this.items(p)
        .filter(item => (item.code + " " + item.title).toLocaleLowerCase("ru-RU").includes(q))
        .sort((a, b) => (b.updatedAt||Date.parse(b.date)) - (a.updatedAt||Date.parse(a.date)));
      p.page = Math.max(0, Math.min(p.page, Math.ceil(all.length / 8) - 1));
      p.list.replaceChildren();
      p.visible=all.slice(p.page * 8, (p.page + 1) * 8);
      if(p.route==='news'){const ids=new Set(this.items(p).map(item=>item.id));for(const id of p.selected)if(!ids.has(id))p.selected.delete(id);}
      for (const item of p.visible) {
        const row = el("article", undefined, "content-row"), info = el("div");
        info.append(el("strong", item.code ? item.code + " — " + item.title : item.title));
        if (p.route === "promo-codes") {
          const text = item.rewards.map(r => {
            const entry = p.data.catalog.find(c => c.kind === r.kind && c.id === r.id);
            return (entry?.name || r.id) + " × " + r.amount;
          }).join("; ");
          info.append(el("p", text), el("small", `${item.enabled ? "Включён" : "Отключён"} · Активаций: ${item.redeemed}${item.maxRedemptions ? " / " + item.maxRedemptions : " · без общего лимита"}`));
        } else info.append(el("p", item.date + " · " + (item.visible ? "Опубликовано" : "Скрыто")), el("small", item.body.slice(0, 150)));
        const actions = el("div", undefined, "content-toolbar");
        actions.append(button("Редактировать", () => this.edit(p, item)));
        actions.append(button("Удалить", () => this.remove(p, item), "danger"));
        if(p.route==='news'){
          const label=el('label',undefined,'news-row-selection'),check=el('input');check.type='checkbox';check.checked=p.selected.has(item.id);check.setAttribute('aria-label','Выбрать новость: '+item.title);
          check.onchange=()=>{if(this.busy){check.checked=p.selected.has(item.id);return;}if(check.checked)p.selected.add(item.id);else p.selected.delete(item.id);this.selectionState(p);};
          label.append(check);row.append(label);row.classList.add('news-selectable-row');
        }
        row.append(info, actions); p.list.append(row);
      }
      this.selectionState(p);
      if (!all.length) p.list.append(el("p", "Записей пока нет.", "muted"));
      const previous = button("←", () => { p.page--; this.renderList(p); }), next = button("→", () => { p.page++; this.renderList(p); });
      window.KillexControls.state(previous, p.page === 0); window.KillexControls.state(next, (p.page + 1) * 8 >= all.length);
      p.pager.replaceChildren(previous, el("span", `${p.page + 1} / ${Math.max(1, Math.ceil(all.length / 8))}`), next);
    }
    selectionState(p){
      if(p.route!=='news')return;
      const count=p.visible.filter(n=>p.selected.has(n.id)).length;
      p.selectAll.checked=p.visible.length>0&&count===p.visible.length;p.selectAll.indeterminate=count>0&&count<p.visible.length;
      p.selectionCount.textContent='Выбрано: '+p.selected.size;p.bulkDelete.disabled=!p.selected.size||this.busy;
    }
    async removeSelected(p){
      if(this.busy||!this.active||!p.selected.size)return;
      if(p.selected.size>100){p.status.textContent='За один раз можно удалить до 100 новостей.';return;}
      const selected=[...p.selected];await this.loadPanel(p);if(this.busy||!this.active)return;
      const items=this.items(p).filter(n=>selected.includes(n.id));
      if(items.length!==selected.length){p.status.textContent='Список изменился. Проверь выбор заново.';return;}
      const revision=p.data.revision;p.editor?.dispose();p.pending=null;p.form.hidden=false;p.form.replaceChildren();
      const label=el('label','Причина удаления для журнала'),reason=el('input'),submit=el('button','Удалить '+items.length+' новостей','danger');
      reason.required=true;reason.minLength=3;reason.maxLength=500;reason.value='Массовое удаление новостей';label.append(reason);submit.type='submit';
      const list=el('ul');for(const item of items)list.append(el('li',item.title));
      p.form.append(el('h3','Переместить выбранные новости в корзину?'),list,label,submit,button('Отмена',()=>{if(!this.busy)p.form.hidden=true;}));
      p.form.scrollIntoView({behavior:'smooth',block:'nearest'});
      p.form.onsubmit=async e=>{
        e.preventDefault();if(this.busy)return;
        const payload={action:'delete-many',ids:selected,revision,reason:reason.value,confirmed:true},signature=JSON.stringify(payload);
        if(p.pending?.signature!==signature)p.pending={signature,requestId:window.KillexRequestIds.create()};
        const generation=this.generation;this.busy=true;submit.disabled=true;this.selectionState(p);
        try{const result=await this.api('news',{...payload,requestId:p.pending.requestId});if(!this.active||generation!==this.generation)return;p.data=result;p.pending=null;for(const id of selected)p.selected.delete(id);p.form.hidden=true;p.status.textContent=(result.queued?'Сохранено в редакции; ожидает применения. Выбрано: ':'Перемещено в корзину: ')+result.deleted;this.renderList(p);}
        catch(error){if(this.active)p.status.textContent=error.message+' При потере ответа можно повторить удаление.';}
        finally{this.busy=false;submit.disabled=false;this.selectionState(p);}
      };
    }
    async remove(p, item) {
      if (this.busy || !this.active) return;
      await this.loadPanel(p);
      if (this.busy || !this.active) return;
      item = this.items(p).find(row => row.id === item.id);
      if (!item) { p.status.textContent = "Запись уже удалена."; return; }
      const promo = p.route === "promo-codes";
      const revision = p.data.revision;
      p.editor?.dispose(); p.pending = null; p.form.hidden = false; p.form.replaceChildren();
      const label = el("label", "Причина удаления для журнала владельца"), reason = el("input"),
        submit = el("button", promo ? "Удалить промокод" : "Удалить новость", "danger");
      reason.required = true; reason.minLength = 3; reason.maxLength = 500;
      reason.id = promo ? "promo-delete-reason" : "news-delete-reason"; label.append(reason); submit.type = "submit";
      p.form.append(el("h3", "Удалить «" + (item.code || item.title) + "»?"),
        el("p", promo ? "Промокод переместится в корзину и станет недоступен для активации. Награды и история сохранятся. Из корзины можно восстановить тот же код с прежним счётчиком активаций." : "Новость исчезнет из газеты и переместится в корзину. Её можно восстановить вместе с текстом, датой и прежним статусом публикации."),
        label, submit, button("Отмена", () => { if (!this.busy) p.form.hidden = true; }));
      p.form.onsubmit = async event => {
        event.preventDefault(); if (this.busy) return;
        const payload = { action: "delete", id: item.id, confirmed: true, revision, reason: reason.value };
        const signature = JSON.stringify(payload);
        if (p.pending?.signature !== signature) p.pending = { signature, requestId: window.KillexRequestIds.create() };
        const generation = this.generation;
        this.busy = true; window.KillexControls.state(submit, true, false); p.status.textContent = "";
        try {
          const result = await this.api(p.route, { ...payload, requestId: p.pending.requestId });
          if (!this.active || generation !== this.generation) return;
          p.data = result; p.pending = null; p.form.hidden = true;
          p.status.textContent = result.queued ? "Удаление сохранено в редакции и ожидает запуска игры." : promo ? "Промокод удалён. Выданные награды сохранены." : "Новость удалена. Запись в журнале сохранена."; this.renderList(p);
        } catch (error) { if (this.active) p.status.textContent = error.message + " При потере ответа можно повторить удаление."; }
        finally { this.busy = false; window.KillexControls.state(submit, false); }
      };
      reason.focus();
    }
    async edit(p, item) {
      if (this.busy) return;
      if (!p.data) { await this.loadPanel(p); if (!p.data) return; }
      const revision = p.data.revision;
      p.editor?.dispose(); p.editor = null; p.form.hidden = false; p.form.replaceChildren(); p.pending = null;
      p.form.append(el("h3", item ? "Редактирование" : "Новая запись"));
      const fields = {}, field = (key, title, type = "text", value = "") => {
        const label = el("label", title), input = el(type === "textarea" ? "textarea" : "input");
        if (type !== "textarea") input.type = type;
        input.name = key; input.id = p.route + "-" + key;
        if (type === "checkbox") input.checked = value; else input.value = value;
        label.append(input); p.form.append(label); fields[key] = input; return input;
      };
      const title = field("title", "Название", "text", item?.title || ""); title.maxLength = 100; title.required = true;
      let rewardRows;
      if (p.route === "promo-codes") {
        const code = field("code", "Промокод (3–48 латинских букв, цифр, - или _)", "text", item?.code || "");
        code.maxLength = 48; code.required = true; code.readOnly = !!item; code.autocomplete = "off";
        field("enabled", "Промокод включён", "checkbox", item?.enabled ?? true);
        field("startsAt", "Начало, МСК (пусто — сразу)", "datetime-local", stamp(item?.startsAt));
        field("endsAt", "Окончание, МСК (пусто — бессрочно)", "datetime-local", stamp(item?.endsAt));
        const max = field("maxRedemptions", "Общий лимит активаций (0 — без ограничения)", "number", item?.maxRedemptions || 0);
        max.min = 0; max.max = 10000000; max.step = 1;
        p.form.append(el("p", "Каждый игрок получает награды только один раз. Существующий код нельзя переименовать или выдать заново. Изменение состава действует на будущие активации.", "muted"));
        rewardRows = el("div", undefined, "promo-reward-rows"); p.form.append(rewardRows);
        const addReward = (reward) => {
          const row = el("div", undefined, "promo-reward-row"), choice = el("select"), quantity = el("input");
          choice.setAttribute("aria-label", "Награда"); quantity.setAttribute("aria-label", "Количество награды");
          for (const category of new Set(p.data.catalog.map(c => c.category))) {
            const group = el("optgroup"); group.label = category;
            for (const c of p.data.catalog.filter(c => c.category === category)) {
              const option = el("option", c.name); option.value = c.kind + ":" + c.id; group.append(option);
            }
            choice.append(group);
          }
          if (reward) choice.value = reward.kind + ":" + reward.id;
          quantity.type = "number"; quantity.min = 1; quantity.step = 1; quantity.required = true; quantity.value = reward?.amount || 1;
          const update = () => { const c = p.data.catalog.find(c => c.kind + ":" + c.id === choice.value); quantity.max = c.max; if (+quantity.value > c.max) quantity.value = c.max; };
          choice.onchange = update; update();
          row.append(choice, quantity, button("Убрать", () => { if (!this.busy) row.remove(); })); rewardRows.append(row);
        };
        for (const r of item?.rewards || [{ kind: "currency", id: "coins", amount: 100 }]) addReward(r);
        p.form.append(button("Добавить награду", () => { if (!this.busy) addReward(); }));
      } else {
        const date = field("date", "Дата публикации (без времени)", "date", item?.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" })); date.required = true;
        const category = el("select"), label = el("label", "Раздел"); category.name = "category";
        for (const [id, name] of [["news", "Новости"], ["event", "События"], ["release", "Обновления"]]) { const option = el("option", name); option.value = id; category.append(option); }
        category.value = item?.category || "news"; label.append(category); p.form.append(label); fields.category = category;
        const text = field("body", "Текст новости", "textarea", item?.body || ""); text.rows = 7; text.maxLength = 6000; text.required = true;
        field("visible", "Опубликовано в газете", "checkbox", item?.visible ?? false);
        p.form.append(el("p", "Длинная статья прокручивается внутри окна газеты. Правка публикации о событии меняет только статью, а не само событие.", "muted"));
        p.editor = window.KillexNewsEditor.attach({form:p.form,fields,item,api:this.api,status:p.status});
      }
      const reason = field("reason", "Причина правки для журнала владельца", "text"); reason.minLength = 3; reason.maxLength = 500; reason.required = true;
      const save = el("button", "Сохранить", "primary"), cancel = button("Закрыть редактор", () => { if (!this.busy) p.form.hidden = true; });
      save.type = "submit"; p.form.append(save, cancel);
      p.form.onsubmit = async event => {
        event.preventDefault(); if (this.busy) return;
        if(p.editor?.busy){p.status.textContent='Подожди окончания загрузки баннера.';return;}
        const payload = { revision, reason: reason.value, title: title.value, ...(item && !item.builtin ? { id: item.id } : {}) };
        if (p.route === "promo-codes") Object.assign(payload, {
          code: fields.code.value, enabled: fields.enabled.checked, startsAt: instant(fields.startsAt.value), endsAt: instant(fields.endsAt.value), maxRedemptions: Number(fields.maxRedemptions.value),
          rewards: [...rewardRows.children].map(row => { const [kind, id] = row.querySelector("select").value.split(":"); return { kind, id, amount: Number(row.querySelector("input").value) }; }),
        });
        else Object.assign(payload, { body: fields.body.value, date: fields.date.value, category: fields.category.value, visible: fields.visible.checked,layout:fields.layout.value,image:p.editor.image,...(item?.sourceId?{sourceId:item.sourceId}:{}) });
        const signature = JSON.stringify(payload);
        if (p.pending?.signature !== signature) p.pending = { signature, requestId: window.KillexRequestIds.create() };
        const generation = this.generation;
        this.busy = true; window.KillexControls.state(save, true, false); p.status.textContent = "";
        try {
          const result = await this.api(p.route, { ...payload, requestId: p.pending.requestId });
          if (!this.active || generation !== this.generation) return;
          p.data = result; p.pending = null; p.form.hidden = true; p.status.textContent = result.queued ? "Сохранено в редакции. Публикация после запуска игры." : "Сохранено."; this.renderList(p);
        } catch (error) { if (this.active) p.status.textContent = error.message + " При потере ответа можно повторить сохранение."; }
        finally { this.busy = false; window.KillexControls.state(save, false); }
      };
    }
    items(p) {
      if(p.route!=='news')return p.data?.items||[];
      const custom=p.data?.items||[], ids=new Set(custom.map(n=>n.sourceId)),hidden=new Set(p.data?.hiddenSources||[]);
      const base=(p.data?.sources||[]).filter(n=>!hidden.has(n.sourceId)).map(n=>({...n,builtin:!ids.has(n.sourceId)}));
      return window.KillexNewsLayout.merge(base,custom.map(n=>({...n,builtin:false})),true);
    }
  }
  window.KillexContentManager = ContentManager;
})();

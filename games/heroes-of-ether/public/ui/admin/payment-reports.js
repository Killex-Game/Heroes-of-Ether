"use strict";
(() => {
  const $ = id => document.getElementById(id), fmt = n => Number(n).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const dateInput = date => [date.getFullYear(), String(date.getMonth()+1).padStart(2,"0"), String(date.getDate()).padStart(2,"0")].join("-");
  function renderChart(series) {
    const host = $("paymentsChart"), view = node("div", undefined, "payment-chart-scroll");
    if (!series.length) { host.replaceChildren(node("p", "За выбранный период данных нет.", "muted")); return; }
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"),
      add = (tag, attrs, text) => { const e = document.createElementNS(svg.namespaceURI, tag);
        for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, value);
        if (text !== undefined) e.textContent = text; svg.append(e); return e; };
    const left = 86, right = 620, top = 28, bottom = 218, slot = (right-left)/series.length;
    const peak = Math.max(0, ...series.map(d => d.votes)), rough = Math.max(1, peak/4),
      magnitude = 10 ** Math.floor(Math.log10(rough)),
      step = [1,2,5,10].find(n => n*magnitude >= rough)*magnitude, ceiling = step*4;
    const shortDay = day => day.slice(8,10)+"."+day.slice(5,7),
      fullDay = day => new Date(day+"T12:00:00").toLocaleDateString("ru-RU", {day:"numeric",month:"long",year:"numeric"});
    svg.setAttribute("viewBox", "0 0 640 256");svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Голоса по дням. Точная сумма выбранного дня указана под графиком.");
    add("text", {x:left,y:16,class:"payment-chart-label"}, "Голоса");
    for (let i=0;i<=4;i++) {
      const value=step*i,y=bottom-(bottom-top)*value/ceiling;
      add("path", {d:`M${left} ${y} H${right}`,class:"payment-chart-grid"});
      add("text", {x:left-10,y:y+5,"text-anchor":"end",class:"payment-chart-label"},fmt(value));
    }
    const bars=series.map((day,i)=>{
      const height=(bottom-top)*day.votes/ceiling;
      const bar=add("rect",{x:left+i*slot+slot*.08,y:bottom-height,width:slot*.84,height,rx:1,class:"payment-chart-bar"});
      const title=document.createElementNS(svg.namespaceURI,"title");title.textContent=fullDay(day.day)+": "+fmt(day.votes)+" Голосов";bar.append(title);return bar;
    });
    for(const i of new Set([0,Math.floor((series.length-1)/3),Math.floor((series.length-1)*2/3),series.length-1]))
      add("text",{x:left+(i+.5)*slot,y:244,"text-anchor":i===0?"start":i===series.length-1?"end":"middle",class:"payment-chart-label"},shortDay(series[i].day));
    const marker=add("path",{class:"payment-chart-marker"}),readout=node("output",undefined,"payment-chart-readout"),
      picker=node("input",undefined,"payment-chart-picker");
    picker.type="range";picker.min="0";picker.max=String(series.length-1);picker.step="1";picker.disabled=series.length===1;
    picker.setAttribute("aria-label","День на графике");
    let selected=-1;
    const select=index=>{
      index=Math.max(0,Math.min(series.length-1,index));if(selected===index)return;
      if(selected>=0)bars[selected].classList.remove("selected");selected=index;bars[index].classList.add("selected");
      const day=series[index],x=left+(index+.5)*slot,label=fullDay(day.day)+" — "+fmt(day.votes)+" Голосов";
      marker.setAttribute("d",`M${x} ${top} V${bottom}`);readout.textContent=label;
      picker.value=String(index);picker.setAttribute("aria-valuetext",label);
    };
    picker.oninput=()=>select(Number(picker.value));
    svg.onpointermove=svg.onclick=e=>{const box=svg.getBoundingClientRect(),x=(e.clientX-box.left)/box.width*640;
      if(x>=left&&x<=right)select(Math.floor((x-left)/slot));};
    select(Math.max(0,series.findLastIndex(day=>day.votes>0)));
    view.append(svg);host.replaceChildren(view,readout,picker);
    if(!peak)host.append(node("p","За выбранный период покупок нет.","muted"));
  }
  class PaymentReports {
    constructor({ api, fail, selectPlayer }) {
      Object.assign(this, { api, fail, selectPlayer, page: 1, generation: 0, loading: false, loaded: false });
      const now = new Date(), first = new Date(now); first.setDate(first.getDate()-29);
      $("paymentsFrom").value = dateInput(first); $("paymentsTo").value = dateInput(now);
      $("paymentFilters").onsubmit = e => { e.preventDefault(); this.page = 1; this.load(); };
      $("paymentsPrev").onclick = () => { this.page--; this.load(); };
      $("paymentsNext").onclick = () => { this.page++; this.load(); };
      $("paymentsExport").onclick = () => this.export();
    }
    clear() {
      this.generation++; this.loaded = this.loading = false; this.report = null; this.page = 1;
      for (const id of ["paymentsSummary","paymentsCategories","paymentsChart","paymentsJournal","paymentsHint","paymentsCaptured"]) $(id).replaceChildren();
      $("paymentsPage").textContent = "";
      window.KillexControls.state($("paymentsRefresh"), false);
      for (const id of ["paymentsPrev","paymentsNext","paymentsExport"]) window.KillexControls.state($(id), true);
    }
    async load() {
      if (this.loading) return;
      const from = new Date($("paymentsFrom").value + "T00:00:00"), through = new Date($("paymentsTo").value + "T00:00:00");
      through.setDate(through.getDate()+1);
      const params = new URLSearchParams({ from: +from, to: +through, mode: $("paymentsMode").value,
        category: $("paymentsCategory").value, page: this.page, offset: -from.getTimezoneOffset() });
      const generation = ++this.generation; this.loading = true;
      for (const id of ["paymentsRefresh","paymentsPrev","paymentsNext"]) window.KillexControls.state($(id), true, false);
      $("paymentsHint").textContent = "Формируем отчёт…";
      try {
        const report = await this.api("payments?" + params);
        if (generation !== this.generation) return;
        this.report = report; this.page = report.page; this.loaded = true; this.render(report);
      } catch (error) {
        if (generation === this.generation) { this.page = this.report?.page || 1; $("paymentsHint").textContent = "Не удалось обновить отчёт. Предыдущие данные, если есть, остаются на экране."; this.fail(error); }
      } finally {
        if (generation === this.generation) {
          this.loading = false; window.KillexControls.state($("paymentsRefresh"), false);
          window.KillexControls.state($("paymentsPrev"), !this.report || this.page <= 1);
          window.KillexControls.state($("paymentsNext"), !this.report || this.page >= this.report.pages);
        }
      }
    }
    render(r) {
      const test = r.filters.mode === "test";
      $("paymentsHint").replaceChildren(...r.limitations.map(text => node("p", text)));
      const metrics = [[test ? "Тестовый оборот, Голоса" : "Выручка, Голоса",fmt(r.summary.votes)], ["Покупок",fmt(r.summary.purchases)], ["Покупателей",fmt(r.summary.buyers)], ["Средний чек, Голоса",fmt(r.summary.averageVotes)], ["Чистая прибыль", "Не рассчитана"]];
      $("paymentsSummary").replaceChildren(...metrics.map(([label,value]) => { const box=node("div",undefined,"stat"); box.append(node("span",label),node("strong",value));return box; }));
      $("paymentsReportTitle").textContent = test ? "Тестовые покупки по дням" : "Выручка по дням";
      renderChart(r.series);
      const top = Math.max(1,...r.categories.map(c=>c.votes));
      $("paymentsCategories").replaceChildren(...r.categories.map(c=>{const row=node("div",undefined,"payment-category");const heading=node("div");heading.append(node("span",c.name),node("strong",fmt(c.votes)+" · покупок: "+fmt(c.count)));const bar=node("div",undefined,"payment-category-track"),fill=node("span");fill.style.width=c.votes/top*100+"%";bar.append(fill);row.append(heading,bar);return row;}));
      $("paymentsJournal").replaceChildren(...r.entries.map(entry=>{
        const row=node("article",undefined,"payment-entry"),title=node("div",undefined,"section-title"),player=node("button",entry.playerName,"payment-player");player.type="button";player.onclick=()=>this.selectPlayer(entry.playerId);
        title.append(player,node("strong",fmt(entry.votes)+" Голосов"));
        row.append(title,node("p",entry.product),node("span","Тестовая · подтверждена","payment-state"),node("small",new Date(entry.at).toLocaleString("ru-RU")),node("small","Продукт: "+entry.productId,"identifier"),node("small","Операция: "+entry.id,"identifier"));return row;
      }));
      if (!r.entries.length) $("paymentsJournal").append(node("p",test ? "За выбранный период покупок не найдено." : "Реальных оплат пока нет. Тестовые покупки доступны в фильтре «Тестовые».","muted"));
      $("paymentsPage").textContent = r.page+" / "+r.pages+" · всего "+fmt(r.total);
      $("paymentsCaptured").textContent="Снимок: "+new Date(r.capturedAt).toLocaleString("ru-RU")+". Даты периода — в часовом поясе браузера; верхняя дата включена.";
      window.KillexControls.state($("paymentsExport"),false);
    }
    export() {
      if (!this.report) return;
      const r=this.report,rows=[["Режим",r.filters.mode === "test" ? "Тестовые покупки — не выручка" : "Реальные оплаты"],["Начало периода",new Date(r.filters.from).toISOString()],["Конец периода (исключительно)",new Date(r.filters.to).toISOString()],["Категория",r.filters.category],["Поиск",r.filters.q],["Голоса",r.summary.votes],["Покупки",r.summary.purchases],["Чистая прибыль","Не рассчитана"],[],["Дата","Голоса"],...r.series.map(d=>[d.day,d.votes]),[],["Категория","Голоса","Покупки"],...r.categories.map(c=>[c.name,c.votes,c.count])];
      const cell=v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
      const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n')],{type:"text/csv;charset=utf-8"}));
      const link=node("a");link.href=url;link.download="killex-payments-"+dateInput(new Date(r.capturedAt))+".csv";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  }
  window.KillexPaymentReports=PaymentReports;
})();

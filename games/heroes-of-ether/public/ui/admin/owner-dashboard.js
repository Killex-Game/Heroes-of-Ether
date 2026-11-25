"use strict";
(() => {
  const $ = id => document.getElementById(id), fmt = n => Number(n).toLocaleString("ru-RU", {maximumFractionDigits: 2});
  const sections = [
    ["overview", "Обзор", "M3 10 12 3l9 7v11H3Z M9 21v-8h6v8"],
    ["players", "Игроки", "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M18 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-4"],
    ["economy", "Экономика", "M3 7h18v14H3Z M3 7l15-4v4 M15 12h6v5h-6Z"],
    ["events", "События", "M4 5h16v16H4Z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2 M8 17h2"],
    ["friday", "Пятничные акции", "M4 5h16v16H4Z M8 3v4 M16 3v4 M4 10h16 M8 14h8 M8 17h5"],
    ["promos", "Промокоды", "M3 6h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Z M15 6v3 M15 11v2 M15 15v3"],
    ["news", "Новости", "M4 3h14v18H4Z M18 8h3v13h-3 M7 7h8 M7 11h3v4H7Z M12 11h3 M12 14h3 M7 18h8"],
    ["audit", "Журнал", "M5 3h14v18H5Z M8 7h8 M8 11h8 M8 15h5"],
    ["maintenance", "Технические работы", "M14 4a6 6 0 0 0-7 7L2 16l6 6 5-5a6 6 0 0 0 7-7l-4 3-4-4Z"],
    ["moderators", "Модераторы", "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7Z M8 12l3 3 5-6"],
    ["feedback", "Отзывы", "M3 4h18v14H8l-5 4Z M7 8h10 M7 12h7"],
    ["trash", "Корзина", "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7"],
  ];
  class OwnerDashboard {
    constructor({refresh, onView}) {
      this.onView = onView;
      const brand = document.createElement("div"); brand.className = "owner-brand"; brand.textContent = "K"; brand.setAttribute("aria-label", "Killex");
      $("ownerNavigation").append(brand);
      for (const [id, label, path] of sections) {
        const b = document.createElement("button"); b.type = "button"; b.dataset.adminTarget = id;
        b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg><span>${label}</span>`;
        b.title = label; $("ownerNavigation").append(b);
      }
      document.addEventListener("click", e => { const b = e.target.closest("[data-admin-target]"); if (b) this.navigate(b.dataset.adminTarget); });
      $("refreshOverview").onclick = async () => {
        const b = $("refreshOverview"); if (b.disabled) return;
        window.KillexControls.state(b, true, false);
        try { await refresh(); } finally { window.KillexControls.state(b, false); }
      };
      const clock = () => {
        if (document.hidden) return;
        const now = new Date(); $("ownerClock").textContent = now.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit"});
        $("ownerClock").dateTime = now.toISOString();
        $("ownerDate").textContent = now.toLocaleDateString("ru-RU",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
      };
      clock(); window.KillexActivity.every(clock, 30000); document.addEventListener("visibilitychange",clock);
      addEventListener("hashchange", () => { if (!$("workspace").hidden) this.navigate(location.hash.slice(1), false); });
    }
    ready(name, role = "owner") {
      this.role = role;
      this.allowed = role === "moderator" ? ["overview", "players", "economy", "audit", "feedback"] : sections.map(s => s[0]);
      for (const b of document.querySelectorAll("[data-admin-target]")) b.hidden = !this.allowed.includes(b.dataset.adminTarget);
      document.querySelector('.owner-session-badge').textContent=role==='moderator'?'Сеанс модератора':'Сеанс владельца';
      $("ownerNavigation").hidden = false; document.body.classList.add("owner-authorized");
      $("ownerGreeting").textContent = name || "владелец";
      this.navigate(location.hash.slice(1) || this.allowed[0], false);
    }
    lock() {
      $("ownerNavigation").hidden = true; document.body.classList.remove("owner-authorized");
      $("ownerGreeting").textContent = "владелец";
      for (const id of ["overviewProfiles","overviewPlayers","overviewLobby","overviewOnline","overviewRooms","overviewQueue","overviewRate"]) $(id).textContent = "—";
      $("economySelected").textContent = "Выбери игрока, чтобы посмотреть его транзакции или изменить баланс.";
      $("economyWallet").hidden = true;
    }
    navigate(id, history = true) {
      if ($("workspace").hidden) return;
      if (!this.allowed?.includes(id)) id = this.allowed?.[0] || "overview";
      for (const pane of document.querySelectorAll("[data-admin-view]")) {
        pane.hidden = pane.dataset.adminView !== id;
        if (!pane.hidden && pane.tagName === "DETAILS") pane.open = true;
      }
      for (const b of $("ownerNavigation").querySelectorAll("button")) {
        if (b.dataset.adminTarget === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
      }
      if (history) window.history.replaceState(null, "", "#" + id);
      this.onView?.(id);
    }
    players(total) { $("overviewProfiles").textContent = fmt(total); }
    selected(player) { $("economySelected").textContent = "Транзакции и баланс: " + player.name; $("economyWallet").hidden = this.role==='moderator'; }
    performance(value) {
      if(value.available===false){
        for(const id of ["overviewPlayers","overviewLobby","overviewOnline","overviewRooms","overviewQueue","overviewRate"])$(id).textContent="—";
        $("overviewMeasured").textContent="Нет сохранённого замера · игровой сервер недоступен";
        for(const card of [$("overviewQueue").closest(".owner-metric"),$("overviewRate").closest(".owner-rate-card")])window.KillexServerHealth.paint(card,{level:"unknown",reason:"Нет свежих измерений"});
        return;
      }
      $("overviewPlayers").textContent = value.online ? fmt(value.online.arena) : "—";
      $("overviewLobby").textContent = value.online ? fmt(value.online.lobby) : "—";
      $("overviewOnline").textContent = value.online ? fmt(value.online.total) : "—";
      $("overviewRooms").textContent = fmt(value.arena.rooms);
      $("overviewQueue").textContent = fmt(value.persistence.queuedActions);
      $("overviewRate").textContent = fmt(value.updatesHz);
      $("overviewMeasured").textContent = (value.stale?"Сохранённый замер · игра недоступна: ":"Замер: ") + new Date(value.capturedAt).toLocaleString("ru-RU");
      const health = window.KillexServerHealth.assess(value);
      window.KillexServerHealth.paint($("overviewQueue").closest(".owner-metric"),health[5]);
      window.KillexServerHealth.paint($("overviewRate").closest(".owner-rate-card"),health[1]);
    }
    event(state) {
      if (!state) return;
      if(state.available===false){$("overviewEventTitle").textContent="Календарь временно недоступен";$("overviewEventDescription").textContent="Сохранённых данных пока нет.";$("overviewEventDates").textContent="";return;}
      const run = state.active || state.scheduled;
      $("overviewEventTitle").textContent = run?.manifest.title || "Нет активного события";
      $("overviewEventDescription").textContent = run ? (state.stale?"По последним данным. ":state.active ? "Сейчас в игре. " : "Запланировано. ") + (run.manifest.description || "") : state.stale?"В сохранённом календаре событий нет.":this.role==='moderator' ? "События пока не запланированы." : "Подготовь следующую активность для сообщества в разделе «События».";
      $("overviewEventDates").textContent = (run ? new Date(run.startsAt).toLocaleDateString("ru-RU") + " — " + new Date(run.endsAt).toLocaleDateString("ru-RU") : "")+(state.stale?" · Сохранённые данные на "+new Date(state.serverNow).toLocaleString("ru-RU"):"");
    }
  }
  window.KillexOwnerDashboard = OwnerDashboard;
})();

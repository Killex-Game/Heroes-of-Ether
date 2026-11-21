"use strict";
(() => {
  const $ = (id) => document.getElementById(id),
    fmt = (value) => Number(value).toLocaleString("ru-RU");
  const date = (value) => (value ? new Date(value).toLocaleString("ru-RU") : "Нет");
  const words = {
    coins: "Монеты",
    crystals: "Кристаллы",
    bucks: "Эфир",
    vipUntil: "VIP до",
    premiumUntil: "Premium до",
    level: "Уровень",
    xp: "Опыт",
  };
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  let csrf,
    adminRole = "owner",
    ownerName,
    setup,
    recovery = false,
    player,
    playersPage = 1,
    auditPage = 1,
    auditSerial = 0,
    allAudit = false,
    selection = 0,
    pending = null,
    busy = false,
    overviewCalendar = null,
    observedGameReady;
  const controlStatus = new window.KillexControlStatus({api});
  const feedbackPanel = new window.KillexFeedbackPanel({api});
  const playerTabs = new window.KillexPlayerTabs({api, selectPlayer: id => choose(id).catch(fail)});
  const inventoryPanel = new window.KillexPlayerInventory({ review: inventoryReview, retry: commit });
  const playerEditor = new window.KillexPlayerEditor({ review: playerEditReview, retry: commit });
  $("editPlayerName").onclick = () => playerEditor.open("rename");
  $("editPlayerLevel").onclick = () => playerEditor.open("level");
  const transactionHome = $("transactionsPanel").parentElement;
  const securityUI = new window.KillexAdminSecurity({ api, fail, onAuth: enter, onChallenge: value => { csrf = value; }, onBack: lock });
  const journal = new window.KillexTransactionJournal({ api, fail });
  const journalPanels = new window.KillexJournalPanels({api});
  const events = new window.KillexEventManager({ api });
  const clanSeasons = new window.KillexClanSeasons({api});
  const content = new window.KillexContentManager({ api });
  const maintenancePanel = new window.KillexMaintenancePanel({ api });
  const monitoring = new window.KillexOwnerMonitoring({api,onState:(state,data)=>{
    maintenancePanel.updateStatus(state);
    if(typeof data.control?.gameReady==='boolean'&&data.control.gameReady!==observedGameReady){observedGameReady=data.control.gameReady;refreshPerformance();}
  }});
  const trash = new window.KillexContentTrash({ api, onRestored: () => { for (const panel of content.panels) panel.data = null; } });
  const payments = new window.KillexPaymentReports({ api, fail, selectPlayer: id => { dashboard.navigate("players"); choose(id).catch(fail); } });
  const dashboard = new window.KillexOwnerDashboard({
    refresh: async () => {
      try {
        await Promise.all([refreshPerformance(), loadOverviewCalendar()]);
        if (!csrf) return;
        dashboard.event(overviewCalendar);
      } catch (error) { fail(error); }
    },
    onView: id => {
      monitoring.view(id);
      if (id === "players") playerTabs.open();
      if (id === "overview") dashboard.event(overviewCalendar);
      if (id === "audit") {audit().catch(fail);journalPanels.show();}
      if (id === "economy" && !payments.loaded) payments.load();
      if (id === "economy" && !journal.player) journal.selectAll().catch(fail);
      if (id === "trash") trash.load();
      if (id === "maintenance") maintenancePanel.load();
      if (id === "events") {events.load().catch(fail);clanSeasons.load();}
      if (id === "moderators") securityUI.load().catch(fail);
      if (id === "feedback") feedbackPanel.load();
      if (["promos","news"].includes(id)) content.loadPanel(content.panels.find(p => p.route === (id === "promos" ? "promo-codes" : "news")));
    },
  });
  function notice(text, kind = "") {
    inventoryPanel.message(text);
    playerEditor.message(text);
    $("notice").textContent = text;
    $("notice").className = "notice " + kind;
  }
  async function loadOverviewCalendar(){
    const state=await api('overview-calendar');if(csrf){overviewCalendar=state;dashboard.event(state);}
  }
  function lock() {
    overviewCalendar=null;observedGameReady=undefined;
    csrf = null;
    player = null;
    selection++;
    auditSerial++;
    $("workspace").hidden = true;
    $("logout").hidden = true;
    $("myAdminProfile").hidden = true;$("myAdminDialog").close();
    $("confirmDialog").close();
    $("players").replaceChildren();
    $("audit").replaceChildren();
    journal.clear();
    journalPanels.lock();
    events.lock();
    clanSeasons.lock();
    content.lock();
    maintenancePanel.lock();
    monitoring.lock();
    trash.lock();
    payments.clear();
    dashboard.lock();
    securityUI.lock();
    playerTabs.lock();
    inventoryPanel.clear();
    playerEditor.clear();
    controlStatus.lock();
    feedbackPanel.lock();
    $("performanceStats").replaceChildren();
    $("performanceTime").textContent = "";
    $("performancePanel").open = false;
    $("selected").hidden = true;
    $("loginPanel").hidden = false;
  }
  async function api(path, body) {
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch("/api/admin/" + path, {
        method: body ? "POST" : "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: body ? { "Content-Type": "application/json", "X-Owner-CSRF": csrf || "" } : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const value = await response.json();
      if (!response.ok) {
        if (response.status === 401) lock();
        throw Object.assign(Error(value.error || "Не удалось выполнить запрос."), {
          status: response.status,
        });
      }
      return value;
    } finally {
      clearTimeout(timeout);
    }
  }
  function fail(error) {
    notice(
      error.name === "AbortError"
        ? "Сервер не ответил вовремя. Проверь соединение."
        : error.message,
      "error",
    );
  }
  async function list() {
    const value = await api(
      "players?q=" + encodeURIComponent($("search").value) + "&page=" + playersPage,
    );
    playersPage = value.page;
    $("total").textContent = fmt(value.total);
    if (!$("search").value.trim()) dashboard.players(value.total);
    $("players").replaceChildren();
    for (const p of value.players) {
      const b = node("button", undefined, "player-row");
      b.type = "button";
      b.setAttribute("aria-pressed", String(p.id === player?.id));
      b.append(
        node("strong", p.name),
        node(
          "small",
          `Уровень ${p.level} - ${p.ban ? "Заблокирован" : p.inArena ? "На арене" : p.online ? "В лобби" : "Не в сети"}${p.isOwner ? ", владелец" : p.testBot ? ", тестовый бот" : ""}`,
        ),
      );
      b.addEventListener("click", () => choose(p.id).catch(fail));
      $("players").append(b);
    }
    if (!value.players.length) $("players").append(node("p", "Ничего не найдено.", "muted"));
    $("playersPage").textContent = `${value.page} / ${value.pages}`;
    window.KillexControls.state($("prevPlayers"), value.page <= 1);
    window.KillexControls.state($("nextPlayers"), value.page >= value.pages);
  }
  function stat(label, value, onClick) {
    const n = node(onClick ? "button" : "div", undefined, "stat");
    if (onClick) { n.type = "button"; n.onclick = onClick; n.setAttribute("aria-haspopup", "dialog"); }
    n.append(node("span", label), node("strong", value));
    $("stats").append(n);
  }
  function renderPlayer() {
    $("empty").hidden = true;
    $("selected").hidden = false;
    $("playerName").textContent = player.name;
    $("playerId").textContent = "ID: " + player.id;
    $("playerState").textContent =
      `Уровень ${player.level}, ${player.clan || "без клана"}. ${player.inArena ? "Сейчас на арене." : player.online ? "Сейчас в лобби." : "Не в сети."}`;
    $("stats").replaceChildren();
    for (const c of ["coins", "crystals", "bucks"]) stat(words[c], fmt(player.wallet[c]));
    stat("VIP до", date(player.account.vipUntil));
    stat("Premium до", date(player.account.premiumUntil));
    stat("Бустеры", fmt(Object.values(player.inventory).reduce((sum, n) => sum + n, 0)), () => inventoryPanel.open());
    inventoryPanel.update(player, adminRole === "moderator" && player.isOwner
      ? "Данные владельца доступны только для просмотра."
      : player.inArena ? "Изменение доступно после выхода игрока с арены." : "");
    playerEditor.update(player, inventoryPanel.forbidden);
    $("banInfo").hidden = !player.ban;
    $("banInfo").textContent = player.ban
      ? `Блокировка ${player.ban.until ? "до " + date(player.ban.until) : "бессрочная"}. Причина: ${player.ban.reason}`
      : "";
    $("chatStrikeStats").replaceChildren();
    for (const [kind, label, critical] of [["flood", "Флуд и спам", 2], ["profanity", "Нецензурная речь", 2]]) {
      const value = player.chatModeration?.[kind] || { strikes: 0 };
      const card = node("div", undefined, "stat");
      card.dataset.health = value.strikes >= critical ? "critical" : value.strikes ? "warning" : "ok";
      card.append(node("span", label), node("strong", fmt(value.strikes) + " страйк(ов)"));
      card.append(node("small", value.resetAt ? "Сброс: " + date(value.resetAt) : "Активных страйков нет"));
      if (value.lastAt) card.append(node("small", "Последнее нарушение: " + date(value.lastAt)));
      $("chatStrikeStats").append(card);
    }
    const mute = player.chatModeration?.mute;
    $("chatMuteInfo").textContent = mute
      ? `Все чаты заблокированы до ${date(mute.until)}. Причина: ${mute.reason}`
      : player.ban ? "Доступ к игре ограничен блокировкой аккаунта." : "Ограничение чатов не действует.";
    fields();
  }
  async function choose(id) {
    playerTabs.select("settings");
    if (pending || busy) {
      notice("Сначала заверши текущую правку.", "error");
      return;
    }
    const serial = ++selection,
      value = await api("player?id=" + encodeURIComponent(id));
    if (serial !== selection) return;
    if (player?.id !== id) inventoryPanel.close();
    if (player?.id !== id) playerEditor.close();
    player = value;
    auditPage = 1;
    $("reason").value = "";
    renderPlayer();
    dashboard.selected(player);
    await Promise.all([list(), audit(), journal.select(player)]);
  }
  function field(label, id, options, input = {}) {
    const l = node("label", label),
      control = document.createElement(options ? "select" : "input");
    control.id = id;
    if (options)
      for (const [value, text] of options) {
        const o = node("option", text);
        o.value = value;
        control.append(o);
      }
    else Object.assign(control, { required: true, ...input });
    l.append(control);
    $("actionFields").append(l);
  }
  function fields() {
    if (!player) return;
    inventoryPanel.setBusy(busy, !!pending);
    playerEditor.setBusy(busy, !!pending);
    for (const id of ["editPlayerName", "editPlayerLevel"]) $(id).disabled = busy || !!pending;
    $("actionFields").replaceChildren();
    const a = $("action").value;
    if (a === "ban") {
      const catalog = window.KillexModerationCatalog;
      field("Вид нарушения / пункт регламента", "violationRule", [
        ["", "Указать причину вручную"], ...catalog.rules.map(r => [r.id, r.id + " · " + r.name]),
      ]);
      field("Срок блокировки", "minutes", [
        [60, "1 час"],
        [1440, "1 сутки"],
        [10080, "7 дней"],
        [43200, "30 дней"],
        [259200, "180 дней"],
        [525600, "365 дней"],
        ["forever", "Бессрочно"],
      ]);
      const hint = node("p", "Выбери пункт или введи свою причину. Решение применяется только после подтверждения.", "muted");
      hint.id = "violationRuleHint"; $("actionFields").append(hint);
      const currentRule = catalog.forReason($("reason").value.trim());
      if (currentRule) $("violationRule").value = currentRule.id;
      $("violationRule").onchange = () => {
        const rule = catalog.find($("violationRule").value);
        if (!rule) { hint.textContent = "Укажи конкретную причину и основание блокировки."; return; }
        const previous = catalog.forReason($("reason").value.trim());
        const detail = previous ? $("reason").value.trim().slice(catalog.reasonFor(previous.id).length).replace(/^[\s.:;]+/u, "") : $("reason").value.trim();
        $("reason").value = catalog.reasonFor(rule.id) + (detail ? ". " + detail : "");
        if (rule.minutes !== undefined) $("minutes").value = rule.minutes === null ? "forever" : String(rule.minutes);
        hint.textContent = rule.sanction + ". " + rule.detail +
          ((rule.minutes === null || rule.minutes >= 259200) ? " По п. 1.4 требуется решение владельца." : "");
      };
    }
    if (a === "rename") field("Новый ник", "newName", null, { value: player.name, maxLength: 16 });
    if (a === "level") field("Новый уровень", "newLevel", null, { type: "number", value: player.level, min: 1, step: 1 });
    if (a === "wallet") {
      field("Валюта", "currency", Object.entries(words).slice(0, 3));
      field("Изменение, минус для списания", "amount", null, {
        type: "number",
        min: -1000000,
        max: 1000000,
        step: 1,
        value: 100,
      });
    }
    if (a === "account") {
      field("Статус", "kind", [
        ["vip", "VIP"],
        ["premium", "Premium"],
      ]);
      field("Добавить дней, 0 - отключить", "days", null, {
        type: "number",
        min: 0,
        max: 365,
        step: 1,
        value: 7,
      });
    }
    if (a === "inventory") {
      field(
        "Бустер и текущий остаток",
        "boosterId",
        player.boosters.map((b) => [b.id, `${b.name} (${fmt(player.inventory[b.id] || 0)})`]),
      );
      field("Изменение, минус для списания", "amount", null, {
        type: "number",
        min: -10000,
        max: 10000,
        step: 1,
        value: 1,
      });
    }
    const forbidden =
      (adminRole === "moderator" && player.isOwner) || (a === "ban" && player.isOwner) || (player.inArena && !["ban", "unban"].includes(a));
    $("editHint").textContent =
      adminRole === "moderator" && player.isOwner ? "Данные владельца доступны только для просмотра." : player.isOwner && a === "ban"
        ? "Единственного владельца нельзя заблокировать."
        : player.inArena && !["ban", "unban"].includes(a)
          ? "Игрок должен выйти с арены, чтобы можно было изменить его данные."
          : a === "ban"
            ? "Игрок будет отключён от арены. Причина будет видна ему при входе."
            : a === "level" ? "Опыт — начало выбранного уровня. Награды за пропущенные уровни не выдаются. Предметы и достижения сохраняются."
            : "Правка применяется сразу после подтверждения.";
    window.KillexControls.state($("review"), forbidden || !!pending || busy, forbidden);
  }
  function describe(value) {
    if (value === undefined) return "—";
    if (value === null) return "Нет блокировки";
    if (typeof value !== "object") return String(value);
    if (Object.hasOwn(value, "until"))
      return `${value.until ? "До " + date(value.until) : "Бессрочно"}\n${value.reason}`;
    return Object.entries(value)
      .map(
        ([key, val]) =>
          `${words[key] || player?.boosters.find((b) => b.id === key)?.name || key}: ${key.endsWith("Until") ? date(val) : typeof val === "number" ? fmt(val) : typeof val === "string" ? val : JSON.stringify(val)}`,
      )
      .join("\n");
  }
  async function audit() {
    const serial=++auditSerial;
    const target = !allAudit && player ? player.id : "",
      value = await api("audit?source=actions&targetId=" + encodeURIComponent(target) + "&page=" + auditPage);
    if(serial!==auditSerial || !csrf)return;
    auditPage = value.page;
    $("audit").replaceChildren();
    $("auditHint").textContent = target
      ? "Действия для «" + player.name + "»"
      : "Действия для всех аккаунтов";
    $("auditScope").textContent = allAudit ? "Выбранный игрок" : "Все игроки";
    for (const e of value.entries) {
      const n = node("details", undefined, "audit-entry"),
        changes = node("div", undefined, "audit-change");
      const summary=node('summary');summary.append(node('strong',e.label+' — '+e.targetName),node('time',new Date(e.at).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'})+' МСК'));n.append(summary);
      n.append(
        node("p", e.reason),
        node("p", "Кто выполнил: " + (e.actorName || e.actorId || "Система"), "muted identifier"),
      );
      if(e.operationId)n.append(node("p","ID операции: "+e.operationId,"identifier"));
      changes.append(
        node("div", "Было\n" + (["promoCodes", "gameNews"].includes(e.action) && e.before === null ? "Запись отсутствует" : describe(e.before))),
        node("div", "Стало\n" + (["promoCodes", "gameNews"].includes(e.action) && e.after === null ? "Запись удалена" : describe(e.after))),
      );
      changes.hidden = e.before === undefined && e.after === undefined;
      n.append(
        changes,
        node("p", "Аккаунт: " + e.targetId + ". Запись: " + e.id, "muted identifier"),
      );
      $("audit").append(n);
    }
    if (!value.entries.length) $("audit").append(node("p", "Изменений пока нет.", "muted"));
    $("auditPage").textContent = `${value.page} / ${value.pages}`;
    window.KillexControls.state($("prevAudit"), value.page <= 1);
    window.KillexControls.state($("nextAudit"), value.page >= value.pages);
  }
  function review(event) {
    event.preventDefault();
    if (!player || pending || busy) return;
    const action = $("action").value,
      command = {
        action,
        targetId: player.id,
        revision: player.revision,
        moderationRevision: player.moderationRevision,
        requestId: window.KillexRequestIds.create(),
        reason: $("reason").value.trim(),
      };
    let summary = "";
    if (action === "ban") {
      command.minutes = $("minutes").value === "forever" ? null : Number($("minutes").value);
      summary = "Заблокировать: " + $("minutes").selectedOptions[0].textContent;
    }
    if (action === "unban") summary = "Снять блокировку";
    if (action === "rename") {
      command.name = $("newName").value;
      summary = `Ник: ${player.name} → ${command.name}`;
    }
    if (action === "level") {
      command.level = Number($("newLevel").value);
      summary = `Уровень: ${player.level} → ${command.level}. Опыт — начало уровня, без наград.`;
    }
    if (action === "wallet" || action === "inventory") {
      command.amount = Number($("amount").value);
      if (!command.amount) {
        notice("Укажи ненулевое количество.", "error");
        return;
      }
      const key = action === "wallet" ? "currency" : "boosterId";
      command[key] = $(key).value;
      const old = (action === "wallet" ? player.wallet : player.inventory)[command[key]] || 0;
      summary = `${$(key).selectedOptions[0].textContent}: ${fmt(old)} → ${fmt(old + command.amount)}`;
    }
    if (action === "account") {
      command.kind = $("kind").value;
      command.days = Number($("days").value);
      summary = `${command.kind.toUpperCase()}: ${command.days ? "+" + command.days + " дней к действующему сроку" : "отключить"}`;
    }
    reviewCommand(command, summary);
  }
  function inventoryReview({ boosterId, amount, reason }) {
    if (!player || pending || busy) return;
    const booster = player.boosters.find(b => b.id === boosterId);
    if (!booster) return;
    const command = { action: "inventory", targetId: player.id, revision: player.revision,
      moderationRevision: player.moderationRevision, requestId: window.KillexRequestIds.create(), boosterId, amount, reason };
    const count = player.inventory[boosterId] || 0;
    reviewCommand(command, `${booster.name}: ${fmt(count)} → ${fmt(count + amount)}`);
  }
  function playerEditReview({ action, value, reason }) {
    if (!player || pending || busy || playerEditor.forbidden) return;
    const command = { action, targetId: player.id, revision: player.revision,
      requestId: window.KillexRequestIds.create(), reason };
    if (action === "rename") {
      command.name = value;
      reviewCommand(command, `Ник: ${player.name} → ${value}`);
    } else {
      command.level = Number(value);
      reviewCommand(command, `Уровень: ${player.level} → ${command.level}. Опыт — начало уровня, без наград.`);
    }
  }
  function reviewCommand(command, summary) {
    $("reviewText").textContent =
      `Игрок: ${player.name}\nID: ${player.id}\n\n${summary}\n\nПричина: ${command.reason}`;
    $("commit").onclick = () => {
      pending = command;
      $("confirmDialog").close();
      commit();
    };
    $("confirmDialog").showModal();
  }
  async function commit() {
    if (!pending || busy) return;
    busy = true;
    notice("");
    $("retry").hidden = true;
    fields();
    try {
      const result = await api("action", pending);
      pending = null;
      player = result.player;
      notice(
        result.duplicate
          ? "Правка уже была сохранена. Повторного начисления нет."
          : "Правка сохранена и записана в журнал.",
        "success",
      );
      renderPlayer();
      await Promise.all([list(), audit(), journal.select(player)]);
    } catch (error) {
      if (error.status && ![401, 429, 500, 503].includes(error.status)) pending = null;
      fail(error);
      if (pending) {
        $("retry").hidden = false;
        notice(
          "Ответ о сохранении не получен. Повтори тот же запрос кнопкой ниже: он защищён от двойного начисления. " +
            $("notice").textContent,
          "error",
        );
      }
    } finally {
      busy = false;
      fields();
    }
  }
  async function enter(status) {
    if (status.requires2fa) { securityUI.challenge(status); return; }
    adminRole = status.role || "owner";
    feedbackPanel.ready();
    playerTabs.ready(adminRole);
    setup = false;
    $("adminLoginLabel").hidden = false;
    $("adminLogin").required = true;
    $("setupLabel").hidden = true;
    $("setupCode").required = false;
    $("password").autocomplete = "current-password";
    $("loginTitle").textContent = "Вход в админку";
    $("loginHint").textContent = "Введи логин и пароль админ-панели.";
    csrf = status.csrf;
    $("loginPanel").hidden = true;
    $("workspace").hidden = false;
    $("logout").hidden = false;
    $("myAdminProfile").hidden = adminRole !== "moderator";
    notice(
      (adminRole === "owner" ? "Доступ владельца подтверждён." : "Доступ модератора подтверждён.") + " Сеанс завершается после 15 минут бездействия, максимум через час." + (adminRole === "owner" && !status.twoFactorEnabled ? " Подключи 2FA в разделе «Модераторы»." : ""),
    );
    if (pending) $("retry").hidden = false;
    transactionHome.append($("transactionsPanel"));
    $("economyWallet").hidden=adminRole==='moderator'||!player;
    if(!player)$("economySelected").textContent='Выбери игрока, чтобы посмотреть его транзакции и баланс.';
    if (adminRole === 'owner') content.active = true;
    dashboard.ready(adminRole === "owner" ? status.ownerName || ownerName : status.login, adminRole);
    controlStatus.ready(adminRole);
    const initial = await Promise.allSettled([list(), audit(), loadOverviewCalendar(), ...(adminRole === "owner" ? [content.load()] : [])]);
    if (!csrf) return;
    for (const result of initial) if (result.status === 'rejected' && result.reason.status !== 503) fail(result.reason);
    refreshPerformance();
  }
  $("loginForm").onsubmit = async (event) => {
    event.preventDefault();
    const button = event.submitter;
    window.KillexControls.state(button, true, false);
    const password = $("password").value,
      setupCode = $("setupCode").value;
    $("password").value = "";
    $("setupCode").value = "";
    try {
      if (recovery) {
        await api("recover-profile", { password });
        location.replace("/");
        return;
      }
      await enter(
        await api(setup ? "setup" : "auth/login", { password, login: $("adminLogin").value, ...(setup ? { setupCode } : {}) }),
      );
      setup = false;
    } catch (error) {
      fail(error);
    } finally {
      window.KillexControls.state(button, false);
    }
  };
  $("logout").onclick = async () => {
    if (busy || pending || events.busy || content.busy || securityUI.busy) {
      notice("Сначала получи результат текущего сохранения.", "error");
      return;
    }
    try {
      await api("logout", {});
      lock();
      notice("Сеанс завершён.");
    } catch (error) {
      fail(error);
    }
  };
  $("searchForm").onsubmit = (event) => {
    event.preventDefault();
    playersPage = 1;
    list().catch(fail);
  };
  async function refreshPerformance() {
    const button = $("refreshPerformance");
    if (button.disabled || !csrf) return;
    window.KillexControls.state(button, true, false);
    try {
      const value = await api("performance");
      if (!csrf) return;
      dashboard.performance(value);
      if(value.available===false){
        $("performanceStats").replaceChildren();
        $("performanceTime").textContent="Игровой сервер недоступен. Сохранённых измерений пока нет. Статус доступности и диск проверяются независимо в мониторинге.";
        return;
      }
      const timing=window.KillexServerHealth.timings(value);
      const fields = [
        ["Игроки на арене / комнаты", (value.online?.arena ?? "—") + " / " + value.arena.rooms],
        ["Игроки в лобби", value.online ? fmt(value.online.lobby) : "—"],
        ["Общий онлайн", value.online ? fmt(value.online.total) : "—"],
        ["Обновления в секунду", fmt(value.updatesHz)],
        ["Работа такта, p95", fmt(value.tickWorkMs.p95) + " мс"],
        ["Интервал тактов, p95", fmt(value.tickIntervalMs.p95) + " мс",
          timing.intervalExcess===null?null:"Цель: "+fmt(timing.target)+" мс · сверх цели: "+fmt(timing.intervalExcess)+" мс"],
        [
          "Ожидание цикла, p95",
          value.eventLoop ? fmt(value.eventLoop.p95Ms) + " мс" : "Нет замера",
          timing.loopExcess===null?null:"Шаг замера: "+fmt(timing.resolution)+" мс · сверх шага: ≈ "+fmt(timing.loopExcess)+" мс",
        ],
        [
          "Очередь прогресса / действий",
          value.persistence.arenaBatches + " / " + value.persistence.queuedActions,
        ],
        ["Память всего процесса (RSS)", fmt(value.memoryMiB.resident) + " МиБ",
          "Включая рабочие потоки"+(Number.isFinite(value.memoryMiB.heapUsed)?" · JS-куча главного потока: "+fmt(value.memoryMiB.heapUsed)+" МиБ":"")],
        [
          "Журнал до контрольной точки",
          fmt(Math.round(value.persistence.pendingWalBytes / 1024)) + " КиБ",
        ],
      ];
      const health = window.KillexServerHealth.assess(value);
      $("performanceStats").replaceChildren(
        ...fields.map(([label, text, detail], index) => {
          const item = node("div", undefined, "stat");
          item.append(node("span", label), node("strong", text));
          if(detail)item.append(node("small",detail,"owner-metric-context"));
          window.KillexServerHealth.paint(item, index <= 2 ? health[0] : health[index-2]);
          return item;
        }),
      );
      $("performanceTime").textContent =
        (value.stale ? "Сохранённый замер — игровой сервер недоступен: " : "Обновлено: ") +
        date(value.capturedAt) +
        ". Окно: " +
        fmt(Math.round(value.windowMs / 1000)) +
        " с. " +
        (value.persistence.paused ? "Арена ожидает сохранения прогресса." : "") +
        " p95 — не выше этого значения в 95% замеров. Превышение шага — приблизительная оценка. Это серверные показатели, не FPS браузера.";
    } catch (error) {
      if (error.status === 503 && controlStatus.active) $("performanceTime").textContent = "Игровой сервер недоступен. Свежих измерений нет.";
      else fail(error);
    } finally {
      window.KillexControls.state(button, false);
    }
  }
  $("refreshPerformance").onclick = event => { event.preventDefault(); event.stopPropagation(); refreshPerformance(); };
  $("performancePanel").addEventListener("toggle", () => {
    if ($("performancePanel").open) refreshPerformance();
  });
  $("refreshPlayer").onclick = () => choose(player.id).catch(fail);
  $("economyAll").onclick = () => journal.selectAll().catch(fail);
  $("economyWallet").onclick = () => {
    if (!player) return;
    dashboard.navigate("players"); $("action").value = "wallet"; fields(); $("action").focus();
  };
  $("action").onchange = fields;
  $("actionForm").onsubmit = review;
  $("retry").onclick = commit;
  for (const [id, type, step] of [
    ["prevPlayers", "players", -1],
    ["nextPlayers", "players", 1],
    ["prevAudit", "audit", -1],
    ["nextAudit", "audit", 1],
  ])
    $(id).onclick = () => {
      if (type === "players") {
        playersPage += step;
        list().catch(fail);
      } else {
        auditPage += step;
        audit().catch(fail);
      }
    };
  $("auditScope").onclick = () => {
    allAudit = !allAudit;
    auditPage = 1;
    audit().catch(fail);
  };
  $("refreshAudit").onclick=()=>{auditPage=1;audit().catch(fail);};
  api("auth/status")
    .then(async (status) => {
      ownerName = status.ownerName;
      setup = status.setupRequired;
      $("setupLabel").hidden = !setup;
      $("setupCode").required = setup;
      $("adminLoginLabel").hidden = setup;
      $("adminLogin").required = !setup;
      $("password").autocomplete = setup ? "new-password" : "current-password";
      $("loginTitle").textContent = setup ? "Первый вход владельца" : "Вход в админку";
      $("loginHint").textContent = setup
        ? "Ключ находится на компьютере сервера в data/owner-first-login.json. Задай отдельный пароль из 12–128 символов."
        : "Введи логин и пароль админ-панели. Логин владельца: owner.";
      if (status.authenticated) await enter(status);
      else {
        $("loginPanel").hidden = false;
        notice("Вход владельца или модератора");
      }
    })
    .catch(async (error) => {
      $("loginPanel").hidden = true;
      fail(error);
      if (error.status !== 403) return;
      try {
        await api("recover-profile");
        recovery = true;
        setup = false;
        $("setupLabel").hidden = true;
        $("setupCode").required = false;
        $("loginTitle").textContent = "Восстановить вход в профиль владельца";
        $("loginHint").textContent =
          "Введи существующий пароль админ-панели. Прогресс сохранится. Вход владельца в других браузерах потребуется восстановить заново.";
        $("loginPanel").hidden = false;
        notice("В этом браузере открыт другой профиль. Можно вернуться в аккаунт владельца.");
      } catch (_) {
        // Public hosts and unconfigured owners keep the original access denial.
      }
    });
})();

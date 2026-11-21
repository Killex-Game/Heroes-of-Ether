/* Общий вывод сообщений, компактный чат арены и приватный чат клана. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  async function json(url, options = {}) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(url, {
        ...options,
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.code === "ACCOUNT_BANNED") location.assign("/blocked.html");
        throw Object.assign(Error(data.error || "Нет связи с чатом."), {
          status: response.status, code: data.code, chatModeration: data.chatModeration,
        });
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
  class Panel {
    constructor({ title, send, onFocus = () => {} }) {
      this.send = send;
      this.enabled = true;
      this.generation = 0;
      this.messages = [];
      this.root = el("section", "player-chat");
      this.root.setAttribute("aria-label", title);
      this.log = el("div", "chat-log");
      this.log.setAttribute("role", "log");
      this.log.setAttribute("aria-live", "polite");
      this.log.setAttribute("aria-label", "Сообщения");
      this.log.tabIndex = 0;
      this.empty = el("p", "chat-empty", "Здесь пока нет сообщений.");
      this.log.append(this.empty);
      this.form = el("form", "chat-form");
      this.input = el("input", "chat-input");
      this.input.type = "text";
      this.input.maxLength = 280;
      this.input.placeholder = "Написать сообщение…";
      this.input.setAttribute("aria-label", "Сообщение, до 280 символов");
      this.input.autocomplete = "off";
      this.button = el("button", "sf-button chat-send", "Отправить");
      this.button.type = "submit";
      this.status = el("p", "chat-status");
      this.status.setAttribute("role", "status");
      this.form.append(this.input, this.button);
      this.root.append(this.log, this.form, this.status);
      this.input.addEventListener("focus", onFocus);
      this.form.addEventListener("submit", (event) => {
        event.preventDefault();
        this.submit();
      });
      this.input.addEventListener("input", () => this.lock());
      this.lock();
    }
    reset(preserveDraft = false) {
      clearTimeout(this.muteTimer);
      this.mutedUntil = 0;
      this.generation++;
      this.messages = [];
      this.log.replaceChildren(this.empty);
      if (!preserveDraft) this.input.value = "";
      this.retry = null;
      this.busy = false;
      this.status.textContent = "";
      this.lock();
    }
    lock() {
      const muted = this.mutedUntil > Date.now();
      window.KillexControls.state(this.input, !this.enabled || muted);
      this.input.readOnly = !!this.busy;
      window.KillexControls.state(
        this.button,
        !this.enabled || muted || !!this.busy || !this.input.value.trim(),
        !this.enabled || muted || !this.input.value.trim(),
      );
    }
    moderation(state) {
      if (!state) return;
      clearTimeout(this.muteTimer);
      const remaining = Math.max(0, (state.until || 0) - state.serverNow);
      this.mutedUntil = remaining ? Date.now() + remaining : 0;
      if (remaining) {
        this.status.textContent = `${state.reason}. Чат недоступен до ${new Date(state.until).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}.`;
        this.muteTimer = setTimeout(() => {
          this.mutedUntil = 0;
          this.muteNotice = false;
          this.status.textContent = "";
          this.lock();
        }, remaining + 25);
      } else if (this.muteNotice) this.status.textContent = "";
      this.muteNotice = !!remaining;
      this.lock();
    }
    enable(value) {
      this.enabled = value;
      this.lock();
    }
    paintAuthor(node, author) {
      node.textContent = `${author.clanTag ? "[" + author.clanTag + "] " : ""}${author.name}${Number.isSafeInteger(author.level) && author.level > 0 ? " [" + author.level + "]" : ""}`;
      for (const status of ["vip", "premium"])
        node.classList.toggle("account-label-" + status, author.status === status);
    }
    refreshAuthors(authors, expiresBefore) {
      const scrollTop = this.log.scrollTop;
      const rows = new Map([...this.log.children].map((row) => [row.dataset.messageId, row]));
      for (const m of this.messages) {
        const row = rows.get(m.id);
        if (Number.isFinite(expiresBefore) && m.at <= expiresBefore) {
          row?.remove();
          continue;
        }
        const author = authors?.[m.author.id];
        if (
          !author ||
          ["name", "clanTag", "level", "status"].every((key) => author[key] === m.author[key])
        )
          continue;
        m.author = author;
        if (row) this.paintAuthor(row.querySelector(".chat-author"), author);
      }
      if (Number.isFinite(expiresBefore))
        this.messages = this.messages.filter((m) => m.at > expiresBefore);
      if (!this.messages.length) this.log.replaceChildren(this.empty);
      this.log.scrollTop = scrollTop;
    }
    append(messages, reset = false) {
      const bottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
      if (reset) {
        this.messages = [];
        this.log.replaceChildren(this.empty);
      }
      for (const m of messages) {
        if (this.messages.some((old) => old.id === m.id)) continue;
        this.empty.remove();
        this.messages.push(m);
        const row = el("div", "chat-message"),
          meta = el("div", "chat-meta");
        row.dataset.messageId = m.id;
        row.classList.toggle("chat-system-result", m.kind === "clan-battle-result");
        const name = el("strong", "chat-author");
        this.paintAuthor(name, m.author);
        const time = el(
          "time",
          "chat-time",
          new Date(m.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
        );
        time.dateTime = new Date(m.at).toISOString();
        time.title = new Date(m.at).toLocaleString("ru-RU");
        meta.append(name, time);
        row.append(meta, el("p", "chat-text", m.text));
        this.log.append(row);
        if (this.messages.length > 100) {
          this.messages.shift();
          this.log.firstElementChild.remove();
        }
      }
      if (bottom || reset) this.log.scrollTop = this.log.scrollHeight;
    }
    appendSystem(messages) {
      if (!messages.some(m => !this.messages.some(old => old.id === m.id))) return;
      const bottom = this.log.scrollHeight - this.log.scrollTop - this.log.clientHeight < 40;
      const top = this.log.scrollTop;
      const merged = [...new Map([...this.messages, ...messages].map(m => [m.id, m])).values()]
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).slice(-100);
      this.append(merged, true);
      if (!bottom) this.log.scrollTop = top;
    }
    async submit() {
      if (!this.enabled || this.busy || this.mutedUntil > Date.now() || !this.input.value.trim()) return;
      const text = this.input.value,
        generation = this.generation;
      const request =
        this.retry?.text === text
          ? this.retry
          : { text, requestId: window.KillexRequestIds.create() };
      this.retry = request;
      this.busy = true;
      this.lock();
      this.status.textContent = "";
      try {
        const result = await this.send(request);
        if (generation !== this.generation) return;
        this.append([result.message]);
        this.input.value = "";
        this.retry = null;
        this.status.textContent = "Отправлено";
      } catch (error) {
        if (generation === this.generation) {
          if (["CHAT_MUTED", "CHAT_REJECTED"].includes(error.code)) this.retry = null;
          this.status.textContent =
            error.name === "AbortError"
              ? "Ответ задерживается. Повтори отправку."
              : error.message || "Нет связи с чатом. Повтори отправку.";
          this.moderation(error.chatModeration);
        }
      } finally {
        if (generation === this.generation) {
          this.busy = false;
          this.lock();
        }
      }
    }
  }
  class ArenaChat {
    constructor(send, onFocus) {
      this.panel = new Panel({
        title: "Чат арены",
        send: (request) => this.post(request),
        onFocus,
      });
      this.panel.form.before(this.panel.status);
      this.root = el("aside", "arena-chat");
      this.root.id = "arenaChat";
      this.toggle = el("button", "sf-button arena-chat-toggle", "Чат арены");
      this.toggle.type = "button";
      this.toggle.setAttribute("aria-controls", "arenaChatBody");
      this.panel.root.id = "arenaChatBody";
      this.root.append(this.toggle, this.panel.root);
      document.getElementById("arena").append(this.root);
      this.send = send;
      this.toggle.addEventListener("click", () => this.expand(this.panel.root.hidden));
      this.expand(false);
      this.panel.input.addEventListener("keydown", (event) => {
        if (event.code === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.expand(false);
          this.toggle.focus();
        }
      });
      this.disconnect();
    }
    expand(open) {
      this.panel.root.hidden = !open;
      this.toggle.setAttribute("aria-expanded", String(open));
      this.toggle.textContent = open ? "Свернуть чат" : "Чат арены";
      if (open) {
        this.unread = false;
        this.panel.log.scrollTop = this.panel.log.scrollHeight;
      }
      this.paintUnread();
    }
    paintUnread() {
      this.toggle.querySelector(".menu-notification-dot")?.remove();
      if (this.unread) {
        const dot = el("span", "menu-notification-dot");
        dot.setAttribute("aria-label", "Есть новые сообщения");
        this.toggle.append(dot);
      }
    }
    start(profileId) {
      this.disconnect();
      this.panel.reset(!!profileId && profileId === this.draftOwner);
      this.draftOwner = profileId;
      this.unread = false;
      this.expand(false);
    }
    connect() {
      this.panel.enable(true);
    }
    disconnect() {
      clearTimeout(this.panel.muteTimer);
      this.panel.enable(false);
      if (this.pending) {
        clearTimeout(this.pending.timer);
        this.pending.reject(Error("Связь потеряна. Сообщение не подтверждено."));
        this.pending = null;
      }
    }
    post(request) {
      return new Promise((resolve, reject) => {
        this.pending = {
          ...request,
          resolve,
          reject,
          timer: setTimeout(() => {
            this.pending = null;
            reject(Error("Ответ задерживается. Повтори отправку."));
          }, 8000),
        };
        if (!this.send({ type: "chatSend", ...request })) this.disconnect();
      });
    }
    receive(packet) {
      if (packet.type === "chatHistory") {
        this.panel.append(packet.messages, true);
        this.panel.moderation(packet.chatModeration);
      }
      if (packet.type === "chatMessage") {
        const fresh = !this.panel.messages.some((m) => m.id === packet.message.id);
        this.panel.append([packet.message]);
        if (fresh && this.panel.root.hidden) {
          this.unread = true;
          this.paintUnread();
        }
      }
      if (packet.type === "chatResult" && packet.requestId === this.pending?.requestId) {
        clearTimeout(this.pending.timer);
        if (packet.ok) this.pending.resolve(packet);
        else this.pending.reject(Object.assign(Error(packet.error), { code: packet.code, chatModeration: packet.chatModeration }));
        this.pending = null;
      }
    }
  }
  class ClanChat {
    constructor(owner) {
      this.owner = owner;
      this.panel = new Panel({ title: "Чат клана", send: (request) => this.post(request) });
      this.owner.dialog.addEventListener("close", () => clearTimeout(this.panel.muteTimer));
      this.panel.root.classList.add("clan-chat");
      this.root = el("div", "clan-chat-layout");
      this.history = el("aside", "clan-member-history player-chat");
      this.history.setAttribute("aria-label", "История участников");
      this.historyLog = el("div", "clan-history-log");
      this.historyLog.tabIndex = 0;
      this.historyLog.setAttribute("aria-label", "Хронология участников клана");
      this.historyItems = el("ol", "clan-history-items");
      this.historyEmpty = el("p", "chat-empty", "Здесь появятся изменения состава и должностей.");
      this.older = el("button", "sf-button clan-history-older", "Ранее");
      this.older.type = "button";
      this.older.hidden = true;
      this.older.addEventListener("click", () => this.loadOlder());
      this.historyStatus = el("p", "chat-status");
      this.historyStatus.setAttribute("role", "status");
      this.historyLog.append(this.historyEmpty, this.historyItems, this.older);
      this.history.append(
        el("h3", "clan-history-heading", "История участников"),
        this.historyLog,
        this.historyStatus,
      );
      this.root.append(this.panel.root, this.history);
      this.entries = new Map();
      this.dateFormat = new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      window.KillexActivity.every(() => {
        if (this.active() && !document.hidden) this.load();
      }, 3000, () => this.active());
    }
    active() {
      return (
        this.owner.dialog.open &&
        this.owner.mode === "chat" &&
        this.owner.data?.mine?.id === this.clanId &&
        window.KillexWindows.top() === this.owner.dialog
      );
    }
    mount(clanId) {
      if (this.clanId !== clanId) {
        this.clanId = clanId;
        this.panel.reset();
        this.resetHistory();
      }
      this.owner.content.append(this.root);
      this.load();
    }
    revoke(error) {
      this.panel.reset();
      this.resetHistory();
      this.panel.enable(false);
      this.panel.status.textContent = error.message;
    }
    async load() {
      if (this.loading) return;
      this.loading = true;
      const clanId = this.clanId;
      try {
        const after = this.panel.messages.at(-1)?.id || "";
        const data = await json(
          "/api/clans/chat?" +
            new URLSearchParams({
              clanId,
              after,
              historyAfter: this.newest || "",
            }),
        );
        if (!this.active() || clanId !== this.clanId) return;
        this.panel.enable(true);
        this.panel.moderation(data.chatModeration);
        this.panel.append(data.messages, data.reset);
        this.panel.appendSystem(data.systemMessages || []);
        this.panel.refreshAuthors(data.authors, data.expiresBefore);
        this.appendHistory(data.memberHistory);
      } catch (error) {
        if (clanId !== this.clanId || !this.active()) return;
        if ([401, 403].includes(error.status)) this.revoke(error);
        else this.panel.status.textContent = "Нет связи с чатом.";
      } finally {
        this.loading = false;
      }
    }
    resetHistory() {
      this.historyGeneration = (this.historyGeneration || 0) + 1;
      this.entries.clear();
      this.newest = this.oldest = 0;
      this.historyItems.replaceChildren();
      this.historyEmpty.hidden = false;
      this.older.hidden = true;
      this.historyStatus.textContent = "";
    }
    historyText(row) {
      const a = row.actor.name,
        t = row.target.name;
      const form = (person, male, female, unknown = male + "(а)") =>
        person.gender === "male" ? male : person.gender === "female" ? female : unknown;
      const actor = (male, female, unknown) => form(row.actor, male, female, unknown);
      const target = (male, female, unknown) => form(row.target, male, female, unknown);
      const roles = {
        head: "Глава",
        manager: "Управляющий",
        officer: "Офицер",
        member: "Участник",
        recruit: "Новобранец",
      };
      const power = { head: 3, manager: 2, officer: 1, member: 0, recruit: 0 };
      switch (row.action) {
        case "created":
          return `${a} ${actor("создал", "создала")} клан и ${actor("стал", "стала")} главой.`;
        case "joined":
          return `${t} ${target("вступил", "вступила")} в клан.`;
        case "accepted":
          return `${a} ${actor("принял", "приняла")} в клан ${t}.`;
        case "left":
          return `${t} ${target("вышел", "вышла", "вышел(ла)")} из клана.`;
        case "kicked":
          return `${a} ${actor("исключил", "исключила")} из клана ${t}.`;
        case "transfer":
          return `${a} ${actor("передал", "передала")} руководство ${t} и ${actor("стал участником", "стала участницей", "стал(а) участником")}.`;
        case "role":
          return `${a} ${power[row.toRole] < power[row.fromRole] ? actor("понизил", "понизила") : actor("назначил", "назначила")} ${t}: ${roles[row.fromRole]} → ${roles[row.toRole]}.`;
        default:
          return "Изменение состава клана.";
      }
    }
    appendHistory(data, older = false) {
      if (!data) return;
      if (data.reset) this.resetHistory();
      if (!data.entries.length) return;
      const wasEmpty = !this.entries.size;
      for (const row of data.entries) this.entries.set(row.id, row);
      const rows = [...this.entries.values()].sort((a, b) => b.id - a.id);
      this.newest = rows[0].id;
      this.oldest = rows.at(-1).id;
      const scrollTop = this.historyLog.scrollTop,
        height = this.historyLog.scrollHeight;
      this.historyItems.replaceChildren(
        ...rows.map((row) => {
          const item = el("li", "clan-history-entry");
          const time = el("time", "clan-history-time", this.dateFormat.format(new Date(row.at)));
          time.dateTime = new Date(row.at).toISOString();
          item.append(time, el("p", "clan-history-text", this.historyText(row)));
          return item;
        }),
      );
      this.historyEmpty.hidden = true;
      if (older || wasEmpty || data.reset) this.older.hidden = !data.hasOlder;
      // New records must not displace someone reading an older event.
      this.historyLog.scrollTop =
        older || scrollTop < 8 ? scrollTop : scrollTop + this.historyLog.scrollHeight - height;
      this.historyStatus.textContent = "";
    }
    async loadOlder() {
      if (this.olderBusy || !this.oldest || !this.active()) return;
      const clanId = this.clanId,
        generation = this.historyGeneration;
      this.olderBusy = true;
      window.KillexControls.state(this.older, true, false);
      try {
        const data = await json(
          "/api/clans/chat?" +
            new URLSearchParams({
              clanId,
              after: this.panel.messages.at(-1)?.id || "",
              historyBefore: this.oldest,
            }),
        );
        if (this.active() && clanId === this.clanId && generation === this.historyGeneration)
          this.appendHistory(data.memberHistory, true);
      } catch (error) {
        if (this.active() && clanId === this.clanId && generation === this.historyGeneration) {
          if ([401, 403].includes(error.status)) this.revoke(error);
          else this.historyStatus.textContent = "Не удалось загрузить историю. Попробуй ещё раз.";
        }
      } finally {
        this.olderBusy = false;
        window.KillexControls.state(this.older, false);
      }
    }
    async post(request) {
      const clanId = this.clanId;
      try {
        return await json("/api/clans/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...request, clanId }),
        });
      } catch (error) {
        if (clanId === this.clanId && [401, 403].includes(error.status)) this.revoke(error);
        throw error;
      }
    }
  }
  window.KillexChat = { ArenaChat, ClanChat };
})();

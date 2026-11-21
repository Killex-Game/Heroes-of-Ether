"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text, action, cls = "sf-button sf-secondary") => {
    const node = el("button", cls, text);
    node.type = "button";
    node.onclick = action;
    return node;
  };
  class ArenaPicker {
    constructor(owner) {
      this.owner = owner;
      this.opener = document.getElementById("arenaPickerButton");
      this.page = 0;
      this.cards = new Map();
      this.dialog = el("dialog", "clan-dialog interface-window arena-picker-dialog");
      this.dialog.id = "arenaPickerDialog";
      this.dialog.setAttribute("aria-labelledby", "arenaPickerTitle");
      const heading = el("header", "clan-heading");
      const title = el("h2", "", "Выбор арены");
      title.id = "arenaPickerTitle";
      this.title = title;
      const close = button("×", () => this.dialog.close(), "booster-close");
      close.setAttribute("aria-label", "Закрыть выбор арены");
      heading.append(title, close);
      this.auto = button("Автовыбор", () => this.choose(null), "sf-tab arena-auto");
      this.grid = el("div", "arena-choice-grid");
      this.grid.setAttribute("role", "group");
      this.grid.setAttribute("aria-label", "Доступные арены");
      this.status = el("p", "arena-picker-status");
      this.status.setAttribute("role", "status");
      this.pager = el("nav", "arena-picker-pages");
      this.previous = button("‹", () => {
        this.page--;
        this.paginate();
      });
      this.previous.setAttribute("aria-label", "Предыдущие арены");
      this.next = button("›", () => {
        this.page++;
        this.paginate();
      });
      this.next.setAttribute("aria-label", "Следующие арены");
      this.pageLabel = el("span");
      this.pager.append(this.previous, this.pageLabel, this.next);
      this.pager.hidden = true;
      this.dialog.append(heading, this.auto, this.grid, this.pager, this.status);
      document.body.append(this.dialog);
      this.noticeElement = el("p", "arena-transfer-notice");
      this.noticeElement.setAttribute("role", "status");
      this.noticeElement.hidden = true;
      document.body.append(this.noticeElement);
      this.opener.onclick = () => this.open();
      this.dialog.addEventListener("close", () => {
        this.stop();
        this.opener.focus({ preventScroll: true });
      });
      document.addEventListener("visibilitychange", () => this.syncVisibility());
      window.addEventListener("resize", () => this.paginate());
      document.addEventListener("killex:profile", () => this.updateTitle());
      this.updateTitle();
    }
    key() {
      return `${window.KillexPlatform.storageKey(".")}arena.${this.owner.getProfile()?.id || "guest"}.${window.KillexArenaNames.groupForLevel(this.owner.getProfile()?.level).id}`;
    }
    preferred() {
      try {
        const id = localStorage.getItem(this.key());
        return /^arena-[1-9][0-9]*$/.test(id || "") ? id : null;
      } catch {
        return this.selected || null;
      }
    }
    choose(id) {
      this.selected = id;
      try {
        if (id) localStorage.setItem(this.key(), id);
        else localStorage.removeItem(this.key());
      } catch {
        /* Selection remains available for this tab. */
      }
      this.updateTitle();
      this.dialog.close();
    }
    updateTitle() {
      const group = window.KillexArenaNames.groupForLevel(this.owner.getProfile()?.level);
      this.title.textContent = group.title;
      this.opener.removeAttribute("title");
      this.opener.setAttribute("aria-label", group.title);
      if (this.dialog.open && this.groupId !== group.id) this.load();
      this.groupId = group.id;
    }
    open() {
      if (!this.owner.isLobby() || this.opener.disabled) return;
      this.page = 0;
      this.auto.setAttribute("aria-pressed", String(!this.preferred()));
      window.KillexWindows.open(this.dialog);
      this.load();
    }
    showClosed(message = "Арена временно закрыта, попробуй войти позже") {
      this.dialog.close();
      if (!this.closedDialog) {
        const dialog = el("dialog", "clan-dialog interface-window arena-closed-dialog");
        dialog.id = "arenaClosedDialog";
        dialog.setAttribute("aria-labelledby", "arenaClosedTitle");
        const heading = el("header", "clan-heading"), title = el("h2", "", "Арена");
        title.id = "arenaClosedTitle";
        const close = button("×", () => dialog.close(), "booster-close");
        close.setAttribute("aria-label", "Вернуться в лобби");
        heading.append(title, close);
        this.closedCopy = el("p", "arena-closed-copy");
        dialog.append(heading, this.closedCopy, button("В лобби", () => dialog.close()));
        document.body.append(dialog);
        this.closedDialog = dialog;
      }
      this.closedCopy.textContent = message;
      window.KillexWindows.open(this.closedDialog);
    }
    async load() {
      if (!this.dialog.open || document.hidden || !this.owner.isLobby()) return;
      clearTimeout(this.timer);
      this.loading?.abort();
      const request = new AbortController();
      this.loading = request;
      const timeout = setTimeout(() => request.abort(), 4000);
      this.status.textContent = "";
      try {
        const response = await fetch("/api/arenas", { cache: "no-store", signal: request.signal });
        const data = await response.json();
        if (data.code === "ARENA_TEMPORARILY_CLOSED") { this.showClosed(data.error); return; }
        if (!response.ok || !Array.isArray(data.arenas))
          throw Error(data.error || "Не удалось загрузить арены.");
        if (!this.dialog.open || this.loading !== request) return;
        if (data.group) this.title.textContent = data.group.title;
        for (const arena of data.arenas) {
          let card = this.cards.get(arena.id);
          if (!card) {
            card = button("", () => this.choose(arena.id), "arena-choice");
            card.dataset.arenaId = arena.id;
            const picture = el("img");
            picture.src = "assets/ui/arena-planet-v1.webp";
            picture.alt = "";
            card.append(picture, el("strong"), el("span", "arena-occupancy"), el("small"));
            this.cards.set(arena.id, card);
            this.grid.append(card);
          }
          card.querySelector("strong").textContent = arena.name;
          card.querySelector(".arena-occupancy").textContent =
            `${arena.playing + arena.reserved} / ${arena.capacity}`;
          card.querySelector("small").textContent =
            arena.status === "starting"
              ? "Подготовка"
              : arena.status !== "ready"
                ? "Недоступна"
                : arena.joinable
                  ? "Можно войти"
                  : "Нет свободных мест";
          window.KillexControls.state(card, !arena.joinable);
          card.setAttribute("aria-pressed", String(this.preferred() === arena.id));
        }
        for (const [id, card] of this.cards)
          if (!data.arenas.some((arena) => arena.id === id)) {
            card.remove();
            this.cards.delete(id);
          }
        this.status.textContent = data.arenas.some((arena) => arena.joinable)
          ? ""
          : "Сейчас все арены заняты, попробуйте позже";
        this.paginate();
      } catch (error) {
        if (!this.dialog.open || this.loading !== request) return;
        this.status.textContent =
          error.name === "AbortError"
            ? "Сервер не отвечает. Повторяем подключение…"
            : error.message;
        for (const card of this.cards.values()) window.KillexControls.state(card, true);
      } finally {
        clearTimeout(timeout);
        if (this.loading === request) {
          this.loading = null;
          if (this.dialog.open && !document.hidden && this.owner.isLobby())
            this.timer = setTimeout(() => this.load(), 4000);
        }
      }
    }
    stop() {
      clearTimeout(this.timer);
      this.loading?.abort();
      this.loading = null;
    }
    syncVisibility() {
      if (document.hidden || !this.dialog.open || !this.owner.isLobby()) this.stop();
      else this.load();
    }
    paginate() {
      if (!this.dialog.open || !this.grid.clientWidth) return;
      const style = getComputedStyle(this.grid);
      const width = parseFloat(style.getPropertyValue("--arena-card-width"));
      const columns = Math.max(1, Math.floor((this.grid.clientWidth + 8) / (width + 8)));
      const size = columns * (innerHeight < 520 ? 1 : 2);
      const count = Math.max(1, Math.ceil(this.cards.size / size));
      this.page = Math.max(0, Math.min(this.page, count - 1));
      [...this.cards.values()].forEach((card, index) => {
        card.hidden = Math.floor(index / size) !== this.page;
      });
      this.pager.hidden = count <= 1;
      window.KillexControls.state(this.previous, this.page === 0);
      window.KillexControls.state(this.next, this.page === count - 1);
      this.pageLabel.textContent = `${this.page + 1} / ${count}`;
    }
    async post(path, input) {
      const request = new AbortController();
      const timeout = setTimeout(() => request.abort(), 5000);
      try {
        const response = await fetch(path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: request.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw Object.assign(Error(data.error || "Не удалось выбрать арену."), {
            serverResponse: true,
            code: data.code,
          });
        return data;
      } finally {
        clearTimeout(timeout);
      }
    }
    async reserve() {
      const pending = {
        requestId: window.KillexRequestIds.create(),
        preferredArenaId: this.preferred(),
      };
      this.pending = pending;
      let result;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          result = await this.post("/api/arena-reservations", pending);
          break;
        } catch (error) {
          if (error.serverResponse || attempt || pending.cancelled) {
            this.cancelPending();
            throw error;
          }
        }
      }
      if (pending.cancelled) {
        await this.post("/api/arena-reservations/cancel", { requestId: pending.requestId }).catch(
          () => {},
        );
        throw Error("Подключение отменено.");
      }
      this.notice = result.redirected
        ? `Выбранная арена занята или недоступна. Подключена арена «${result.name}».`
        : "";
      return result;
    }
    joined() {
      this.pending = null;
      if (this.notice) {
        this.noticeElement.textContent = this.notice;
        this.noticeElement.hidden = false;
        clearTimeout(this.noticeTimer);
        this.noticeTimer = setTimeout(() => {
          this.noticeElement.hidden = true;
        }, 6000);
      }
      this.notice = "";
    }
    cancelPending() {
      const pending = this.pending;
      if (!pending) return;
      pending.cancelled = true;
      this.pending = null;
      this.post("/api/arena-reservations/cancel", { requestId: pending.requestId }).catch(() => {});
    }
  }
  window.KillexArenaPicker = ArenaPicker;
})();

"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, action, cls = "sf-button sf-secondary") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.onclick = action;
    return b;
  };
  const number = (n) => n.toLocaleString("ru-RU");
  const range = (v) => (v[0] === v[1] ? number(v[0]) : `${number(v[0])}–${number(v[1])}`);
  class QuestsUI {
    constructor(owner) {
      this.owner = owner;
      this.profile = owner.getProfile();
      this.dialog = el("dialog", "clan-dialog quests-dialog");
      this.dialog.id = "questsDialog";
      this.dialog.setAttribute("aria-labelledby", "questsTitle");
      const head = el("header", "clan-heading"),
        title = el("h2", "", "Личные задания");
      title.id = "questsTitle";
      const close = button("×", () => this.dialog.close(), "booster-close");
      close.setAttribute("aria-label", "Закрыть задания");
      head.append(title, close);
      this.summary = el("p", "quests-summary");
      this.grid = el("div", "quests-grid");
      this.page = 0;
      this.pages = el("nav", "quests-pages");
      this.pages.setAttribute("aria-label", "Страницы заданий");
      this.previous = button("‹", () => {
        this.page--;
        this.paginate();
      });
      this.previous.setAttribute("aria-label", "Предыдущие задания");
      this.next = button("›", () => {
        this.page++;
        this.paginate();
      });
      this.next.setAttribute("aria-label", "Следующие задания");
      this.pageLabel = el("span");
      this.pageLabel.setAttribute("aria-live", "polite");
      this.pages.append(this.previous, this.pageLabel, this.next);
      this.error = el("span", "clan-form-error");
      this.error.hidden = true;
      this.dialog.append(head, this.summary, this.grid, this.pages, this.error);
      document.body.append(this.dialog);
      this.confirm = el("dialog", "clan-dialog quest-confirm");
      this.confirm.setAttribute("aria-labelledby", "questRerollTitle");
      const confirmHead = el("header", "clan-heading");
      const confirmTitle = el("h2", "", "Сменить задание?");
      confirmTitle.id = "questRerollTitle";
      const confirmClose = button("×", () => this.confirm.close(), "booster-close");
      confirmClose.setAttribute("aria-label", "Закрыть");
      confirmHead.append(confirmTitle, confirmClose);
      const confirmBody = el("div", "quest-confirm-body");
      this.confirmName = el("strong", "quest-confirm-name");
      this.confirmText = el(
        "p",
        "quest-confirm-note",
        "Вместо этого задания появится новое. Текущий прогресс задания сбросится.",
      );
      this.confirmReward = el("span");
      this.confirmCost = el("strong");
      const details = el("dl", "quest-confirm-details");
      const reward = el("dd"),
        cost = el("dd");
      reward.append(this.confirmReward);
      cost.append(this.confirmCost);
      details.append(
        el("dt", "", "Награда сохранится"),
        reward,
        el("dt", "", "Стоимость смены"),
        cost,
      );
      const actions = el("div", "quest-confirm-actions");
      actions.append(
        button("Сменить", () => {
          const input = this.confirmInput;
          this.confirm.close();
          this.begin(input);
        }),
        button("Оставить", () => this.confirm.close()),
      );
      confirmBody.append(this.confirmName, this.confirmText, details, actions);
      this.confirm.append(confirmHead, confirmBody);
      document.body.append(this.confirm);
      document.getElementById("questsSection").onclick = () => this.open();
      document.addEventListener("killex:profile", (e) => {
        this.profile = e.detail;
        this.restorePending();
        if (this.dialog.open) this.render();
      });
      this.dialog.addEventListener("close", () =>
        document.getElementById("questsSection").focus({ preventScroll: true }),
      );
      this.restorePending();
      this.render();
      new ResizeObserver(([entry]) => {
        const width = Math.round(entry.contentRect.width);
        if (width === this.gridWidth) return;
        this.gridWidth = width;
        requestAnimationFrame(() => this.paginate());
      }).observe(this.grid);
      window.KillexActivity.every(() => {
        if (!this.dialog.open || this.busy || document.hidden) return;
        if (this.pending && this.owner.isLobby() && Date.now() >= (this.retryAt || 0)) {
          this.submit(this.pending);
          return;
        }
        const state = this.profile?.quests;
        if (state && Date.now() >= state.resetsAt && !this.refreshing) {
          this.refreshing = true;
          this.owner.loadProfile().finally(() => {
            this.refreshing = false;
          });
        }
      }, 5000, () => this.dialog.open);
    }
    key() {
      return `${window.KillexPlatform.storageKey("-")}quest-pending-${this.profile?.id || "none"}`;
    }
    restorePending() {
      try {
        this.pending = JSON.parse(localStorage.getItem(this.key()) || "null");
      } catch {
        this.pending = null;
      }
    }
    async open() {
      if (!this.owner.isLobby()) return;
      if (!this.dialog.open) window.KillexAudio?.play?.("quests");
      this.page = 0;
      this.render();
      window.KillexWindows.open(this.dialog);
      this.paginate();
      await this.owner.loadProfile();
      if (this.pending && this.dialog.open) this.submit(this.pending);
    }
    render() {
      const q = this.profile?.quests;
      if (!q) {
        this.summary.textContent = "";
        return;
      }
      this.summary.textContent = "Ежедневные 4 задания, обновляются каждый день.";
      const cards = [];
      for (const row of q.items) {
        const card = el("article", "quest-card"),
          chest = row.chest;
        card.dataset.questId = row.id;
        card.dataset.tier = row.tier;
        card.dataset.state =
          row.claimedAt !== null ? "claimed" : row.completedAt !== null ? "complete" : "active";
        const icon = el("img", "quest-chest");
        icon.src = window.KillexProgressionArt.questChest(chest.art);
        icon.alt = "";
        icon.width = icon.height = 96;
        const chestHelp = el("div", "quest-chest-help"),
          chestButton = button("", () => {}, "quest-chest-trigger");
        chestButton.setAttribute("aria-label", "Награды: " + chest.name);
        chestButton.append(icon);
        chestHelp.append(chestButton);
        card.append(
          el("span", "quest-tier", chest.name),
          chestHelp,
          el("h3", "", row.name),
          el("p", "quest-description", row.description),
        );
        const time = ["top1", "top10", "survival"].includes(row.metric);
        const format = (n) =>
          time ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : number(n);
        card.append(
          el("strong", "quest-progress-text", `${format(row.progress)} / ${format(row.target)}`),
        );
        const meter = el("progress", "quest-progress");
        meter.max = row.target;
        meter.value = row.progress;
        meter.setAttribute("aria-label", `Прогресс: ${row.name}`);
        card.append(meter);
        const rewards = el("div", "quest-rewards");
        rewards.append(
          el(
            "p",
            "",
            `${range(chest.common)} обычных, ${range(chest.advanced)} улучшенных, ${range(chest.rare)} редких бустеров`,
          ),
        );
        rewards.append(
          el("p", "", `${range(chest.coins)} монет и ${range(chest.crystals)} кристаллов`),
        );
        rewards.append(window.KillexGreatnessUI.label(el("p", "", `+${chest.greatness} величия`)));
        const pending = q.pending.find((r) => r.id === row.id);
        const tickets = pending?.tickets ?? (row.completedAt === null ? chest.tickets : 0);
        if (tickets) {
          const line = el("p", "quest-tickets", `+${tickets} бил. рулетки`),
            img = el("img");
          img.src = "assets/roulette/ticket-v2.webp?art=20261122b";
          img.alt = "";
          line.prepend(img);
          rewards.append(line);
        }
        rewards.id = "quest-rewards-" + row.id;
        rewards.setAttribute("role", "tooltip");
        chestButton.setAttribute("aria-describedby", rewards.id);
        chestHelp.append(rewards);
        if (row.completedAt !== null) {
          const claim = button(
            row.expiredAt !== undefined
              ? "Сундук сгорел"
              : row.claimedAt !== null
                ? "Получено"
                : pending?.receivedAt === null
                  ? "Получить"
                  : pending?.stored === false
                    ? "Ожидает места"
                    : "В сокровищницу",
            () => {
              if (pending?.receivedAt === null) {
                this.begin({ action: "receive", questId: row.id });
                return;
              }
              this.dialog.close();
              document.dispatchEvent(
                new CustomEvent("killex:open-chests", { detail: { category: "treasury" } }),
              );
            },
          );
          claim.classList.add("quest-claim");
          window.KillexControls.state(
            claim,
            !!this.busy ||
              !!this.pending ||
              row.claimedAt !== null ||
              row.expiredAt !== undefined ||
              this.owner.inArena(),
            row.claimedAt !== null || row.expiredAt !== undefined || this.owner.inArena(),
          );
          card.append(claim);
        }
        const reroll = button(
          q.rerollCost ? "Сменить за 100 монет" : "Сменить бесплатно",
          () => {
            this.confirmInput = { action: "reroll", questId: row.id, expectedCost: q.rerollCost };
            this.confirmName.textContent = row.name;
            this.confirmReward.textContent = chest.name;
            this.confirmCost.textContent = q.rerollCost
              ? `${number(q.rerollCost)} монет`
              : "Бесплатно";
            window.KillexWindows.open(this.confirm);
          },
          "sf-button sf-tertiary quest-reroll",
        );
        reroll.hidden = row.completedAt !== null;
        window.KillexControls.state(
          reroll,
          !!this.busy || !!this.pending || this.owner.inArena(),
          this.owner.inArena(),
        );
        card.append(reroll);
        cards.push(card);
      }
      this.grid.replaceChildren(...cards);
      this.paginate();
    }
    paginate() {
      if (!this.grid.clientWidth) return;
      const style = getComputedStyle(this.grid),
        cardWidth = parseFloat(style.getPropertyValue("--quest-card-width")),
        gap = parseFloat(style.columnGap),
        size = Math.min(
          4,
          Math.max(1, Math.floor((this.grid.clientWidth + gap) / (cardWidth + gap))),
        ),
        cards = [...this.grid.children],
        count = Math.max(1, Math.ceil(cards.length / size));
      this.page = Math.max(0, Math.min(this.page, count - 1));
      cards.forEach((card, i) => {
        card.hidden = Math.floor(i / size) !== this.page;
      });
      this.pages.hidden = count <= 1;
      window.KillexControls.state(this.previous, this.page === 0);
      window.KillexControls.state(this.next, this.page === count - 1);
      this.pageLabel.textContent = this.page + 1 + " / " + count;
    }
    begin(input) {
      if (this.busy || this.pending || this.owner.inArena()) return;
      this.pending = { ...input, requestId: window.KillexRequestIds.create() };
      try {
        localStorage.setItem(this.key(), JSON.stringify(this.pending));
      } catch {
        /* retry stays available in memory */
      }
      this.submit(this.pending);
    }
    async submit(input) {
      if (!input || this.busy) return;
      this.busy = true;
      this.render();
      try {
        const response = await fetch("/api/quests/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await response.json();
        if (!response.ok) {
          const error = new Error(data.error || "Не удалось выполнить действие.");
          error.definitive = response.status < 500;
          throw error;
        }
        this.clearPending();
        this.owner.updateProfile(data.profile);
      } catch (error) {
        if (error.definitive) {
          this.clearPending();
          this.error.textContent = error.message;
          await this.owner.loadProfile();
        } else {
          if (!this.retryDelay)
            this.error.textContent = "Не удалось получить ответ. Попробуем ещё раз автоматически.";
          this.retryDelay = Math.min(60000, (this.retryDelay || 2500) * 2);
          this.retryAt = Date.now() + this.retryDelay;
        }
      } finally {
        this.busy = false;
        this.render();
      }
    }
    clearPending() {
      this.pending = null;
      this.retryAt = 0;
      this.retryDelay = 0;
      this.error.textContent = "";
      try {
        localStorage.removeItem(this.key());
      } catch {
        /* unavailable storage */
      }
    }
  }
  window.KillexQuestsUI = QuestsUI;
})();

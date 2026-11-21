/* Подтверждение открытия сундука и показ полученных наград. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const number = (n) => n.toLocaleString("ru-RU");
  const dayForms = new Intl.PluralRules("ru");
  class ChestUI {
    constructor(owner) {
      this.owner = owner;
      this.root = el("section", "chests-section");
      this.root.id = "chestsSection";
      this.root.hidden = true;
      this.busy = false;
      this.requests = {};
      this.confirm = this.makeDialog("chestConfirmDialog", "Подтверждение открытия");
      this.confirmText = el("h2");
      this.confirmText.id = "chestConfirmTitle";
      this.confirm.setAttribute("aria-labelledby", this.confirmText.id);
      this.confirmIcon = el("img", "chest-confirm-art");
      this.confirmIcon.alt = "";
      const actions = el("div", "chest-modal-actions"),
        yes = el("button", "sf-button", "Да"),
        no = el("button", "sf-button sf-tertiary", "Нет");
      yes.onclick = () => this.confirmOpening();
      no.onclick = () => this.confirm.close();
      actions.append(yes, no);
      this.confirm.append(this.confirmIcon, this.confirmText, actions, this.confirm.message);
      this.yes = yes;
      this.no = no;
      this.reward = this.makeDialog("chestRewardDialog", "Награда сундука");
      this.rewardIcon = el("img", "chest-reward-art");
      this.rewardIcon.alt = "";
      this.rewardTitle = el("h2");
      this.rewardTitle.id = "chestRewardTitle";
      this.reward.setAttribute("aria-labelledby", this.rewardTitle.id);
      this.rewardGrid = el("div", "chest-reward-grid");
      this.claim = el("button", "chest-claim", "Отлично");
      this.claim.onclick = () =>
        this.receivedReward ? this.reward.close() : this.perform("open", this.pendingReward()?.id);
      this.reward.addEventListener("close", () => {
        this.receivedReward = null;
      });
      const head = el("header", "chest-reward-heading"),
        copy = el("div"),
        foot = el("footer", "chest-reward-footer");
      this.rewardRank = el("p", "chest-rank");
      copy.append(this.rewardRank, this.rewardTitle);
      head.append(this.rewardIcon, copy);
      foot.append(this.claim, this.reward.message);
      this.reward.append(head, this.rewardGrid, foot);
    }
    makeDialog(id, label) {
      const d = el("dialog", "chest-modal");
      d.id = id;
      d.setAttribute("aria-label", label);
      const close = el("button", "chest-modal-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Закрыть");
      close.onclick = () => {
        if (!this.busy) d.close();
      };
      const message = el("p", "chest-modal-message");
      message.setAttribute("role", "status");
      d.append(close, message);
      d.message = message;
      d.addEventListener("cancel", (e) => {
        if (this.busy) e.preventDefault();
      });
      document.body.append(d);
      return d;
    }
    render() {
      const o = this.owner,
        honors = o.profile?.honors;
      if (!honors) {
        this.root.replaceChildren(el("p", "", ""));
        return;
      }
      const grid = el("div", "chest-grid");
      for (const t of honors.tiers) {
        const card = el("article", "clan-panel chest-card");
        card.dataset.chestId = t.id;
        card.dataset.state = t.state;
        const head = el("div", "chest-heading"),
          icon = el("img", "chest-art");
        icon.src = window.KillexProgressionArt.chest(t.id, 256);
        icon.alt = "";
        icon.width = icon.height = 96;
        head.append(icon, el("h3", "", t.chestName));
        card.append(head);
        const state =
          t.state === "opened"
            ? "Открыт - награды получены"
            : t.state === "closed"
              ? "Получен за титул"
              : "";
        if (state) card.append(el("p", "chest-state", state));
        const contents = [
          number(t.boosters) + " бустеров",
          number(t.coins) + " монет",
          number(t.crystals) + " кристаллов",
          number(t.bucks) + " эфира",
        ];
        if (t.rarityShares)
          contents.push(
            ...Object.entries(t.rarityShares).map(
              ([tier, percent]) =>
                (o.catalog?.tiers?.[tier]?.name || tier) + ": " + Number(percent.toFixed(2)) + "%",
            ),
          );
        else if (t.items)
          contents.push(
            ...Object.entries(t.items).map(
              ([id, count]) => o.item(id).name + " × " + number(count),
            ),
          );
        else if (t.contents) contents.push(t.contents);
        for (const [kind, days] of Object.entries(t.accountDays || {}))
          contents.push(
            (kind === "vip" ? "VIP" : "Premium") +
              ": " +
              days +
              " " +
              (days % 10 === 1 && days % 100 !== 11
                ? "день"
                : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14)
                  ? "дня"
                  : "дней"),
          );
        if (t.tickets) contents.push("Билеты рулетки: " + number(t.tickets));
        window.KillexBoosterTooltip.attach(head, {
          name: t.chestName,
          usage: contents.join("\n"),
        });
        head.setAttribute("aria-label", t.chestName + ": состав награды");
        if (t.reason)
          card.append(
            el("p", "chest-reason", `Пока закрыт. ${t.reason} Награда будет храниться без срока.`),
          );
        const action = el(
          "button",
          "sf-button",
          honors.pending?.id === t.id
            ? "Забрать награду"
            : t.state === "opened"
              ? "Награды получены"
              : t.state === "unearned"
                ? "Нужен титул"
                : t.reason
                  ? "Пока закрыт"
                  : "Открыть сундук",
        );
        action.type = "button";
        window.KillexControls.state(
          action,
          this.busy || o.purchasesBlocked() || t.state !== "closed" || !!t.reason,
          o.purchasesBlocked() || t.state !== "closed" || !!t.reason,
        );
        action.addEventListener("click", () => this.open(t.id));
        card.append(action);
        grid.append(card);
      }
      this.root.replaceChildren(grid);
    }
    title(id) {
      const friday = this.owner.profile?.fridayChests?.find((c) => c.id === id);
      if (friday)
        return {
          ...friday,
          source: "friday",
          chestName: "Сундук Чёрной пятницы",
          name: "Чёрная пятница",
          icon: "assets/events/black-friday/chest.webp",
        };
      const easter = this.owner.profile?.easter?.chests.find((c) => c.id === id);
      if (easter)
        return {
          id,
          source: "easter",
          chestName: "Пасхальный сундук",
          name: "Пасхальная охота",
          icon: "assets/events/easter-hunt/chest.webp",
          reward: easter.reward,
        };
      const quest = this.owner.profile?.quests?.pending.find((r) => r.id === id);
      if (quest)
        return {
          id,
          source: "quest",
          chestName: quest.chest.name,
          art: quest.chest.art,
          icon: window.KillexProgressionArt.questChest(quest.chest.art),
          name: quest.title,
          reward: quest,
        };
      if (id?.startsWith("clan-")) {
        const chest = this.owner.profile?.clanChests?.items.find((c) => c.id === id);
        return chest
          ? { ...chest, icon: window.KillexProgressionArt.clanChest(chest.tier) }
          : undefined;
      }
      return this.owner.profile?.honors?.tiers.find((t) => t.id === id);
    }
    pendingReward() {
      if (this.title(this.selected)?.source === "friday") return this.title(this.selected).reward;
      if (this.title(this.selected)?.source === "easter") return this.title(this.selected).reward;
      if (this.title(this.selected)?.source === "quest") return this.title(this.selected).reward;
      return this.selected?.startsWith("clan-")
        ? this.title(this.selected)?.reward
        : this.owner.profile?.honors?.pending;
    }
    open(id) {
      if (this.busy || this.owner.purchasesBlocked()) return;
      this.selected = id;
      const title = this.title(id);
      if (!title) return;
      this.confirm.dataset.chestTheme = title.art || id;
      this.confirmIcon.src = title.icon || window.KillexProgressionArt.chest(title.art || id, 256);
      this.confirmText.textContent = `Вы уверены что хотите открыть «${title.chestName}»?`;
      this.confirm.message.textContent = "";
      window.KillexWindows.open(this.confirm);
      this.no.focus();
    }
    confirmOpening() {
      if (this.busy || this.owner.purchasesBlocked()) return;
      const title = this.title(this.selected),
        pending = this.pendingReward();
      if (!title) return;
      // Every source enters through confirmation, even a previously prepared chest.
      // Reopening already sealed loot must not reroll it or send another preparation.
      if (
        pending?.id === this.selected &&
        (title.source !== "quest" || pending.prepared) &&
        (title.source !== "easter" || pending.fragmentId !== undefined)
      ) {
        this.confirm.close();
        this.showReward();
      } else this.perform("prepare", this.selected);
    }
    showReceived(reward, offer) {
      this.showReward({ ...reward, id: reward.requestId, items: reward.items || {} }, offer);
    }
    showReward(received = null, offer = null) {
      const r = received || this.pendingReward();
      if (!r) return;
      this.receivedReward = received;
      const title = received
        ? { source: "friday", name: offer.sourceName || "Лавка Мани", icon: offer.icon }
        : this.title(r.id);
      this.reward.dataset.chestTheme = title.art || r.id;
      this.reward.dataset.state = "opened";
      this.rewardRank.textContent = ["easter", "friday"].includes(title.source)
        ? title.name
        : title.source === "quest"
          ? `За задание «${title.name}»`
          : r.id.startsWith("clan-")
            ? "Награда клановой битвы"
            : `${title.name} - награда титула`;
      this.rewardTitle.textContent = received
        ? offer.receiptTitle || "Полученные бустеры"
        : `Открыв «${title.chestName}», вы нашли:`;
      this.rewardIcon.src = title.icon || window.KillexProgressionArt.chest(title.art || r.id, 256);
      // A fresh opening (including the same prepared chest) starts on page one.
      this.rewardOpenSequence = (this.rewardOpenSequence || 0) + 1;
      this.rewardGrid.dataset.collectionKey = `${r.id}:${this.rewardOpenSequence}`;
      this.rewardGrid.replaceChildren();
      const add = (name, src, count) => {
        const cell = el("div", "chest-reward-item"),
          img = el("img");
        img.src = src;
        img.alt = name;
        cell.append(img);
        if (count !== undefined) {
          cell.title = `${name}: ${number(count)}`;
          cell.append(el("strong", "", number(count)));
        }
        if (name !== "Величие") cell.append(el("small", "", name));
        this.rewardGrid.append(cell);
        return cell;
      };
      for (const [id, count] of Object.entries(r.items)) {
        const item = this.owner.item(id);
        add(item.name, item.icon, count);
      }
      for (const [id, name] of [
        ["coins", "Монеты"],
        ["crystals", "Кристаллы"],
        ["bucks", "Эфир"],
      ])
        if (r[id]) add(name, `assets/menu-icons/128/currency_${id}.webp`, r[id]);
      for (const [kind, days] of Object.entries(r.accountDays || {})) {
        const name = { vip: "VIP", premium: "Premium", lite: "Lite" }[kind];
        if (!name || !Number.isSafeInteger(days) || days <= 0) continue;
        const day = { one: "день", few: "дня", many: "дней", other: "дня" }[dayForms.select(days)];
        const cell = add(
          `${name} на ${number(days)} ${day}`,
          `assets/accounts/${kind}.${kind === "lite" ? "svg" : "png"}`,
        );
        cell.classList.add("chest-account-reward");
        cell.firstElementChild.alt = "";
      }
      if (r.greatness) add("Величие", window.KillexGreatnessUI.SOURCE, r.greatness);
      if (r.vipMs) add("VIP на 1 час", "assets/accounts/vip.png");
      if (r.tickets) add("Билеты рулетки", "assets/roulette/ticket-v2.webp", r.tickets);
      if (r.fridayTokens)
        add("Жетоны Мани", "assets/events/black-friday/token-v2.webp", r.fridayTokens);
      if (r.fragment) {
        const rules = window.KillexEaster,
          collection =
            rules.collections[Math.floor(r.fragment.index / rules.fragmentsPerCollection)],
          i = r.fragment.index % rules.fragmentsPerCollection,
          name = r.fragment.duplicate ? "Повторный фрагмент" : "Новый фрагмент",
          cell = el("div", "chest-reward-item"),
          piece = el("div", "easter-fragment chest-fragment-art");
        piece.dataset.found = "true";
        piece.style.backgroundImage = `url("${collection.image}")`;
        piece.setAttribute("role", "img");
        piece.setAttribute("aria-label", name);
        piece.style.backgroundPosition = `${(i % 3) * 50}% ${(Math.floor(i / 3) * 100) / 3}%`;
        cell.append(piece, el("small", "", name));
        this.rewardGrid.append(cell);
      }
      this.reward.message.textContent = "";
      window.KillexWindows.open(this.reward);
      this.rewardGrid.scrollTop = 0;
      this.claim.focus({ preventScroll: true });
    }
    async perform(action, id) {
      if (this.busy || !id || this.owner.purchasesBlocked()) return;
      const dialog = action === "prepare" ? this.confirm : this.reward,
        key = action + ":" + id;
      this.requests[key] ||= { chestId: id, requestId: window.KillexRequestIds.create() };
      const quest = this.title(id)?.source === "quest";
      const friday = this.title(id)?.source === "friday";
      this.busy = true;
      window.KillexControls.state(
        this.yes,
        window.KillexControls.state(
          this.no,
          window.KillexControls.state(this.claim, true, false),
          false,
        ),
        false,
      );
      this.render();
      dialog.message.textContent = action === "prepare" ? "Открываем…" : "Получаем награду…";
      try {
        const response = await fetch(
          friday
            ? "/api/black-friday/action"
            : this.title(id)?.source === "easter"
              ? "/api/easter/action"
              : quest
                ? "/api/quests/action"
                : id.startsWith("clan-")
                  ? "/api/clan-chests/action"
                  : "/api/chests/" + action,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              friday
                ? {
                    action,
                    id,
                    runId: this.title(id).runId,
                    day: Math.floor(
                      ((window.KillexAppearance?.now?.() ?? Date.now()) + 10800000) / 86400000,
                    ),
                    requestId: this.requests[key].requestId,
                  }
                : quest
                  ? {
                      requestId: this.requests[key].requestId,
                      questId: id,
                      action: action === "prepare" ? "prepare" : "claim",
                    }
                  : { ...this.requests[key], action },
            ),
            signal: AbortSignal.timeout(8000),
          },
        );
        const result = await response.json();
        if (!response.ok) {
          if (result.code === "ARENA_ACTIVE") this.owner.serverInArena = true;
          throw Error(result.error || "Не удалось открыть сундук.");
        }
        this.owner.updateProfile(result.profile);
        delete this.requests[key];
        dialog.close();
        if (action === "prepare" && this.pendingReward()) this.showReward();
        else this.owner.status("Награда получена! Предметы добавлены в инвентарь.");
      } catch (error) {
        dialog.message.textContent =
          error.message + " Можно повторить: награда не будет выдана дважды.";
      } finally {
        this.busy = false;
        window.KillexControls.state(
          this.yes,
          window.KillexControls.state(this.no, window.KillexControls.state(this.claim, false)),
        );
        this.owner.render();
      }
    }
  }
  window.KillexChestUI = ChestUI;
})();

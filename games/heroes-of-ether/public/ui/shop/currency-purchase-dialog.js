/* Окно пополнения игровых валют и предложения магазина. */
"use strict";
// Начисление выполняется только после подтверждения тестовой покупки.
(() => {
  const catalogs = window.KillexVirtualProducts.currencies;
  const number = (n) => n.toLocaleString("ru-RU");
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  class DonationUI {
    constructor(owner) {
      this.owner = owner;
      this.bonusRequests = new Map();
      this.pendingBonuses = new Set();
      this.dialog = el("dialog", "clan-dialog donation-dialog");
      this.dialog.id = "donationDialog";
      this.dialog.setAttribute("aria-labelledby", "donationTitle");
      const heading = el("div", "clan-heading donation-heading");
      const title = el("h2");
      title.id = "donationTitle";
      this.title = title;
      const close = el("button", "booster-close", "×");
      close.type = "button";
      close.autofocus = true;
      this.closeButton = close;
      close.addEventListener("click", () => this.dialog.close());
      heading.append(title, close);
      this.grid = el("div", "donation-grid");
      this.grid.id = "donationPackages";
      this.grid.setAttribute("role", "tabpanel");
      this.tabs = new Map();
      const tabs = el("div", "donation-tabs");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Валюта покупки");
      for (const [currency, label] of [
        ["coins", "Монетки"],
        ["crystals", "Кристаллы"],
        ["bucks", "Эфир"],
      ]) {
        const tab = el("button", "sf-tab", label);
        tab.type = "button";
        tab.id = `donationTab-${currency}`;
        tab.setAttribute("role", "tab");
        tab.setAttribute("aria-controls", this.grid.id);
        tab.addEventListener("click", () => this.render(currency));
        tab.addEventListener("keydown", (event) => {
          const keys = [...this.tabs.keys()],
            index = keys.indexOf(currency);
          const next =
            event.key === "ArrowRight"
              ? keys[(index + 1) % keys.length]
              : event.key === "ArrowLeft"
                ? keys[(index + keys.length - 1) % keys.length]
                : event.key === "Home"
                  ? keys[0]
                  : event.key === "End"
                    ? keys.at(-1)
                    : null;
          if (next) {
            event.preventDefault();
            this.render(next);
            this.tabs.get(next).focus();
          }
        });
        this.tabs.set(currency, tab);
        tabs.append(tab);
      }
      this.dialog.append(heading, tabs, this.grid);
      this.bonusStatus = el("p", "donation-bonus-status");
      this.bonusStatus.setAttribute("role", "status");
      this.dialog.append(this.bonusStatus);
      this.render("bucks");
      document.body.append(this.dialog);
      document.addEventListener("killex:profile", () => this.refreshBonuses());
      // Кошелёк может обновиться, пока окно открыто: возвращаем фокус на новую кнопку.
      this.dialog.addEventListener("close", () => {
        this.bonusTimer?.();
        if (!this.owner.game.isArena())
          this.returnWallet
            ?.querySelector(`.currency-add[data-currency="${this.returnCurrency}"]`)
            ?.focus({ preventScroll: true });
      });
    }
    promotion() {
      const s = this.owner.profile?.blackFriday;
      return !!(s?.active && s.endsAt > (window.KillexAppearance?.now?.() ?? Date.now()));
    }
    render(currency) {
      const catalog = catalogs[currency];
      this.promo = this.promotion();
      this.dialog.dataset.blackFriday = String(this.promo);
      this.currency = currency;
      this.dialog.dataset.currency = currency;
      this.grid.dataset.collectionKey = currency;
      this.title.textContent = `Покупка ${catalog.label}`;
      this.closeButton.setAttribute("aria-label", `Закрыть покупку ${catalog.label}`);
      for (const [id, tab] of this.tabs) {
        const selected = id === currency;
        tab.setAttribute("aria-selected", String(selected));
        tab.setAttribute("aria-pressed", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      this.grid.setAttribute("aria-labelledby", this.tabs.get(currency).id);
      this.grid.replaceChildren();
      for (const item of catalog.packages) {
        const card = el("article", "clan-panel donation-card");
        card.dataset.packageId = item.id;
        if (this.promo) {
          const tokens = el("span", "donation-token-badge");
          const tokenIcon = el("img");
          tokenIcon.src = "assets/events/black-friday/token-v2.webp?art=20261123-interface-art";
          tokenIcon.alt = "жетонов";
          tokens.append(el("strong", "", `+${number(item.votes * 10)}`), tokenIcon);
          const multiplier = el("span", "donation-multiplier-badge", "x2");
          multiplier.setAttribute("aria-label", "Вдвое больше валюты");
          card.append(tokens, multiplier);
        }
        const icon = el("img", "donation-currency-icon");
        icon.alt = "";
        icon.width = 96;
        icon.height = 96;
        icon.src = window.KillexArtRevision.url(window.KillexVirtualProducts.get(`${currency}:${item.id}`).icon);
        const name = el("h3", "", item.name);
        const total = (item.base + item.bonus) * (this.promo ? 2 : 1);
        const extra = total - item.base;
        const bonus = el(
          "p",
          "donation-bonus",
          extra ? `+${number(extra)} ${catalog.label}` : "Без бонуса",
        );
        bonus.dataset.bonus = String(extra > 0);
        const amount = el("p", "donation-amount");
        amount.append(el("strong", "", number(total)), el("span", "", catalog.label));
        const prices = el("p", "donation-prices");
        prices.append(
          el("strong", "", `${item.votes} ${item.votes === 1 ? "голос" : "голосов"}`),
          el("span", "", `${number(item.rubles)} ₽`),
        );
        const action = el("button", "sf-button donation-action", "Купить");
        action.type = "button";
        action.setAttribute("aria-label", `Купить: ${item.name}`);
        action.onclick = () =>
          window.KillexMockPayments.open(`${currency}:${item.id}`, {
            getProfile: () => this.owner.profile,
            unavailable: () => this.owner.game.isArena() || this.owner.serverInArena,
            updateProfile: (profile) => this.owner.updateProfile(profile),
            showReward: (reward, product) =>
              this.owner.chests.showReceived(reward, {
                icon: product.icon,
                sourceName: product.name,
                receiptTitle: "Покупка получена",
              }),
          });
        const heading = el("div", "donation-card-heading");
        heading.append(icon, name);
        card.append(heading, bonus, amount);
        if (!this.promo) {
          card.append(el("p", "donation-base", `Базовое количество: ${number(item.base)}`));
        }
        card.append(prices, action);
        this.grid.append(card);
      }
      for (const kind of ["vip", "premium"]) {
        const label = kind === "vip" ? "VIP" : "Premium";
        const card = el("article", "clan-panel donation-card donation-bonus-card");
        card.dataset.accountKind = kind;
        const heading = el("div", "donation-card-heading");
        const icon = el("img", "donation-account-icon");
        icon.src = `assets/accounts/${kind}.png?art=20261123-interface-art`;
        icon.alt = "";
        heading.append(icon, el("h3", "", `Бонус ${label}`));
        const amount = el("p", "donation-amount");
        amount.append(
          el(
            "strong",
            "",
            number(window.KillexVirtualProducts.accountLoginRewards[kind][currency]),
          ),
          el("span", "", catalog.label),
        );
        const state = el("p", "donation-bonus-state");
        const action = el("button", "sf-button donation-bonus-action", "Получить");
        action.type = "button";
        action.setAttribute("aria-label", `Получить бонус ${label}: ${catalog.label}`);
        action.onclick = () => this.claimBonus(kind, currency);
        card.append(
          heading,
          el("p", "donation-daily-label", "Ежедневный бонус за вход"),
          amount,
          el("p", "donation-base donation-bonus-countdown"),
          state,
          action,
        );
        this.grid.append(card);
      }
      this.refreshBonuses();
    }
    refreshBonuses() {
      if (!this.grid) return;
      if (this.promo !== this.promotion()) {
        this.render(this.currency);
        return;
      }
      const account = this.owner.profile?.account,
        now = Date.now();
      for (const card of this.grid.querySelectorAll(".donation-bonus-card")) {
        const kind = card.dataset.accountKind;
        const active = account?.[kind] === true && account[`${kind}Until`] > now;
        const claimed = account?.currencyBonuses?.[kind]?.[this.currency]?.claimed === true;
        const pending = this.pendingBonuses.has(`${kind}:${this.currency}`);
        const label = kind === "vip" ? "VIP" : "Premium";
        card.dataset.available = String(active && !claimed);
        card.dataset.active = String(active);
        const countdown = card.querySelector(".donation-bonus-countdown");
        countdown.hidden = !active || !claimed || !Number.isFinite(account?.currencyBonusResetAt);
        if (countdown.hidden) countdown.textContent = "";
        else {
          const seconds = Math.max(0, Math.ceil((account.currencyBonusResetAt - now) / 1000));
          const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
            .map((n) => String(n).padStart(2, "0"))
            .join(":");
          // Доступность нового бонуса подтверждает обычный опрос профиля у сервера.
          const text = seconds ? `Новый бонус через ${time}` : "";
          if (countdown.textContent !== text) countdown.textContent = text;
        }
        card.querySelector(".donation-bonus-state").textContent = !active
          ? `Доступно с ${label}`
          : claimed
            ? "Сегодня уже получено"
            : "Доступно сегодня";
        const action = card.querySelector(".donation-bonus-action");
        window.KillexControls.state(
          action,
          !active || claimed || pending || this.owner.serverInArena,
          !active || claimed || this.owner.serverInArena,
        );
        action.textContent = !active
          ? `Нужен ${label}`
          : claimed
            ? "Получено"
            : "Получить";
      }
    }
    async claimBonus(kind, currency) {
      const key = `${kind}:${currency}`;
      if (this.pendingBonuses.has(key) || this.owner.game.isArena() || this.owner.serverInArena)
        return;
      this.pendingBonuses.add(key);
      this.refreshBonuses();
      const profileId = this.owner.profile?.id;
      const storageKey = `${window.KillexPlatform.storageKey(".")}accountBonus.${profileId}.${key}.${this.owner.profile?.account?.currencyBonusResetAt}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        let requestId = this.bonusRequests.get(storageKey);
        try {
          requestId ||= sessionStorage.getItem(storageKey);
        } catch (_) {}
        requestId ||= window.KillexRequestIds.create();
        this.bonusRequests.set(storageKey, requestId);
        try {
          sessionStorage.setItem(storageKey, requestId);
        } catch (_) {}
        const response = await fetch("/api/profile/account-bonus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, currency, requestId }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Не удалось получить бонус.");
        this.bonusRequests.delete(storageKey);
        try {
          sessionStorage.removeItem(storageKey);
        } catch (_) {}
        this.owner.updateProfile(data.profile);
        const amount = window.KillexVirtualProducts.accountLoginRewards[kind][currency];
        this.bonusStatus.textContent = `${kind === "vip" ? "VIP" : "Premium"}: ${number(amount)} ${catalogs[currency].label} зачислено.`;
      } catch (error) {
        this.bonusStatus.textContent =
          error.name === "AbortError" || error instanceof TypeError
            ? "Нет ответа от сервера. Нажми «Получить» ещё раз - повторного начисления не будет."
            : error.message;
        this.owner.load(true);
      } finally {
        clearTimeout(timeout);
        this.pendingBonuses.delete(key);
        this.refreshBonuses();
      }
    }
    open(wallet, currency) {
      if (!Object.hasOwn(catalogs, currency) || this.owner.game.isArena() || this.dialog.open)
        return;
      this.returnWallet = wallet;
      this.returnCurrency = currency;
      this.render(currency);
      this.bonusStatus.textContent = "";
      this.owner.load(true);
      this.owner.game.stop();
      window.KillexWindows.open(this.dialog);
      this.bonusTimer?.();
      this.bonusTimer = window.KillexActivity.every(() => {
        if (this.dialog.open && !document.hidden) this.refreshBonuses();
      }, 1000, () => this.dialog.open);
      this.dialog.scrollTop = 0;
    }
    close() {
      if (this.dialog.open) this.dialog.close();
    }
  }
  window.KillexDonationUI = DonationUI;
})();

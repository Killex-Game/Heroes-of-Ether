/* Окно VIP/Premium, активация и подписи срока действия. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  class AccountsUI {
    constructor(owner) {
      this.owner = owner;
      this.profile = owner.getProfile();
      this.controls = new Map();
      const d = (this.dialog = el("dialog", "clan-dialog account-dialog"));
      d.id = "accountDialog";
      d.setAttribute("aria-labelledby", "accountTitle");
      const heading = el("header", "clan-heading"),
        title = el("h2", "", "Статусы");
      title.id = "accountTitle";
      const close = el("button", "booster-close", "×");
      close.type = "button";
      close.setAttribute("aria-label", "Закрыть статусы");
      close.onclick = () => d.close();
      heading.append(title, close);
      d.append(heading);
      d.append(
        el(
          "p",
          "account-intro",
          "VIP приобретается на 7 дней, Premium на 14 дней. Повторная покупка продлевает срок, статусы можно совмещать. " +
            "VIP удваивает опыт с арены, Premium — природные киллы каждые 30 секунд. Слот F открывается с 12 уровня.",
        ),
      );
      d.dataset.selectedAccount = "vip";
      const tabs = (this.tabs = el("nav", "account-plan-tabs"));
      tabs.setAttribute("aria-label", "Тип статуса");
      for (const [kind, name] of [
        ["vip", "VIP"],
        ["premium", "Premium"],
        ["lite", "Lite"],
      ]) {
        const tab = el("button", "sf-tab", name);
        tab.type = "button";
        tab.dataset.kind = kind;
        tab.setAttribute("aria-pressed", String(kind === "vip"));
        tab.onclick = () => {
          d.dataset.selectedAccount = kind;
          for (const control of tabs.children)
            control.setAttribute("aria-pressed", String(control === tab));
        };
        tabs.append(tab);
      }
      d.append(tabs);
      const grid = el("div", "account-plans");
      for (const [kind, features] of [
        [
          "vip",
          [
            "Золотая рамка шара и свечение ника",
            "Золотой набор аватаров",
            "Начальная масса: 50",
            "×2 опыта",
            "×2 валюты и бустеров в сундуках*",
            "Турбо: 2 минуты, скорость +30%",
            "+1 слот бустеров",
            "+3 к лимиту каждого бустера на арене",
            "Сокровищница вмещает до 10 сундуков",
            "Клан: +5 величия в клановом сундуке",
            "Дополнительный бонус к питомцам",
            "Срок ожидания сундуков 24 часа",
            "Ежедневные бонусы",
          ],
        ],
        [
          "premium",
          [
            "Аметистовые лобби, рамка шара и свечение ника",
            "Премиальный набор аватаров",
            "Начальная масса: 100",
            "×2 киллов",
            "×2 величия*",
            "+1 слот бустеров",
            "+3 к лимиту каждого бустера на арене",
            "Эмоции питомцев на арене",
            "Сокровищница вмещает до 12 сундуков",
            "Клан: +10 величия в клановом сундуке",
            "Срок ожидания сундуков 24 часа",
            "Ежедневные бонусы",
          ],
        ],
      ]) {
        const product = window.KillexVirtualProducts.get(`account:${kind}`);
        const card = el("article", "account-plan " + kind),
          icon = el("img"),
          iconBox = el("span", "account-emblem status-icon " + kind);
        const cardHeading = el("header", "account-plan-heading");
        const activeBadge = el("span", "account-active-badge", "Активен");
        activeBadge.hidden = true;
        icon.src = product.icon;
        icon.alt = product.name;
        iconBox.append(icon);
        cardHeading.append(iconBox, el("h3", "", product.name), activeBadge);
        const list = el("ul");
        for (const feature of features)
          list.append(window.KillexGreatnessUI.label(el("li", "", feature)));
        const state = el("p", "account-expiry"),
          activate = el(
            "button",
            "sf-button sf-secondary",
            `Купить за ${product.votes} голосов на ${product.days} дней`,
          );
        activate.type = "button";
        activate.onclick = () => this.activate(kind);
        card.append(cardHeading, list, state, activate);
        grid.append(card);
        this.controls.set(kind, { state, activate, activeBadge });
      }
      const lite = (this.liteCard = el("article", "account-plan lite"));
      const liteHead = el("header", "account-plan-heading"),
        liteIcon = el("img", "account-emblem");
      liteIcon.src = "assets/accounts/lite.svg?art=20261123-interface-art";
      liteIcon.alt = "";
      this.liteBadge = el("span", "account-active-badge", "Активен");
      liteHead.append(liteIcon, el("h3", "", "Lite"), this.liteBadge);
      const features = el("ul", "lite-features");
      for (const text of [
        "50 билетов сразу при покупке",
        "+1 билет за наградной сундук, кроме сундуков титулов",
        "Быстрая прокрутка - мгновенный показ результата",
        "Билет за 100 монет - до 50 за событие",
        "Билет за 10 кристаллов - до 50 за событие",
        "Билет за 2 эфира - без лимита",
      ])
        features.append(el("li", "", text));
      this.liteState = el("p", "account-expiry");
      this.liteBuy = el("button", "sf-button sf-secondary", "Купить Lite - 50 голосов");
      this.liteBuy.type = "button";
      this.liteBuy.onclick = () => this.activate("lite");
      lite.append(
        liteHead,
        el("p", "lite-tagline", "Больше билетов. Больше праздничных призов."),
        features,
        this.liteState,
        this.liteBuy,
      );
      grid.append(lite);
      d.append(grid);
      d.append(el("p", "account-intro account-footnote",
        "* Сундуки титулов и фиксированные клановые выплаты не умножаются. " +
        "В клановых сундуках действует отдельный бонус величия: +5 с VIP, +10 с Premium, +15 с обоими статусами."));
      this.message = el("p", "account-message");
      this.message.setAttribute("role", "status");
      d.append(this.message);
      document.body.append(d);
      const open = (kind) => {
        if (owner.isLobby()) {
          this.render();
          const tab = kind && this.tabs.querySelector(`[data-kind="${kind}"]`);
          if (tab && !tab.hidden) tab.click();
          window.KillexWindows.open(d);
          owner.loadProfile();
          if (kind === "lite" && !this.liteCard.hidden)
            this.liteCard.scrollIntoView({ block: "nearest" });
        }
      };
      document.getElementById("accountButton").onclick = () => open();
      document.addEventListener("killex:open-lite", () => open("lite"));
      document.addEventListener("killex:profile", (e) => {
        this.profile = e.detail;
        this.render();
      });
      window.KillexActivity.every(() => {
        if (
          owner.isLobby() &&
          (d.open || this.profile?.account?.vip || this.profile?.account?.premium)
        )
          owner.loadProfile();
      }, 30000, () => owner.isLobby() && (d.open || this.profile?.account?.vip || this.profile?.account?.premium));
      this.render();
    }
    render() {
      const lite = this.profile?.roulette?.lite;
      // Сервер разрешает Lite в активном событии или в бессрочном тестовом режиме.
      const available = lite?.available && (lite.endsAt === null || lite.endsAt > Date.now());
      clearTimeout(this.expiryTimer);
      if (available && lite.endsAt)
        this.expiryTimer = setTimeout(
          () => this.render(),
          Math.min(2147483647, lite.endsAt - Date.now() + 1),
        );
      this.liteCard.hidden = !available;
      this.tabs.querySelector('[data-kind="lite"]').hidden = !available;
      this.dialog.classList.toggle("has-lite", !!available);
      if (!available && this.dialog.dataset.selectedAccount === "lite")
        this.tabs.querySelector('[data-kind="vip"]').click();
      this.liteBadge.hidden = !lite?.active;
      const litePeriod = lite?.endsAt
        ? "До " +
          new Date(lite.endsAt).toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Срок действия: бессрочно";
      this.liteState.textContent = (lite?.active ? "" : "Не активирован. ") + litePeriod;
      window.KillexControls.state(
        this.liteBuy,
        !available || !!lite?.active || this.owner.inArena(),
      );
      this.liteBuy.textContent = lite?.active ? "Lite активен" : "Купить Lite - 50 голосов";
      const a = this.profile?.account || {};
      document.body.classList.toggle("account-vip", !!a.vip);
      document.body.classList.toggle("account-premium", !!a.premium);
      const marks = document.getElementById("accountMarks");
      const marksKey = JSON.stringify([!!a.vip, a.vipUntil, !!a.premium, a.premiumUntil]);
      const updateMarks = marks.dataset.renderKey !== marksKey;
      if (updateMarks) { marks.dataset.renderKey = marksKey; marks.replaceChildren(); }
      for (const [kind, { state, activate, activeBadge }] of this.controls) {
        const active = !!a[kind];
        activeBadge.hidden = !active;
        window.KillexControls.state(activate, !this.profile || this.owner.inArena());
        const expiry = new Date(a[kind + "Until"] || 0).toLocaleString("ru-RU", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        state.textContent = active ? "До " + expiry : "Не активирован";
        if (updateMarks) {
          const row = el("div", "profile-account " + kind),
            img = el("img"),
            copy = el("div");
          row.dataset.active = String(active);
          img.src = `assets/accounts/${kind}.png?art=20261123-interface-art`;
          img.alt = "";
          const time = el(
            active ? "time" : "span",
            "profile-account-period",
            active ? "до " + expiry : "Не активен",
          );
          if (active) time.dateTime = new Date(a[kind + "Until"]).toISOString();
          copy.append(el("strong", "", kind === "vip" ? "VIP" : "Premium"), time);
          const iconBox = el("span", "status-icon " + kind);
          iconBox.append(img);
          row.append(iconBox, copy);
          marks.append(row);
        }
      }
    }
    activate(kind) {
      if (!this.owner.isLobby() || this.owner.inArena()) return;
      window.KillexMockPayments.open(`account:${kind}`, {
        getProfile: () => this.profile,
        unavailable: () => !this.owner.isLobby() || this.owner.inArena(),
        updateProfile: (profile) => this.owner.updateProfile(profile),
      });
    }
  }
  window.KillexAccountsUI = AccountsUI;
})();

"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const img = (src, cls = "") => {
    const n = el("img", cls);
    const booster = /^assets\/boosters\/png\/([a-z_]+)\.png$/.exec(src);
    if (booster) src = window.KillexProgressionArt.booster(booster[1], 128) || src;
    n.src = window.KillexArtRevision.url(src);
    n.alt = "";
    n.draggable = false;
    return n;
  };
  const button = (text, onClick, cls = "sf-button") => {
    const n = el("button", cls, text);
    n.type = "button";
    n.onclick = onClick;
    return n;
  };
  // Silver merchant tokens are visually distinct from the gold game currency.
  const token = () => {
    const n = img("assets/events/black-friday/token-v2.webp?art=20261123-interface-art", "manya-token");
    n.alt = "жетоны Мани";
    n.setAttribute("aria-label", "жетоны Мани");
    return n;
  };
  const amount = (n) => Number(n || 0).toLocaleString("ru-RU");
  const now = () => window.KillexAppearance?.now?.() ?? Date.now();
  class BlackFriday {
    constructor(owner) {
      this.owner = owner;
      this.tab = "orders";
      this.requests = new Map();
      this.trigger = document.getElementById("blackFridayButton");
      this.trigger.classList.add("menu-notification-target");
      this.indicator = el("span", "menu-notification-dot");
      this.indicator.hidden = true;
      this.indicator.setAttribute("aria-hidden", "true");
      this.trigger.append(this.indicator);
      this.dialog = el("dialog", "manya-dialog");
      this.dialog.id = "blackFridayDialog";
      this.dialog.setAttribute("aria-labelledby", "manyaTitle");
      const header = el("header", "manya-header"),
        brand = el("div", "manya-brand"),
        heading = el("div", "");
      heading.append(el("small", "", "ЧЁРНАЯ ПЯТНИЦА"));
      const title = el("h2", "", "Лавка Мани");
      title.id = "manyaTitle";
      this.deadline = el("time", "manya-deadline");
      heading.append(title, this.deadline);
      this.balance = el("strong", "manya-balance");
      const close = button("×", () => this.dialog.close(), "manya-close");
      close.setAttribute("aria-label", "Закрыть лавку");
      const controls = el("div", "manya-header-controls");
      controls.append(this.balance);
      brand.append(img("assets/events/black-friday/shop.webp?art=20261123-interface-art", "manya-portrait"), heading);
      this.tabs = el("nav", "manya-tabs");
      this.tabs.setAttribute("aria-label", "Разделы лавки");
      for (const [id, label] of [
        ["orders", "Книга заказов"],
        ["prizes", "Ценные призы"],
        ["exchange", "Обмен жетонов"],
        ["achievements", "Достижения"],
      ]) {
        const b = button(
          label,
          () => {
            this.tab = id;
            this.renderKey = null;
            this.render();
          },
          "sf-tab",
        );
        b.dataset.tab = id;
        b.classList.add("menu-notification-target");
        const dot = el("span", "menu-notification-dot");
        dot.hidden = true;
        dot.setAttribute("aria-hidden", "true");
        b.append(dot);
        this.tabs.append(b);
      }
      this.content = el("div", "manya-content");
      this.notice = el("p", "manya-notice");
      this.notice.setAttribute("role", "status");
      this.notice.hidden = true;
      header.append(brand, this.tabs, controls);
      this.dialog.append(close, header, this.content, this.notice);
      document.body.append(this.dialog);
      this.trigger.onclick = () => this.open();
      this.dialog.addEventListener("close", () => {
        this.clock?.();
        this.clearNotice();
        this.trigger.focus({ preventScroll: true });
      });
      document.addEventListener("killex:profile", () => this.sync());
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this.dialog.open) this.owner.loadProfile();
      });
      this.sync();
    }
    data() {
      return this.owner.getProfile()?.blackFriday;
    }
    sync() {
      const s = this.data();
      this.trigger.hidden = !s?.active || s.endsAt <= now();
      const ready =
        !this.trigger.hidden &&
        (s.orders?.some((o) => !o.claimed && o.progress >= o.target) ||
          (!s.finalClaimed && s.completedOrders >= s.finalTarget));
      this.indicator.hidden = !ready;
      for (const b of this.tabs.children) {
        const pending = b.dataset.tab === "orders" && ready;
        b.querySelector(".menu-notification-dot").hidden = !pending;
        if (pending) b.setAttribute("aria-description", "Есть награда для получения");
        else b.removeAttribute("aria-description");
      }
      if (ready) this.trigger.setAttribute("aria-description", "Есть награда для получения");
      else this.trigger.removeAttribute("aria-description");
      if (this.dialog.open) this.render();
    }
    open() {
      if (!this.owner.isLobby()) return;
      if (!this.dialog.open) this.tab = "orders";
      this.clearNotice();
      this.renderKey = null;
      this.render();
      window.KillexWindows.open(this.dialog);
      this.owner.loadProfile();
      this.clock?.();
      let ticks = 0;
      this.clock = window.KillexActivity.every(() => {
        if (document.hidden) return;
        this.sync();
        if (++ticks % 30 === 0) this.owner.loadProfile();
      }, 1000, () => this.dialog.open);
    }
    render() {
      const s = this.data(),
        active = s?.active && s.endsAt > now();
      const key = JSON.stringify([s, this.tab, this.busy, !!active]);
      if (key === this.renderKey) return;
      this.renderKey = key;
      this.balance.replaceChildren(token(), document.createTextNode(amount(s?.tokens)));
      for (const b of this.tabs.children)
        b.setAttribute("aria-pressed", String(b.dataset.tab === this.tab));
      if (!active) {
        this.deadline.textContent = "Лавка закрыта";
        this.content.replaceChildren(
          el(
            "p",
            "manya-empty",
            "Лавка откроется во время Чёрной пятницы. Полученные призы и картина остаются у тебя.",
          ),
        );
        return;
      }
      this.deadline.dateTime = new Date(s.endsAt).toISOString();
      this.deadline.textContent =
        "До " +
        new Date(s.endsAt).toLocaleString("ru-RU", {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        });
      this.content.replaceChildren(
        this.tab === "orders"
          ? this.book(s)
          : this.tab === "achievements"
            ? this.achievements(s)
            : this.catalog(s),
      );
    }
    markReward(control) {
      control.classList.add("menu-notification-target");
      const dot = el("span", "menu-notification-dot");
      dot.setAttribute("aria-hidden", "true");
      control.append(dot);
    }
    book(s) {
      const book = el("section", "manya-book"),
        left = el("div", "manya-leaf manya-leaf-left"),
        right = el("div", "manya-leaf manya-leaf-right");
      const date = el("p", "manya-page-date", "ЗАКАЗЫ ДНЯ"),
        title = el(
          "h3",
          "",
          s.ordersComplete
            ? `Все ${s.eventLimit || 84} заказа выполнены`
            : `Выполнено сегодня: ${s.dailyCompleted} / ${s.dailyLimit || 12}`,
        );
      const reset = new Date(s.resetAt).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      left.append(
        date,
        title,
        el(
          "p",
          "manya-reset",
          s.ordersComplete
            ? "Призы и обмен жетонов доступны до завершения события."
            : "Новые заказы: " + reset,
        ),
      );
      for (const o of s.orders) {
        const row = el("article", "manya-order"),
          text = el("div", "manya-order-copy");
        row.dataset.claimed = String(o.claimed);
        row.dataset.tier = o.tier;
        const caption = el("strong", "", o.name),
          description = el("p", "", o.description);
        const progress = el("progress", "");
        progress.max = o.target;
        progress.value = o.progress;
        progress.setAttribute("aria-label", o.name);
        text.append(
          el("small", "manya-order-tier", `${o.tierName}: ${o.done} / ${o.quota}`),
          caption,
          description,
          progress,
          el("small", "", amount(o.progress) + " / " + amount(o.target)),
        );
        const claim = button(o.claimed ? "Получено" : "Забрать", () => this.act("order", o.id));
        window.KillexControls.state(
          claim,
          !!this.busy || o.claimed || o.progress < o.target,
          o.claimed || o.progress < o.target,
        );
        if (!o.claimed && o.progress >= o.target) this.markReward(claim);
        const reward = el("div", "manya-order-reward");
        const price = el("strong", "manya-token-amount", "+" + o.tokens);
        price.append(token());
        const swap = button(
          s.swapCost ? "Сменить: 3" : "Сменить бесплатно",
          () => this.act("swap", o.id),
          "sf-button manya-swap",
        );
        if (s.swapCost) swap.append(img("assets/menu-icons/64/currency_bucks.webp?art=20261123-interface-art"));
        window.KillexControls.state(
          swap,
          !!this.busy || o.claimed || (this.owner.getProfile()?.wallet?.bucks || 0) < s.swapCost,
          o.claimed || (this.owner.getProfile()?.wallet?.bucks || 0) < s.swapCost,
        );
        reward.append(price, claim, swap);
        const icon = el("span", "manya-order-icon");
        icon.append(img(o.icon));
        if (o.metric === "life") {
          const count = el("b", "manya-order-games", "+" + o.target);
          count.setAttribute("aria-label", "Игр: " + o.target);
          icon.append(count);
        }
        row.append(icon, text, reward);
        left.append(row);
      }

      right.append(
        el("p", "manya-page-date", "ОСОБАЯ БЛАГОДАРНОСТЬ"),
        el("h3", "", "Карточная шкатулка"),
      );
      const preview = el("div", "manya-final-art");
      preview.append(
        img("assets/events/black-friday/album.webp?art=20261123-interface-art", "manya-album-preview"),
        img("assets/events/black-friday/regalia-v2.webp?art=20261123-interface-art", "manya-regalia-preview"),
      );
      right.append(
        preview,
        el(
          "p",
          "manya-final-copy",
          "Выполни 50 заказов за событие. Регалия украсит витрину профиля, а картина с Маней останется в Альбоме.",
        ),
      );
      const track = el("div", "manya-stamps");
      track.setAttribute("aria-label", "Заказы " + s.completedOrders + " из " + s.finalTarget);
      for (let i = 1; i <= s.finalTarget; i++) {
        const done = i <= s.completedOrders;
        const mark = el("span", done ? "is-done" : "", done ? "✓" : String(i));
        mark.setAttribute("aria-label", `Заказ ${i}${done ? ": выполнен" : ""}`);
        track.append(mark);
      }
      const claim = button(s.finalClaimed ? "Награда получена" : "Получить награду", () =>
        this.act("final"),
      );
      window.KillexControls.state(
        claim,
        !!this.busy || s.finalClaimed || s.completedOrders < s.finalTarget,
        s.finalClaimed || s.completedOrders < s.finalTarget,
      );
      if (!s.finalClaimed && s.completedOrders >= s.finalTarget) this.markReward(claim);
      right.append(
        track,
        el("strong", "manya-final-count", `${s.completedOrders} / ${s.finalTarget} заказов`),
        claim,
      );
      const rings = el("div", "manya-binding");
      rings.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 5; i++) rings.append(el("i", ""));
      book.append(left, rings, right);
      return book;
    }
    achievements(s) {
      const wrap = el("section", "manya-achievements");
      for (const a of s.achievements || []) {
        const card = el("article", "manya-achievement");
        card.dataset.earned = String(a.claimed > 0);
        const icon = window.KillexAchievementBadge.create(a.id, "manya-achievement-icon", 54);
        const text = el("div", "");
        text.append(el("h3", "", a.name), el("p", "", a.description));
        const steps = el("div", "manya-achievement-steps");
        a.thresholds.forEach((n, i) => {
          const step = el("span", i < a.claimed ? "is-done" : "");
          step.append(
            document.createTextNode((i < a.claimed ? "✓ " : "") + amount(n) + ": +" + a.rewards[i]),
            img("assets/menu-icons/64/nav_achievements.webp?art=20261123-interface-art"),
          );
          steps.append(step);
        });
        text.append(steps, el("small", "", "Прогресс: " + amount(a.value) + " " + a.unit));
        card.append(icon, text);
        wrap.append(card);
      }
      return wrap;
    }
    catalog(s) {
      const wrap = el("div", "manya-catalog-wrap"),
        grid = el("div", "manya-catalog");
      if (this.tab === "prizes") {
        wrap.append(
          el("h3", "", "Выбери подарок за жетоны"),
          el(
            "p",
            "manya-catalog-note",
            "Бустеры указанного качества выбираются случайно. Сундуки поступают в Сокровищницу.",
          ),
        );
        for (const o of s.shop) {
          const card = el("article", "manya-prize"),
            buy = button("", () => this.act("buy", o.id));
          buy.append(document.createTextNode(o.tokens + " "), token());
          buy.setAttribute("aria-label", o.name + " за " + o.tokens + " жетонов");
          window.KillexControls.state(
            buy,
            !!this.busy || s.tokens < o.tokens || (o.limit && o.bought >= o.limit),
            s.tokens < o.tokens || (o.limit && o.bought >= o.limit),
          );
          card.append(
            img(o.icon),
            el("h4", "", o.name),
            el(
              "small",
              "",
              o.limit ? `Получено: ${o.bought} / ${o.limit} за событие` : "Без ограничения покупок",
            ),
            buy,
          );
          if (o.chest)
            window.KillexBoosterTooltip.attach(card.firstElementChild, {
              name: o.name,
              usage: s.chestContents,
            });
          grid.append(card);
        }
        const chest = el("article", "manya-prize");
        const buyChest = button("", () => this.act("chest-ether"));
        buyChest.append(
          document.createTextNode("100 "),
          img("assets/menu-icons/64/currency_bucks.webp?art=20261123-interface-art", "manya-price-icon"),
        );
        buyChest.setAttribute("aria-label", "Сундук Чёрной пятницы за 100 эфира");
        window.KillexControls.state(
          buyChest,
          !!this.busy || (this.owner.getProfile()?.wallet?.bucks || 0) < 100,
          (this.owner.getProfile()?.wallet?.bucks || 0) < 100,
        );
        chest.append(
          img("assets/events/black-friday/chest.webp?art=20261123-interface-art"),
          el("h4", "", "Сундук Чёрной пятницы"),
          el("small", "", "Без ограничения покупок"),
          buyChest,
        );
        window.KillexBoosterTooltip.attach(chest.firstElementChild, {
          name: "Сундук Чёрной пятницы",
          usage: s.chestContents,
        });
        grid.append(chest);
      } else {
        wrap.append(
          el("h3", "", "Пополнить запас жетонов"),
          el(
            "p",
            "manya-catalog-note",
            "Обмен не заменяет заказы для итоговой награды. Лимиты обновляются вместе с книгой.",
          ),
        );
        for (const o of s.exchanges) {
          const card = el("article", "manya-prize manya-exchange"),
            cost = el("strong", "manya-token-amount", amount(o.cost));
          cost.append(
            img(`assets/menu-icons/128/currency_${o.currency}.webp?art=20261123-interface-art`),
            document.createTextNode(" = " + o.tokens),
            token(),
          );
          const buy = button("Обменять", () => this.act("exchange", o.id));
          window.KillexControls.state(
            buy,
            !!this.busy ||
              (o.limit != null && o.used >= o.limit) ||
              (this.owner.getProfile()?.wallet?.[o.currency] || 0) < o.cost,
            (o.limit != null && o.used >= o.limit) ||
              (this.owner.getProfile()?.wallet?.[o.currency] || 0) < o.cost,
          );
          card.append(
            img("assets/events/black-friday/token-v2.webp?art=20261123-interface-art"),
            cost,
            el(
              "small",
              "",
              o.limit == null ? "Без ограничения обменов" : `Сегодня: ${o.used} / ${o.limit}`,
            ),
            buy,
          );
          grid.append(card);
        }
        const coupon = el("article", "manya-coupon"),
          details = el("div", "");
        const benefits = el("ul", "");
        for (const text of [
          "500 жетонов сразу",
          "x2 жетонов за заказы, обмены, уровни и сундуки",
          "Позиция «VIP на 1 час» без ограничения покупок",
          "Сундук Чёрной пятницы сразу",
          "Шанс VIP в сундуках Чёрной пятницы: 4%",
        ])
          benefits.append(el("li", "", text));
        details.append(
          el("h3", "", "Купон Мани"),
          benefits,
          el("small", "", "Одна покупка на текущее событие."),
        );
        const buy = button(s.coupon?.active ? "Купон активен" : "Купить за 50 голосов", () =>
          window.KillexMockPayments.open("event:manya-coupon", {
            getProfile: () => this.owner.getProfile(),
            unavailable: () => !this.owner.isLobby() || !!this.busy,
            updateProfile: (p) => {
              this.owner.updateProfile(p);
              this.render();
            },
          }),
        );
        window.KillexControls.state(buy, !!this.busy || !!s.coupon?.active, !!s.coupon?.active);
        coupon.append(img("assets/events/black-friday/coupon.webp?art=20261123-interface-art"), details, buy);
        wrap.append(coupon);
      }
      wrap.append(grid);
      return wrap;
    }
    clearNotice() {
      clearTimeout(this.noticeTimer);
      this.notice.hidden = true;
      this.notice.textContent = "";
    }
    showNotice(text, error = false) {
      this.clearNotice();
      if (!this.dialog.open) return;
      this.notice.textContent = text;
      this.notice.classList.toggle("is-error", error);
      this.notice.hidden = false;
      this.noticeTimer = setTimeout(() => this.clearNotice(), error ? 4500 : 1800);
    }
    async act(action, id) {
      if (this.busy || !this.owner.isLobby()) return;
      const s = this.data();
      if (!s?.active) return;
      const key = JSON.stringify([s.runId, s.day, action, id || null]);
      if (!this.requests.has(key)) this.requests.set(key, window.KillexRequestIds.create());
      this.busy = key;
      this.clearNotice();
      this.render();
      try {
        const response = await fetch("/api/black-friday/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            runId: s.runId,
            day: s.day,
            action,
            id,
            requestId: this.requests.get(key),
          }),
          signal: AbortSignal.timeout(8000),
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status < 500) this.requests.delete(key);
          throw Error(result.error || "Не удалось выполнить действие.");
        }
        this.requests.delete(key);
        this.owner.updateProfile(result.profile);
        if (result.reward)
          this.owner.showBoosterReward(
            result.reward,
            s.shop.find((o) => o.id === id),
          );
        if (result.currencyReward)
          this.owner.showBoosterReward(result.currencyReward, {
            ...s.shop.find((o) => o.id === id),
            receiptTitle: "Полученная валюта",
          });
        if (action === "exchange") this.showNotice("Обмен выполнен");
      } catch (error) {
        this.showNotice(error.message, true);
        this.owner.loadProfile();
      } finally {
        this.busy = null;
        this.render();
      }
    }
  }
  window.KillexBlackFriday = BlackFriday;
})();

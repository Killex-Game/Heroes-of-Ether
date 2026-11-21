"use strict";
(() => {
  const R = window.KillexRouletteRules;
  const palette = {
    vip: ["#ffb4f1", "#d42fce", "#76199e"],
    coins: ["#fff18a", "#f5a51c", "#bc4b09"],
    crystals: ["#a2fffa", "#12c9db", "#087baa"],
    common: ["#d0fc88", "#49bc41", "#177642"],
    rare: ["#ecb8ff", "#a64aef", "#5d25b1"],
    clan: ["#ffd8a3", "#f16b36", "#a12c39"],
    advanced: ["#a2e1ff", "#328eee", "#274eb0"],
    fridayTokens: ["#f3f7ff", "#aab6c4", "#4a5668"],
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const image = (src) => {
    const n = el("img");
    n.src = src;
    n.alt = "";
    return n;
  };
  const svg = (tag, attrs) => {
    const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs || {})) n.setAttribute(key, value);
    return n;
  };
  const button = (label, fn, cls = "sf-button sf-secondary") => {
    const n = el("button", cls, label);
    n.type = "button";
    n.onclick = fn;
    return n;
  };
  const number = (n) => n.toLocaleString("ru-RU");
  class RouletteUI {
    constructor(owner) {
      this.owner = owner;
      this.profile = owner.getProfile();
      this.dialog = el("dialog", "roulette-dialog");
      this.dialog.id = "rouletteDialog";
      this.dialog.setAttribute("aria-labelledby", "rouletteTitle");
      const head = el("header", "roulette-heading"),
        brand = el("div");
      const title = el("h2", "", "Колесо удачи");
      title.id = "rouletteTitle";
      brand.append(title);
      this.close = button("×", () => this.dialog.close(), "booster-close");
      this.close.setAttribute("aria-label", "Закрыть рулетку");
      this.liteButton = button(
        "",
        () => document.dispatchEvent(new CustomEvent("killex:open-lite")),
        "roulette-lite-button",
      );
      this.liteButton.append(image("assets/accounts/lite.svg"));
      this.liteButtonCopy = el("span");
      this.liteButton.append(this.liteButtonCopy);
      head.append(image("assets/roulette/wheel.svg"), brand, this.liteButton, this.close);
      this.eventLabel = el("p", "roulette-event");
      this.viewTabs = el("nav", "roulette-view-tabs");
      this.viewTabs.setAttribute("aria-label", "Разделы рулетки");
      this.dialog.dataset.panel = "wheel";
      for (const [id, label] of [
        ["wheel", "Колесо"],
        ["tickets", "Билеты"],
        ["info", "Призы"],
      ]) {
        const tab = button(label, () => this.selectPanel(id), "roulette-panel-tab");
        tab.dataset.panel = id;
        tab.setAttribute("aria-pressed", String(id === "wheel"));
        this.viewTabs.append(tab);
      }
      this.mobileTickets = el("small", "roulette-mobile-balance");
      this.viewTabs.append(this.mobileTickets);
      const layout = el("div", "roulette-layout"),
        stage = el("section", "roulette-stage");
      this.wheel = el("div", "roulette-wheel");
      this.wheel.setAttribute("aria-label", "Призы на колесе");
      const pointer = el("div", "roulette-pointer");
      pointer.setAttribute("aria-hidden", "true");
      this.wheelFrame = el("div", "roulette-wheel-frame");
      const lamps = el("div", "roulette-lamps");
      lamps.setAttribute("aria-hidden", "true");
      for (let i = 0; i < 42; i++) {
        const lamp = el("span", "roulette-lamp"),
          angle = (i / 42) * Math.PI * 2;
        lamp.style.setProperty("--lamp-x", `${50 + Math.sin(angle) * 47.5}%`);
        lamp.style.setProperty("--lamp-y", `${50 - Math.cos(angle) * 47.5}%`);
        lamp.style.setProperty("--lamp-color", ["#ffe781", "#ff91de", "#7ceeff"][i % 3]);
        lamp.style.setProperty("--lamp-idle-delay", `${-(i % 7) * 0.5}s`);
        lamp.style.setProperty("--lamp-spin-delay", `${-(i % 7) * 0.12}s`);
        lamps.append(lamp);
      }
      const wheelViewport = el("div", "roulette-wheel-viewport");
      wheelViewport.append(this.wheel);
      this.wheelFrame.append(wheelViewport, lamps, pointer);
      this.spinButton = button(
        "Крутить рулетку",
        () => this.spin(),
        "sf-button sf-primary roulette-spin",
      );
      this.status = el("p", "roulette-status");
      this.status.setAttribute("role", "status");
      this.fiveButton = button(
        "Крутить рулетку x5",
        () => this.spin(5),
        "sf-button sf-primary roulette-spin roulette-spin-five",
      );
      const spins = el("div", "roulette-spin-actions");
      this.spinButton.title = "Стоимость: 1 билет";
      this.fiveButton.title = "Стоимость: 5 билетов";
      const extraSpins = el("div", "roulette-extra-spins"),
        fastLabel = el("label", "roulette-fast-label");
      this.fastSpin = el("input");
      this.fastSpin.type = "checkbox";
      this.fastSpin.id = "rouletteFastSpin";
      try {
        this.fastPreferred =
          localStorage.getItem(window.KillexPlatform.storageKey("-roulette-fast")) === "true";
      } catch {
        this.fastPreferred = false;
      }
      this.fastSpin.onchange = () => {
        this.fastPreferred = this.fastSpin.checked;
        try {
          localStorage.setItem(
            window.KillexPlatform.storageKey("-roulette-fast"),
            String(this.fastPreferred),
          );
        } catch {
          /* preference stays in memory */
        }
      };
      fastLabel.append(this.fastSpin, el("span", "", "Быстрая прокрутка"));
      fastLabel.title = "Быстрое вращение с активным Lite";
      extraSpins.append(this.fiveButton, fastLabel);
      spins.append(this.spinButton, extraSpins);
      this.ticketShop = el("section", "roulette-ticket-shop");
      this.ticketShop.append(el("h3", "", "Билеты с Lite"));
      const shopGrid = el("div", "roulette-ticket-offers");
      this.ticketControls = new Map();
      for (const [currency, label, price] of [
        ["coins", "монет", 100],
        ["crystals", "кристаллов", 10],
        ["bucks", "эфира", 2],
      ]) {
        const card = el("div", "roulette-ticket-offer");
        card.dataset.currency = currency;
        const amount = el("input");
        amount.type = "number";
        amount.name = `roulette-${currency}-quantity`;
        amount.min = "1";
        amount.step = "1";
        amount.value = "1";
        amount.setAttribute("aria-label", `Количество билетов за ${label}`);
        const limit = el("small"),
          cost = el("span", "roulette-ticket-cost");
        const buy = button("Купить", () => this.buyTickets(currency), "sf-button sf-secondary");
        amount.oninput = () => this.updateTicketControl(currency);
        card.append(
          image(`assets/menu-icons/128/currency_${currency}.webp`),
          el("strong", "", `1 билет = ${price} ${label}`),
          limit,
          amount,
          cost,
          buy,
        );
        this.ticketControls.set(currency, { amount, limit, cost, buy, price, label });
        shopGrid.append(card);
      }
      this.ticketShop.append(shopGrid);
      stage.append(this.wheelFrame, spins, this.status);
      const aside = (this.info = el("aside", "roulette-info"));
      aside.dataset.view = "odds";
      const tickets = el("div", "roulette-tickets");
      this.ticketCount = el("strong", "", "0");
      tickets.append(
        el("span", "", "Твои билеты"),
        this.ticketCount,
        el("small", "", "Новый уровень = 1 билет"),
      );
      this.result = el("section", "roulette-result");
      this.result.setAttribute("aria-live", "polite");
      const odds = (this.odds = el("section", "roulette-odds"));
      const infoTabs = el("nav", "roulette-info-tabs");
      infoTabs.setAttribute("aria-label", "Информация о призах");
      this.resultTab = button("Мои призы", () => this.selectInfo("result"), "roulette-panel-tab");
      this.oddsTab = button("Шансы", () => this.selectInfo("odds"), "roulette-panel-tab");
      infoTabs.append(this.resultTab, this.oddsTab);
      this.selectInfo("odds");
      this.renderOdds("default");
      aside.append(tickets, infoTabs, this.result, odds);
      layout.append(this.ticketShop, stage, aside);
      this.dialog.append(head, this.eventLabel, this.viewTabs, layout);
      document.body.append(this.dialog);
      document.getElementById("rouletteButton").onclick = () => this.open();
      document.addEventListener("killex:profile", (e) => {
        this.profile = e.detail;
        this.update();
      });
      this.dialog.addEventListener("close", () => this.animation?.finish());
      const visibility = () => {
        this.dialog.classList.toggle("is-page-hidden", document.hidden);
        if (document.hidden) this.animation?.finish();
      };
      document.addEventListener("visibilitychange", visibility);
      visibility();
      matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
        if (e.matches) this.animation?.finish();
      });
      window.KillexActivity.every(() => {
        if (this.dialog.open && !this.busy && !document.hidden) this.owner.loadProfile();
      }, 15000, () => this.dialog.open);
      this.update();
    }
    renderOdds(variant) {
      if (this.oddsVariant === variant) return;
      this.oddsVariant = variant;
      const odds = this.odds;
      odds.replaceChildren(el("h3", "", "Что можно выиграть"));
      for (const c of [...R.forEvent(variant).categories].sort((a, b) => a.weight - b.weight)) {
        const row = el("div", "roulette-odds-row");
        row.style.setProperty("--prize-color", palette[c.id][1]);
        const copy = el("span", "", c.name);
        if (c.min) copy.append(el("small", "", `${c.min}-${c.max} шт.`));
        row.append(
          copy,
          el(
            "strong",
            "",
            ((c.weight / R.totalWeight) * 100).toLocaleString("ru-RU", {
              maximumFractionDigits: 2,
            }) + "%",
          ),
        );
        odds.append(row);
      }
      odds.append(
        el(
          "p",
          "roulette-fineprint",
          "Шансы указаны для категорий. Призы одной категории равновероятны. Бустеры и их количество обновляются после вращения.",
        ),
      );
    }
    key() {
      return window.KillexPlatform.storageKey(".roulette.pending.") + this.profile.id;
    }
    selectPanel(id) {
      this.dialog.dataset.panel = id;
      for (const tab of this.viewTabs.querySelectorAll("button"))
        tab.setAttribute("aria-pressed", String(tab.dataset.panel === id));
    }
    selectInfo(id) {
      this.info.dataset.view = id;
      this.resultTab.setAttribute("aria-pressed", String(id === "result"));
      this.oddsTab.setAttribute("aria-pressed", String(id === "odds"));
    }
    pending() {
      try {
        return JSON.parse(sessionStorage.getItem(this.key()) || "null");
      } catch {
        return null;
      }
    }
    update() {
      const r = this.profile?.roulette;
      if (!r) return;
      this.renderOdds(r.variant || "default");
      const enabled =
        r.available && (!this.profile.event || this.profile.event.endsAt > Date.now());
      const button = document.getElementById("rouletteButton"),
        badge = document.getElementById("rouletteTicketBadge");
      window.KillexControls.state(button, !enabled);
      button.classList.toggle("is-locked", !enabled);
      button.classList.toggle("has-tickets", r.tickets > 0 && enabled);
      button.removeAttribute("title");
      button.setAttribute(
        "aria-label",
        enabled ? "Открыть рулетку" : "Рулетка закрыта до начала события",
      );
      badge.hidden = !enabled;
      badge.textContent = enabled ? number(r.tickets) : "";
      this.ticketCount.parentElement.hidden = !enabled;
      this.mobileTickets.hidden = !enabled;
      this.ticketCount.textContent = number(r.tickets);
      this.mobileTickets.textContent = "Твои билеты: " + number(r.tickets);
      this.eventLabel.textContent = this.profile.event
        ? `${this.profile.event.title} - до ${new Date(this.profile.event.endsAt).toLocaleString("ru-RU")}`
        : r.testing
          ? "Рулетка открыта для тестирования"
          : r.available
            ? "Событие активно - испытай удачу"
            : "Рулетка откроется в дни события. Билеты сохраняются.";
      const pending = this.pending();
      const lite = r.lite;
      const available = lite?.available && (lite.endsAt === null || lite.endsAt > Date.now());
      const activeLite = available && !!lite?.active;
      clearTimeout(this.expiryTimer);
      const end = this.profile.event?.endsAt || (available && lite.endsAt);
      if (end && end > Date.now())
        this.expiryTimer = setTimeout(
          () => this.update(),
          Math.min(2147483647, end - Date.now() + 1),
        );
      window.KillexControls.state(this.liteButton, !!this.busy, false);
      this.liteButtonCopy.replaceChildren(
        el("strong", "", activeLite ? "Lite активен" : "Купить Lite"),
        ...(activeLite
          ? [el("small", "", lite.endsAt === null ? "Бессрочно" : "До конца события")]
          : []),
      );
      this.fiveButton.hidden = false;
      window.KillexControls.state(
        this.fiveButton,
        !!this.busy || !!pending || !enabled || r.tickets < 5 || this.owner.inArena(),
        !enabled || r.tickets < 5 || this.owner.inArena(),
      );
      this.fiveButton.textContent = "Крутить рулетку x5";
      window.KillexControls.state(
        this.fastSpin,
        !activeLite || !!this.busy || !!pending,
        !activeLite,
      );
      this.fastSpin.checked = activeLite && !!this.fastPreferred;
      this.ticketShop.hidden = !activeLite;
      this.dialog.dataset.account = activeLite ? "lite" : "base";
      this.dialog.classList.toggle("has-lite-shop", !this.ticketShop.hidden);
      this.viewTabs.querySelector('[data-panel="tickets"]').hidden = this.ticketShop.hidden;
      if (this.ticketShop.hidden && this.dialog.dataset.panel === "tickets")
        this.selectPanel("wheel");
      for (const currency of this.ticketControls.keys()) this.updateTicketControl(currency);
      window.KillexControls.state(
        this.spinButton,
        !!this.busy || (!pending && (!enabled || r.tickets < 1)) || this.owner.inArena(),
        (!pending && (!enabled || r.tickets < 1)) || this.owner.inArena(),
      );
      this.spinButton.textContent = this.busy
        ? "Вращаем…"
        : pending
          ? "Восстановить результат"
          : "Крутить рулетку";
      if (!this.busy && !pending && r.tickets < 1)
        this.status.textContent = "Повысь уровень, чтобы получить билет.";
    }
    updateTicketControl(currency) {
      const control = this.ticketControls.get(currency),
        lite = this.profile?.roulette?.lite;
      const remaining = lite?.remaining[currency];
      const max = remaining === null ? 10000 : remaining || 0;
      control.limit.textContent =
        remaining === null ? "Без лимита за событие" : `Осталось ${max} из 50 за событие`;
      control.amount.max = String(Math.max(1, max));
      const count = Number(control.amount.value);
      control.cost.textContent =
        max === 0
          ? "Лимит исчерпан"
          : Number.isSafeInteger(count) && count > 0 && count <= max
            ? `Итого: ${number(count * control.price)} ${control.label}`
            : "Укажи доступное количество";
      window.KillexControls.state(
        control.buy,
        !!this.busy ||
          !!this.pending() ||
          !lite?.active ||
          this.owner.inArena() ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > max ||
          count * control.price > (this.profile?.wallet[currency] || 0),
        !lite?.active ||
          this.owner.inArena() ||
          !Number.isSafeInteger(count) ||
          count < 1 ||
          count > max ||
          count * control.price > (this.profile?.wallet[currency] || 0),
      );
      window.KillexControls.state(control.amount, !!this.busy || max === 0, max === 0);
    }
    async buyTickets(currency) {
      if (this.busy || !this.owner.isLobby() || this.owner.inArena()) return;
      this.busy = true;
      this.update();
      try {
        const count = Number(this.ticketControls.get(currency).amount.value);
        const data = await this.request("tickets", null, {
          currency,
          quantity: count,
          eventId: this.profile.roulette.lite.eventId,
        });
        if (data.result) await this.animate(data.result);
        else this.status.textContent = "Билеты зачислены. Можно вращать колесо!";
      } catch (error) {
        this.selectPanel("wheel");
        this.status.textContent = this.pending()
          ? "Ответ не получен. Нажми «Восстановить результат» - покупка не повторится."
          : error.message;
      } finally {
        this.busy = false;
        this.update();
      }
    }
    async request(action, offerId, extra = {}) {
      let pending = this.pending();
      if (!pending) {
        pending = {
          action,
          rulesVersion: R.version,
          ...(offerId ? { offerId } : {}),
          ...extra,
          requestId: window.KillexRequestIds.create(),
        };
        // Сохраняем номер до отправки: потеря ответа не должна тратить второй билет.
        sessionStorage.setItem(this.key(), JSON.stringify(pending));
      }
      const response = await fetch("/api/roulette/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
        signal: AbortSignal.timeout(10000),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status < 500) sessionStorage.removeItem(this.key());
        throw Error(data.error || "Не удалось получить результат.");
      }
      sessionStorage.removeItem(this.key());
      this.profile = data.profile;
      this.owner.updateProfile(data.profile);
      return data;
    }
    draw(offer, rotation = 0) {
      if (!offer) return;
      this.shownOffer = offer;
      const board = svg("svg", {
        viewBox: "-250 -250 500 500",
        role: "img",
        "aria-label": "Колесо: " + offer.slots.map((s) => s.name).join(", "),
      });
      const defs = svg("defs");
      for (const [id, colors] of Object.entries(palette)) {
        const gradient = svg("radialGradient", {
          id: `roulette-enamel-${id}`,
          gradientUnits: "userSpaceOnUse",
          cx: 0,
          cy: 0,
          r: 248,
        });
        for (const [offset, color] of [
          ["0%", colors[2]],
          ["65%", colors[1]],
          ["88%", colors[0]],
          ["100%", colors[1]],
        ])
          gradient.append(svg("stop", { offset, "stop-color": color }));
        defs.append(gradient);
      }
      const gold = svg("linearGradient", {
        id: "roulette-gold",
        x1: "0%",
        y1: "0%",
        x2: "65%",
        y2: "100%",
      });
      for (const [offset, color] of [
        ["0%", "#fffbc7"],
        ["30%", "#ffda65"],
        ["55%", "#ad5b13"],
        ["72%", "#ffe89a"],
        ["100%", "#da8d21"],
      ])
        gold.append(svg("stop", { offset, "stop-color": color }));
      const hubGradient = svg("radialGradient", {
        id: "roulette-hub",
        cx: "35%",
        cy: "25%",
        r: "75%",
      });
      for (const [offset, color] of [
        ["0%", "#ff9cdb"],
        ["45%", "#b82fbb"],
        ["100%", "#552078"],
      ])
        hubGradient.append(svg("stop", { offset, "stop-color": color }));
      defs.append(gold, hubGradient);
      board.append(defs);
      const disc = svg("g");
      const step = 360 / offer.slots.length;
      for (const [i, item] of offer.slots.entries()) {
        const start = ((i * step - step / 2 - 90) * Math.PI) / 180,
          end = start + (step * Math.PI) / 180;
        const sector = svg("path", {
          d: `M0 0L${238 * Math.cos(start)} ${238 * Math.sin(start)}A238 238 0 0 1 ${238 * Math.cos(end)} ${238 * Math.sin(end)}Z`,
          fill: `url(#roulette-enamel-${item.category})`,
          stroke: "#fff1ac",
          "stroke-width": "1.4",
        });
        const title = svg("title");
        title.textContent = item.name;
        sector.append(title);
        disc.append(sector);
        const group = svg("g", { transform: `rotate(${i * step})` });
        group.append(
          svg("image", {
            href: item.icon,
            x: -24,
            y: -216,
            width: 48,
            height: 48,
            preserveAspectRatio: "xMidYMid meet",
          }),
        );
        const amount = svg("text", {
          x: 0,
          y: -148,
          "text-anchor": "middle",
          fill: "#fffbe6",
          "font-size": 19,
          "font-weight": 800,
          stroke: "#24152f",
          "stroke-width": "0.7",
          "paint-order": "stroke",
        });
        amount.textContent = item.label;
        group.append(amount);
        disc.append(group);
      }
      disc.append(
        svg("circle", { r: 237, fill: "none", stroke: "url(#roulette-gold)", "stroke-width": 7 }),
      );
      disc.append(
        svg("circle", {
          r: 226,
          fill: "none",
          stroke: "#fff6c8",
          "stroke-opacity": 0.5,
          "stroke-width": 1,
        }),
      );
      board.append(disc);
      board.append(
        svg("image", {
          href: "assets/roulette/hub-v2.svg",
          x: -49,
          y: -49,
          width: 98,
          height: 98,
        }),
      );
      this.wheel.replaceChildren(board);
      this.wheel.style.transform = `rotate(${rotation}deg)`;
    }
    showResult(result) {
      this.dialog.classList.toggle("has-batch-result", !!result?.spins);
      window.KillexControls.state(this.resultTab, !result);
      if (!result) {
        this.result.hidden = true;
        this.selectInfo("odds");
        return;
      }
      this.selectInfo("result");
      this.result.hidden = false;
      if (result.spins) {
        this.result.classList.add("roulette-result-batch");
        this.result.replaceChildren(
          el("small", "", `Все ${result.spins.length} призов уже зачислены`),
        );
        const list = el("ol");
        for (const spin of result.spins) {
          const row = el("li");
          row.append(image(spin.reward.icon), el("strong", "", spin.reward.name));
          list.append(row);
        }
        this.result.append(list);
        return;
      }
      this.result.classList.remove("roulette-result-batch");
      this.result.replaceChildren(
        el("small", "", "Приз уже зачислен"),
        image(result.reward.icon),
        el("strong", "", result.reward.name),
      );
    }
    async animate(result) {
      // Пакет уже целиком сохранён сервером; колесо показывает последний из пяти призов.
      const shown = result.spins?.at(-1) || result;
      this.draw(shown.offer);
      this.result.hidden = true;
      const angle = (360 - (shown.index * 360) / R.slots.length) % 360;
      if (result.spins) this.status.textContent = "Пять вращений - пять призов…";
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      const lite = this.profile?.roulette?.lite;
      const fast =
        this.fastPreferred &&
        lite?.active &&
        lite.available &&
        (lite.endsAt === null || lite.endsAt > Date.now());
      if (!reduce && this.dialog.open && !document.hidden) {
        this.wheelFrame.classList.add("is-spinning");
        this.wheelFrame.classList.toggle("is-fast-spinning", !!fast);
        const turns = fast ? 1080 : 1800;
        this.animation = this.wheel.animate(
          [{ transform: "rotate(0deg)" }, { transform: `rotate(${turns + angle}deg)` }],
          { duration: fast ? 680 : 4800, easing: fast ? "cubic-bezier(.18,.12,.2,1)" : "cubic-bezier(.12,.72,.12,1)", fill: "forwards" },
        );
        const stopTicks = window.KillexAudio?.followRoulette(
          this.animation,
          turns + angle,
          R.slots.length,
          (id) => window.KillexAudio.play?.(id, 1, fast ? 2.8 : 1),
        );
        try {
          await this.animation.finished;
        } catch {
          /* Закрыто во время анимации. */
        } finally {
          stopTicks?.();
          window.KillexAudio?.stopTrack?.("roulette");
          this.animation.cancel();
          this.animation = null;
          this.wheelFrame.classList.remove("is-spinning");
          this.wheelFrame.classList.remove("is-fast-spinning");
        }
      }
      this.wheel.style.transform = `rotate(${angle}deg)`;
      this.showResult(result);
      this.selectPanel("info");
      this.status.textContent = result.spins
        ? "Все 5 призов зачислены. Колесо показывает пятый приз."
        : "Поздравляем! " + result.reward.name;
    }
    async open() {
      if (!this.owner.isLobby() || this.owner.inArena()) return;
      if (!this.profile?.roulette?.available && !this.pending()) return;
      window.KillexWindows.open(this.dialog);
      this.selectPanel("wheel");
      if (this.busy) return;
      this.busy = true;
      this.status.textContent = "";
      this.update();
      try {
        await this.owner.loadProfile();
        this.profile = this.owner.getProfile();
        const pending = this.pending();
        if (pending) {
          const data = await this.request(pending.action, pending.offerId);
          if (data.result) {
            await this.animate(data.result);
            return;
          }
        }
        if (!this.profile.roulette.offer && this.profile.roulette.available)
          await this.request("prepare");
        const r = this.profile.roulette;
        this.draw(r.offer || r.lastSpin?.offer);
        this.showResult(r.lastSpin);
        this.status.textContent = r.available
          ? "Одно вращение - один приз."
          : "Событие ещё не началось.";
      } catch (e) {
        this.status.textContent = this.pending()
          ? "Ответ не получен. Нажми «Восстановить результат». Повтор безопасен."
          : e.message;
      } finally {
        this.busy = false;
        this.update();
      }
    }
    async spin(count = 1) {
      if (this.busy || !this.owner.isLobby() || this.owner.inArena()) return;
      this.busy = true;
      this.selectPanel("wheel");
      this.update();
      try {
        const pending = this.pending();
        if (pending) {
          const data = await this.request(pending.action, pending.offerId);
          if (data.result) {
            await this.animate(data.result);
          } else
            this.status.textContent =
              pending.action === "tickets"
                ? "Покупка восстановлена. Билеты зачислены."
                : "Колесо готово к вращению.";
          return;
        }
        if (!this.profile.roulette.offer) await this.request("prepare");
        this.draw(this.profile.roulette.offer);
        const data = await this.request(
          count === 5 ? "spin-five" : "spin",
          this.profile.roulette.offer.id,
        );
        await this.animate(data.result);
      } catch (e) {
        this.status.textContent = this.pending()
          ? "Связь прервалась. Восстанови результат - второй билет не спишется."
          : e.message;
      } finally {
        this.busy = false;
        this.update();
      }
    }
  }
  window.KillexRouletteUI = RouletteUI;
})();

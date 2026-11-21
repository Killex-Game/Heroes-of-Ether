"use strict";
(() => {
  const R = window.KillexAlchemyRules;
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ""; if (text !== undefined) n.textContent = text; return n; };
  const img = (src, cls = "") => { const n = el("img", cls); n.loading = "lazy"; n.src = src; n.alt = ""; n.draggable = false; return n; };
  const button = (text, action, cls = "sf-button") => { const n = el("button", cls, text); n.type = "button"; n.onclick = action; return n; };
  const number = n => Number(n || 0).toLocaleString("ru-RU");
  class AlchemyUI {
    constructor(owner) {
      this.owner = owner; this.requests = new Map(); this.animations = new Set(); this.flights = new Set(); this.busy = false;
      this.motionFrame = 0; this.motionChecked = false; this.motionLimited = false; this.animationRevision = 0; this.visit = 0;
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion.addEventListener("change", () => { this.motion(); if (this.reducedMotion.matches) this.cancelAnimations(); });
      this.trigger = document.getElementById("alchemyButton"); this.trigger.onclick = () => this.open();
      this.permanent = button("", () => this.open(), "menu-tile sf-button sf-secondary alchemy-permanent");
      this.permanent.id = "etherGeneratorButton";
      this.permanent.append(img(R.asset("generator"), "menu-icon"), el("strong", "", "Эфирный генератор"));
      document.getElementById("eventsSection").after(this.permanent);
      for (const b of [this.trigger, this.permanent]) { b.setAttribute("aria-haspopup", "dialog"); b.setAttribute("aria-controls", "alchemyDialog"); }
      this.dialog = el("dialog", "alchemy-lab"); this.dialog.id = "alchemyDialog"; this.dialog.dataset.layout = "fullscreen";
      this.dialog.setAttribute("aria-labelledby", "alchemyTitle");
      const header = el("header", "alchemy-heading"); this.title = el("h1", "", "Лаборатория"); this.title.id = "alchemyTitle";
      const close = button("×", () => this.dialog.close(), "booster-close"); close.setAttribute("aria-label", "Вернуться в лобби");
      header.append(this.title, close);
      const stage = el("main", "alchemy-stage"); this.stage = stage; this.header = header;
      this.shelf = el("section", "alchemy-shelf"); this.shelf.setAttribute("aria-label", "Изученные зелья");
      this.potions = new Map();
      for (const [index, p] of R.potions.entries()) {
        const b = button("", () => this.showRecipes(p.id), "alchemy-potion"); b.dataset.potion = p.id; b.title = p.name;
        b.style.setProperty("--column", index % 4); b.style.setProperty("--row", Math.floor(index / 4));
        b.append(img(p.image), el("span", "alchemy-potion-count", ""));
        this.shelf.append(b); this.potions.set(p.id, b);
      }
      const center = el("section", "alchemy-center");
      this.generator = el("div", "alchemy-generator"); this.generator.append(img(R.asset("generator")));
      // Only the blue interior rotates. The two clipped windows preserve the gold casing.
      const ns = "http://www.w3.org/2000/svg", svg = (tag, attrs) => {
        const n = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, value); return n;
      };
      this.magic = svg("svg", { class: "alchemy-generator-magic", viewBox: "0 0 1536 1024", "aria-hidden": "true" });
      const defs = svg("defs", {}), clip = svg("clipPath", { id: "alchemy-orb-window" });
      clip.append(svg("path", { d: "M614 405C635 292 687 181 751 160C885 114 988 182 1022 310Q833 376 614 405Z M620 486Q857 451 1033 385C1053 502 969 606 848 622C741 629 660 591 620 486Z" }));
      defs.append(clip); const orbWindow = svg("g", { "clip-path": "url(#alchemy-orb-window)" });
      this.rotor = svg("image", { x: "550", y: "130", width: "550", height: "550", preserveAspectRatio: "none", class: "alchemy-generator-rotor" });
      orbWindow.append(this.rotor); this.magic.append(defs, orbWindow); this.generator.append(this.magic);
      this.glow = el("span", "alchemy-generator-glow"); this.generator.append(this.glow);
      this.sparks = Array.from({ length: 8 }, () => { const n = el("span", "alchemy-generator-spark"); this.generator.append(n); return n; });
      const gauge = el("section", "alchemy-gauge");
      this.amount = el("strong", "alchemy-natural"); this.bar = el("progress"); this.bar.max = R.NATURAL_PER_EXCHANGE;
      this.bar.setAttribute("aria-label", "Природный эфир");
      this.exchange = button("Создать 10 концентрированного эфира", () => this.act("exchange")); this.exchange.id = "alchemyExchange";
      gauge.append(el("span", "", "Природный эфир"), this.amount, this.bar, this.exchange);
      center.append(this.generator, gauge);
      const right = el("section", "alchemy-right");
      this.book = button("", () => this.showRecipes(), "alchemy-book"); this.book.id = "alchemyBook";
      this.book.append(img(R.asset("book")), el("span", "", "Сборник рецептов"));
      this.ingredients = el("div", "alchemy-ingredients"); this.ingredientCounts = new Map();
      for (const item of R.ingredients) {
        const cell = el("div", "alchemy-ingredient-cell"), count = el("strong", "", "0"); cell.title = item.name;
        cell.append(window.KillexAlchemyArt.element(item.id), count); this.ingredients.append(cell); this.ingredientCounts.set(item.id, count);
      }
      right.append(this.book, el("h2", "", "Ингредиенты"), this.ingredients);
      stage.append(this.shelf, center, right);
      this.notice = el("p", "alchemy-notice"); this.notice.setAttribute("role", "status");
      this.recipePanel = el("section", "alchemy-recipe-overlay"); this.recipePanel.hidden = true;
      this.recipePanel.setAttribute("aria-label", "Сборник рецептов");
      const recipeHead = el("header", "alchemy-recipe-header");
      recipeHead.append(button("‹", () => this.turn(-1), "sf-button"), el("h2", "", "Сборник рецептов"), button("›", () => this.turn(1), "sf-button"), button("Закрыть", () => this.closeRecipes(), "sf-button sf-tertiary"));
      this.recipeStrip = el("div", "alchemy-recipes"); this.recipeStrip.tabIndex = 0; this.recipeCards = new Map();
      for (const p of R.potions) {
        const card = el("article", "alchemy-recipe"); card.dataset.potion = p.id;
        const content = el("div", "alchemy-recipe-content"), items = el("div", "alchemy-recipe-items");
        for (const cost of p.ingredients) {
          const row = el("div", "alchemy-recipe-cost"); row.dataset.ingredient = cost.id;
          row.append(window.KillexAlchemyArt.element(cost.id), el("span", "", R.ingredient(cost.id).name), el("strong", "", "× " + cost.count)); items.append(row);
        }
        const brew = button("Сварить × " + p.yield, () => this.act("brew", p.id)); brew.dataset.action = "brew";
        const equip = button("В слот Z", () => this.act("equip", p.id), "sf-button sf-tertiary"); equip.dataset.action = "equip";
        content.append(el("h3", "", p.name), img(p.image, "alchemy-recipe-potion"), el("p", "alchemy-effect", p.effect), items, brew, equip);
        card.append(content); this.recipeStrip.append(card); this.recipeCards.set(p.id, card);
      }
      this.recipeStrip.addEventListener("wheel", event => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          event.preventDefault(); this.recipeStrip.scrollBy({ left: event.deltaY * (event.deltaMode === 1 ? 24 : 1), behavior: "auto" });
        }
      }, { passive: false });
      this.recipeStrip.addEventListener("keydown", event => {
        if (["ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(event.key)) {
          event.preventDefault(); this.turn(["ArrowLeft", "PageUp"].includes(event.key) ? -1 : 1);
        }
      });
      this.recipePanel.append(recipeHead, this.recipeStrip);
      this.result = el("section", "alchemy-result"); this.result.hidden = true; this.result.setAttribute("role", "status");
      this.dialog.append(header, stage, this.notice, this.recipePanel, this.result); document.body.append(this.dialog);
      this.dialog.addEventListener("cancel", event => {
        if (!this.result.hidden) { event.preventDefault(); this.closeResult(); }
        else if (!this.recipePanel.hidden) { event.preventDefault(); this.closeRecipes(); }
      });
      this.dialog.addEventListener("keydown", event => {
        if (event.key !== "Escape" || (this.result.hidden && this.recipePanel.hidden)) return;
        event.preventDefault(); event.stopPropagation();
        if (!this.result.hidden) this.closeResult(); else this.closeRecipes();
      });
      this.dialog.addEventListener("close", () => { this.visit++; this.cancelAnimations(); this.closeRecipes(); this.result.hidden = true; this.overlay(); this.motion(); });
      document.addEventListener("visibilitychange", () => { this.motion(); if (document.hidden) this.cancelAnimations(); });
      document.addEventListener("killex:profile", () => this.sync());
      document.addEventListener("killex:alchemy-open", event => { this.open(); if (this.dialog.open && R.get(event.detail)) this.showRecipes(event.detail); });
      new MutationObserver(() => { if (!owner.isLobby()) this.dialog.close(); this.motion(); })
        .observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
      window.addEventListener("pagehide", () => { this.stopMotionSample(); this.cancelAnimations(); }); this.sync();
    }
    state() { return this.owner.getProfile()?.alchemy; }
    active() { const s = this.state(); return !!s?.active && s.endsAt > (window.KillexAppearance?.now?.() ?? Date.now()); }
    sync() {
      const active = this.active(); this.trigger.hidden = !active; this.permanent.hidden = active;
      if (!this.dialog.open) return;
      const s = this.state(); if (!s) return;
      this.title.textContent = active ? "Лаборатория" : "Эфирный генератор";
      this.amount.textContent = number(s.natural) + " / " + number(R.NATURAL_PER_EXCHANGE);
      this.bar.value = Math.min(s.natural, R.NATURAL_PER_EXCHANGE);
      this.exchange.disabled = this.busy || s.natural < R.NATURAL_PER_EXCHANGE;
      for (const [id, node] of this.ingredientCounts) node.textContent = number(s.ingredients[id]);
      for (const [id, b] of this.potions) {
        b.dataset.learned = String(s.learned.includes(id)); b.dataset.selected = String(s.equipped === id);
        b.lastElementChild.textContent = s.potions[id] ? number(s.potions[id]) : "";
        b.setAttribute("aria-label", R.get(id).name + (s.learned.includes(id) ? ", в запасе " + number(s.potions[id]) : ", рецепт не изучен"));
      }
      for (const [id, card] of this.recipeCards) {
        const p = R.get(id), enough = p.ingredients.every(i => (s.ingredients[i.id] || 0) >= i.count);
        const brew = card.querySelector('[data-action="brew"]'); brew.disabled = this.busy || !active || !enough;
        brew.textContent = !active ? "Варка доступна во время события" : "Сварить × " + p.yield;
        const equip = card.querySelector('[data-action="equip"]'); equip.disabled = this.busy || !s.potions[id] || s.equipped === id;
        equip.textContent = s.equipped === id ? "Выбрано в слот Z" : "В слот Z";
        for (const row of card.querySelectorAll(".alchemy-recipe-cost")) {
          const cost = p.ingredients.find(i => i.id === row.dataset.ingredient);
          row.dataset.enough = String((s.ingredients[cost.id] || 0) >= cost.count);
        }
      }
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.visit++;
      if (!this.rotor.hasAttribute("href")) this.rotor.setAttribute("href", R.asset("generator-orb-v2"));
      this.notice.textContent = ""; this.result.hidden = true; this.overlay();
      window.KillexWindows.open(this.dialog); this.sync(); this.motion(); this.owner.loadProfile();
    }
    showRecipes(id) {
      if (this.busy) return;
      this.result.hidden = true; this.recipePanel.hidden = false; this.sync();
      this.overlay();
      const card = this.recipeCards.get(id || this.state()?.equipped || R.potions[0].id);
      this.recipeStrip.scrollLeft = card.offsetLeft - this.recipeStrip.offsetLeft;
      this.recipeStrip.focus({ preventScroll: true });
    }
    overlay() { this.stage.inert = this.header.inert = !this.recipePanel.hidden || !this.result.hidden; this.motion(); }
    closeRecipes() { this.recipePanel.hidden = true; this.overlay(); if (this.dialog.open) this.book.focus({ preventScroll: true }); }
    closeResult() { this.result.hidden = true; this.overlay(); this.book.focus({ preventScroll: true }); }
    turn(direction) { this.recipeStrip.scrollBy({ left: direction * this.recipeStrip.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
    motion() {
      const visible = this.dialog.open && this.recipePanel.hidden && this.result.hidden && !document.hidden && this.owner.isLobby();
      this.dialog.dataset.animate = String(visible && !this.motionLimited && !this.reducedMotion.matches);
      if (!visible || this.reducedMotion.matches) { this.stopMotionSample(); return; }
      if (this.motionChecked || this.motionFrame) return;
      // One bounded sample per visit/session quality decision, never an idle loop.
      // Ignore initial image decoding; only sustained slow frames disable decoration.
      let first, previous; const intervals = [];
      const sample = at => {
        if (first === undefined) first = at;
        if (at - first > 500 && previous !== undefined) intervals.push(at - previous);
        previous = at;
        if (at - first < 2500) { this.motionFrame = requestAnimationFrame(sample); return; }
        this.motionFrame = 0; this.motionChecked = true;
        this.motionLimited = intervals.length > 0 && intervals.filter(ms => ms > 50).length / intervals.length > .75;
        if (this.motionLimited) this.cancelAnimations();
        this.dialog.dataset.motionLimited = String(this.motionLimited); this.motion();
      };
      this.motionFrame = requestAnimationFrame(sample);
    }
    stopMotionSample() { if (this.motionFrame) cancelAnimationFrame(this.motionFrame); this.motionFrame = 0; }
    cancelAnimations() { this.animationRevision++; for (const a of this.animations) a.cancel(); this.animations.clear(); for (const n of this.flights) n.remove(); this.flights.clear(); }
    play(node, frames, options) {
      const a = node.animate(frames, options); this.animations.add(a);
      return a.finished.catch(() => {}).finally(() => { a.cancel(); this.animations.delete(a); });
    }
    async animate(origins) {
      const revision = this.animationRevision;
      const visible = () => revision === this.animationRevision && this.dialog.open && !document.hidden && this.owner.isLobby() && !this.reducedMotion.matches && !this.motionLimited;
      if (!visible()) return;
      const target = this.generator.getBoundingClientRect(), root = this.dialog.getBoundingClientRect();
      const promises = origins.map(({ id, rect }, i) => {
        const node = window.KillexAlchemyArt.element(id); node.classList.add("alchemy-flight");
        Object.assign(node.style, { left: rect.left - root.left + this.dialog.scrollLeft - this.dialog.clientLeft + "px", top: rect.top - root.top + this.dialog.scrollTop - this.dialog.clientTop + "px", width: rect.width + "px", height: rect.height + "px" });
        this.dialog.append(node); this.flights.add(node);
        return this.play(node, [{ transform: "translate(0,0) scale(1)", opacity: 1 },
          { transform: `translate(${target.left + target.width / 2 - rect.left - rect.width / 2}px, ${target.top + target.height * .4 - rect.top - rect.height / 2}px) scale(.25)`, opacity: .15 }], { duration: 850, delay: i * 65, easing: "cubic-bezier(.45,0,.2,1)", fill: "forwards" });
      });
      await Promise.all(promises);
      for (const n of this.flights) n.remove(); this.flights.clear();
      if (!visible()) return;
      const timing = { duration: 1800, easing: "cubic-bezier(.35,0,.2,1)" };
      await Promise.all([
        this.play(this.magic, [{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 1, offset: .82 }, { opacity: 0 }], timing),
        this.play(this.rotor, [{ transform: "rotate(0deg) scale(1.08)" }, { transform: "rotate(720deg) scale(1.08)" }], timing),
        this.play(this.glow, [{ opacity: 0, transform: "scale(.5)" }, { opacity: .65, transform: "scale(1.05)", offset: .65 }, { opacity: 0, transform: "scale(1.5)" }], timing),
        ...this.sparks.map((node, i) => {
          const angle = i * Math.PI / 4, radius = Math.min(target.width * .3, 155);
          return this.play(node, [{ opacity: 0, transform: "translate(0,0) scale(.2)" },
            { opacity: 1, transform: `translate(${Math.cos(angle + .7) * radius * .65}px,${Math.sin(angle + .7) * radius * .65}px) rotate(90deg) scale(1)`, offset: .45 },
            { opacity: 0, transform: `translate(${Math.cos(angle) * radius}px,${Math.sin(angle) * radius}px) rotate(180deg) scale(.25)` }], { duration: 1500, delay: i * 35, easing: "ease-out" });
        }),
      ]);
    }
    async act(action, potionId) {
      if (this.busy || !this.owner.isLobby()) return;
      const data = { action, ...(potionId && { potionId }), ...(action === "brew" && { runId: this.state()?.runId }) };
      const key = JSON.stringify(data), requestId = this.requests.get(key) || window.KillexRequestIds.create(); this.requests.set(key, requestId);
      const visit = this.visit;
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 12000);
      const card = this.recipeCards.get(potionId);
      const origins = action === "brew" ? [...card.querySelectorAll(".alchemy-ingredient-art")].map(n => ({ id: n.dataset.ingredient, rect: n.getBoundingClientRect() })) : [];
      this.busy = true; this.notice.textContent = ""; this.sync();
      try {
        const response = await fetch("/api/alchemy/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...data, requestId }), signal: controller.signal });
        const result = await response.json();
        if (!response.ok) { if (response.status < 500) this.requests.delete(key); throw Error(result.error || "Действие сейчас недоступно."); }
        this.requests.delete(key); this.owner.updateProfile(result.profile);
        if (action !== "equip" && this.dialog.open && visit === this.visit) { this.closeRecipes(); await this.animate(origins); }
        if (action !== "equip" && this.dialog.open && visit === this.visit) {
          this.result.replaceChildren(); const reward = action === "brew" ? R.get(potionId) : null;
          this.result.append(el("h2", "", "Получено"), img(reward?.image || "assets/food/ether-drop-v1.webp"),
            el("strong", "", reward ? reward.name + " × " + reward.yield : "Концентрированный эфир × 10"), button("Продолжить", () => this.closeResult()));
          this.result.hidden = false; this.overlay(); this.result.querySelector("button").focus({ preventScroll: true });
        }
      } catch (e) { this.notice.textContent = e.name === "AbortError" ? "Ответ задерживается. Повтори действие: повторного списания не будет." : e.message; }
      finally { clearTimeout(timeout); this.busy = false; this.sync(); }
    }
  }
  window.KillexAlchemyUI = AlchemyUI;
})();

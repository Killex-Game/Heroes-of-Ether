"use strict";
(() => {
  const R = window.KillexAlchemyRules;
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ""; if (text !== undefined) n.textContent = text; return n; };
  const img = (src, cls = "") => { const n = el("img", cls); n.loading = "lazy"; n.src = window.KillexArtRevision.url(src); n.alt = ""; n.draggable = false; return n; };
  const button = (text, action, cls = "sf-button") => { const n = el("button", cls, text); n.type = "button"; n.onclick = action; return n; };
  const number = n => Number(n || 0).toLocaleString("ru-RU");
  class AlchemyUI {
    constructor(owner) {
      this.owner = owner; this.requests = new Map(); this.animations = new Set(); this.flights = new Set(); this.busy = false;
      this.motionFrame = 0; this.motionChecked = false; this.motionLimited = false; this.animationRevision = 0; this.visit = 0;
      this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
      this.reducedMotion.addEventListener("change", () => { this.motion(); if (this.reducedMotion.matches) this.cancelAnimations(); });
      this.trigger = document.getElementById("alchemyButton"); this.trigger.onclick = () => this.open();
      this.generatorUI = new window.KillexEtherGenerator(owner);
      this.trigger.setAttribute("aria-haspopup", "dialog"); this.trigger.setAttribute("aria-controls", "alchemyDialog");
      this.dialog = el("dialog", "alchemy-lab"); this.dialog.id = "alchemyDialog"; this.dialog.dataset.layout = "fullscreen";
      this.dialog.setAttribute("aria-labelledby", "alchemyTitle");
      const header = el("header", "alchemy-heading"); this.title = el("h1", "", "Эфирная алхимия"); this.title.id = "alchemyTitle";
      const close = button("×", () => this.dialog.close(), "booster-close"); close.setAttribute("aria-label", "Вернуться в лобби");
      header.append(this.title, close);
      const stage = el("main", "alchemy-stage"); this.stage = stage; this.header = header;
      this.shelf = el("section", "alchemy-shelf"); this.shelf.setAttribute("aria-label", "Изученные зелья");
      this.potions = new Map();
      for (const [index, p] of R.potions.entries()) {
        const b = button("", () => this.showRecipes(p.id), "alchemy-potion"); b.dataset.potion = p.id; b.title = p.name;
        b.style.setProperty("--column", index % 4); b.style.setProperty("--shelf-bottom", ["27.3%", "44.5%", "61.6%", "80.1%"][Math.floor(index / 4)]);
        b.append(img(p.image), el("span", "alchemy-potion-count", ""));
        this.shelf.append(b); this.potions.set(p.id, b);
      }
      const center = el("section", "alchemy-center");
      this.generator = el("div", "alchemy-cauldron"); this.generator.append(img(R.asset("cauldron-v1")));
      this.glow = el("span", "alchemy-generator-glow"); this.generator.append(this.glow);
      center.append(this.generator);
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
      const active = this.active(); this.trigger.hidden = !active;
      if (!this.dialog.open) return;
      const s = this.state(); if (!s) return;
      this.title.textContent = "Эфирная алхимия";
      for (const [id, node] of this.ingredientCounts) node.textContent = number(s.ingredients[id]);
      for (const [id, b] of this.potions) {
        b.dataset.learned = String(s.learned.includes(id)); b.dataset.selected = String(R.equipped(s).includes(id));
        b.lastElementChild.textContent = s.potions[id] ? number(s.potions[id]) : "";
        b.setAttribute("aria-label", R.get(id).name + (s.learned.includes(id) ? ", в запасе " + number(s.potions[id]) : ", рецепт не изучен"));
      }
      for (const [id, card] of this.recipeCards) {
        const p = R.get(id), enough = p.ingredients.every(i => (s.ingredients[i.id] || 0) >= i.count);
        const brew = card.querySelector('[data-action="brew"]'); brew.disabled = this.busy || !active || !enough;
        brew.textContent = !active ? "Варка доступна во время события" : "Сварить × " + p.yield;
        const queue = R.equipped(s), index = queue.indexOf(id);
        const equip = card.querySelector('[data-action="equip"]'); equip.disabled = this.busy || !s.potions[id] || (index < 0 && queue.length >= R.MAX_ACTIVE);
        equip.textContent = index >= 0 ? `Z: ${index + 1}, Убрать` : "В очередь Z";
        for (const row of card.querySelectorAll(".alchemy-recipe-cost")) {
          const cost = p.ingredients.find(i => i.id === row.dataset.ingredient);
          row.dataset.enough = String((s.ingredients[cost.id] || 0) >= cost.count);
        }
      }
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.visit++;
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
      await Promise.all([
        this.play(this.generator, [{transform:"scale(1)"},{transform:"scale(1.025)",offset:.5},{transform:"scale(1)"}], {duration:900,easing:"ease-in-out"}),
        this.play(this.glow, [{opacity:0},{opacity:.4,offset:.5},{opacity:0}], {duration:900,easing:"ease-in-out"}),
      ]);
    }
    async act(action, potionId) {
      if (this.busy || !this.owner.isLobby()) return;
      const data = { action, ...(potionId && { potionId }), ...(action === "brew" && { runId: this.state()?.runId }) };
      if (action === "equip") {
        const queue = R.equipped(this.state());
        data.potionIds = queue.includes(potionId) ? queue.filter(id => id !== potionId) : [...queue, potionId];
        delete data.potionId;
      }
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
          this.result.append(el("h2", "", "Получено"), img(reward?.image || "assets/food/ether-drop-v1.webp?art=20261123-interface-art"),
            el("strong", "", reward ? reward.name + " × " + reward.yield : "Концентрированный эфир × 10"), button("Продолжить", () => this.closeResult()));
          this.result.hidden = false; this.overlay(); this.result.querySelector("button").focus({ preventScroll: true });
        }
      } catch (e) { this.notice.textContent = e.name === "AbortError" ? "Ответ задерживается. Повтори действие: повторного списания не будет." : e.message; }
      finally { clearTimeout(timeout); this.busy = false; this.sync(); }
    }
  }
  window.KillexAlchemyUI = AlchemyUI;
})();

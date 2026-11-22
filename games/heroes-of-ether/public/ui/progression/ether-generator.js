/* Permanent ether exchange is independent of the brewing event. */
"use strict";
(() => {
  const R = window.KillexAlchemyRules;
  const el = (tag, cls, text) => { const n = document.createElement(tag); n.className = cls || ""; if (text !== undefined) n.textContent = text; return n; };
  const button = (text, action, cls = "sf-button") => { const n = el("button", cls, text); n.type = "button"; n.onclick = action; return n; };
  class EtherGenerator {
    constructor(owner) {
      this.owner = owner; this.busy = false; this.visit = 0;
      this.trigger = button("", () => this.open(), "menu-tile sf-button sf-secondary alchemy-permanent"); this.trigger.id = "etherGeneratorButton";
      const icon = el("img", "menu-icon"); icon.src = R.asset("generator"); icon.alt = ""; this.trigger.append(icon, el("strong", "", "Эфирный генератор"));
      let tools = document.querySelector(".lobby-generator-tools");
      if (!tools) { tools = el("div", "lobby-generator-tools"); document.querySelector("#lobby .lobby-header").append(tools); }
      tools.prepend(this.trigger); this.trigger.setAttribute("aria-haspopup", "dialog"); this.trigger.setAttribute("aria-controls", "etherGeneratorDialog");
      this.dialog = el("dialog", "alchemy-lab ether-generator-dialog"); this.dialog.id = "etherGeneratorDialog"; this.dialog.setAttribute("aria-labelledby", "etherGeneratorTitle");
      const head = el("header", "alchemy-heading"), title = el("h1", "", "Эфирный генератор"); title.id = "etherGeneratorTitle";
      const close = button("×", () => this.dialog.close(), "booster-close"); close.setAttribute("aria-label", "Вернуться в лобби"); head.append(title, close);
      const main = el("main", "ether-generator-body"), art = el("img", "ether-generator-art"); art.src = R.asset("generator"); art.alt = ""; art.draggable = false;
      const gauge = el("section", "alchemy-gauge"); this.amount = el("strong", "alchemy-natural"); this.bar = el("progress"); this.bar.max = R.NATURAL_PER_EXCHANGE; this.bar.setAttribute("aria-label", "Природный эфир");
      this.exchange = button("Создать 10 концентрированного эфира", () => this.convert()); this.exchange.id = "alchemyExchange";
      gauge.append(el("span", "", "Природный эфир"), this.amount, this.bar, this.exchange); main.append(art, gauge);
      this.notice = el("p", "ether-generator-notice"); this.notice.setAttribute("role", "status"); this.dialog.append(head, main, this.notice); document.body.append(this.dialog);
      this.dialog.addEventListener("close", () => { this.visit++; this.trigger.focus({preventScroll:true}); });
      document.addEventListener("killex:profile", () => this.sync());
      new MutationObserver(() => { if (!owner.isLobby()) this.dialog.close(); }).observe(document.body, {attributes:true, attributeFilter:["data-screen"]});
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.visit++; this.notice.textContent = ""; window.KillexWindows.open(this.dialog); this.sync(); this.owner.loadProfile();
    }
    sync() {
      if (!this.dialog.open) return;
      const natural = this.owner.getProfile()?.alchemy?.natural || 0;
      this.amount.textContent = natural.toLocaleString("ru-RU") + " / " + R.NATURAL_PER_EXCHANGE.toLocaleString("ru-RU");
      this.bar.value = Math.min(natural, R.NATURAL_PER_EXCHANGE); this.exchange.disabled = this.busy || (natural < R.NATURAL_PER_EXCHANGE && !this.requestId);
    }
    async convert() {
      if (this.busy || !this.owner.isLobby()) return;
      const profileId = this.owner.getProfile()?.id;
      if (this.requestProfile !== profileId) { this.requestId = null; this.requestProfile = profileId; }
      this.requestId ||= window.KillexRequestIds.create(); this.busy = true; this.notice.textContent = ""; this.sync(); const visit = this.visit;
      try {
        const response = await fetch("/api/alchemy/action", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"exchange",requestId:this.requestId}),signal:AbortSignal.timeout(12000)});
        const data = await response.json();
        if (!response.ok) { if (response.status < 500) this.requestId = null; throw Error(data.error || "Обмен сейчас недоступен."); }
        this.requestId = null;
        if (this.owner.getProfile()?.id !== profileId) return;
        this.owner.updateProfile(data.profile);
        if (this.dialog.open && visit === this.visit) this.notice.textContent = "Получено 10 концентрированного эфира.";
      } catch (error) {
        if (this.dialog.open && visit === this.visit) this.notice.textContent = error.name === "TimeoutError" || error instanceof TypeError ? "Ответ задерживается. Повтори обмен: повторного списания не будет." : error.message;
      } finally { this.busy = false; this.sync(); }
    }
  }
  window.KillexEtherGenerator = EtherGenerator;
})();

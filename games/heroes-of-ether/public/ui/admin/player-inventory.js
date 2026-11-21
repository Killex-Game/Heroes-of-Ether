"use strict";
(() => {
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  class PlayerInventory {
    constructor({ review, retry }) {
      this.review = review;
      this.dialog = el("dialog", undefined, "owner-inventory-dialog");
      this.dialog.id = "playerInventoryDialog";
      this.dialog.setAttribute("aria-labelledby", "playerInventoryTitle");
      const header = el("div", undefined, "section-title"), close = el("button", "Закрыть");
      close.type = "button"; close.onclick = () => this.dialog.close();
      this.title = el("h2"); this.title.id = "playerInventoryTitle";
      header.append(this.title, close);
      this.search = el("input"); this.search.type = "search"; this.search.placeholder = "Найти бустер";
      this.search.setAttribute("aria-label", "Поиск бустера");
      this.search.oninput = () => { for (const row of this.rows || []) row.node.hidden = !row.name.includes(this.search.value.trim().toLocaleLowerCase("ru")); };
      this.hint = el("p", "", "muted"); this.hint.setAttribute("role", "status");
      this.status = el("p", ""); this.status.setAttribute("role", "status");
      this.retry = el("button", "Повторить сохранение"); this.retry.type = "button"; this.retry.hidden = true; this.retry.onclick = retry;
      const label = el("label", "Причина изменения");
      this.reason = el("input"); this.reason.maxLength = 500; this.reason.value = "Корректировка инвентаря";
      label.append(this.reason);
      this.list = el("div", undefined, "owner-inventory-list");
      this.dialog.append(header, this.search, this.hint, this.status, this.retry, label, this.list);
      document.body.append(this.dialog);
    }
    open() {
      if (!this.player) return;
      this.search.value = ""; this.status.textContent = ""; this.render();
      if (!this.dialog.open) this.dialog.showModal();
    }
    close() { this.dialog.close(); }
    clear() { this.close(); this.player = null; this.rows = []; this.list.replaceChildren(); }
    update(player, forbidden) {
      this.player = player; this.forbidden = forbidden;
      if (this.dialog.open) this.render();
    }
    message(text) { if (this.dialog.open) this.status.textContent = text; }
    setBusy(busy, pending) { this.busy = busy || pending; this.retry.hidden = !pending; this.retry.disabled = busy; this.controls(); }
    controls() {
      this.hint.textContent = this.forbidden || (this.busy ? "Заверши текущую правку." : "Выбери количество кнопками − и +, затем примени правку.");
      for (const row of this.rows || []) {
        const disabled = !!this.forbidden || this.busy;
        row.minus.disabled = disabled || row.value <= 0 || row.value - row.count <= -10000;
        row.plus.disabled = disabled || row.value - row.count >= 10000 || row.value >= Number.MAX_SAFE_INTEGER;
        row.apply.disabled = disabled || row.value === row.count;
        row.amount.textContent = row.value.toLocaleString("ru-RU");
      }
    }
    render() {
      const player = this.player;
      this.title.textContent = "Бустеры — " + player.name;
      this.rows = []; this.list.replaceChildren();
      for (const booster of player.boosters) {
        const count = player.inventory[booster.id] || 0;
        const card = el("article", undefined, "owner-inventory-row"); card.dataset.booster = booster.id;
        if (booster.icon) { const image = el("img"); image.src = "/" + booster.icon.replace(/^\//, ""); image.alt = ""; image.loading = "lazy"; card.append(image); }
        const description = el("div", undefined, "owner-inventory-description");
        description.append(el("strong", booster.name), el("small", booster.effect || "", "muted"));
        const controls = el("div", undefined, "owner-inventory-controls"), minus = el("button", "−"), plus = el("button", "+"), amount = el("output"), apply = el("button", "Применить", "primary");
        for (const button of [minus, plus, apply]) button.type = "button";
        minus.setAttribute("aria-label", "Уменьшить: " + booster.name); plus.setAttribute("aria-label", "Увеличить: " + booster.name);
        amount.setAttribute("aria-label", "Количество: " + booster.name); amount.setAttribute("aria-live", "polite");
        const row = { node: card, name: booster.name.toLocaleLowerCase("ru"), count, value: count, minus, plus, amount, apply };
        minus.onclick = () => { if (!minus.disabled) { row.value--; this.controls(); } };
        plus.onclick = () => { if (!plus.disabled) { row.value++; this.controls(); } };
        apply.onclick = () => {
          if (apply.disabled) return;
          const reason = this.reason.value.trim();
          if (reason.length < 3) { this.hint.textContent = "Укажи причину изменения, минимум 3 символа."; this.reason.focus(); return; }
          this.review({ boosterId: booster.id, amount: row.value - count, reason });
        };
        controls.append(minus, amount, plus, apply); card.append(description, controls); this.rows.push(row); this.list.append(card);
      }
      this.controls(); this.search.oninput();
    }
  }
  window.KillexPlayerInventory = PlayerInventory;
})();

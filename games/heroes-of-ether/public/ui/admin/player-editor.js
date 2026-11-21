"use strict";
(() => {
  const el = (tag, text) => { const n = document.createElement(tag); if (text) n.textContent = text; return n; };
  class PlayerEditor {
    constructor({ review, retry }) {
      this.review = review;
      this.dialog = el("dialog"); this.dialog.id = "playerEditorDialog";
      this.dialog.className = "owner-player-editor";
      this.dialog.setAttribute("aria-labelledby", "playerEditorTitle");
      const header = el("div"); header.className = "section-title";
      this.title = el("h2"); this.title.id = "playerEditorTitle";
      const close = el("button", "Закрыть"); close.type = "button"; close.onclick = () => this.close();
      header.append(this.title, close);
      this.playerName = el("p");
      this.form = el("form");
      this.label = el("label"); this.caption = el("span"); this.input = el("input"); this.input.required = true;
      this.input.id = "playerEditorValue";
      this.label.append(this.caption, this.input);
      this.skinChoice = el("select"); this.skinChoice.hidden = true; this.skinChoice.disabled = true;
      this.skinChoice.id = "playerEditorAvatar";
      this.skinChoice.setAttribute("aria-label", "Подарочный аватар");
      this.label.append(this.skinChoice);
      this.hint = el("p"); this.hint.className = "muted";
      const reasonLabel = el("label", "Причина изменения");
      this.reason = el("input"); this.reason.required = true; this.reason.minLength = 3; this.reason.maxLength = 500;
      reasonLabel.append(this.reason);
      this.status = el("p"); this.status.setAttribute("role", "status");
      this.submit = el("button", "Проверить правку"); this.submit.type = "submit"; this.submit.className = "primary";
      this.retry = el("button", "Повторить сохранение"); this.retry.type = "button"; this.retry.hidden = true; this.retry.onclick = retry;
      this.form.append(this.label, this.hint, reasonLabel, this.status, this.submit, this.retry);
      this.form.onsubmit = event => {
        event.preventDefault();
        if (this.submit.disabled) return;
        this.review({ action: this.action, value: this.action === "avatarGift" ? this.skinChoice.value : this.input.value, reason: this.reason.value.trim() });
      };
      this.dialog.append(header, this.playerName, this.form); document.body.append(this.dialog);
    }
    open(action) {
      if (!this.player || this.busy) return;
      this.action = action;
      const level = action === "level";
      const gift = action === "avatarGift";
      this.label.htmlFor = gift ? this.skinChoice.id : this.input.id;
      this.input.hidden = gift; this.input.required = !gift;
      this.skinChoice.hidden = !gift; this.skinChoice.required = gift;
      this.title.textContent = gift ? "Подарить аватар" : level ? "Изменить уровень" : "Изменить ник";
      this.caption.textContent = gift ? "Подарочный аватар" : level ? "Новый уровень" : "Новый ник";
      this.input.type = level ? "number" : "text"; this.input.min = "1"; this.input.step = "1";
      if (level) this.input.removeAttribute("maxlength"); else this.input.maxLength = 16;
      this.reason.value = gift ? "Личный подарок от владельца игры" : level ? "Корректировка уровня" : "Корректировка ника";
      this.status.textContent = ""; this.update(this.player, this.forbidden);
      if (!this.dialog.open) this.dialog.showModal();
      if (gift) this.skinChoice.focus(); else { this.input.focus(); this.input.select(); }
    }
    close() { this.dialog.close(); }
    clear() { this.close(); this.player = null; }
    update(player, forbidden) {
      this.player = player; this.forbidden = forbidden;
      this.playerName.textContent = player.name;
      this.input.value = this.action === "level" ? player.level : player.name;
      const selected = this.skinChoice.value;
      this.skinChoice.replaceChildren();
      for (const skin of player.ownerGiftSkins || []) {
        const option = el("option", skin.name + (skin.owned ? " — уже получен" : ""));
        option.value = skin.id; option.disabled = skin.owned; this.skinChoice.append(option);
      }
      this.skinChoice.value = (player.ownerGiftSkins || []).find(s => s.id === selected && !s.owned)?.id ||
        (player.ownerGiftSkins || []).find(s => !s.owned)?.id || "";
      this.controls();
    }
    message(text) { if (this.dialog.open) this.status.textContent = text; }
    setBusy(busy, pending) {
      this.busy = busy || pending; this.retry.hidden = !pending; this.retry.disabled = busy; this.controls();
    }
    controls() {
      const gift = this.action === "avatarGift", blocked = !!this.forbidden || this.busy;
      this.submit.disabled = blocked || (gift && !this.skinChoice.value);
      this.input.disabled = blocked || gift; this.skinChoice.disabled = blocked || !gift; this.reason.disabled = blocked;
      this.submit.textContent = gift ? "Проверить подарок" : "Проверить правку";
      this.hint.textContent = this.forbidden || (gift ? "Аватар навсегда появится в подарочной коллекции только этого игрока. Уже полученный аватар повторно не выдаётся." : this.action === "level"
        ? "Опыт — начало выбранного уровня. Награды за пропущенные уровни не выдаются. Предметы и достижения сохраняются."
        : "Ник должен быть свободным, от 1 до 16 символов.");
    }
  }
  window.KillexPlayerEditor = PlayerEditor;
})();

"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const dialog = el("dialog", "promo-code-dialog"), header = el("header", "personal-heading"),
    title = el("h2", "", "Промокод"), close = el("button", "personal-close", "×"),
    form = el("form", "promo-code-form"), input = el("input"),
    label = el("label", "", "Введи промокод"), submit = el("button", "sf-button sf-primary", "Активировать"),
    status = el("p", "promo-code-status"), rewards = el("ul", "promo-code-rewards");
  dialog.id = "promoCodeDialog";
  title.id = "promoCodeTitle";
  dialog.setAttribute("aria-labelledby", title.id);
  close.type = "button";
  close.setAttribute("aria-label", "Закрыть");
  close.onclick = () => dialog.close();
  header.append(title, close);
  input.id = "promoCodeInput";
  input.maxLength = 48;
  input.required = true;
  input.autocomplete = "off";
  input.autocapitalize = "characters";
  input.spellcheck = false;
  label.htmlFor = input.id;
  status.setAttribute("role", "status");
  submit.type = "submit";
  form.append(label, input, el("small", "", "Каждый промокод можно активировать один раз на игрока."), submit);
  const resultControls = el("div", "promo-result-controls"),
    another = el("button", "sf-button sf-primary", "Ввести другой");
  another.type = "button";
  rewards.setAttribute("aria-label", "Полученные награды");
  resultControls.append(another);
  resultControls.hidden = true;
  dialog.append(header, form, status, rewards, resultControls);
  document.body.append(dialog);
  let pending = null, busy = false, playerId = null, received = [];
  function rewardCard(reward) {
    const card = el("li", "promo-reward-card"), picture = el("div", "promo-reward-picture");
    card.dataset.kind = reward.kind;
    if (reward.kind === "accessory") card.dataset.slot = window.KillexAccessories?.item(reward.id)?.slot || "";
    if (reward.kind === "frame" && !reward.icon) {
      const frame = el("div", "promo-reward-frame");
      picture.append(frame);
      window.KillexAppearance?.paintFrame(frame, reward.id);
    } else {
      const img = el("img");
      img.src = reward.icon;
      img.alt = "";
      img.width = img.height = 80;
      picture.append(img);
    }
    card.append(picture, el("strong", "promo-reward-name", reward.name),
      el("span", "promo-reward-amount", "× " + reward.amount.toLocaleString("ru-RU")));
    return card;
  }
  function renderRewards() {
    rewards.replaceChildren(...received.map(rewardCard));
    rewards.scrollTop = 0;
    rewards.tabIndex = 0;
  }
  function resetResult() {
    form.hidden = false; resultControls.hidden = true; received = [];
    rewards.replaceChildren(); status.textContent = "";
  }
  another.onclick = () => { resetResult(); input.focus(); };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const code = input.value.trim().normalize("NFKC").toUpperCase(), actor = playerId;
    if (pending?.code !== code) pending = { code, requestId: window.KillexRequestIds.create() };
    busy = true;
    window.KillexControls.state(submit, true, false);
    input.readOnly = true;
    status.textContent = "";
    rewards.replaceChildren();
    try {
      const response = await fetch("/api/promo-code/redeem", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending),
        signal: AbortSignal.timeout(12000),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Не удалось активировать промокод.");
      if (actor !== playerId) return;
      document.dispatchEvent(new CustomEvent("killex:profile", { detail: result.profile }));
      status.textContent = "Промокод активирован. Награды получены!";
      received = result.rewards; form.hidden = true; resultControls.hidden = false;
      renderRewards();
      input.value = "";
      pending = null;
    } catch (error) {
      status.textContent = error.name === "TimeoutError"
        ? "Ответ задержался. Нажми «Активировать» ещё раз: повторного начисления не будет." : error.message;
    } finally {
      busy = false;
      input.readOnly = false;
      window.KillexControls.state(submit, false);
    }
  };
  document.getElementById("promoCodeSection").onclick = () => {
    if (document.body.dataset.screen !== "lobby") return;
    if (!busy && received.length) resetResult();
    window.KillexUITheme?.inherit(dialog, document.body);
    window.KillexWindows.open(dialog);
    input.focus();
  };
  document.addEventListener("killex:profile", event => {
    if (playerId && playerId !== event.detail.id) { pending = null; input.value = ""; resetResult(); dialog.close(); }
    playerId = event.detail.id;
  });
})();

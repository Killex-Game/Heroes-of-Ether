/* Вертикальный путь титулов. Строится только при открытии, без опроса сервера. */
"use strict";
(() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const number = value => Number(value || 0).toLocaleString("ru-RU");
  function art(src, className, size) {
    const img = el("img", className);
    img.src = window.KillexArtRevision.url(src); img.alt = ""; img.width = img.height = size;
    img.loading = "lazy"; img.decoding = "async";
    return img;
  }
  function prize(src, name, detail, className = "") {
    const row = el("div", "title-road-prize " + className), copy = el("div", "");
    copy.append(el("strong", "", name));
    if (detail) copy.append(el("small", "", detail));
    row.append(art(src, "", 56), copy);
    return row;
  }
  function open(dialog, profile) {
    const titles = profile.honors?.tiers || [], greatness = Math.max(0, profile.greatness || 0);
    const head = el("header", "clan-heading"), close = el("button", "booster-close", "×");
    close.type = "button"; close.setAttribute("aria-label", "Закрыть титулы");
    close.onclick = () => dialog.close();
    head.append(el("h2", "", "Все титулы"), close);
    const summary = el("div", "title-road-summary");
    summary.append(el("strong", "", "Ваше величие: " + number(greatness)));
    const current = el("button", "sf-button sf-tertiary", "К моему прогрессу");
    current.type = "button"; summary.append(current);
    const guide = el("p", "title-catalog-note", "Получай величие и открывай титулы. Медаль, рамка и аксессуары остаются навсегда. Содержимое каждого сундука показано рядом.");
    const road = el("ol", "title-road");
    road.setAttribute("aria-label", "Титулы от Героя до Новичка");
    const next = titles.find(t => t.threshold > greatness) || titles.at(-1);
    let focusRow;
    for (let i = titles.length - 1; i >= 0; i--) {
      const t = titles[i], earned = t.degree <= profile.honors.claimed;
      const row = el("li", "title-road-step"), rank = el("div", "title-road-rank");
      row.dataset.titleId = t.id; row.dataset.earned = String(earned);
      if (t.id === next?.id) { row.dataset.current = "true"; focusRow = row; }
      const previous = titles[i - 1]?.threshold || 0;
      const fraction = Math.max(0, Math.min(1, (greatness - previous) / Math.max(1, t.threshold - previous)));
      row.style.setProperty("--title-progress", (fraction * 100) + "%");
      rank.append(art(window.KillexProgressionArt.rank(t.id, 128), "title-road-medal", 104),
        el("strong", "title-road-threshold", number(t.threshold)),
        el("span", "title-road-rank-state", earned ? "Титул получен" : "До титула: " + number(Math.max(0, t.threshold - greatness))));
      const card = el("section", "title-road-card"), header = el("div", "title-road-card-head");
      const copy = el("div", "");
      copy.append(el("h3", "", t.name), el("p", "", t.chestName));
      const state = t.state === "opened" ? "Сундук открыт" : earned ? "Сундук доступен" : "Впереди";
      copy.append(el("span", "title-road-state", state));
      const chestArt = art(window.KillexProgressionArt.chest(t.id, 256), "title-road-chest", 160);
      chestArt.srcset = [128, 256, 512].map(size =>
        `${window.KillexArtRevision.url(window.KillexProgressionArt.chest(t.id, size))} ${size}w`).join(", ");
      chestArt.sizes = "(max-width: 650px) 128px, 160px";
      header.append(chestArt, copy);
      const rewards = el("div", "title-road-rewards");
      for (const [currency, label] of [["coins", "монет"], ["crystals", "кристаллов"], ["bucks", "эфира"]])
        rewards.append(prize(`assets/menu-icons/64/currency_${currency}.webp?art=20261123-interface-art`, number(t[currency]), label));
      const contents = el("div", "title-road-contents");
      contents.append(el("strong", "", "Бустеры: " + number(t.boosters)), el("p", "", t.contents));
      const appearance = el("div", "title-road-appearance");
      appearance.append(prize(window.KillexLeagueAppearance.source("title_" + t.id, "frame"), "Рамка «" + t.name + "»", "Навсегда"));
      for (const accessory of window.KillexAccessories.items.filter(a => a.titleDegree === t.degree))
        appearance.append(prize(accessory.icon, accessory.name, accessory.bonusLabel || accessory.description || "Навсегда", "title-road-accessory"));
      if (t.id === "boss") {
        appearance.append(prize(window.KillexLeagueAppearance.source("heroic", "lobby"), "Героическое оформление", "Тема интерфейса и фон лобби навсегда", "title-road-theme"));
        appearance.append(el("p", "", "Специальный подарок от игры"));
      }
      if (t.accountDays) for (const [kind, days] of Object.entries(t.accountDays))
        rewards.append(prize(`assets/accounts/${kind}.png?art=20261123-interface-art`, kind === "vip" ? "VIP" : "Premium", number(days) + " дн."));
      card.append(header, rewards, contents, appearance);
      if (earned && t.state !== "opened") {
        const chest = el("button", "sf-button sf-tertiary title-road-open", "К сундукам");
        chest.type = "button";
        chest.onclick = () => { dialog.close(); document.dispatchEvent(new CustomEvent("killex:open-chests")); };
        card.append(chest);
      }
      row.append(rank, card); road.append(row);
    }
    const scroller = el("div", "title-road-scroll");
    scroller.append(guide, road);
    dialog.replaceChildren(head, summary, scroller);
    const moveToProgress = (smooth = false) => {
      if (focusRow) scroller.scrollTo({
        top: scroller.scrollTop + focusRow.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12,
        behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant',
      });
    };
    current.onclick = () => moveToProgress(true);
    window.KillexWindows.open(dialog);
    moveToProgress();
  }
  window.KillexTitlesCatalog = { open };
})();

"use strict";
(() => {
  const arena = document.getElementById("arena"), top = arena.querySelector(".leaderboard");
  const mobile = matchMedia("(max-width: 760px), (pointer: coarse) and (max-width: 1180px)");
  const host = document.createElement("aside");
  host.id = "arenaObjectives";
  host.hidden = true;
  host.setAttribute("aria-label", "Текущие задания");
  arena.append(host);
  const nodes = ["Ежедневное задание", "Заказ события"].map((label, index) => {
    const card = document.createElement("section");
    card.className = "arena-objective";
    card.id = index ? "arenaEventObjective" : "arenaDailyObjective";
    card.hidden = true;
    const heading = document.createElement("div"), caption = document.createElement("span"),
      count = document.createElement("b"), text = document.createElement("div"),
      reward = document.createElement("img"), meter = document.createElement("div"), fill = document.createElement("i");
    heading.className = "arena-objective-heading";
    caption.textContent = label; heading.append(caption, count);
    text.className = "arena-objective-text";
    reward.className = "arena-objective-reward"; reward.alt = "";
    meter.className = "arena-objective-meter"; meter.append(fill);
    card.append(reward, heading, text, meter); host.append(card);
    return { card, caption, count, text, reward, fill, key: "", index };
  });
  // Each panel keeps its choice through profile updates and orientation changes.
  // Desktop always shows the full HUD; no saved profile or arena tick is involved.
  function collapsible(panel, label, controls) {
    let collapsed = true;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "arena-panel-toggle";
    toggle.setAttribute("aria-controls", controls);
    toggle.textContent = label;
    const refresh = () => {
      panel.dataset.mobilePanel = String(mobile.matches);
      panel.classList.toggle("arena-panel-collapsed", mobile.matches && collapsed);
      toggle.hidden = !mobile.matches;
      toggle.setAttribute("aria-expanded", String(!mobile.matches || !collapsed));
      toggle.setAttribute("aria-label", (collapsed ? "Развернуть: " : "Свернуть: ") + label);
    };
    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      refresh();
      position();
    });
    // Space operates the focused disclosure, not the arena split action.
    toggle.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "Enter") event.stopPropagation();
    });
    panel.prepend(toggle);
    mobile.addEventListener("change", () => { refresh(); position(); });
    refresh();
    return () => {
      collapsed = true;
      refresh();
    };
  }
  const closeRanking = collapsible(top, "Топ игроков и кланов", "leaderList arenaClanList");
  collapsible(host, "Задания и заказы", "arenaDailyObjective arenaEventObjective");
  let timer, offset = 0, model;
  function render() {
    clearTimeout(timer);
    let remaining = Infinity;
    for (const node of nodes) {
      const row = model?.[node.index ? "event" : "daily"], now = Date.now() + offset;
      node.card.hidden = !row || row.expiresAt <= now;
      if (node.card.hidden) continue;
      remaining = Math.min(remaining, row.expiresAt - now);
      const key = JSON.stringify(row);
      if (node.key === key) continue;
      node.key = key;
      const ready = row.progress >= row.target;
      node.card.dataset.ready = String(ready);
      node.caption.textContent = node.index ? `Заказ события +${row.reward}` : "Ежедневное задание";
      node.count.textContent = ready ? "Готово" : `${format(row.progress, row.metric)} / ${format(row.target, row.metric)}`;
      node.text.textContent = row.description;
      node.fill.style.width = Math.min(100, Math.max(0, row.progress / row.target * 100)) + "%";
      node.reward.src = node.index ? row.icon || "assets/events/black-friday/order-timer.webp?art=20261123-interface-art"
        : `assets/chests/prism-unified-v4/64/quest-${row.reward}.webp?art=20261123-interface-art`;
      node.reward.alt = node.index ? row.name : ({ large: "Большой сундук", medium: "Средний сундук", small: "Малый сундук" })[row.reward];
    }
    host.hidden = nodes.every((node) => node.card.hidden);
    // Only a boundary timer, no polling and no work in the rendering loop.
    if (Number.isFinite(remaining)) timer = setTimeout(render, Math.min(remaining + 50, 2147483647));
  }
  function format(n, metric) {
    if (["top1", "top10", "survival"].includes(metric))
      return Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
    return Math.floor(n).toLocaleString("ru-RU");
  }
  function update(event) {
    model = event.detail?.arenaObjectives;
    if (model?.serverTime) offset = model.serverTime - Date.now();
    render();
  }
  document.addEventListener("killex:profile", update);
  document.addEventListener("killex:arena-profile", update);
  // Position beside the ranking on wide screens; below it on narrow screens.
  // ResizeObserver runs only for geometry changes, never for arena movement.
  function position() {
    if (arena.hidden) return;
    const rect = top.getBoundingClientRect();
    if (mobile.matches) {
      const available = rect.left - 28;
      if (innerHeight <= 500 && available >= 180 && !top.classList.contains("arena-panel-collapsed")) {
        host.style.width = Math.min(260, available) + "px";
        host.style.right = innerWidth - rect.left + 10 + "px";
        host.style.top = Math.max(rect.top, document.getElementById("leaveButton").getBoundingClientRect().bottom + 8) + "px";
        return;
      }
      host.style.width = Math.min(260, innerWidth - 28) + "px";
      host.style.right = Math.max(0, innerWidth - rect.right) + "px";
      host.style.top = rect.bottom + 8 + "px";
      return;
    }
    const beside = rect.left - 145;
    host.style.width = Math.min(320, innerWidth - 24, beside >= 210 ? beside - 10 : innerWidth - 24) + "px";
    host.style.right = beside >= 210 ? (innerWidth - rect.left + 10) + "px" : "12px";
    host.style.top = (beside >= 210 ? rect.top : rect.bottom + 8) + "px";
  }
  new ResizeObserver(position).observe(top);
  window.addEventListener("resize", position);
  new MutationObserver(() => {
    closeRanking();
    position();
  }).observe(arena, { attributes: true, attributeFilter: ["hidden"] });
})();

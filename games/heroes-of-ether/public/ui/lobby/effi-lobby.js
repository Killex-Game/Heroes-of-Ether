/* Permanent lobby greeting preview. CSS animates the art; no frame loop or requests. */
(() => {
  "use strict";
  const header = document.querySelector("#lobby .lobby-header");
  if (!header) return;
  const greeting = "Добро пожаловать герой!";
  const root = document.createElement("aside");
  root.className = "effi-lobby";
  root.dataset.active = "false";
  root.setAttribute("aria-label", `Эффи: ${greeting}`);
  root.innerHTML = `
    <div class="effi-lobby-character" aria-hidden="true">
      <img src="assets/guide/effi-v1.webp" width="213" height="320" alt="" draggable="false">
      <svg class="effi-lobby-eyes" viewBox="0 0 213 320" aria-hidden="true">
        <defs><linearGradient id="effi-lobby-lid" x2="0" y2="1">
          <stop stop-color="#a7ddac"/><stop offset="1" stop-color="#9dd7b0"/>
        </linearGradient></defs>
        <g class="effi-lobby-blink">
          <ellipse cx="75" cy="119" rx="12.5" ry="16" fill="url(#effi-lobby-lid)"/>
          <ellipse cx="126" cy="120" rx="12.5" ry="16" fill="url(#effi-lobby-lid)"/>
          <path d="M67 119 Q75 125 83 119 M118 120 Q126 126 134 120" fill="none" stroke="#408e78" stroke-width="3" stroke-linecap="round"/>
        </g>
      </svg>
    </div>
    <div class="effi-lobby-bubble"><strong>Эффи</strong><p></p><button class="effi-lobby-dismiss" type="button">Выйти</button></div>`;
  const tools = document.querySelector(".lobby-generator-tools") || document.createElement("div");
  tools.className = "lobby-generator-tools";
  const reserved = document.createElement("div");
  reserved.className = "lobby-generator-reserved";
  reserved.setAttribute("aria-hidden", "true");
  tools.append(reserved, root);
  header.append(tools);
  const copy = root.querySelector("p"), words = greeting.split(" ");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let timer = null, position = 0, away = false, visible = false, dismissed = false;
  root.querySelector(".effi-lobby-dismiss").addEventListener("click", () => { dismissed = true; sync(); });
  function word() {
    timer = null;
    if (!visible) return;
    position = reduced.matches ? words.length : Math.min(words.length, position + 1);
    copy.textContent = words.slice(0, position).join(" ");
    if (position < words.length) timer = setTimeout(word, 170);
  }
  function sync() {
    visible = !dismissed && !away && !document.hidden && document.body.dataset.screen === "lobby" &&
      !window.KillexBoot?.active && !window.KillexMaintenance?.blocked && !document.querySelector("dialog[open]");
    root.dataset.active = String(visible);
    clearTimeout(timer); timer = null;
    if (visible && position < words.length) word();
  }
  // Only screen/dialog attributes are observed; typing and ordinary lobby updates do not trigger it.
  new MutationObserver(sync).observe(document.body, {
    subtree: true, attributes: true, attributeFilter: ["data-screen", "open"],
  });
  for (const event of ["visibilitychange", "killex:boot-ready", "killex:maintenance", "close"])
    document.addEventListener(event, sync, true);
  reduced.addEventListener("change", sync);
  addEventListener("pagehide", () => { away = true; sync(); });
  addEventListener("pageshow", () => { away = false; sync(); });
  sync();
})();

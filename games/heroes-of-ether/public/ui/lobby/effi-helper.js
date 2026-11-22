/* Effi's presentation layer. Appearance schedules are supplied by guide callers. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag); n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let root, bubble, copy, accessible, next, art, timer, current, index = 0, words, position = 0;
  const lobby = () => document.body.dataset.screen === "lobby" && !document.hidden;
  function clearTimer() { clearTimeout(timer); timer = undefined; }
  function hide(completed = false) {
    clearTimer();
    lifecycle.disconnect();
    const previous = current; current = null;
    root?.remove();
    if (completed) previous?.onComplete?.(previous.id);
  }
  function finishLine() {
    clearTimer(); copy.textContent = current.lines[index]; accessible.textContent = copy.textContent;
    root.classList.remove("effi-talking"); next.hidden = false;
    next.textContent = "Продолжить";
  }
  function typeWord() {
    clearTimer();
    if (!current || !lobby() || !root.isConnected) return;
    if (reduced.matches || position >= words.length) { finishLine(); return; }
    copy.textContent += words[position++];
    if (position === words.length) timer = setTimeout(finishLine, 180);
    else timer = setTimeout(typeWord, current.wordDelayMs);
  }
  function line() {
    clearTimer(); copy.textContent = ""; accessible.textContent = ""; next.hidden = true;
    root.classList.add("effi-talking");
    words = current.lines[index].match(/\S+\s*/gu) || []; position = 0;
    typeWord();
  }
  function show({ id, lines, container, onComplete, wordDelayMs = 110 } = {}) {
    if (!lobby() || window.KillexBoot?.active || window.KillexMaintenance?.blocked ||
        typeof id !== "string" || !id || !Array.isArray(lines) || !lines.length || lines.length > 20 ||
        lines.some(text => typeof text !== "string" || !text.trim() || text.length > 700)) return false;
    const parent = container || document.querySelector("dialog[open]") || document.body;
    if (!(parent instanceof HTMLElement) || !parent.isConnected) return false;
    hide();
    if (!root) {
      root = el("aside", "effi-helper"); root.setAttribute("aria-label", "Подсказка Эффи");
      art = el("img", "effi-character"); art.src = "assets/guide/effi-v1.webp?art=20261122b";
      art.width = 213; art.height = 320; art.alt = "Эффи"; art.draggable = false;
      bubble = el("div", "effi-bubble");
      const close = el("button", "effi-close", "×"); close.type = "button";
      close.setAttribute("aria-label", "Скрыть подсказку Эффи"); close.onclick = () => hide();
      copy = el("p", "effi-copy"); copy.setAttribute("aria-hidden", "true");
      accessible = el("p", "effi-accessible"); accessible.setAttribute("role", "status");
      next = el("button", "sf-button sf-primary", "Продолжить"); next.type = "button";
      next.onclick = () => { if (!current || next.hidden) return; if (++index < current.lines.length) line(); else hide(true); };
      bubble.append(el("strong", "effi-name", "Эффи"), close, copy, accessible, next); root.append(art, bubble);
    }
    current = { id, lines: lines.map(text => text.trim()), onComplete: typeof onComplete === "function" ? onComplete : null,
      wordDelayMs: Math.max(60, Math.min(300, Number(wordDelayMs) || 110)), parent };
    index = 0; parent.append(root);
    lifecycle.observe(document.body, { attributes: true, attributeFilter: ["data-screen"], childList: true, subtree: true });
    line(); return true;
  }
  document.addEventListener("visibilitychange", () => {
    if (!current) return;
    if (document.hidden) clearTimer();
    else if (lobby() && next.hidden) typeWord();
  });
  document.addEventListener("close", event => { if (current && event.target.contains?.(root)) hide(); }, true);
  document.addEventListener("killex:maintenance", () => hide());
  addEventListener("pagehide", () => hide());
  const lifecycle = new MutationObserver(() => { if (current && (!root.isConnected || document.body.dataset.screen !== "lobby")) hide(); });
  reduced.addEventListener("change", () => { if (current && reduced.matches) finishLine(); });
  window.KillexEffi = Object.freeze({ show, hide, get active() { return !!current; } });
})();

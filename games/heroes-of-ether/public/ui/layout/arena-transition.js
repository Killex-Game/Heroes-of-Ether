/* A light transition curtain, dismissed only after the destination is ready. */
(() => {
  "use strict";
  const root = document.createElement("dialog");
  root.className = "arena-transition";
  root.setAttribute("aria-label", "Переход между лобби и ареной");
  root.innerHTML = '<div class="arena-transition-content"><div class="arena-transition-orbit" aria-hidden="true"><span>✦</span></div><strong>Герои Эфира</strong><p role="status" aria-live="polite"></p><button type="button" hidden>Отмена</button></div>';
  document.body.append(root);
  const label = root.querySelector("p"), cancel = root.querySelector("button");
  let generation = 0, onCancel = null;
  root.addEventListener("cancel", event => {
    event.preventDefault();
    onCancel?.();
  });
  cancel.addEventListener("click", () => onCancel?.());
  window.KillexArenaTransition = {
    get active() { return root.open; },
    begin(destination, cancelAction) {
      generation++;
      onCancel = cancelAction || null;
      cancel.hidden = !onCancel;
      label.textContent = destination === "arena" ? "Входим на арену…" : "Возвращаемся в лобби…";
      if (!root.open) root.showModal();
      return generation;
    },
    finish(token = generation, afterPaint = false, focus) {
      const close = () => {
        if (token !== generation || !root.open) return;
        root.close();
        onCancel = null;
        focus?.();
      };
      if (!afterPaint) { close(); return; }
      // Two frames allow the newly revealed destination to paint underneath.
      // A hidden tab must not retain the curtain indefinitely when rAF sleeps.
      let first, second;
      const timer = setTimeout(() => { cancelAnimationFrame(first); cancelAnimationFrame(second); close(); }, 250);
      first = requestAnimationFrame(() => { second = requestAnimationFrame(() => { clearTimeout(timer); close(); }); });
    },
  };
})();

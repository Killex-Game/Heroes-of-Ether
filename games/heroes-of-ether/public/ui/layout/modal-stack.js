/* Порядок модальных окон, закрытие и восстановление фокуса. */
"use strict";
(() => {
  const stack = [],
    raised = new WeakMap();
  let rootOpener;
  const remove = (dialog) => {
    const index = stack.indexOf(dialog);
    if (index !== -1) stack.splice(index, 1);
  };
  // Native dialogs provide the top layer, inert background and Escape handling.
  // A native close/show pair can also raise an already open window. Suppress only
  // that queued close event so its forms, requests and child windows stay intact.
  document.addEventListener(
    "close",
    (event) => {
      const dialog = event.target,
        pending = raised.get(dialog) || 0;
      if (pending) {
        raised.set(dialog, pending - 1);
        event.stopImmediatePropagation();
      } else if (!dialog.open) {
        remove(dialog);
        queueMicrotask(() => {
          if (!stack.some((item) => item.open) && rootOpener?.isConnected)
            rootOpener.focus({ preventScroll: true });
        });
      }
    },
    true,
  );
  window.KillexWindows = Object.freeze({
    top() {
      return stack.findLast((dialog) => dialog.isConnected && dialog.open) || null;
    },
    open(dialog) {
      if(window.KillexMaintenance?.blocked)return false;
      if (window.KillexBoot?.active) {
        window.KillexBoot.defer(dialog, () => {
          if (dialog.isConnected) window.KillexWindows.open(dialog);
        });
        return false;
      }
      const required = document.querySelector('dialog[data-required="true"]');
      if (required && required !== dialog) {
        if (!required.open) window.KillexWindows.open(required);
        required.querySelector("input")?.focus({ preventScroll: true });
        return false;
      }
      for (const item of [...stack]) if (!item.isConnected || !item.open) remove(item);
      if (dialog.open && stack.at(-1) === dialog) return;
      if (!stack.length && !dialog.open) rootOpener = document.activeElement;
      const fresh = !dialog.open;
      if (fresh) dialog.dispatchEvent(new Event("killex:window-reset"));
      if (dialog.open) {
        raised.set(dialog, (raised.get(dialog) || 0) + 1);
        dialog.close(dialog.returnValue);
      }
      dialog.showModal();
      if (fresh) {
        for (const node of [dialog, ...dialog.querySelectorAll("*")]) {
          if (!node.scrollTop && !node.scrollLeft) continue;
          const behavior = node.style.scrollBehavior;
          node.style.scrollBehavior = "auto";
          node.scrollTop = node.scrollLeft = 0;
          node.style.scrollBehavior = behavior;
        }
      }
      remove(dialog);
      stack.push(dialog);
      // Earned achievements stay above ordinary lobby windows without closing
      // those windows or discarding their forms. Required onboarding wins above.
      const achievement = document.getElementById("achievementNotice");
      if (document.body.dataset.screen === "lobby" && achievement?.open && achievement !== dialog)
        window.KillexWindows.open(achievement);
    },
  });
})();

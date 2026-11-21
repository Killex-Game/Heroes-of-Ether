/* Сообщения об операциях показываются поверх интерфейса, не меняя его размеры. */
"use strict";
(() => {
  const selector = [
    ".booster-message",
    ".booster-arena-message",
    ".clan-status",
    ".clan-form-error",
    ".account-message",
    ".wardrobe-status",
    ".personal-status",
    ".mock-payment-status",
    ".donation-bonus-status",
    ".chest-modal-message",
    "#settingsFeedback",
    "#lifeResultStatus",
    "#leaveConfirmStatus",
  ].join(",");
  const toast = document.createElement("div"),
    pending = new WeakSet();
  toast.className = "system-message-toast";
  toast.setAttribute("popover", "manual");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("aria-atomic", "true");
  document.body.append(toast);
  let currentSource, timer;
  const hide = () => {
    clearTimeout(timer);
    if (toast.hidePopover && toast.matches(":popover-open")) toast.hidePopover();
    toast.classList.remove("is-visible");
    currentSource = null;
  };
  const prepare = (node) => {
    node.classList.add("system-message-source");
    const footer = node.closest(".interface-footer");
    if (footer && [...footer.children].every((child) => child.matches(selector)))
      footer.dataset.notificationsOnly = "true";
  };
  const isError = (node) => node.dataset.error === "true" || node.matches(".clan-form-error");
  const suppressed = (node) => document.body.dataset.screen === "arena" && !isError(node);
  const show = (node) => {
    prepare(node);
    const text = node.textContent.trim(),
      dialog = node.closest("dialog");
    // Purple operation notices are silent in the arena; error notices remain available.
    if (!text || suppressed(node)) {
      pending.delete(node);
      if (currentSource === node) hide();
      return;
    }
    if (dialog && !dialog.open) {
      pending.add(node);
      return;
    }
    pending.delete(node);
    const error = isError(node);
    clearTimeout(timer);
    currentSource = node;
    window.KillexUITheme.inherit(toast, node);
    toast.textContent = text;
    toast.dataset.error = String(error);
    toast.setAttribute("role", error ? "alert" : "status");
    toast.setAttribute("aria-live", error ? "assertive" : "polite");
    toast.classList.add("is-visible");
    if (toast.showPopover) {
      if (!toast.matches(":popover-open")) toast.showPopover();
    } else {
      // In browsers without Popover API, keep the fixed notice inside the top dialog.
      toast.removeAttribute("popover");
      const parent = window.KillexWindows?.top() || dialog || document.body;
      if (toast.parentNode !== parent) parent.append(toast);
    }
    timer = setTimeout(hide, error ? 8000 : 5000);
  };
  const scan = (root, changed) => {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches(selector)) {
      prepare(root);
      changed.add(root);
    }
    for (const node of root.querySelectorAll(selector)) {
      prepare(node);
      changed.add(node);
    }
  };
  const initial = new Set();
  scan(document.body, initial);
  initial.forEach(show);
  new MutationObserver((records) => {
    const changed = new Set();
    for (const record of records) {
      const element =
        record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      if (record.type === "attributes" && record.attributeName === "data-screen") {
        if (currentSource && suppressed(currentSource)) hide();
        continue;
      }
      if (record.type === "attributes" && record.attributeName === "open") {
        if (!element.open && currentSource?.closest("dialog") === element) hide();
        if (element.open)
          element.querySelectorAll(selector).forEach((node) => {
            if (pending.has(node)) changed.add(node);
          });
        continue;
      }
      const source = element?.closest(selector);
      if (source) changed.add(source);
      if (record.type === "childList") record.addedNodes.forEach((node) => scan(node, changed));
    }
    changed.forEach((node) => {
      if (node.isConnected) show(node);
    });
    if (currentSource && !currentSource.isConnected) hide();
  }).observe(document.body, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-error", "data-screen", "open"],
  });
})();

/* Подсказка с описанием бустера при наведении и фокусе. */
"use strict";
(() => {
  // One shared tooltip, including cards rebuilt after a purchase or a tab change.
  const tip = document.createElement("aside");
  tip.id = "boosterTooltip";
  tip.className = "booster-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  document.body.append(tip);
  let anchor = null;
  let nativeTitle = null;
  let hideTimer;
  const onArena = () => document.body.dataset.screen === "arena";
  const observer = new MutationObserver(() => {
    if (anchor && !anchor.isConnected) hide();
  });
  function hide() {
    clearTimeout(hideTimer);
    observer.disconnect();
    if (anchor) {
      anchor.removeAttribute("aria-describedby");
      if (nativeTitle !== null && !anchor.hasAttribute("title"))
        anchor.setAttribute("title", nativeTitle);
    }
    nativeTitle = null;
    anchor = null;
    if (tip.matches(":popover-open")) tip.hidePopover();
  }
  function show(node) {
    clearTimeout(hideTimer);
    if (node === anchor) return;
    hide();
    if (onArena()) {
      // Do not leave a second, native browser tooltip after suppressing ours.
      if (node?.hasAttribute("title")) {
        node.setAttribute("aria-label", node.getAttribute("title"));
        node.removeAttribute("title");
      }
      return;
    }
    if (!node || (!node.dataset.boosterHint && !node.getAttribute("title"))) return;
    anchor = node;
    tip.classList.toggle("scrollable-history", node.dataset.tooltipScrollable === "true");
    // A scrollable history must belong to the modal's non-inert subtree.
    const host =
      node.dataset.tooltipScrollable === "true"
        ? node.closest("dialog[open]") || document.body
        : document.body;
    if (tip.parentElement !== host) host.append(tip);
    const name = document.createElement("strong"),
      text = document.createElement("p");
    if (node.dataset.boosterHint) {
      name.textContent = node.dataset.boosterHintName;
      text.textContent = node.dataset.boosterHint;
      tip.replaceChildren(name, text);
      if (node.dataset.tooltipRecipe) {
        try {
          const recipe = JSON.parse(node.dataset.tooltipRecipe),
            row = document.createElement("p");
          row.className = "tooltip-item-recipe";
          for (const item of recipe) {
            const group = document.createElement("span"),
              icon = document.createElement("img");
            icon.src = window.KillexArtRevision.url(item.image);
            icon.alt = item.name;
            icon.width = 24;
            icon.height = 28;
            group.append(document.createTextNode(String(item.count) + " "), icon);
            row.append(group);
          }
          const result = document.createElement("span");
          result.className = "tooltip-recipe-result";
          result.textContent = "= 1 сундук";
          row.append(result);
          tip.append(row);
        } catch (_) {}
      }
    } else {
      text.textContent = node.getAttribute("title");
      tip.replaceChildren(text);
    }
    nativeTitle = node.getAttribute("title");
    node.removeAttribute("title");
    window.KillexUITheme.inherit(tip, node);
    node.setAttribute("aria-describedby", tip.id);
    tip.showPopover();
    const box = node.getBoundingClientRect(),
      w = tip.offsetWidth,
      h = tip.offsetHeight;
    tip.style.left =
      Math.max(10, Math.min(innerWidth - w - 10, box.x + (box.width - w) / 2)) + "px";
    const below = box.bottom + 8;
    tip.style.top =
      Math.max(
        10,
        Math.min(innerHeight - h - 10, below + h <= innerHeight - 10 ? below : box.top - h - 8),
      ) + "px";
    observer.observe(document.body, { childList: true, subtree: true });
  }
  const find = (node) =>
    node instanceof Element
      ? anchor?.contains(node)
        ? anchor
        : node.closest("[data-booster-hint],[title]")
      : null;
  document.addEventListener("pointerover", (e) => {
    if (tip.classList.contains("scrollable-history")) {
      if (tip.contains(e.target)) {
        clearTimeout(hideTimer);
        return;
      }
      if (anchor && !find(e.target)) return;
    }
    if (e.pointerType !== "touch") {
      const node = find(e.target);
      if (!node && anchor?.contains(document.activeElement)) return;
      show(node);
    }
  });
  document.addEventListener("pointerout", (e) => {
    if (tip.classList.contains("scrollable-history") && tip.contains(e.relatedTarget)) return;
    // Keyboard focus owns the tooltip even if scrolling moves the pointer away.
    // focusout still closes it when the player moves to another control.
    if (anchor?.contains(document.activeElement)) return;
    if (anchor && !anchor.contains(e.relatedTarget)) {
      if (tip.classList.contains("scrollable-history")) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hide, 200);
      } else hide();
    }
  });
  document.addEventListener("focusin", (e) => show(find(e.target)));
  document.addEventListener("focusout", (e) => {
    if (anchor && !anchor.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && anchor) {
      hide();
      e.preventDefault();
    }
  });
  for (const event of ["dragstart", "close"]) document.addEventListener(event, hide, true);
  document.addEventListener(
    "scroll",
    (event) => {
      if (!tip.contains(event.target)) hide();
    },
    true,
  );
  window.addEventListener("resize", hide);
  new MutationObserver(() => {
    if (!onArena()) return;
    hide();
    for (const node of document.querySelectorAll("#arena [title]")) {
      node.setAttribute("aria-label", node.getAttribute("title"));
      node.removeAttribute("title");
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  window.KillexBoosterTooltip = {
    attach(node, item) {
      if (item.recipe) node.dataset.tooltipRecipe = JSON.stringify(item.recipe);
      node.dataset.boosterHintName = item.name;
      node.dataset.boosterHint = item.usage || item.effect || "";
      if (item.scrollable) node.dataset.tooltipScrollable = "true";
      if (!node.matches("button,a,input")) node.tabIndex = 0;
    },
  };
})();

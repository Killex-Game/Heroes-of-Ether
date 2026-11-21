/* Native page dragging is separate from the intentional inventory drag-and-drop. */
"use strict";
(() => {
  const editable = (target) =>
    target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]');
  const selectable = target => {
    const element = target instanceof Element ? target : target?.parentElement;
    return editable(element) || !!element?.closest('.player-chat, #publicPlayerTitle, .public-player-name');
  };
  document.addEventListener(
    "dragstart",
    (event) => {
      const target = event.target;
      if (editable(target)) return;
      if (
        target instanceof Element &&
        target.closest('[draggable="true"][data-loadout-slot], .booster-card[draggable="true"]')
      )
        return;
      event.preventDefault();
    },
    true,
  );
  document.addEventListener("selectstart", (event) => {
    if (!selectable(event.target)) event.preventDefault();
  });
  // Copy stays native. A line selection can end on its parent element, so
  // filtering range endpoints would incorrectly block a selected nickname.
  document.addEventListener("contextmenu", (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest("img, canvas") &&
      !editable(event.target)
    )
      event.preventDefault();
  });
})();

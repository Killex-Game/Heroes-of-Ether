/* A pending request blocks duplicate actions without looking like a game-rule lock. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexControls = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  function state(control, disabled, unavailable = disabled) {
    const blocked = !!disabled;
    const pending = blocked && !unavailable;
    if (control.disabled !== blocked) control.disabled = blocked;
    if (control.hasAttribute("data-pending") !== pending)
      control.toggleAttribute("data-pending", pending);
    if (pending) {
      if (control.getAttribute("aria-busy") !== "true") control.setAttribute("aria-busy", "true");
    } else if (control.hasAttribute("aria-busy")) control.removeAttribute("aria-busy");
    return blocked;
  }
  return { state };
});

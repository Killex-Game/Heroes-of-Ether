const test = require("node:test");
const assert = require("node:assert/strict");
const { state } = require("../../public/shared/control-state");
function control() {
  const attrs = new Map();
  return {
    disabled: false,
    hasAttribute: (key) => attrs.has(key),
    getAttribute: (key) => attrs.get(key) ?? null,
    setAttribute: (key, value) => attrs.set(key, value),
    removeAttribute: (key) => attrs.delete(key),
    toggleAttribute: (key, present) => present ? attrs.set(key, "") : attrs.delete(key),
  };
}
test("waiting blocks duplicate activation without marking the action unavailable", () => {
  const button = control();
  state(button, true, false);
  assert.equal(button.disabled, true);
  assert.equal(button.hasAttribute("data-pending"), true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  state(button, false, false);
  assert.equal(button.disabled, false);
  assert.equal(button.hasAttribute("data-pending"), false);
  assert.equal(button.hasAttribute("aria-busy"), false);
});
test("a game-rule restriction remains unavailable even while another request is pending", () => {
  const button = control();
  state(button, true, false);
  state(button, true, true);
  assert.equal(button.disabled, true);
  assert.equal(button.hasAttribute("data-pending"), false);
  assert.equal(button.hasAttribute("aria-busy"), false);
});
test("repeated frame updates do not rewrite unchanged pending attributes", () => {
  const button = control();
  state(button, true, false);
  button.toggleAttribute = button.setAttribute = () => assert.fail("unnecessary DOM write");
  state(button, true, false);
});

test("recovering a roulette request stays pending even after the last ticket or event expires", () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const element = () => Object.assign(control(), {
    dataset: {}, parentElement: {}, classList: { toggle() {} },
    replaceChildren() {}, querySelector() { return element(); },
  });
  const pageControls = new Map();
  const context = { window: { KillexControls: { state } },
    document: {
      createElement: element,
      getElementById(id) {
        if (!pageControls.has(id)) pageControls.set(id, element());
        return pageControls.get(id);
      },
    },
    clearTimeout() {},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,
    "../../public/ui/roulette/roulette-dialog.js"), "utf8"), context);
  const ui = Object.create(context.window.KillexRouletteUI.prototype);
  Object.assign(ui, {
    profile: { roulette: { available: false, tickets: 0 } },
    busy: true, owner: { inArena: () => false }, renderOdds() {},
    pending: () => ({ requestId: "same-durable-request" }), ticketControls: new Map(),
  });
  for (const key of ["ticketCount", "mobileTickets", "eventLabel", "liteButton",
    "liteButtonCopy", "fiveButton", "fastSpin", "ticketShop", "dialog", "viewTabs",
    "spinButton", "status"]) ui[key] = element();
  ui.update();
  assert.equal(ui.spinButton.disabled, true);
  assert.equal(ui.spinButton.hasAttribute("data-pending"), true);
  ui.busy = false;
  ui.update();
  assert.equal(ui.spinButton.disabled, false);
  assert.equal(ui.spinButton.textContent, "Восстановить результат");
  ui.pending = () => null;
  ui.busy = true;
  ui.profile.roulette.available = true;
  ui.update();
  assert.equal(ui.spinButton.disabled, true);
  assert.equal(ui.spinButton.hasAttribute("data-pending"), false, "no ticket for a new spin");
  ui.profile.roulette.tickets = 1;
  ui.update();
  assert.equal(ui.spinButton.hasAttribute("data-pending"), true, "ordinary network wait");
});

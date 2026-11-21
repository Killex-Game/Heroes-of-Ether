"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
function fixture() {
  const callbacks = new Map(), window = { KillexAlchemyRules: {} }, document = { hidden: false }; let serial = 0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../../public/ui/progression/ether-alchemy.js"), "utf8"), {
    window, document, requestAnimationFrame(fn) { callbacks.set(++serial, fn); return serial; }, cancelAnimationFrame(id) { callbacks.delete(id); },
  });
  const ui = Object.create(window.KillexAlchemyUI.prototype);
  Object.assign(ui, { dialog: { open: true, dataset: {} }, recipePanel: { hidden: true }, result: { hidden: true }, owner: { isLobby: () => true }, reducedMotion: { matches: false }, motionFrame: 0, motionChecked: false, motionLimited: false, animations: new Set(), flights: new Set(), animationRevision: 0 });
  const step = at => { const pending = [...callbacks]; callbacks.clear(); for (const [, fn] of pending) fn(at); };
  return { ui, callbacks, document, step };
}
test("laboratory decoration samples once, preserves normal motion and stops its frame callback", () => {
  const { ui, callbacks, step } = fixture(); ui.motion();
  for (let at = 0; at <= 2600; at += 16) step(at);
  assert.equal(callbacks.size, 0); assert.equal(ui.motionLimited, false); assert.equal(ui.dialog.dataset.animate, "true");
  ui.motion(); assert.equal(callbacks.size, 0);
});
test("sustained slow drawing disables decoration, not laboratory actions", () => {
  const { ui, callbacks, step } = fixture(); ui.motion();
  for (let at = 0; at <= 3000; at += 150) step(at);
  assert.equal(callbacks.size, 0); assert.equal(ui.motionLimited, true); assert.equal(ui.dialog.dataset.animate, "false"); assert.equal(ui.dialog.open, true);
  ui.motion(); assert.equal(callbacks.size, 0);
});
test("hidden, closed, reduced-motion and recipe states cancel an unfinished sample", () => {
  for (const change of [f => { f.document.hidden = true; }, f => { f.ui.dialog.open = false; }, f => { f.ui.reducedMotion.matches = true; }, f => { f.ui.recipePanel.hidden = false; }]) {
    const f = fixture(); f.ui.motion(); f.step(0); change(f); f.ui.motion();
    assert.equal(f.callbacks.size, 0); assert.equal(f.ui.motionFrame, 0); assert.equal(f.ui.dialog.dataset.animate, "false");
  }
});

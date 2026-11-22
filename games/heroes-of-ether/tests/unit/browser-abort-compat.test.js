"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../public/shared/browser-abort-compat.js"), "utf8");
function fallback() {
  function Signal() {}
  Signal.prototype = AbortSignal.prototype;
  const timers = [];
  vm.runInNewContext(source, {
    AbortSignal: Signal, AbortController, DOMException,
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
  });
  return { Signal, timers };
}
test("native implementations are retained", () => {
  const any = AbortSignal.any, timeout = AbortSignal.timeout;
  vm.runInNewContext(source, { AbortSignal, AbortController });
  assert.equal(AbortSignal.any, any); assert.equal(AbortSignal.timeout, timeout);
});
test("caller cancellation wins and removes all listeners", () => {
  const { Signal } = fallback(), a = new AbortController(), b = new AbortController();
  let adds = 0, removes = 0;
  for (const s of [a.signal, b.signal]) {
    const add = s.addEventListener.bind(s), remove = s.removeEventListener.bind(s);
    s.addEventListener = (...args) => { adds++; add(...args); };
    s.removeEventListener = (...args) => { removes++; remove(...args); };
  }
  const combined = Signal.any([a.signal, b.signal, a.signal]);
  const reason = new DOMException("Closed", "AbortError");
  a.abort(reason); assert(combined.aborted); assert.equal(combined.reason, reason);
  assert.equal(adds, 2); assert.equal(removes, 2);
  b.abort("Later"); assert.equal(combined.reason, reason); assert.equal(removes, 2);
});
test("already aborted inputs preserve the first reason", () => {
  const { Signal } = fallback(), a = new AbortController(), b = new AbortController();
  a.abort("first"); b.abort("second");
  assert.equal(Signal.any([a.signal, b.signal]).reason, "first");
  assert.equal(Signal.any([]).aborted, false);
  assert.throws(() => Signal.any([a.signal, {}]), { name: "TypeError" });
});
test("timeout cancels a composed request with TimeoutError", () => {
  const { Signal, timers } = fallback(), owner = new AbortController();
  const result = Signal.any([owner.signal, Signal.timeout(8000)]);
  assert(!result.aborted); assert.equal(timers[0].delay, 8000);
  timers[0].fn(); assert(result.aborted); assert.equal(result.reason.name, "TimeoutError");
  owner.abort(); assert.equal(result.reason.name, "TimeoutError");
});
test("zero timeout is asynchronous and long delays do not overflow", () => {
  const { Signal, timers } = fallback(), zero = Signal.timeout(0);
  assert(!zero.aborted); timers.shift().fn(); assert(zero.aborted);
  const long = Signal.timeout(2147483648), first = timers.shift();
  assert.equal(first.delay, 2147483647); first.fn(); assert(!long.aborted);
  assert.equal(timers[0].delay, 1); timers.shift().fn(); assert(long.aborted);
  for (const delay of [-1, Infinity, 1.5, NaN])
    assert.throws(() => Signal.timeout(delay), { name: "RangeError" });
});
test("every player entry point loads compatibility before request code", () => {
  for (const name of ["index.html", "blocked.html", "maintenance.html"]) {
    const html = fs.readFileSync(path.join(__dirname, "../../public", name), "utf8");
    assert.match(html.match(/<script[^>]+src="([^"]+)"/)[1], /browser-abort-compat/);
  }
});

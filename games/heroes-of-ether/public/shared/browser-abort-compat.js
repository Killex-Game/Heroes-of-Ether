/* Older supported browsers have AbortController but lack these static helpers. */
"use strict";
(() => {
  if (typeof AbortSignal === "undefined" || typeof AbortController === "undefined") return;

  if (typeof AbortSignal.timeout !== "function") {
    Object.defineProperty(AbortSignal, "timeout", {
      configurable: true, writable: true,
      value(milliseconds) {
        if (!Number.isSafeInteger(milliseconds) || milliseconds < 0)
          throw new RangeError("Invalid timeout");
        const controller = new AbortController();
        // Browsers clamp larger setTimeout values to a signed 32-bit integer.
        const wait = remaining => setTimeout(() => {
          if (remaining > 2147483647) wait(remaining - 2147483647);
          else controller.abort(new DOMException("Request timed out", "TimeoutError"));
        }, Math.min(remaining, 2147483647));
        wait(milliseconds);
        return controller.signal;
      },
    });
  }

  if (typeof AbortSignal.any !== "function") {
    Object.defineProperty(AbortSignal, "any", {
      configurable: true, writable: true,
      value(signals) {
        const inputs = Array.from(signals);
        for (const signal of inputs)
          if (!(signal instanceof AbortSignal)) throw new TypeError("Expected AbortSignal");
        const controller = new AbortController(), subscribed = new Set();
        const abort = signal => {
          for (const input of subscribed) input.removeEventListener("abort", listener);
          subscribed.clear();
          controller.abort(signal.reason);
        };
        const listener = event => abort(event.target);
        for (const signal of inputs) {
          if (signal.aborted) {
            abort(signal);
            return controller.signal;
          }
        }
        for (const signal of inputs) {
          if (subscribed.has(signal)) continue;
          signal.addEventListener("abort", listener, { once: true });
          subscribed.add(signal);
        }
        return controller.signal;
      },
    });
  }
})();

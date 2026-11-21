"use strict";
(() => {
  // Pointer capture supports a second finger while the first steers the joystick.
  class TouchControls {
    constructor({ root, split, feed, setFeeding }) {
      this.root = root;
      this.split = document.getElementById("arenaSplitButton");
      this.feed = document.getElementById("arenaFeedButton");
      this.pointer = null;
      this.setFeeding = setFeeding;
      const mobile = matchMedia("(max-width: 760px), (pointer: coarse) and (max-width: 1180px)");
      const refresh = () => {
        root.hidden = !mobile.matches;
        if (root.hidden) this.reset();
      };
      mobile.addEventListener("change", refresh);
      refresh();
      this.split.addEventListener("pointerdown", event => {
        if (event.button !== 0 || this.split.disabled) return;
        event.preventDefault();
        split();
      });
      this.feed.addEventListener("pointerdown", event => {
        if (event.button !== 0 || this.pointer !== null || this.feed.disabled) return;
        event.preventDefault();
        this.pointer = event.pointerId;
        this.feed.dataset.held = "true";
        this.setFeeding(true);
        try { this.feed.setPointerCapture(event.pointerId); } catch (_) { /* pointercancel still stops feeding. */ }
        feed();
      });
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
        this.feed.addEventListener(type, event => {
          if (event.pointerId === this.pointer) this.reset();
        });
      }
      // Native keyboard/assistive clicks have no pointerdown. Pointer clicks were handled above.
      this.split.addEventListener("click", event => { if (event.detail === 0) split(); });
      this.feed.addEventListener("click", event => { if (event.detail === 0) feed(); });
      root.addEventListener("keydown", event => {
        if (event.code === "Space" || event.code === "Enter") event.stopPropagation();
      });
    }
    reset() {
      const pointer = this.pointer;
      this.pointer = null;
      this.setFeeding(false);
      if (pointer === null) return;
      delete this.feed.dataset.held;
      if (this.feed.hasPointerCapture(pointer)) this.feed.releasePointerCapture(pointer);
    }
    update(canSplit, canFeed) {
      if (this.split.disabled === !!canSplit) this.split.disabled = !canSplit;
      if (this.feed.disabled === !!canFeed) this.feed.disabled = !canFeed;
      if (!canFeed && this.pointer !== null) this.reset();
    }
  }
  window.KillexTouchControls = TouchControls;
})();

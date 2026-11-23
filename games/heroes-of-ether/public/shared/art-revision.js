/* Asset URL revision for server-provided art; no timers or eager image loads. */
"use strict";
window.KillexArtRevision = Object.freeze({
  url(value) {
    if (typeof value !== "string" || !/^\/?assets\//.test(value)) return value;
    const parts = value.split("#"), base = parts[0]
      .replace(/([?&])art=[^&]*(&?)/g, (_, a, b) => b ? a : "").replace(/[?&]$/, "");
    const selectedPortrait = /assets\/skins\/(?:premium-v2\/\d+\/premium-2|collections-v1\/\d+\/(?:desert-cat|grove-faun))\.webp/.test(base);
    const revised = /assets\/achievements\/illustrated-v2\/(?!easter_)/.test(base)
      || /assets\/skins\/(?:transparent-v2\/\d+\/vip-[13]|premium-v2\/\d+\/premium-2)\.webp/.test(base);
    return base + (base.includes("?") ? "&" : "?") + "art=" + (selectedPortrait ? "20261123-selected-portraits" : revised ? "20261122c" : "20261122b")
      + (parts.length > 1 ? "#" + parts.slice(1).join("#") : "");
  },
});

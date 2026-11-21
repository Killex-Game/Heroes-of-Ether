/* Stable identifiers retained for existing sessions, preferences and network clients. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexPlatform = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const legacy = "sferorumiya";
  return Object.freeze({
    project: "Killex",
    game: "Герои Эфира",
    sessionCookie: legacy + "_session",
    ownerCookie: legacy + "_owner",
    storageKey: (suffix) => legacy + suffix,
    stateProtocol: (version) => legacy + "-state-v" + version,
  });
});

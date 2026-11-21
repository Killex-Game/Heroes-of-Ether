/* Идентификаторы операций: работают и на localhost/HTTPS, и по HTTP в локальной сети. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KillexRequestIds = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  function create(cryptoApi = globalThis.crypto) {
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    // randomUUID требует secure context; getRandomValues доступен и на обычном LAN HTTP.
    if (typeof cryptoApi?.getRandomValues !== "function")
      throw Error("Браузер не поддерживает создание запроса. Обнови браузер и повтори.");
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return Object.freeze({ create });
});

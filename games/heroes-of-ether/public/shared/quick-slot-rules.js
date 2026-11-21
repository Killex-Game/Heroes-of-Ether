/* Клавиши слотов, их количество и перестановка предметов. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KillexLoadout = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const keys = Object.freeze(["A", "S", "D", "F", "G", "H"]);
  const count = (account) => (account?.premium ? 6 : account?.vip ? 5 : 4);
  const unlocked = (index, account, level = 1) =>
    index >= 0 && index < count(account) && (index !== 3 || level >= 12);
  const itemAllowed = (item, level = 1) => !!item?.ready && item.tier !== "potion" && level >= (item.useLevel || 1);
  const unlockLabel = (index) =>
    index === 3 ? "12 уровня" : index === 4 ? "VIP или Premium" : "Premium";
  const keyIndex = (code) => keys.findIndex((key) => code === "Key" + key);
  function emptyIndex(slots, capacity, allowed = () => true) {
    for (let i = 0; i < Math.min(capacity, keys.length); i++) if (allowed(i) && !slots[i]) return i;
    return -1;
  }
  function move(slots, from, to, capacity) {
    if (
      ![from, to].every(
        (i) => Number.isInteger(i) && i >= 0 && i < Math.min(capacity, keys.length),
      ) ||
      from === to ||
      !slots[from]
    )
      return null;
    const next = [...slots];
    while (next.length <= Math.max(from, to)) next.push(null);
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  }
  return Object.freeze({ keys, count, unlocked, itemAllowed, unlockLabel, keyIndex, emptyIndex, move });
});

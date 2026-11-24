(function () {
  "use strict";
  const root = document.getElementById("arenaEmoteHotkeys");
  const names = ["Злость", "Дурачество", "Смех", "Плач", "Любовь", "Крутость", "Голод", "Мир", "Извинение"];
  let activate = () => {};
  const icons = window.KillexEmotes.items.map((item, index) => {
    const cell = document.createElement("button"), image = document.createElement("img"), key = document.createElement("kbd");
    cell.type = "button";
    cell.className = "arena-emote-key";
    cell.setAttribute("aria-label", names[index] + ", клавиша " + item.id);
    cell.addEventListener("pointerdown", event => event.stopPropagation());
    cell.addEventListener("touchstart", event => event.stopPropagation(), { passive: true });
    cell.addEventListener("click", event => {
      event.preventDefault(); event.stopPropagation(); activate(item.id); cell.blur();
    });
    image.alt = ""; image.draggable = false; image.decoding = "async";
    key.textContent = item.id;
    cell.append(image, key); root.append(cell);
    return image;
  });
  let variant;
  function update(account) {
    const next = account?.premium === true ? "pets" : "basic";
    if (next === variant) return;
    variant = next; root.dataset.variant = next;
    icons.forEach((image, index) => { const item = window.KillexEmotes.items[index]; image.src = next === "pets" ? item.premiumImage : item.image; });
  }
  update(null);
  window.KillexEmoteHotkeys = { update, setActivate(handler) { activate = handler; } };
})();

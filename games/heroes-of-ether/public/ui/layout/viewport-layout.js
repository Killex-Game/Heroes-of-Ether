/* Подстройка лобби и окон под размеры экрана. */
"use strict";
(() => {
  const make = (cls) => {
    const node = document.createElement("div");
    node.className = cls;
    return node;
  };
  // Один каркас для разделов: заголовок, неподвижные вкладки, область содержимого,
  // нижние действия/статус. Существующие узлы и обработчики сохраняются.
  const windows = [
    "boosterDialog",
    "clanDialog",
    "topsDialog",
    "skinsDialog",
    "wardrobeDialog",
    "questsDialog",
    "donationDialog",
    "achievementsDialog",
    "accountDialog",
  ];
  for (const id of windows) {
    const dialog = document.getElementById(id);
    if (!dialog) continue;
    const header = make("interface-header"),
      toolbar = make("interface-toolbar");
    const content = make("interface-content"),
      footer = make("interface-footer");
    for (const node of [...dialog.children]) {
      if (node.matches(".booster-heading,.clan-heading")) header.append(node);
      else if (
        node.matches(
          ".booster-tabs,.booster-wallet,.booster-toolbar,.clan-nav,.donation-tabs,.inventory-loadout,.cosmetics-tabs,.cosmetics-season-discount",
        )
      )
        toolbar.append(node);
      else if (node.matches(".booster-message,.clan-status,.cosmetics-actions,.account-message"))
        footer.append(node);
      else content.append(node);
    }
    dialog.classList.add("interface-window");
    dialog.append(header, toolbar, content, footer);
    if (!toolbar.childElementCount) toolbar.hidden = true;
    if (!footer.childElementCount) footer.hidden = true;
    dialog.addEventListener("close", () => {
      content.scrollTop = 0;
    });
    // Переключение раздела начинает его с верхней границы, а не с прокрутки предыдущего.
    toolbar.addEventListener("click", (e) => {
      if (e.target.closest("button")) content.scrollTop = 0;
    });
    content.addEventListener("click", (e) => {
      if (e.target.closest(".shop-categories button,.booster-filters button"))
        content.scrollTop = 0;
    });
  }

  // Размеры и перенос задаёт CSS. Масштабирование всей сцены делало кнопки
  // мелкими, а zoom по-разному взаимодействовал с сетками Firefox и WebKit.
  document.getElementById("landscapeHint").hidden = true;
})();

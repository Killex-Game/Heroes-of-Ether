/* Пагинация коллекций и подгонка содержимого окон по высоте. */
"use strict";
(() => {
  // Showcases scroll inside the window; headers and loadout controls stay fixed.
  const collections = [
    ["#skinList", 4],
    [".chest-reward-grid", chestRewardPageSize],
    [".chest-items", 5],
    [".clan-applications-list", 6],
    [".donation-grid", donationPageSize],
  ];
  function chestRewardPageSize(root) {
    const style = getComputedStyle(root),
      gap = parseFloat(style.columnGap) || 0,
      width = root.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      capacity = Math.max(1, Math.floor((width + gap) / (96 + gap))),
      count = [...root.children].filter((item) => !item.hidden).length,
      compact = count > 0 && count <= capacity;
    // Use the complete reward, not the current page: a short last page stays tall.
    root.closest("dialog").dataset.rewardLayout = compact ? "single-row" : "two-rows";
    root.style.setProperty("--chest-reward-columns", compact ? count : 4);
    return compact ? count : 8;
  }
  function donationPageSize(root) {
    const dialog = root.closest("dialog"),
      style = getComputedStyle(dialog),
      columns = Number(style.getPropertyValue("--donation-columns")) || 1,
      card = root.querySelector(".donation-card"),
      cardHeight = parseFloat(getComputedStyle(card).height),
      gap = parseFloat(getComputedStyle(root).rowGap) || 0,
      header = dialog.querySelector(".interface-header").getBoundingClientRect().height,
      toolbar = dialog.querySelector(".interface-toolbar").getBoundingClientRect().height,
      status = dialog.querySelector(".donation-bonus-status").getBoundingClientRect().height,
      padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 2,
      available = innerHeight - 24 - header - toolbar - padding - 20 - status;
    const total = root.children.length;
    const fullRows = Math.ceil(total / columns);
    if (fullRows * (cardHeight + gap) - gap <= available) return total;
    // Кнопки страниц и их отступ оставляем внутри окна.
    return columns * Math.max(1, Math.floor((available - 48 + gap) / (cardHeight + gap)));
  }
  const pages = new WeakMap();
  document.addEventListener("killex:window-reset", event => {
    for (const [selector] of collections) {
      for (const root of event.target.querySelectorAll(selector)) {
        const state = pages.get(root);
        if (state) { state.page = 0; state.signature = ""; }
      }
    }
    schedule();
  }, true);
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  }
  function paginate(root, size) {
    if (typeof size === "function") size = size(root);
    let state = pages.get(root);
    if (!state) {
      const nav = document.createElement("nav");
      nav.className = "collection-pages";
      nav.setAttribute("aria-label", "Страницы коллекции");
      const previous = document.createElement("button"),
        next = document.createElement("button"),
        label = document.createElement("span");
      previous.type = next.type = "button";
      previous.textContent = "‹";
      next.textContent = "›";
      previous.setAttribute("aria-label", "Предыдущая страница");
      next.setAttribute("aria-label", "Следующая страница");
      label.setAttribute("aria-live", "polite");
      nav.append(previous, label, next);
      state = { nav, previous, next, label, page: 0, signature: "" };
      pages.set(root, state);
      previous.onclick = () => {
        state.page--;
        state.signature = "";
        schedule();
      };
      next.onclick = () => {
        state.page++;
        state.signature = "";
        schedule();
      };
    }
    if (state.nav.previousElementSibling !== root) root.after(state.nav);
    const items = [...root.children].filter((item) => !item.hidden);
    const count = Math.ceil(items.length / size);
    if (state.key !== root.dataset.collectionKey) {
      state.key = root.dataset.collectionKey;
      state.page = 0;
    }
    state.page = Math.max(0, Math.min(state.page, count - 1));
    // Recreated cards must receive their page visibility after profile refreshes.
    const signature =
      items
        .map(
          (item, i) =>
            item.dataset.boosterId ||
            item.dataset.chestId ||
            item.dataset.titleId ||
            item.textContent,
        )
        .join("|") +
      ":" +
      state.page +
      ":" +
      size +
      ":" +
      root.hidden;
    if (signature === state.signature && items.every((item) => item.dataset.pageReady)) return;
    state.signature = signature;
    items.forEach((item, i) => {
      item.classList.toggle("collection-page-hidden", Math.floor(i / size) !== state.page);
      item.dataset.pageReady = "true";
    });
    state.nav.hidden = root.hidden || count <= 1;
    window.KillexControls.state(state.previous, state.page === 0);
    window.KillexControls.state(state.next, state.page >= count - 1);
    state.label.textContent = `${state.page + 1} / ${Math.max(1, count)}`;
  }
  function fitContent(dialog) {
    const content = dialog.querySelector(":scope > .interface-content");
    if (!content) return;
    let stage = content.querySelector(":scope > .interface-page");
    if (!stage) {
      stage = document.createElement("div");
      stage.className = "interface-page";
      stage.append(...content.childNodes);
      content.append(stage);
    }
    content.classList.add("showcase-scroll");
    // Содержимое сохраняет естественный размер, лишняя высота прокручивается.
  }
  function fitCompact(dialog) {
    if (dialog.dataset.layout === "fullscreen") return;
    if (!dialog.classList.contains("interface-window")) dialog.classList.add("compact-window");
  }
  function refresh() {
    for (const dialog of document.querySelectorAll("dialog[open]")) {
      for (const [selector, size] of collections)
        for (const root of dialog.querySelectorAll(selector)) paginate(root, size);
      fitContent(dialog);
      fitCompact(dialog);
    }
  }
  new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          record.target.nodeType === 1 &&
          (record.target.matches("dialog") || record.target.closest("dialog")),
      )
    )
      schedule();
  }).observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["open", "hidden"],
  });
  document.addEventListener(
    "load",
    (e) => {
      if (e.target.matches?.("dialog img")) schedule();
    },
    true,
  );
  document.addEventListener(
    "toggle",
    (e) => {
      if (e.target.matches?.("details")) schedule();
    },
    true,
  );
  addEventListener("resize", schedule);
  document.fonts.ready.then(schedule);
  schedule();
})();

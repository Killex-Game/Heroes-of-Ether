/* Единое отображение значка и числового значения величия. */
"use strict";
(() => {
  // One source for the value symbol; it can be replaced without editing every screen.
  const SOURCE = "assets/menu-icons/128/nav_achievements.webp?art=20261123-interface-art";
  function icon(size = 20, label = "") {
    const image = document.createElement("img");
    image.className = "greatness-icon";
    image.src = SOURCE;
    image.alt = label;
    image.width = image.height = size;
    image.title = "Величие";
    return image;
  }
  function value(text) {
    const node = document.createElement("span");
    node.className = "greatness-value";
    node.append(document.createTextNode(String(text)), icon(20, "величия"));
    return node;
  }
  function text(value) {
    const fragment = document.createDocumentFragment();
    for (const piece of String(value).split(/(величи(?:ем|[еяюи]))/giu)) {
      if (/^величи(?:ем|[еяюи])$/iu.test(piece)) fragment.append(icon(20, piece));
      else fragment.append(document.createTextNode(piece));
    }
    return fragment;
  }
  function label(node) {
    node.replaceChildren(text(node.textContent));
    return node;
  }
  window.KillexGreatnessUI = { SOURCE, icon, value, text, label };
})();

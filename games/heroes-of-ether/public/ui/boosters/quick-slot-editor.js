/* Выбор, перестановка и перетаскивание бустеров в быстрые слоты. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  class LoadoutUI {
    constructor(owner, root = document.getElementById("lobbyLoadout"), inventory = false) {
      this.owner = owner;
      this.root = root;
      this.inventory = inventory;
      this.ignoreClickUntil = 0;
      const heading = el("div", "loadout-heading");
      heading.append(el("strong", "", "Бустеры взятые с собой"));
      this.slots = el("div", "loadout-slots");
      this.slots.setAttribute("role", "group");
      this.slots.setAttribute("aria-label", "Шесть слотов бустеров");
      this.feedback = el("span", "loadout-feedback");
      this.feedback.hidden = true;
      this.feedback.setAttribute("role", "status");
      if (!inventory) root.append(heading);
      root.append(this.slots, this.feedback);
      this.render();
    }
    render() {
      this.clearDrag();
      const owner = this.owner;
      this.slots.replaceChildren();
      window.KillexLoadout.keys.forEach((key, index) => {
        const locked = !owner.slotAvailable(index),
          unlock = window.KillexLoadout.unlockLabel(index),
          item = owner.item(owner.slots[index]);
        const control = el("button", "booster-slot loadout-slot");
        control.type = "button";
        control.dataset.loadoutSlot = String(index);
        control.dataset.locked = String(locked);
        if (index >= 4) control.dataset.accountSlot = index === 4 ? "vip" : "premium";
        control.dataset.tier = item?.tier || "common";
        window.KillexControls.state(control, !owner.ready || !!owner.slotSaving, !owner.ready);
        control.draggable = !!item && !locked && !control.disabled && !owner.purchasesBlocked();
        control.onclick = () => {
          if (performance.now() < this.ignoreClickUntil) return;
          if (!this.inventory) owner.open("inventory");
          else if (item && !locked && !owner.purchasesBlocked()) owner.toggleSlot(item.id);
        };
        control.addEventListener("dragstart", (event) => this.startDrag(event, { index }));
        control.addEventListener("dragend", () => this.endDrag());
        control.addEventListener("dragover", (event) => {
          if (!this.nextSlots(index)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          this.slots
            .querySelectorAll("[data-drop-target]")
            .forEach((node) => delete node.dataset.dropTarget);
          control.dataset.dropTarget = "true";
        });
        control.addEventListener("dragleave", (event) => {
          if (!control.contains(event.relatedTarget)) delete control.dataset.dropTarget;
        });
        control.addEventListener("drop", (event) => this.drop(event, index));
        const action = this.inventory
          ? item
            ? "убрать из слота"
            : "перетащить бустер сюда"
          : "открыть инвентарь";
        control.setAttribute(
          "aria-label",
          `Слот ${key}: ${locked ? "нужен " + unlock : (item?.name || "пустой") + ", " + action}`,
        );
        if (!this.inventory) control.setAttribute("aria-haspopup", "dialog");
        if (item) {
          const image = el("img");
          image.src = window.KillexArtRevision.url(item.icon);
          image.alt = "";
          image.draggable = false;
          control.append(
            image,
            el("span", "booster-slot-count", String(owner.profile?.inventory[item.id] || 0)),
          );
        } else control.append(el("span", "loadout-placeholder", locked ? "◇" : "+"));
        control.append(el("kbd", "booster-slot-key", key));
        if (locked)
          control.append(
            el(
              "span",
              "loadout-lock",
              index === 3 ? "12 ур." : index === 4 ? "VIP / P" : "Premium",
            ),
          );
        const hint = locked ? "Открывается с " + unlock : (item ? item.name + " - " : "") + action;
        if (!this.slots.closest("#arena")) control.title = hint;
        if (item && !locked) {
          window.KillexBoosterTooltip.attach(control, item);
          control.removeAttribute("title");
        }
        this.slots.append(control);
      });
    }
    startDrag(event, source) {
      const owner = this.owner,
        id = source.itemId || owner.slots[source.index];
      if (
        !event.dataTransfer ||
        !owner.ready ||
        owner.purchasesBlocked() ||
        owner.slotSaving ||
        !window.KillexLoadout.itemAllowed(owner.item(id), owner.profile?.level) ||
        !owner.profile?.inventory[id] ||
        (source.index !== undefined && !owner.slotAvailable(source.index))
      ) {
        event.preventDefault();
        return;
      }
      owner.loadoutDrag = { ...source, id, slots: [...owner.slots] };
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      event.currentTarget.dataset.dragging = "true";
    }
    refreshAvailability() {
      const owner = this.owner;
      if (owner.purchasesBlocked()) this.clearDrag();
      this.slots.querySelectorAll("[data-loadout-slot]").forEach((control) => {
        const index = Number(control.dataset.loadoutSlot);
        window.KillexControls.state(control, !owner.ready || !!owner.slotSaving, !owner.ready);
        control.draggable =
          !!owner.slots[index] &&
          owner.slotAvailable(index) &&
          !control.disabled &&
          !owner.purchasesBlocked();
      });
    }
    nextSlots(index) {
      const owner = this.owner,
        drag = owner.loadoutDrag;
      if (
        !drag ||
        !owner.ready ||
        owner.purchasesBlocked() ||
        owner.slotSaving ||
        !owner.slotAvailable(index) ||
        !owner.profile?.inventory[drag.id] ||
        !window.KillexLoadout.itemAllowed(owner.item(drag.id), owner.profile?.level) ||
        drag.slots.length !== owner.slots.length ||
        !drag.slots.every((id, i) => id === owner.slots[i])
      )
        return null;
      const from = owner.slots.indexOf(drag.id);
      if (from >= 0)
        return window.KillexLoadout.move(owner.slots, from, index, owner.slotCapacity());
      const next = [...owner.slots];
      while (next.length <= index) next.push(null);
      next[index] = drag.id;
      return next;
    }
    clearDrag() {
      this.owner.loadoutDrag = null;
      for (const rack of [this.owner.loadout, this.owner.inventoryLoadout, this])
        rack?.slots.querySelectorAll("[data-dragging],[data-drop-target]").forEach((node) => {
          delete node.dataset.dragging;
          delete node.dataset.dropTarget;
        });
      this.owner.grid
        ?.querySelectorAll("[data-dragging]")
        .forEach((node) => delete node.dataset.dragging);
    }
    endDrag() {
      this.ignoreClickUntil = performance.now() + 250;
      this.clearDrag();
    }
    async drop(event, index) {
      const next = this.nextSlots(index);
      if (!next) return;
      event.preventDefault();
      this.endDrag();
      this.feedback.hidden = true;
      const saved = await this.owner.changeSlots(next);
      if (!saved) this.showFeedback(this.owner.message.textContent, true);
    }
    showFeedback(text, error = false) {
      clearTimeout(this.feedbackTimer);
      this.feedback.textContent = text;
      this.feedback.dataset.error = String(error);
      this.feedback.hidden = false;
      this.feedbackTimer = setTimeout(
        () => {
          this.feedback.hidden = true;
        },
        error ? 5000 : 2500,
      );
    }
  }
  window.KillexLoadoutUI = LoadoutUI;
})();

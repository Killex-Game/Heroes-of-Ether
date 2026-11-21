/* Отдельный запас бустеров надетых аксессуаров на текущую жизнь. */
(() => {
  "use strict";
  class AccessoryAbilityUI {
    constructor(owner) {
      this.owner = owner;
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.tabIndex = -1;
      this.button.className = "booster-slot accessory-ability";
      this.button.hidden = true;
      this.button.addEventListener("click", () => this.use());
      document.querySelector(".booster-quick [data-slot]").before(this.button);
    }
    updateArena() {
      const me = this.owner.getMe(),
        life = me && me.id + ":" + me.spawnSerial;
      if (life !== this.life) {
        this.life = life;
        this.pending = null;
        this.confirmed = {};
        clearTimeout(this.timer);
      }
      const stock = me?.accessoryAbilities || [];
      this.current =
        stock.find(
          (item) => Math.min(item.count, this.confirmed[item.accessoryId] ?? Infinity) > 0,
        ) || stock[0];
      const item = this.current,
        def = window.KillexAccessories.item(item?.accessoryId)?.ability;
      const hidden = !def || !this.owner.isArena() || !!me?.dead;
      if (this.button.hidden !== hidden) this.button.hidden = hidden;
      if (!def) return;
      const count = Math.min(item.count, this.confirmed[item.accessoryId] ?? Infinity);
      window.KillexControls.state(
        this.button,
        !count || !!this.pending || this.owner.inputBlocked(),
        !count || this.owner.inputBlocked(),
      );
      const signature = item.accessoryId + ":" + count;
      if (this.signature !== signature) {
        this.signature = signature;
        const image = document.createElement("img"),
          key = document.createElement("span"),
          amount = document.createElement("span");
        image.src = def.icon;
        image.alt = "";
        key.className = "booster-slot-key";
        key.textContent = "E";
        amount.className = "booster-slot-count";
        amount.textContent = String(count);
        this.button.replaceChildren(image, key, amount);
        this.button.setAttribute("aria-label", "E. " + def.name + ", " + count);
      }
    }
    handleKey(event) {
      if (
        event.code !== "KeyE" ||
        !this.owner.isArena() ||
        this.owner.inputBlocked() ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.target?.closest("input,textarea,select,[contenteditable],dialog")
      )
        return false;
      if (!event.repeat) this.use();
      return !!this.current;
    }
    use() {
      this.updateArena();
      if (this.button.hidden || this.button.disabled) return;
      const message = {
        type: "useAccessoryBooster",
        requestId: window.KillexRequestIds.create(),
        spawnSerial: this.owner.getMe().spawnSerial,
        accessoryId: this.current.accessoryId,
      };
      const aim = this.owner.getAim();
      if (aim) Object.assign(message, { aimX: aim.x, aimY: aim.y });
      if (!this.owner.send(message)) return;
      this.pending = message;
      this.updateArena();
      this.timer = setTimeout(() => {
        if (this.pending !== message) return;
        this.owner.send(message);
        this.timer = setTimeout(() => {
          if (this.pending === message) {
            this.pending = null;
            this.updateArena();
          }
        }, 5000);
      }, 2000);
    }
    receive(message) {
      if (message.requestId !== this.pending?.requestId) return;
      clearTimeout(this.timer);
      this.pending = null;
      if (message.ok) this.confirmed[message.accessoryId] = message.remaining;
      else this.owner.notice(message.message);
      this.updateArena();
    }
  }
  window.KillexAccessoryAbilityUI = AccessoryAbilityUI;
})();

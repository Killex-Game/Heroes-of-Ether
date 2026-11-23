/* Редактор ника, пола и ссылки VK. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (label, action, cls = "sf-button") => {
    const node = el("button", cls, label);
    node.type = "button";
    node.onclick = action;
    return node;
  };
  class PersonalUI {
    constructor(owner) {
      this.owner = owner;
      this.trigger = document.getElementById("editProfile");
      this.dialog = el("dialog", "personal-dialog");
      this.dialog.id = "personalDialog";
      this.dialog.setAttribute("aria-labelledby", "personalTitle");
      const header = el("header", "personal-heading"),
        title = el("h2", "", "Личные данные");
      title.id = "personalTitle";
      const close = (this.close = button(
        "×",
        () => {
          if (!this.required()) this.dialog.close();
        },
        "personal-close",
      ));
      close.setAttribute("aria-label", "Закрыть личные данные");
      header.append(title, close);
      this.form = el("form", "personal-form");
      this.name = el("input");
      this.name.id = "profileNickname";
      this.name.maxLength = 16;
      this.name.required = true;
      this.name.autocomplete = "off";
      const nameLabel = el("label", "", "Ник");
      nameLabel.htmlFor = this.name.id;
      this.vk = el("input");
      this.vk.id = "profileVk";
      this.vk.type = "url";
      this.vk.maxLength = 200;
      this.vk.placeholder = "https://vk.com/имя";
      const vkLabel = el("label", "", "Ссылка VK - видна другим игрокам");
      vkLabel.htmlFor = this.vk.id;
      this.gender = "unspecified";
      this.genderButtons = new Map();
      const genderLabel = el("span", "personal-field-label", "Пол");
      genderLabel.id = "profileGenderLabel";
      const genderGroup = el("div", "personal-genders");
      genderGroup.id = "profileGender";
      genderGroup.setAttribute("role", "group");
      genderGroup.setAttribute("aria-labelledby", genderLabel.id);
      for (const [value, label] of [
        ["male", "Мужской"],
        ["female", "Женский"],
      ]) {
        const control = button(
          "",
          () => {
            this.gender = value;
            this.refresh();
          },
          "personal-gender",
        );
        const icon = el("img");
        icon.src = "assets/identity/gender-" + value + ".svg";
        icon.alt = "";
        icon.width = 64;
        icon.height = 64;
        control.append(icon, el("span", "", label));
        control.dataset.gender = value;
        this.genderButtons.set(value, control);
        genderGroup.append(control);
      }
      this.price = el("p", "personal-price");
      this.status = el("p", "personal-status");
      this.status.setAttribute("role", "status");
      this.save = el("button", "sf-button", "Сохранить");
      this.save.type = "submit";
      this.form.append(
        nameLabel,
        this.name,
        genderLabel,
        genderGroup,
        vkLabel,
        this.vk,
        this.price,
        this.status,
        this.save,
      );
      this.dialog.append(header, this.form);
      this.confirm = el("dialog", "personal-dialog rename-confirm");
      this.confirm.id = "renameConfirmDialog";
      const confirmTitle = el("h2", "", "Сменить ник?");
      confirmTitle.id = "renameConfirmTitle";
      this.confirm.setAttribute("aria-labelledby", confirmTitle.id);
      const cost = el("p", "personal-price", "Стоимость смены ника - 10 ");
      cost.append(this.crystal());
      const actions = el("div", "personal-actions");
      this.yes = button("Да", () => {
        this.confirm.close();
        this.submit(true);
      });
      actions.append(
        button("Нет", () => this.confirm.close(), "sf-button sf-tertiary"),
        this.yes,
      );
      this.confirm.append(confirmTitle, cost, actions);
      document.body.append(this.dialog, this.confirm);
      this.trigger.onclick = () => this.open();
      this.form.onsubmit = (event) => {
        event.preventDefault();
        this.submit(false);
      };
      this.dialog.addEventListener("close", () => {
        this.confirm.close();
        if (this.required()) {
          queueMicrotask(() => {
            if (this.required() && !this.dialog.open) window.KillexWindows.open(this.dialog);
          });
          return;
        }
        this.trigger.focus({ preventScroll: true });
      });
      this.dialog.addEventListener("cancel", (event) => {
        if (this.required()) event.preventDefault();
      });
      document.addEventListener("killex:profile", () => {
        this.refresh();
        this.welcome();
      });
      this.refresh();
      this.welcome();
    }
    required() {
      return this.owner.getProfile()?.personal?.introPending === true;
    }
    welcome() {
      if (
        this.owner.getProfile()?.personal?.introPending &&
        this.owner.isLobby() &&
        !this.owner.inArena() &&
        !this.dialog.open &&
        !this.pending
      ) {
        this.intro = true;
        this.open();
      }
    }
    crystal() {
      const image = el("img", "inline-currency");
      image.src = "assets/menu-icons/64/currency_crystals.webp?art=20261123-interface-art";
      image.alt = "кристаллов";
      image.width = 24;
      image.height = 24;
      return image;
    }
    refresh() {
      const profile = this.owner.getProfile();
      window.KillexControls.state(this.trigger, !profile || !!this.pending, !profile);
      this.dialog.dataset.required = String(this.required());
      this.close.hidden = this.required();
      window.KillexControls.state(this.close, this.required());
      if (!this.dialog.open) return;
      this.price.replaceChildren();
      if (profile?.personal?.renameCost)
        this.price.append(document.createTextNode("Смена ника: 10 "), this.crystal());
      else this.price.textContent = "Первая установка ника - бесплатно.";
      window.KillexControls.state(
        this.save,
        !!this.pending || this.owner.inArena(),
        this.owner.inArena(),
      );
      window.KillexControls.state(this.name, !!this.pending, false);
      window.KillexControls.state(this.vk, !!this.pending, false);
      for (const [value, control] of this.genderButtons) {
        window.KillexControls.state(
          control,
          !!this.pending || this.owner.inArena(),
          this.owner.inArena(),
        );
        control.setAttribute("aria-pressed", String(this.gender === value));
      }
    }
    open() {
      if (!this.owner.isLobby() || !this.owner.getProfile()) return;
      const profile = this.owner.getProfile();
      this.expectedName = profile.name;
      this.name.value = profile.name;
      this.gender = profile.personal?.gender || "unspecified";
      this.status.textContent = "";
      this.vk.value = profile.personal?.vkUrl || "";
      window.KillexWindows.open(this.dialog);
      this.refresh();
      this.owner.loadProfile();
      this.name.focus();
    }
    async submit(confirmed) {
      if (
        this.pending ||
        this.confirm.open ||
        !this.owner.isLobby() ||
        this.owner.inArena() ||
        !this.form.reportValidity()
      )
        return;
      const profile = this.owner.getProfile();
      if (
        !confirmed &&
        this.name.value.trim() !== this.expectedName &&
        profile.personal.renameCost
      ) {
        window.KillexWindows.open(this.confirm);
        return;
      }
      const operation = {
        name: this.name.value,
        gender: this.gender,
        vkUrl: this.vk.value.trim(),
        expectedName: this.expectedName,
        confirmed,
        requestId: window.KillexRequestIds.create(),
      };
      this.pending = true;
      this.status.textContent = "";
      this.refresh();
      try {
        let data;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await fetch("/api/profile/personal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(operation),
              signal: AbortSignal.timeout(8000),
            });
            data = await response.json();
            if (!response.ok)
              throw Object.assign(Error(data.error || "Не удалось сохранить профиль."), {
                server: true,
              });
            break;
          } catch (error) {
            if (attempt || error.server) throw error;
          }
        }
        this.owner.updateProfile(data.profile);
        this.expectedName = data.profile.name;
        this.name.value = data.profile.name;
        this.status.textContent = "";
        if (this.intro) {
          this.intro = false;
          this.dialog.close();
          this.owner.loadProfile();
        }
      } catch (error) {
        if (this.intro && !this.dialog.open) window.KillexWindows.open(this.dialog);
        this.status.textContent = error.message;
      } finally {
        this.pending = false;
        this.refresh();
      }
    }
  }
  window.KillexPersonalUI = PersonalUI;
})();

/* Баннеры VIP/Premium, события и кнопка статусов. */
"use strict";
(() => {
  const product = document.querySelector(".promo-products"),
    events = document.querySelector(".promo-events");
  const label = (node, eyebrow, title, description) => {
    const small = document.createElement("span"),
      heading = document.createElement("h2"),
      copy = document.createElement("p");
    small.className = "promo-eyebrow";
    small.textContent = eyebrow;
    heading.textContent = title;
    copy.textContent = description;
    node.replaceChildren(small, heading, copy);
  };
  // Оба слайда постоянно в DOM: фон, затемнение и подписи плавно меняются вместе.
  const slides = ["vip", "premium"].map((tier) => {
    const slide = document.createElement("div"),
      copy = document.createElement("div"),
      premium = tier === "premium";
    slide.className = "promo-slide";
    slide.dataset.tier = tier;
    slide.style.backgroundImage = `url("assets/banners/${premium ? "premium.webp" : "vip.png"}?art=20261122d")`;
    copy.className = "promo-slide-copy";
    label(
      copy,
      "Игровые продукты",
      premium ? "Premium" : "VIP",
      premium ? "Аметистовое сияние и особые привилегии" : "Золотое сияние и больше наград",
    );
    slide.append(copy);
    slide.classList.toggle("is-active", !premium);
    slide.setAttribute("aria-hidden", String(premium));
    return slide;
  });
  product.replaceChildren(...slides);
  const started = Date.now(),
    render = () => {
      const premium = Math.floor((Date.now() - started) / 120000) % 2 === 1,
        tier = premium ? "premium" : "vip";
      if (product.dataset.tier === tier) return;
      product.dataset.tier = tier;
      for (const slide of slides) {
        const active = slide.dataset.tier === tier;
        slide.classList.toggle("is-active", active);
        slide.setAttribute("aria-hidden", String(!active));
      }
    };
  render();
  window.KillexActivity.every(() => {
    if (!document.hidden && document.body.dataset.screen !== "arena") render();
  }, () => 120000 - ((Date.now() - started) % 120000), () => document.body.dataset.screen === "lobby");
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && document.body.dataset.screen !== "arena") render();
  });
  product.tabIndex = 0;
  product.setAttribute("role", "button");
  product.setAttribute("aria-label", "Открыть VIP и Premium");
  product.onclick = () => document.getElementById("accountButton").click();
  product.onkeydown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      product.click();
    }
  };
  events.style.backgroundImage = 'url("assets/banners/pets.webp?art=20261122d")';
  label(events, "Предложения", "Питомцы", "Выбери верного друга для арены");
  const offers = document.querySelector(".promo-offers");
  const eventBanners = {
    "ether-alchemy-v1": "assets/events/ether-alchemy/v1/banner-v2.webp?art=20261122d",
    "black-friday-v1": "assets/events/black-friday/banner-v2.webp?art=20261122d",
    "easter-hunt-v1": "assets/events/easter-hunt/banner.png?art=20261122-zaya",
    "lucky-week-v1": "assets/events/lucky-week/banner-v3.webp?art=20261122d",
    "core-v1": "assets/events/lucky-week/banner-v3.webp?art=20261122d",
  };
  if (offers) {
    offers.tabIndex = 0;
    offers.setAttribute("role", "button");
    offers.onclick = () => document.getElementById("eventsSection")?.click();
    offers.onkeydown = (e) => {
      if (["Enter", " "].includes(e.key)) {
        e.preventDefault();
        offers.click();
      }
    };
    document.addEventListener("killex:profile", ({ detail: profile }) => {
      const event = profile.event || profile.scheduledEvent;
      const banner = event && eventBanners[event.contentPack];
      offers.classList.toggle("has-event-banner", !!banner);
      offers.style.backgroundImage = banner ? 'url("' + banner + '")' : "none";
      label(
        offers,
        "События",
        event?.name || event?.title || "События",
        event
          ? profile.event
            ? "Событие проходит сейчас"
            : "Начало " +
              new Date(event.startsAt).toLocaleString("ru-RU", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
          : "Следующее событие скоро появится здесь",
      );
    });
  }
  const account = document.getElementById("accountButton"),
    icons = document.createElement("span");
  icons.className = "account-button-icons";
  for (const tier of ["vip", "premium"]) {
    const img = new Image();
    img.src = "assets/accounts/" + tier + ".png";
    img.alt = tier === "vip" ? "VIP" : "Premium";
    icons.append(img);
  }
  const accountLabel = document.createElement("span");
  accountLabel.textContent = "Статусы";
  account.replaceChildren(icons, accountLabel);
  const bonusDot = document.createElement("span");
  bonusDot.className = "menu-notification-dot";
  bonusDot.hidden = true;
  bonusDot.setAttribute("aria-label", "Доступен ежедневный бонус статуса");
  account.classList.add("menu-notification-target");
  account.append(bonusDot);
  document.addEventListener("killex:profile", ({ detail }) => {
    const a = detail.account;
    bonusDot.hidden = !["vip", "premium"].some(
      (kind) => a?.[kind] && Object.values(a.currencyBonuses?.[kind] || {}).some((b) => !b.claimed),
    );
    account.setAttribute(
      "aria-label",
      bonusDot.hidden ? "Статусы: VIP и Premium" : "Статусы: доступен ежедневный бонус",
    );
  });
  account.setAttribute("aria-label", "Статусы: VIP и Premium");
  account.title = "Статусы: VIP и Premium";
})();

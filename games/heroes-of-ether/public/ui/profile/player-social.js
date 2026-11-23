/* Брак по взаимному согласию и подтверждаемая отправка подарков. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls || "";
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const button = (text, click, cls = "sf-button sf-secondary") => {
    const b = el("button", cls, text);
    b.type = "button";
    b.onclick = click;
    return b;
  };
  let own = null,
    catalog = [],
    state = { invitations: [] },
    loading = null;
  const seen = new Set(),
    currency = { coins: "монет", crystals: "кристаллов", bucks: "эфира" };
  const giftPrice = (item) => {
    const price = el("span", "social-gift-price", Number(item.price).toLocaleString("ru-RU")),
      icon = el("img");
    price.setAttribute("aria-label", item.price + " " + currency[item.currency]);
    icon.src = "assets/menu-icons/64/currency_" + item.currency + ".webp?art=20261123-interface-art";
    icon.alt = "";
    icon.width = icon.height = 22;
    price.append(icon);
    return price;
  };
  let invitationBox = null;
  const canNotify = () => own && !document.hidden &&
    document.body.dataset.screen === "lobby" && !window.KillexBoot?.active &&
    !document.querySelector('dialog[open], dialog[data-required="true"]');
  function showNewInvitations() {
    if (!canNotify() || invitationBox?.dialog.isConnected) return;
    const invitation = state.invitations?.find(i => !seen.has(i.id));
    if (invitation) invitations(invitation.id);
  }
  let giftBox = null, divorceBox = null, marriageBox = null, declinedBox = null;
  let giftAck = null;
  const shownGifts = new Map();
  async function acknowledgeGifts() {
    const pending = giftAck;
    if (!pending || pending.busy || pending.playerId !== own?.id) return;
    pending.busy = true;
    try {
      const result = await request("/api/social/action", pending.payload, true);
      if (giftAck !== pending || own?.id !== pending.playerId) return;
      giftAck = null;
      document.dispatchEvent(new CustomEvent("killex:profile", { detail: result.profile }));
    } catch {
      // The existing social refresh retries this same durable operation. Closing
      // a window never creates another acknowledgement or discards the gift.
    } finally { pending.busy = false; }
  }
  function portrait(player) {
    const wrap = el("div", "achievement-earned-icon social-notice-avatar");
    if (player?.id) {
      wrap.append(window.KillexPlayerProfile.avatar(player, "", { imageSize: 160 }));
      // Reserve the complete frame box, including crowns above the portrait.
      // The existing offline fit supplies its geometry; no image scanning or
      // repeated DOM measurements are needed when this notice is displayed.
      const fit = window.KillexLeagueAppearance?.frameTheme(player.appearance?.avatarFrame)?.fit;
      if (fit) {
        const size = 1 / (2 * fit[2] * 0.98);
        wrap.style.setProperty("--social-frame-top", Math.max(0, fit[1] * size - 0.5));
        wrap.style.setProperty("--social-frame-bottom", Math.max(0, (1 - fit[1]) * size - 0.5));
      }
    }
    else {
      const anonymous = el("span", "social-anonymous-avatar", "?");
      anonymous.setAttribute("aria-label", "Анонимный игрок");
      wrap.append(anonymous);
    }
    return wrap;
  }
  function presentation(box, player, message, gift) {
    box.body.replaceChildren(
      portrait(player),
      el("h3", "achievement-earned-name", player?.name || "Анонимный игрок"),
      el("p", "achievement-earned-description", message),
    );
    if (gift) {
      const line = el("div", "social-notice-gift"), art = el("img");
      art.src = window.KillexArtRevision.url(gift.icon);
      art.alt = "";
      line.append(art, el("strong", "", gift.name));
      box.body.append(line);
    }
  }
  function acknowledgedNotice(box, action, noticeId, label) {
    const accept = button(label, null, "sf-button sf-primary");
    const acknowledge = () => perform({ action, noticeId }, accept, box, () => box.dialog.close());
    accept.onclick = acknowledge;
    box.dialog.querySelector(".personal-close").onclick = acknowledge;
    box.dialog.addEventListener("cancel", e => { e.preventDefault(); acknowledge(); });
    box.body.append(accept);
  }
  function showDivorce(explicitNotice) {
    if ((!explicitNotice && !canNotify()) || divorceBox?.dialog.isConnected) return;
    const notice = explicitNotice || state.divorceNotices?.[0];
    if (!notice) return;
    const box = modal("Брак расторгнут", true);
    divorceBox = box;
    box.dialog.classList.add("divorce-notice-dialog");
    box.dialog.dataset.marriageState = "divorced";
    presentation(box, notice.from, notice.initiated
      ? "Брак с этим игроком успешно расторгнут. Теперь вы оба свободны для новых отношений."
      : "Этот игрок расторг брак с тобой. Теперь вы оба свободны для новых отношений.");
    acknowledgedNotice(box, "divorce-read", notice.id, "Понятно");
    box.dialog.addEventListener("close", () => { divorceBox = null; queueMicrotask(showNotices); });
  }
  function showMarriage() {
    if (!canNotify() || marriageBox?.dialog.isConnected) return;
    const notice = state.marriageNotices?.[0];
    if (!notice) return;
    const current = state.marriage?.partner.id === notice.from.id && state.marriage.at === notice.at;
    const box = modal(current ? "Брак заключён!" : "Предложение было принято", true);
    marriageBox = box;
    box.dialog.classList.add("marriage-notice-dialog");
    box.dialog.dataset.marriageState = "confirmed";
    presentation(box, notice.from, current
      ? "Твоё предложение принято! Теперь вы в браке. Поздравляем вашу пару!"
      : "Этот игрок принял твоё предложение брака. Этот брак уже завершён.");
    acknowledgedNotice(box, "marriage-read", notice.id, "Понятно");
    box.dialog.addEventListener("close", () => { marriageBox = null; queueMicrotask(showNotices); });
  }
  function showNotices() {
    showDivorce();
    showMarriage();
    showDeclined();
    showNewInvitations();
    showNewGifts();
  }
  function showDeclined() {
    if (!canNotify() || declinedBox?.dialog.isConnected) return;
    const notice = state.marriageDeclinedNotices?.[0];
    if (!notice) return;
    const box = modal("Приглашение отклонено", true);
    declinedBox = box;
    box.dialog.classList.add("marriage-declined-dialog");
    box.dialog.dataset.marriageState = "declined";
    presentation(box, notice.from, "К сожалению, этот игрок отклонил твоё предложение брака.");
    acknowledgedNotice(box, "marriage-declined-read", notice.id, "Понятно");
    box.dialog.addEventListener("close", () => { declinedBox = null; queueMicrotask(showNotices); });
  }
  function showNewGifts() {
    if (!canNotify() || giftBox?.dialog.isConnected || giftAck) return;
    const summary = state.giftSummary;
    if (summary) {
      const groups = summary.groups.filter(g => g.through > (shownGifts.get(g.gift.id) || 0));
      if (!groups.length) return;
      const total = groups.reduce((n,g) => n + g.count, 0);
      const box = modal(total === 1 ? "Тебе подарок!" : "Тебе подарки!", total === 1);
      giftBox = box;
      box.dialog.classList.add("gift-received-dialog");
      const notice = total === 1 && state.giftNotices?.find(n => n.gift?.id === groups[0].gift.id);
      if (notice) presentation(box, notice.anonymous ? null : notice.from,
        notice.anonymous ? "Кто-то решил порадовать тебя и оставил своё имя в тайне." : "Этот игрок дарит тебе подарок!", notice.gift);
      else {
        box.body.append(el("p", "", "Получено подарков: " + total.toLocaleString("ru-RU")));
        const list = el("div", "gift-summary-list");
        for (const group of groups) {
          const row = el("div", "social-notice-gift"), art = el("img");
          art.src = window.KillexArtRevision.url(group.gift.icon); art.alt = "";
          row.append(art, el("strong", "", group.gift.name + " × " + group.count.toLocaleString("ru-RU"))); list.append(row);
        }
        box.body.append(list);
      }
      box.body.append(button("Спасибо!", () => box.dialog.close(), "sf-button sf-primary"));
      for (const group of groups) shownGifts.set(group.gift.id, group.through);
      giftAck = { playerId: own.id, busy: false, payload: { action: "gifts-seen",
        requestId: window.KillexRequestIds.create(), through: groups.map(g => ({ giftId: g.gift.id, through: g.through })) } };
      box.dialog.addEventListener("close", () => { giftBox = null; acknowledgeGifts(); queueMicrotask(showNotices); });
      // Acknowledge presentation, not a click on every individual gift.
      acknowledgeGifts();
      return;
    }
    const notice = state.giftNotices?.find((n) => n.gift);
    if (!notice) return;
    const box = modal("Тебе подарок!", true);
    giftBox = box;
    box.dialog.classList.add("gift-received-dialog");
    presentation(box, notice.anonymous ? null : notice.from,
      notice.anonymous ? "Кто-то решил порадовать тебя и оставил своё имя в тайне." : "Этот игрок дарит тебе подарок!", notice.gift);
    acknowledgedNotice(box, "gift-read", notice.id, "Спасибо!");
    box.dialog.addEventListener("close", () => {
      giftBox = null;
      queueMicrotask(showNotices);
    });
  }
  function divorce(player) {
    const marriage = own?.social?.marriage;
    if (marriage?.partner.id !== player.id) return;
    const box = modal("Расторгнуть брак?", true);
    box.dialog.classList.add("marriage-dialog");
    box.dialog.dataset.marriageState = "divorced";
    presentation(box, player, "Ты уверен, что хочешь расторгнуть брак с этим игроком?");
    const actions = el("div", "social-actions");
    const confirm = button("Расторгнуть", null, "sf-button sf-danger");
    confirm.onclick = () =>
      perform(
        { action: "divorce", targetId: player.id, marriageAt: marriage.at, confirmed: true },
        confirm,
        box,
        () => {
          box.dialog.close();
          showDivorce(state.divorceNotices?.find(n => n.initiated && n.from.id === player.id));
        },
      );
    actions.append(
      confirm,
      button("Отмена", () => box.dialog.close()),
    );
    box.body.append(actions);
  }
  async function request(url, body, keepalive = false) {
    const response = await fetch(url, {
      ...(body
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
      signal: AbortSignal.timeout(8000), keepalive,
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Не удалось выполнить действие.");
    return data;
  }
  function modal(title, ceremony = false) {
    const dialog = el("dialog", ceremony ? "achievement-earned-dialog social-notice-dialog" : "social-dialog"),
      heading = el("header", ceremony ? "achievement-earned-banner" : "personal-heading"),
      h = el("h2", "", title);
    h.id = "social-title-" + window.KillexRequestIds.create();
    dialog.setAttribute("aria-labelledby", h.id);
    const close = button("×", () => dialog.close(), ceremony ? "personal-close booster-close" : "personal-close");
    close.setAttribute("aria-label", "Закрыть");
    heading.append(h);
    if (!ceremony) heading.append(close);
    const body = el("div", "social-content"),
      status = el("p", "social-status");
    status.setAttribute("role", "status");
    dialog.append(heading, body, status);
    if (ceremony) dialog.append(close);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    window.KillexWindows.open(dialog);
    return { dialog, body, status };
  }
  async function perform(payload, b, box, done) {
    if (box.busy) return;
    box.busy = true;
    const signature = JSON.stringify(payload);
    if (b.pending?.signature !== signature)
      b.pending = { signature, requestId: window.KillexRequestIds.create() };
    window.KillexControls.state(b, true, false);
    box.status.textContent = "";
    try {
      const result = await request("/api/social/action", {
        ...payload,
        requestId: b.pending.requestId,
      });
      document.dispatchEvent(new CustomEvent("killex:profile", { detail: result.profile }));
      if ((payload.action === "gift" || payload.action === "gift-anonymous") &&
          payload.targetId !== result.profile?.id)
        window.KillexPlayerProfile?.refresh(payload.targetId);
      box.status.textContent = "";
      delete b.pending;
      await load();
      done?.(result);
    } catch (error) {
      box.status.textContent = error.message + " Можно повторить действие.";
    } finally {
      box.busy = false;
      window.KillexControls.state(b, false);
    }
  }
  async function load() {
    if (loading) return loading;
    if (!own || document.hidden || document.getElementById("lobby").hidden) return;
    acknowledgeGifts();
    loading = request("/api/social")
      .then((result) => {
        catalog = result.catalog;
        const changed = JSON.stringify(state) !== JSON.stringify(result.social);
        state = result.social;
        if (changed) {
          own = { ...own, social: state };
          document.dispatchEvent(new CustomEvent("killex:profile", { detail: own }));
        }
        showNotices();
      })
      .catch(() => {})
      .finally(() => {
        loading = null;
      });
    return loading;
  }
  function invite(player) {
    const box = modal("Предложение брака", true),
      form = el("form", "social-invite-form");
    box.dialog.classList.add("marriage-offer-dialog");
    box.dialog.dataset.marriageState = "proposal";
    presentation(box, player, "Предложить этому игроку заключить брак?");
    const send = button("Отправить приглашение", null);
    send.type = "submit";
    form.append(
      el("p", "", "Брак заключается после согласия второго игрока."),
      send,
    );
    form.onsubmit = (event) => {
      event.preventDefault();
      perform({ action: "invite", targetId: player.id, name: player.name }, send, box, () => {
        box.status.textContent = "";
        box.dialog.querySelector("h2").textContent = "Предложение отправлено!";
        presentation(box, player, "Твоё предложение доставлено. Приглашение действительно 7 дней.");
        box.body.append(button("Понятно", () => box.dialog.close(), "sf-button sf-primary"));
      });
    };
    box.body.append(form);
    send.focus();
  }
  function invitations(selectedId) {
    if (invitationBox?.dialog.isConnected) {
      window.KillexWindows.open(invitationBox.dialog);
      return;
    }
    if (!state.invitations?.length) return;
    const box = modal("Предложение брака", true);
    box.dialog.classList.add("marriage-invitations-dialog");
    box.dialog.dataset.marriageState = "proposal";
    invitationBox = box;
    box.dialog.addEventListener("close", () => {
      invitationBox = null;
    });
    let page = Math.max(0, state.invitations.findIndex(i => i.id === selectedId));
    const render = () => {
      const list = state.invitations || [];
      const i = list[Math.min(page, list.length - 1)];
      if (!i) { box.dialog.close(); return; }
      seen.add(i.id);
      presentation(box, i.from, "Этот игрок предлагает тебе заключить брак.");
      const actions = el("div", "social-actions"),
        accept = button("Принять"),
        decline = button("Отклонить");
      accept.onclick = () =>
        perform({ action: "accept", invitationId: i.id }, accept, box, () => {
          box.status.textContent = "";
          box.dialog.querySelector("h2").textContent = "Брак заключён!";
          box.dialog.dataset.marriageState = "confirmed";
          presentation(box, i.from, "Теперь вы в браке. Поздравляем вашу пару!");
          box.body.append(button("Отлично", () => box.dialog.close(), "sf-button sf-primary"));
        });
      decline.onclick = () =>
        perform({ action: "decline", invitationId: i.id }, decline, box, () => {
          box.dialog.close();
        });
      actions.append(accept, decline, button("Позже", () => box.dialog.close()));
      box.body.append(actions);
      if (list.length > 1) {
        const pages = el("nav", "social-invitation-pages");
        pages.setAttribute("aria-label", "Предложения брака");
        pages.append(button("‹", () => { page = (page + list.length - 1) % list.length; render(); }),
          el("span", "", `${page + 1} / ${list.length}`),
          button("›", () => { page = (page + 1) % list.length; render(); }));
        box.body.append(pages);
      }
    };
    render();
  }
  async function giftShop(player) {
    const box = modal(`Подарок для ${player.name}`);
    await load();
    if (!catalog.length) {
      box.status.textContent = "Не удалось загрузить подарки. Закрой окно и попробуй снова.";
      return;
    }
    const grid = el("div", "social-gift-grid");
    box.body.append(grid);
    const available = catalog.filter(item => !item.eventId || item.unlocked !== false);
    let category;
    for (const item of available) {
      if (category !== item.category) {
        category = item.category;
        grid.append(
          el(
            "h3",
            "social-gift-category",
            {
              decorative: "Декоративные подарки",
              buff: "Усиления на час",
              debuff: "Ослабления на час",
              event: "Подарки за достижения в событиях",
            }[category],
          ),
        );
      }
      const card = el("article", "social-gift-card"),
        img = el("img");
      if (item.eventId) card.classList.add("social-event-gift");
      img.src = window.KillexArtRevision.url(item.icon);
      img.alt = "";
      const choose = button("", () => {
        const confirmation = el("section", "social-gift-confirm"),
          send = button("Подарить"),
          back = button("Отмена", () => {
            confirmation.remove();
            grid.hidden = false;
            box.dialog.classList.remove("gift-confirmation-dialog");
            choose.focus();
          });
        const gift = el("img", "social-gift-confirm-icon"),
          actions = el("div", "social-actions");
        gift.src = window.KillexArtRevision.url(item.icon);
        gift.alt = item.name;
        gift.width = gift.height = 96;
        actions.append(send, back);
        const cost = el("p", "", "Стоимость: ");
        cost.append(giftPrice(item));
        const privacy = el("label", "social-gift-anonymous"),
          anonymous = el("input");
        anonymous.type = "checkbox";
        privacy.append(anonymous, el("span", "", "Подарить анонимно"));
        confirmation.append(
          gift,
          el(
            "p",
            "social-gift-effect",
            item.description + (item.durationMs ? ". Действует 1 час." : ""),
          ),
          el("p", "", "Получатель: " + player.name),
          cost,
          privacy,
          actions,
        );
        send.onclick = async () => {
          window.KillexControls.state(anonymous, true, false);
          window.KillexControls.state(back, true, false);
          try {
            await perform(
              {
                action: anonymous.checked ? "gift-anonymous" : "gift",
                targetId: player.id,
                giftId: item.id,
                confirmed: true,
                anonymous: anonymous.checked,
              },
              send,
              box,
              () => {
                box.dialog.close();
                const sent = modal("Подарок отправлен!", true);
                sent.dialog.classList.add("gift-sent-dialog");
                presentation(sent, player, anonymous.checked
                  ? "Твой подарок доставлен. Получатель не увидит твоё имя."
                  : "Твой подарок доставлен этому игроку.", item);
                sent.body.append(button("Отлично", () => sent.dialog.close(), "sf-button sf-primary"));
              },
            );
          } finally {
            window.KillexControls.state(anonymous, false);
            window.KillexControls.state(back, false);
          }
        };
        grid.hidden = true;
        box.dialog.classList.add("gift-confirmation-dialog");
        box.body.append(confirmation);
        send.focus();
      });
      choose.append(giftPrice(item));
      choose.setAttribute("aria-label", item.price + " " + currency[item.currency]);
      const locked = item.unlocked === false;
      window.KillexControls.state(choose, locked || (own?.wallet?.[item.currency] || 0) < item.price);
      if (choose.disabled) choose.title = locked ? item.unlockHint : "Недостаточно валюты";
      card.append(img, el("strong", "", item.name), el("small", "", item.description), choose);
      card.title = item.description;
      grid.append(card);
    }
  }
  document.addEventListener("killex:profile", (event) => {
    if (own?.id !== event.detail?.id) { seen.clear(); shownGifts.clear(); giftAck = null; }
    own = event.detail;
    if (own.social) state = own.social;
    showNotices();
    load();
  });
  document.addEventListener(
    "close",
    () =>
      queueMicrotask(showNotices),
    true,
  );
  new MutationObserver(() => {
    showNotices();
    load();
  }).observe(document.getElementById("lobby"), { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("visibilitychange", () => load());
  document.addEventListener("killex:boot-ready", showNotices);
  window.KillexActivity.every(load, 15000, () => document.body.dataset.screen === 'lobby');
  window.KillexSocial = {
    gift: (id) => catalog.find((g) => g.id === id),
    load,
    giftButton(hero, p) {
      if (own?.social?.marriage?.partner.id === p.id) {
        const end = button("", () => divorce(p), "public-background-edit public-divorce-button");
        end.setAttribute("aria-label", "Расторгнуть брак");
        end.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7a7 7 0 1 0 0 10M15 7a7 7 0 1 1 0 10M11 4l3 5-4 6 3 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
        hero.append(end);
      }
      const b = button("", () => giftShop(p), "public-gift-button");
      b.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11v10h14V11M12 7v14M3 7h18v4H3zM12 7C7 7 5 6 5 4.5S7 2 9 3.5L12 7Zm0 0c5 0 7-1 7-2.5S17 2 15 3.5L12 7Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>';
      b.title = "Подарить подарок";
      b.setAttribute("aria-label", "Подарить подарок");
      hero.append(b);
    },
    profileControls(section, p, avatar) {
      const marriage = p.social?.marriage;
      if (marriage) {
        const pair = el("div", "public-marriage"),
          rings = el("img", "marriage-rings"),
          spouse = button(
            "",
            () => window.KillexPlayerProfile.open(marriage.partner.id),
            "public-spouse-button",
          );
        spouse.setAttribute("aria-label", "Открыть профиль " + marriage.partner.name);
        spouse.title = "Открыть профиль " + marriage.partner.name;
        spouse.append(avatar(marriage.partner));
        rings.src = "assets/social/marriage-rings.webp?art=20261123-interface-art";
        rings.alt = "Обручальные кольца";
        pair.append(
          avatar(p),
          rings,
          spouse,
          el("small", "", `${p.name} и ${marriage.partner.name}`),
        );
        pair.title = "В браке с " + new Date(marriage.at).toLocaleDateString("ru-RU");
        section.prepend(pair);
        section.classList.add("has-marriage");
      } else if (own?.id !== p.id) {
        const b = button("Приглашение в брак", () => invite(p));
        window.KillexControls.state(b, !!own?.social?.marriage);
        if (b.disabled) b.title = "Вы уже состоите в браке";
        section.append(b);
      }
      if (own?.id === p.id && state.invitations?.length)
        section.append(button("Приглашения в брак", invitations));
    },
  };
})();

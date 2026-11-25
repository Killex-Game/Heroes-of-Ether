/* Одноразовое уведомление о новом титуле. Отметка хранится в профиле. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const dialog = el("dialog", "title-earned-dialog");
  dialog.id = "titleEarnedDialog";
  dialog.setAttribute("aria-labelledby", "titleEarnedHeading");
  const header = el("header", "clan-heading"),
    heading = el("h2", "", "Новый титул!"),
    close = el("button", "booster-close", "×");
  heading.id = "titleEarnedHeading";
  close.type = "button";
  close.setAttribute("aria-label", "Закрыть уведомление о титуле");
  header.append(heading, close);
  const art = el("img", "title-earned-art"),
    name = el("h3", "title-earned-name"),
    reward = el("p", "title-earned-reward"),
    status = el("p", "title-earned-status"),
    actions = el("div", "title-earned-actions"),
    share = el("button", "sf-button sf-secondary", "Поделиться"),
    done = el("button", "sf-button sf-primary", "Отлично");
  art.width = art.height = 160;
  status.setAttribute("role", "status");
  share.type = done.type = "button";
  actions.append(share, done);
  const stage = el("div", "title-earned-stage"), medal = el("div", "title-earned-medal"), prizes = el("div", "title-earned-prizes");
  medal.append(art, name); stage.append(medal, prizes);
  dialog.append(header, stage, reward, status, actions);
  document.body.append(dialog);
  let profile = null,
    seen = 0,
    busy = false,
    retryAfter = 0,
    request = null;
  const key = (id) => window.KillexPlatform.storageKey(".title-notice.v1.") + id;
  function remember(degree) {
    seen = Math.max(seen, degree);
    try {
      localStorage.setItem(key(profile.id), String(seen));
    } catch (_) {}
  }
  async function acknowledge() {
    if (!profile || busy || Date.now() < retryAfter || document.body.dataset.screen !== "lobby")
      return;
    if (seen <= profile.honors.notified) return;
    const owner = profile.id;
    request ||= { degree: seen, requestId: window.KillexRequestIds.create() };
    busy = true;
    let success = false;
    try {
      const response = await fetch("/api/profile/title-notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(8000),
      });
      const value = await response.json();
      if (!response.ok) throw Error(value.error || "Не удалось сохранить уведомление.");
      success = true;
      if (profile.id === owner) {
        request = null;
        document.dispatchEvent(new CustomEvent("killex:profile", { detail: value.profile }));
      }
    } catch (_) {
      if (profile.id === owner) retryAfter = Date.now() + 15000;
    } finally {
      busy = false;
      if (success) queueMicrotask(acknowledge);
    }
  }
  function render() {
    if (!profile?.honors) return;
    if (document.body.dataset.screen !== "lobby") {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open && !document.querySelector("dialog[open]")) {
      // A single progression update can unlock several titles. Announce the
      // highest one, not a stale intermediate title; all rewards stay in honors.
      const next = profile.honors.notifications?.reduce(
        (latest, n) =>
          n.degree > seen && (!latest || n.degree > latest.degree) ? n : latest,
        null,
      );
      if (next) {
        dialog.dataset.titleId = next.id;
        art.src = window.KillexProgressionArt.rank(next.id, 256);
        art.alt = next.name;
        name.textContent = next.name;
        reward.textContent = `Тебе доступен «${next.chestName}». Забери награду в Сокровищнице.`;
        if (next.id === "boss") reward.textContent += " Героическая тема и фон лобби открыты навсегда.";
        prizes.replaceChildren();
        const item = (src, label, note) => {
          const card = el("div", "title-earned-prize"), image = el("img");
          image.src = window.KillexArtRevision.url(src); image.alt = ""; card.append(image, el("strong", "", label));
          if (note) card.append(el("small", "", note));
          prizes.append(card);
        };
        item(window.KillexProgressionArt.chest(next.id,256), next.chestName);
        item(window.KillexLeagueAppearance.source("title_"+next.id,"frame"), "Рамка титула");
        item("assets/title-offers/v1/"+next.id+".webp", "Акция титула", "Скоро");
        const set=window.KillexAccessories.titleSets.find(t=>t.id===next.id);
        if (set) for (const slot of ["hat","bow"]) {
          const accessory=window.KillexAccessories.item(next.id==="novice"?"novice_"+slot:"title_"+next.id+"_"+slot);
          item(accessory.icon,accessory.name);
        }
        status.textContent = "";
        window.KillexUITheme?.inherit(dialog, document.body);
        window.KillexWindows.open(dialog);
        window.KillexAudio?.play?.("title");
        remember(next.degree);
        done.focus();
      }
    }
    acknowledge();
  }
  close.onclick = done.onclick = () => dialog.close();
  share.onclick = () => {
    const preview=el("dialog","title-share-dialog"), head=el("header","clan-heading"), title=el("h2","","Пост для VK"), x=el("button","booster-close","×");
    x.type="button"; x.setAttribute("aria-label","Закрыть предпросмотр"); x.onclick=()=>preview.close(); head.append(title,x);
    const picture=el("div","title-share-picture"), image=el("img"), text=el("p","title-share-copy");
    image.src="assets/title-share/v1/"+dialog.dataset.titleId+".png";
    image.alt="Мой новый титул - "+name.textContent+". Герои Эфира";
    image.width=image.height=768;
    picture.append(image);
    text.textContent="Мой новый титул - «"+name.textContent+"»! Играю в «Герои Эфира». Присоединяйся - давай играть вместе!";
    const back=el("button","sf-button sf-primary","Закрыть"); back.type="button"; back.onclick=()=>preview.close();
    preview.append(head,picture,text,el("small","title-share-note","Предпросмотр публикации"),back);
    preview.addEventListener("close",()=>preview.remove(),{once:true}); document.body.append(preview);
    window.KillexUITheme?.inherit(preview,document.body); window.KillexWindows.open(preview);
  };
  document.addEventListener("killex:profile", ({ detail }) => {
    if (
      !detail?.id ||
      !detail.honors ||
      (profile?.id === detail.id && profile.revision > detail.revision)
    )
      return;
    if (profile?.id !== detail.id) {
      if (dialog.open) dialog.close();
      seen = detail.honors.notified;
      try {
        seen = Math.max(
          seen,
          Math.min(detail.honors.claimed, Number(localStorage.getItem(key(detail.id))) || 0),
        );
      } catch (_) {}
      request = null;
      retryAfter = 0;
    }
    profile = detail;
    seen = Math.max(seen, detail.honors.notified);
    queueMicrotask(render);
  });
  new MutationObserver(render).observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-screen", "open"],
  });
  window.addEventListener("online", () => {
    retryAfter = 0;
    acknowledge();
  });
  window.KillexTitleNoticeUI = Object.freeze({});
})();

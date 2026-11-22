/* Newspaper: published news, live events and dated release notes. */
"use strict";
(() => {
  const release = window.KillexRelease;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (text, action, cls = "sf-button sf-secondary") => {
    const b = el("button", cls, text); b.type = "button"; b.onclick = action; return b;
  };
  const dialog = el("dialog", "release-notes-dialog news-dialog");
  dialog.id = "releaseNotesDialog";
  dialog.setAttribute("aria-labelledby", "releaseNotesTitle");
  const header = el("header", "news-masthead"), title = el("h2", "", "Вестник Эфира"),
    close = button("×", () => dialog.close(), "booster-close"), tabs = el("nav", "news-tabs"),
    article = el("article", "news-article"), pager = el("nav", "news-pager"),
    previous = button("‹", () => move(-1)), next = button("›", () => move(1)),
    counter = el("span"), footer = el("footer", "release-notes-footer"),
    version = el("small", "release-notes-version"), status = el("p", "news-status");
  title.id = "releaseNotesTitle";
  close.setAttribute("aria-label", "Закрыть новости");
  previous.setAttribute("aria-label", "Предыдущая страница новостей");
  next.setAttribute("aria-label", "Следующая страница новостей");
  tabs.setAttribute("aria-label", "Разделы газеты");
  pager.setAttribute("aria-label", "Страницы газеты");
  status.setAttribute("role", "status");
  header.append(el("small", "news-edition", "ГЕРОИ ЭФИРА, ИГРОВАЯ ГАЗЕТА"), title, close);
  article.tabIndex = 0;
  article.dataset.showScrollbar = 'true';
  article.setAttribute("aria-label", "Текст новости - прокрутка колёсиком, касанием или клавишами");
  for (const [key, name] of [["news", "Новости"], ["event", "События"], ["release", "Обновления"]]) {
    const tab = button(name, () => { category = key; page = 0; render(); }, "news-section-tile");
    tab.append(el("small", "", key === "news" ? "Вести Эфира" : key === "event" ? "Время приключений" : "Что нового"));
    tab.dataset.category = key; tabs.append(tab);
  }
  pager.append(previous, counter, next);
  footer.append(version);
  dialog.append(header, article, pager, tabs, status, footer);
  document.body.append(dialog);
  document.querySelector(".lobby-foot").textContent = "Герои Эфира, " + release.version;
  let profile, displayedFor, scheduled = false, category = "news", page = 0, remote = [], pages = [], loadId = 0;
  const seen = new Set(), key = id => window.KillexPlatform.storageKey(".releaseNotes.v1." + id);
  const layout = window.KillexNewsLayout;
  let hiddenSources = [], read = {}, loadedRevision = null, controller, wantedRevision = 0;
  const needsLoad = () => loadedRevision === null || loadedRevision < wantedRevision;
  const readKey = () => window.KillexPlatform.storageKey('.newsRead.v1.' + profile.id);
  const readStamp = item => String(item.updatedAt || JSON.stringify([item.date,item.title,item.body,item.future]));
  const newsDot = el('span','menu-notification-dot'); newsDot.hidden = true;
  newsDot.setAttribute('role','img');newsDot.setAttribute('aria-label','Есть непрочитанные новости');
  document.getElementById('newsSection').append(newsDot);
  for (const tab of tabs.children) { const dot=el('span','menu-notification-dot');dot.hidden=true;tab.append(dot); }
  function articles() { return layout.merge(layout.sources([release,...(window.KillexReleaseArchive||[])],profile?.event,profile?.scheduledEvent).filter(n=>!hiddenSources.includes(n.sourceId)),remote); }
  function indicators() { const unread=articles().filter(n=>read[n.sourceId||n.id]!==readStamp(n));newsDot.hidden=!unread.length;
    for(const tab of tabs.children)tab.querySelector('.menu-notification-dot').hidden=!unread.some(n=>n.category===tab.dataset.category);
  }
  function markRead(item) { if(!profile?.id||!dialog.open||document.hidden||document.body.dataset.screen!=='lobby')return;
    read[item.sourceId||item.id]=readStamp(item);
    const ids=new Set(articles().map(n=>n.sourceId||n.id));for(const id of Object.keys(read))if(!ids.has(id))delete read[id];
    try{localStorage.setItem(readKey(),JSON.stringify(read));}catch{} indicators();
  }
  function render(preferredId) {
    const previousId = article.dataset.articleId, scrollTop = article.scrollTop;
    pages = articles().filter(a => a.category === category);
    if (preferredId) {
      const index = pages.findIndex(a => a.id === preferredId || a.sourceId === preferredId);
      if (index >= 0) page = index;
    }
    page = Math.max(0, Math.min(page, pages.length - 1));
    for (const tab of tabs.children) tab.setAttribute("aria-pressed", String(tab.dataset.category === category));
    const item = pages[page]; article.replaceChildren();
    if (item) {
      layout.paint(article,item);
      markRead(item);
      if (item.action)
        article.append(button(item.action[0], () => { dialog.close(); document.getElementById(item.action[1])?.click(); }, "sf-button sf-secondary news-event-link"));
      if ((item.sourceId || item.id) === release.id && dialog.open) displayedFor = profile?.id;
      if (item.runId && dialog.open) document.dispatchEvent(new CustomEvent("killex:news-event-visible", { detail: { runId: item.runId } }));
    } else article.append(el("p", "news-empty", "В этом разделе пока нет публикаций."));
    article.dataset.articleId = item?.id || "";
    article.scrollTop = preferredId && previousId === item?.id ? scrollTop : 0;
    counter.textContent = `${pages.length ? page + 1 : 0} / ${pages.length}`;
    window.KillexControls.state(previous, page <= 0);
    window.KillexControls.state(next, page >= pages.length - 1);
    version.textContent = item?.version || "Герои Эфира";
  }
  function move(delta) { page += delta; render(); }
  async function load() {
    if(!profile?.id || document.hidden || document.body.dataset.screen!=='lobby')return;
    if(controller && !controller.signal.aborted)return;
    controller=new AbortController();
    const request=controller, id=++loadId, playerId=profile.id, timeout=setTimeout(()=>request.abort(),8000);
    let received=false;
    try {
      const response = await fetch("/api/news", { cache: "no-store", signal: request.signal });
      const value = await response.json();
      if (!response.ok) throw Error(value.error);
      if (id !== loadId || playerId !== profile?.id) return;
      remote = value.items; hiddenSources=value.hiddenSources||[]; loadedRevision=value.revision; status.textContent = ""; indicators();
      received=true;
      document.dispatchEvent(new CustomEvent('killex:news-ready'));
      if(dialog.open)render(pages[page]?.id);
      schedule();
    } catch (_) { if(id===loadId&&!request.signal.aborted)status.textContent="Свежие новости не загрузились. Открой газету ещё раз, чтобы повторить."; }
    finally{clearTimeout(timeout);if(controller===request){controller=null;if(received&&needsLoad())queueMicrotask(load);}}
  }
  function acknowledged() {
    if (seen.has(profile?.id)) return true;
    try { return localStorage.getItem(key(profile.id)) === release.id; } catch (_) { return false; }
  }
  function open(manual = false) {
    if(!manual && (loadedRevision===null || !articles().some(n=>(n.sourceId||n.id)===release.id)))return;
    if (!profile?.id || dialog.open || document.body.dataset.screen !== "lobby" || window.KillexBoot?.active ||
      window.KillexMaintenance?.blocked || document.querySelector('dialog[data-required="true"]') ||
      (!manual && (document.querySelector('dialog[open]') || !document.getElementById("settingsMenu").hidden || acknowledged()))) return;
    category = manual ? "news" : "release"; page = 0;
    window.KillexUITheme?.inherit(dialog, document.body);
    window.KillexWindows.open(dialog); render(manual ? undefined : release.id);
    load();
  }
  function schedule() {
    if (scheduled) return; scheduled = true;
    queueMicrotask(() => { scheduled = false; open(); });
  }
  document.getElementById("newsSection").onclick = () => open(true);
  // The event announcement now lives in the newspaper instead of a separate modal.
  window.KillexNews = { openEvent(runId) {
    if(loadedRevision===null)return false;
    const item=articles().find(n=>n.sourceId==='event:'+runId);
    if(!item)return false;
    open(true);
    if (dialog.open) { category = item.category; render("event:" + runId); return true; }
    return false;
  } };
  document.addEventListener("killex:profile", event => {
    if (!event.detail?.id) return;
    if (profile?.id !== event.detail.id) { remote = []; hiddenSources=[]; loadedRevision=null; wantedRevision=0; controller?.abort(); displayedFor = null; loadId++; read={}; try{read=JSON.parse(localStorage.getItem(window.KillexPlatform.storageKey(".newsRead.v1."+event.detail.id))||"{}");if(!read||Array.isArray(read)||typeof read!=="object")read={};}catch{} }
    profile = event.detail; wantedRevision=Math.max(wantedRevision,profile.newsRevision||0); indicators(); if(needsLoad())load(); schedule();
  });
  document.addEventListener("killex:boot-ready", () => {schedule();if(loadedRevision===null)load();});
  document.addEventListener("killex:news-changed", event => {wantedRevision=Math.max(wantedRevision,event.detail||0);if(needsLoad())load();});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)controller?.abort();else {if(dialog.open)render(pages[page]?.id);if(needsLoad())load();}});
  new MutationObserver(()=>{if(document.body.dataset.screen!=='lobby')controller?.abort();else if(needsLoad())load();}).observe(document.body,{attributes:true,attributeFilter:['data-screen']});
  document.addEventListener("close", event => {
    if (event.target === dialog && !dialog.open && displayedFor) {
      seen.add(displayedFor);
      try { localStorage.setItem(key(displayedFor), release.id); } catch (_) {}
      displayedFor = null;
    }
    if(event.target===dialog)controller?.abort();
    schedule();
  }, true);
  new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
})();

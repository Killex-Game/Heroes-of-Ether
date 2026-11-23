/* Постоянный альбом изображений событий. */
"use strict";
(() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const picture = (src, className) => {
    const img = el("img", className);
    img.src = window.KillexArtRevision.url(src);
    img.alt = "";
    img.draggable = false;
    img.decoding = "async";
    return img;
  };
  class EventAlbum {
    constructor(owner, back) {
      this.owner = owner;
      this.requests = new Map();
      this.dialog = el("dialog", "event-album-page");
      this.dialog.id = "eventAlbumDialog";
      this.dialog.dataset.layout = "fullscreen";
      this.dialog.setAttribute("aria-labelledby", "eventAlbumTitle");
      const header = el("header", "events-heading"),
        title = el("h1", "", "Альбом"),
        backButton = el("button", "sf-button sf-tertiary", "К событиям");
      title.id = "eventAlbumTitle";
      backButton.onclick = () => {
        this.dialog.close();
        back();
      };
      header.append(title, backButton);
      this.gallery = el("div", "event-album-gallery");
      this.notice = el("p", "event-album-notice");
      this.notice.setAttribute("role", "status");
      this.dialog.append(header, this.gallery, this.notice);
      this.viewer = el("dialog", "event-album-viewer");
      this.viewer.setAttribute("aria-labelledby", "eventAlbumArtTitle");
      this.fullImage = el("img", "event-album-picture");
      this.fullImage.alt = "";
      this.caption = el("h2", "");
      this.caption.id = "eventAlbumArtTitle";
      const close = el("button", "sf-button sf-tertiary", "К альбому");
      close.onclick = () => this.viewer.close();
      this.viewer.append(this.fullImage, this.caption, close);
      document.body.append(this.dialog, this.viewer);
      document.addEventListener("killex:profile", () => {
        if (this.dialog.open) this.render();
      });
    }
    open() {
      if (!this.owner.isLobby()) return;
      this.notice.textContent = "";
      this.render();
      window.KillexWindows.open(this.dialog);
      this.owner.loadProfile();
    }
    render() {
      const shelves = this.owner.getProfile()?.eventAlbum;
      const key = JSON.stringify([shelves, this.busy]);
      if (key === this.renderKey) return;
      this.renderKey = key;
      if (!shelves?.length) {
        this.gallery.replaceChildren(
          el(
            "p",
            "event-album-empty",
            shelves ? "В Альбоме пока нет событий с изображениями." : "",
          ),
        );
        return;
      }
      this.gallery.replaceChildren(...shelves.map((event) => this.eventCard(event)));
    }
    eventCard(event) {
      const card = el("article", "event-album-event"),
        cover = el("div", "event-album-cover"),
        body = el("div", "event-album-body"),
        grid = el("div", "event-album-artworks");
      const owned = event.items.filter((art) => art.owned).length;
      card.setAttribute("aria-label", `${event.title}: изображения ${owned} / ${event.items.length}`);
      cover.append(picture(event.banner + (event.banner.includes("?") ? "&" : "?") + "art=20261123-interface-art", ""));
      for (const art of event.items) {
        const tile = el("button", "event-album-tile");
        tile.type = "button";
        window.KillexControls.state(tile, !art.owned);
        const status = art.claimed
          ? "Награда получена"
          : art.owned
            ? "Награда доступна"
            : art.target > 1
              ? `${art.progress} / ${art.target} фрагментов`
              : "Ещё не получено";
        const frame = el("span", "event-album-art");
        frame.append(picture(art.image, ""));
        if (!art.owned) {
          const lock = el("span", "event-album-lock");
          lock.setAttribute("aria-hidden", "true");
          frame.append(lock);
        }
        tile.append(frame, el("strong", "", art.name), el("small", "", status));
        tile.onclick = () => {
          this.fullImage.src = window.KillexArtRevision.url(art.image);
          this.caption.textContent = art.name;
          this.viewer.showModal();
        };
        grid.append(tile);
      }
      const footer = el("footer", "event-album-footer"),
        info = el("span", "", `${event.rewardPerPicture} эфира за каждое изображение`),
        button = el("button", "sf-button sf-primary event-album-claim");
      button.type = "button";
      if (event.available) {
        button.append(
          `Забрать ${event.available}`,
          picture("assets/menu-icons/64/currency_bucks.webp?art=20261123-interface-art", ""),
        );
        button.setAttribute("aria-label", `Забрать ${event.available} эфира`);
      } else {
        button.textContent = owned ? "Награды получены" : "Получить награду";
      }
      window.KillexControls.state(button, !event.available || !!this.busy, !event.available);
      button.onclick = () => this.claim(event.id);
      footer.append(info, button);
      body.append(grid, footer);
      if (event.sendingGift) {
        const gift = event.sendingGift, unlocked = el("div", "event-album-gift");
        const info = el("div");
        info.append(el("strong", "", gift.name), el("p", "", gift.unlocked
          ? `Теперь ты можешь дарить этот подарок игрокам за ${gift.price} кристаллов. Право дарить останется навсегда.`
          : `${gift.unlockHint} После этого отправка подарка будет стоить ${gift.price} кристаллов.`));
        unlocked.append(picture(gift.icon, ""), info); body.append(unlocked);
      }
      card.append(cover, body);
      return card;
    }
    async claim(eventId) {
      if (this.busy || !this.owner.isLobby()) return;
      this.busy = eventId;
      this.notice.textContent = "";
      this.render();
      if (!this.requests.has(eventId)) this.requests.set(eventId, window.KillexRequestIds.create());
      try {
        const response = await fetch("/api/events/album/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ eventId, requestId: this.requests.get(eventId) }),
          signal: AbortSignal.timeout(8000),
        });
        const result = await response.json();
        if (!response.ok) {
          if (response.status < 500) this.requests.delete(eventId);
          throw Error(result.error || "Не удалось забрать награду.");
        }
        this.requests.delete(eventId);
        this.owner.updateProfile(result.profile);
        this.notice.textContent = "Эфир зачислен.";
      } catch (error) {
        this.notice.textContent = error.message;
        this.owner.loadProfile();
      } finally {
        this.busy = null;
        this.render();
      }
    }
  }
  window.KillexEventAlbum = EventAlbum;
})();

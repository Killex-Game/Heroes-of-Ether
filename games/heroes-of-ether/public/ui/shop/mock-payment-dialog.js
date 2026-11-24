/* Подтверждение тестовой покупки. Реальных платёжных запросов здесь нет. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  class MockPaymentDialog {
    constructor() {
      this.dialog = el("dialog", "clan-dialog mock-payment-dialog");
      this.dialog.id = "mockPaymentDialog";
      this.dialog.setAttribute("aria-labelledby", "mockPaymentTitle");
      this.dialog.setAttribute("aria-describedby", "mockPaymentNotice");
      const heading = el("header", "clan-heading");
      this.title = el("h2", "", "Подтверждение покупки");
      this.title.id = "mockPaymentTitle";
      this.closeButton = el("button", "booster-close", "×");
      this.closeButton.type = "button";
      this.closeButton.setAttribute("aria-label", "Закрыть покупку");
      this.closeButton.onclick = () => this.close();
      heading.append(this.title, this.closeButton);
      const body = el("div", "mock-payment-body");
      const badge = el("span", "mock-payment-badge", "Тестовая операция");
      const notice = el(
        "p",
        "mock-payment-notice",
        `Это симуляция оплаты. Настоящие деньги и голоса не списываются. На аккаунт доступно ${window.KillexVirtualProducts.mockDailyPurchaseLimit} покупок в сутки.`,
      );
      notice.id = "mockPaymentNotice";
      const product = el("div", "mock-payment-product");
      this.icon = el("img");
      this.icon.alt = "";
      const details = el("div");
      this.name = el("h3");
      this.description = el("p");
      details.append(this.name, this.description);
      product.append(this.icon, details);
      const receipt = el("dl", "mock-payment-receipt");
      this.recipient = el("dd");
      this.price = el("dd", "mock-payment-price");
      receipt.append(
        el("dt", "", "Получатель"),
        this.recipient,
        el("dt", "", "Стоимость"),
        this.price,
      );
      this.status = el("p", "mock-payment-status");
      this.status.setAttribute("role", "status");
      this.status.setAttribute("aria-live", "polite");
      const actions = el("div", "mock-payment-actions");
      this.cancelButton = el("button", "sf-button sf-secondary", "Отмена");
      this.cancelButton.type = "button";
      this.cancelButton.onclick = () => this.close();
      this.confirmButton = el("button", "sf-button", "Подтвердить");
      this.confirmButton.type = "button";
      this.confirmButton.onclick = () => this.confirm();
      actions.append(this.cancelButton, this.confirmButton);
      body.append(badge, notice, product, receipt, this.status, actions);
      this.dialog.append(heading, body);
      document.body.append(this.dialog);
      this.dialog.addEventListener("cancel", (event) => {
        if (this.pending) event.preventDefault();
      });
      this.dialog.addEventListener("close", () => {
        if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
      });
    }
    open(productId, owner) {
      const product = window.KillexVirtualProducts.get(productId);
      const profile = owner.getProfile();
      if (!product || !profile || owner.unavailable() || this.dialog.open) return;
      this.owner = owner;
      this.product = product;
      this.profileId = profile.id;
      const promotion = profile.blackFriday;
      this.currencyPromoRunId =
        product.type === "currency" &&
        promotion?.active &&
        promotion.endsAt > (window.KillexAppearance?.now?.() ?? Date.now())
          ? promotion.runId
          : null;
      this.eventId =
        product.type === "lite"
          ? profile.roulette?.lite?.eventId
          : product.type === "manya-coupon"
            ? profile.blackFriday?.runId
            : null;
      this.pending = false;
      this.complete = false;
      this.opener = document.activeElement;
      this.storageKey = `${window.KillexPlatform.storageKey(".")}mockPayment.${profile.id}.${product.id}`;
      if (this.eventId) this.storageKey += "." + this.eventId;
      if (product.type === "currency")
        this.storageKey += "." + (this.currencyPromoRunId || "regular");
      this.requestId = null;
      try {
        this.requestId = sessionStorage.getItem(this.storageKey);
      } catch (_) {}
      this.title.textContent = "Подтверждение покупки";
      this.dialog.dataset.state = "confirmation";
      this.icon.src = window.KillexArtRevision.url(product.icon);
      this.name.textContent = product.name;
      this.description.textContent =
        product.type === "currency"
          ? `${(product.amount * (this.currencyPromoRunId ? 2 : 1)).toLocaleString("ru-RU")} ${window.KillexVirtualProducts.currencies[product.currency].label}`
          : product.description;
      if (this.currencyPromoRunId)
        this.description.textContent += ` и ${product.votes * 10} жетонов Мани`;
      if (product.type === "lite")
        this.description.textContent += profile.roulette.lite.endsAt
          ? ". До " + new Date(profile.roulette.lite.endsAt).toLocaleString("ru-RU")
          : ". Срок действия: бессрочно";
      this.recipient.textContent = profile.name;
      this.price.textContent = `${product.votes} ${product.votes === 1 ? "голос" : "голосов"}`;
      this.status.textContent = this.requestId
        ? "Предыдущая операция не получила ответа. Проверь её результат - повторного начисления не будет."
        : "Товар будет начислен только после подтверждения.";
      this.cancelButton.hidden = false;
      this.cancelButton.textContent = this.requestId ? "Закрыть" : "Отмена";
      this.confirmButton.textContent = this.requestId ? "Проверить операцию" : "Подтвердить";
      this.setPending(false);
      window.KillexWindows.open(this.dialog);
      this.confirmButton.focus();
    }
    setPending(pending) {
      this.pending = pending;
      this.dialog.setAttribute("aria-busy", String(pending));
      window.KillexControls.state(
        this.closeButton,
        window.KillexControls.state(
          this.cancelButton,
          window.KillexControls.state(this.confirmButton, pending, false),
          false,
        ),
        false,
      );
    }
    close() {
      if (!this.pending) this.dialog.close();
    }
    async confirm() {
      if (this.complete) return this.close();
      if (this.pending) return;
      if (this.owner.unavailable() || this.owner.getProfile()?.id !== this.profileId) {
        this.status.textContent = "Вернись в лобби своего профиля, чтобы подтвердить покупку.";
        return;
      }
      this.setPending(true);
      this.status.textContent = "";
      // The existing action label stays stable while the button is disabled.
      try {
        this.requestId ||= window.KillexRequestIds.create();
        // Повтор после потери ответа или перезагрузки использует тот же номер.
        try {
          sessionStorage.setItem(this.storageKey, this.requestId);
        } catch (_) {}
        const response = await fetch("/api/mock-payments/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: this.product.id,
            requestId: this.requestId,
            confirmed: true,
            ...(this.eventId ? { eventId: this.eventId } : {}),
            ...(this.product.type === "currency"
              ? { currencyPromoRunId: this.currencyPromoRunId }
              : {}),
          }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await response.json();
        if (!response.ok && data.code === "MOCK_DAILY_LIMIT") {
          this.complete = true;
          this.dialog.dataset.state = "limit";
          this.status.textContent = data.error + (Number.isSafeInteger(data.nextPurchaseAt)
            ? " Новые покупки доступны " + new Date(data.nextPurchaseAt).toLocaleString("ru-RU") + "." : "");
          this.confirmButton.textContent = "Понятно";
          this.cancelButton.hidden = true;
          try { sessionStorage.removeItem(this.storageKey); } catch (_) {}
          return;
        }
        if (!response.ok) throw Error(data.error || "Сервер не подтвердил операцию.");
        if (data.payment?.status !== "confirmed" || data.payment.requestId !== this.requestId)
          throw Error("Не удалось проверить подтверждение сервера.");
        this.owner.updateProfile(data.profile);
        try {
          sessionStorage.removeItem(this.storageKey);
        } catch (_) {}
        this.complete = true;
        this.dialog.dataset.state = "success";
        this.title.textContent = "Покупка подтверждена";
        this.status.textContent =
          this.product.type === "manya-coupon"
            ? "Купон активирован. 500 жетонов зачислены, сундук добавлен в Сокровищницу или её очередь."
            : this.product.type === "lite"
              ? "Lite активирован. 50 билетов уже зачислены. Покупка билетов и быстрая прокрутка доступны в колесе удачи."
              : this.product.type === "promotion"
                ? "Валюта зачислена на баланс, все бустеры добавлены в инвентарь."
                : this.product.type === "currency"
                  ? `${this.description.textContent} зачислено на баланс.`
                  : `${this.product.name}: добавлено ${this.product.days} дней. Аватары доступны в разделе «Скины» → «Наборы».`;
        this.cancelButton.hidden = true;
        this.confirmButton.textContent = "Готово";
        if (this.product.type === "currency" && data.reward && this.owner.showReward) {
          this.dialog.close();
          this.owner.showReward(data.reward, this.product);
        }
      } catch (error) {
        this.dialog.dataset.state = "error";
        this.status.textContent = `${
          error.name === "TimeoutError" || error instanceof TypeError
            ? "Нет ответа от сервера."
            : error.message
        } Проверь эту операцию повторно; товар не начислится дважды.`;
        this.confirmButton.textContent = "Проверить операцию";
        this.cancelButton.textContent = "Закрыть";
      } finally {
        this.setPending(false);
      }
    }
  }
  let dialog;
  window.KillexMockPayments = Object.freeze({
    open(productId, owner) {
      (dialog ||= new MockPaymentDialog()).open(productId, owner);
    },
  });
})();

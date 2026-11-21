"use strict";
(() => {
  const $ = (id) => document.getElementById(id);
  const words = {
    coins: "Монеты",
    crystals: "Кристаллы",
    bucks: "Эфир",
    vipUntil: "VIP",
    premiumUntil: "Premium",
  };
  const fmt = (n) => n.toLocaleString("ru-RU");
  const date = (at) => (at ? new Date(at).toLocaleString("ru-RU") : "Не активен");
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  class TransactionJournal {
    constructor({ api, fail }) {
      this.api = api;
      this.fail = fail;
      this.serial = 0;
      this.page = 1;
      $("transactionFilter").onchange = () => {
        this.page = 1;
        this.load().catch(fail);
      };
      $("refreshTransactions").onclick = () => this.load().catch(fail);
      for (const [id, step] of [
        ["prevTransactions", -1],
        ["nextTransactions", 1],
      ])
        $(id).onclick = () => {
          this.page += step;
          this.load().catch(fail);
        };
    }
    clear() {
      this.serial++;
      this.player = null;
      $("transactionsPanel").hidden = true;
      $("transactions").replaceChildren();
      $("transactionOpening").replaceChildren();
      $("transactionHint").textContent = "";
    }
    select(player) {
      const changed = this.player?.id !== player.id;
      this.player = player;
      this.page = 1;
      if (changed) $("transactionFilter").value = "all";
      $("transactions").replaceChildren();
      $("transactionsPanel").hidden = false;
      return this.load();
    }
    selectAll() {
      $("economySelected").textContent = "Транзакции всех игроков";
      $("economyWallet").hidden = true;
      return this.select({ id: "all", name: "Все игроки" });
    }
    async load() {
      if (!this.player) return;
      const serial = ++this.serial,
        player = this.player;
      for (const id of ["prevTransactions", "nextTransactions", "refreshTransactions"])
        window.KillexControls.state($(id), true, false);
      $("transactionHint").textContent = "";
      try {
        const value = await this.api(
          "transactions?targetId=" +
            encodeURIComponent(player.id) +
            "&page=" +
            this.page +
            "&filter=" +
            $("transactionFilter").value,
        );
        if (serial !== this.serial) return;
        this.page = value.page;
        $("transactionHint").textContent =
          `${player.id === "all" ? "Все игроки" : "Игрок: " + player.name}. Записей: ${fmt(value.total)}. ${value.startedAt ? "История ведётся с " + date(value.startedAt) + ". Более ранние операции не записывались." : "Сохранённых операций пока нет."}`;
        $("transactionOpening").replaceChildren();
        $("transactionOpening").closest("details").hidden = !value.opening;
        if (value.opening)
          for (const [key, label] of Object.entries(words))
            $("transactionOpening").append(
              node(
                "span",
                `${label}: ${key.endsWith("Until") ? date(value.opening[key]) : fmt(value.opening[key])}`,
              ),
            );
        $("transactions").replaceChildren();
        for (const e of value.entries) {
          const entry = node("article", "", "audit-entry transaction-entry"),
            heading = node("div", "", "section-title");
          heading.append(node("strong", e.label), node("time", date(e.at)));
          entry.append(heading);
          if (player.id === "all") entry.append(node("p", "Игрок: " + e.playerName + (e.testBot ? " (тестовый бот)" : "")));
          if (e.detail) entry.append(node("p", e.detail, "muted identifier"));
          if (e.payment)
            entry.append(
              node(
                "p",
                `Тестовая оплата: ${fmt(e.payment.votes)} голосов. Подтверждена в симуляции, реальные средства не списывались.`,
                "transaction-payment",
              ),
            );
          const changes = node("div", "", "transaction-changes");
          for (const [key, label] of Object.entries(words)) {
            const before = e.before[key],
              after = e.after[key];
            if (before === after) continue;
            const account = key.endsWith("Until"),
              amount = after - before;
            const change = node("div", "", "transaction-change");
            change.append(
              node("span", label),
              node(
                "strong",
                account
                  ? after
                    ? "Срок изменён"
                    : "Отключён"
                  : (amount > 0 ? "+" : "") + fmt(amount),
                amount > 0 ? "transaction-credit" : "transaction-debit",
              ),
              node(
                "small",
                account ? `${date(before)} → ${date(after)}` : `${fmt(before)} → ${fmt(after)}`,
              ),
            );
            changes.append(change);
          }
          entry.append(changes);
          const details = document.createElement("details");
          details.append(
            node("summary", "Данные операции"),
            node("p", "Запись: " + e.id, "muted identifier"),
          );
          if (e.requestId) details.append(node("p", "Запрос: " + e.requestId, "muted identifier"));
          if (e.actorId) details.append(node("p", "Инициатор: " + e.actorId, "muted identifier"));
          if (e.payment)
            details.append(node("p", "Продукт: " + e.payment.productId, "muted identifier"));
          entry.append(details);
          $("transactions").append(entry);
        }
        if (!value.entries.length)
          $("transactions").append(
            node("p", "По выбранному фильтру транзакций пока нет.", "muted"),
          );
        $("transactionsPage").textContent = `${value.page} / ${value.pages}`;
        window.KillexControls.state($("prevTransactions"), value.page <= 1);
        window.KillexControls.state($("nextTransactions"), value.page >= value.pages);
      } catch (error) {
        if (serial !== this.serial) return;
        $("transactions").replaceChildren();
        $("transactionHint").textContent =
          "Не удалось загрузить транзакции. Нажми «Обновить журнал».";
        throw error;
      } finally {
        if (serial === this.serial) window.KillexControls.state($("refreshTransactions"), false);
      }
    }
  }
  window.KillexTransactionJournal = TransactionJournal;
})();

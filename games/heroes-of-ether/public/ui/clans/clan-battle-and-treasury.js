/* Битва, таймер, шкала счёта, награды и Сокровищница. */
"use strict";
(() => {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const num = (n) => Number(n || 0).toLocaleString("ru-RU"),
    date = (n) =>
      new Date(n).toLocaleString(undefined, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
  const rules = window.KillexClanRules;
  const button = (text, fn) => {
    const b = el("button", "sf-button sf-tertiary", text);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  const art = (src, cls) => {
    const img = el("img", cls);
    img.src = window.KillexArtRevision.url(src);
    img.alt = "";
    return img;
  };
  const leagueArt = (id) => window.KillexProgressionArt.league(id, 128);
  const attachChestHint = (node, tier, profile, reward) => {
    const tooltip = window.KillexBoosterTooltip;
    if (!tooltip) return;
    if (tier === "fixed") {
      const fixed = reward || rules.BATTLE_WINNER_FIXED_REWARD;
      tooltip.attach(node, {
        name: "Фиксированная награда",
        usage:
          `Монеты: ${num(fixed.coins)}\nКристаллы: ${num(fixed.crystals)}` +
          (fixed.greatness ? `\nВеличие: ${num(fixed.greatness)}` : ""),
      });
      return;
    }
    const spec = rules.CHESTS[tier];
    if (!spec) return;
    const vip = (profile?.account?.vipUntil || 0) > Date.now(),
      premium = (profile?.account?.premiumUntil || 0) > Date.now(),
      multiplier = reward?.multiplier ?? (vip ? 2 : 1),
      bonus = reward?.greatnessBonus ?? (vip ? 5 : 0) + (premium ? 10 : 0),
      amount = (currency) =>
        reward ? num(reward[currency]) : spec[currency].map((n) => num(n * multiplier)).join("–"),
      boosters = reward
        ? Object.values(reward.items).reduce((total, count) => total + count, 0)
        : spec.boosters * multiplier;
    const lines = [
      "Монеты: " + amount("coins"),
      "Кристаллы: " + amount("crystals"),
      "Бустеры: " + num(boosters),
    ];
    for (const [rarity, label] of [
      ["common", "Обычные"],
      ["advanced", "Улучшенные"],
      ["rare", "Редкие"],
      ["clan", "Клановые"],
    ]) {
      const share = spec.rarityShares[rarity];
      if (share) lines.push(label + ": " + num((boosters * share) / 100) + " (" + share + "%)");
    }
    lines.push(
      "Величие: " +
        num(reward?.greatness ?? spec.greatness + bonus) +
        (bonus ? " (" + spec.greatness + " + " + bonus + " за статусы)" : ""),
    );
    if (multiplier > 1)
      lines.push("Бонусы статусов ×" + multiplier + " уже учтены в валютах и бустерах.");
    tooltip.attach(node, { name: spec.name, usage: lines.join("\n") });
  };
  class ClanBattleUI {
    static previewTier(state, playerId, at = Date.now()) {
      const battle = state?.battle,
        personal = state?.personal?.[playerId];
      if (
        !battle ||
        at < battle.start ||
        at >= battle.end ||
        !(personal?.kills > 0) ||
        !personal.reward
      )
        return null;
      return battle.own > battle.enemy ? personal.reward : "fixed";
    }
    constructor(owner) {
      this.owner = owner;
      if (owner.readOnly) return;
      this.dialog = el("dialog", "clan-season-guide");
      this.dialog.id = "leagueInfoDialog";
      document.body.append(this.dialog);
      window.KillexActivity.every(() => {
        if (this.owner.dialog?.open && !document.hidden && window.KillexWindows.top() === this.owner.dialog) this.updateCountdown();
      }, 1000, () => this.owner.dialog?.open);
    }
    updateCountdown() {
      window.KillexClanDailyQuests?.updateCountdown(this.owner.dialog);
      if (!this.countdown) return;
      const now = Date.now(),
        b = this.timerBattle,
        active = b && now >= b.start && now < b.end,
        ended = b && now >= b.end;
      if (this.resultStage && now >= this.resultPreparationAt) {
        this.resultStage.replaceChildren(el("div", "clan-no-opponent", "Битва готовится"));
        this.resultStage = null;
      }
      const target = active ? b.end : this.nextBattleAt;
      const seconds = Math.max(0, Math.ceil((target - now) / 1000));
      const time = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
        .map((n) => String(n).padStart(2, "0"))
        .join(":");
      if (ended || (!active && !seconds))
        this.countdown.textContent = ended ? "Битва завершена" : "Битва начинается";
      else
        this.countdown.replaceChildren(
          document.createTextNode(active ? "До конца битвы: " : "Следующая битва через "),
          el("b", "clan-countdown-value", time),
        );
      this.countdown.title = (active ? "Завершение: " : "Начало: ") + date(target);
    }
    battle(state, clan) {
      this.resultStage = null;
      const root = el("section", "clan-battle-panel clan-panel");
      const heading = el("div", "clan-battle-heading");
      heading.append(
        el("h3", "", "Клановая битва"),
        el("span", "clan-win-count", "Побед: " + num(state.wins)),
      );
      this.countdown = null;
      if (Number.isFinite(state.nextBattleAt)) {
        this.nextBattleAt = state.nextBattleAt;
        this.timerBattle = state.battle;
        this.countdown = el("div", "clan-battle-countdown");
        this.countdown.setAttribute("role", "timer");
        this.countdown.title = "Начало: " + date(state.nextBattleAt);
        this.updateCountdown();
        const timerRow = el("div", "clan-battle-timer-row");
        timerRow.append(this.countdown);
        heading.append(timerRow);
      }
      root.append(heading);
      const b = state.battle;
      const stage = el("div", "clan-battle-stage");
      root.append(stage);
      if (!b && state.lastBattle) {
        // Keep the finished match visible until two hours before the next battle.
        this.resultPreparationAt = state.nextBattleAt - 2 * 60 * 60 * 1000;
        if (!Number.isFinite(this.resultPreparationAt) || Date.now() < this.resultPreparationAt) {
          stage.append(this.battleResult(state.lastBattle, clan));
          this.resultStage = stage;
        } else stage.append(el("div", "clan-no-opponent", "Битва готовится"));
      } else if (!state.group) {
        stage.append(
          el("div", "clan-no-opponent", "К сожалению для вас соперников не нашлось"),
          el(
            "p",
            "clan-muted",
            "Подбор начинается от 10 кланов одной лиги. Группы всегда чётные - до 16 кланов.",
          ),
        );
      } else if (!b) {
        stage.append(el("div", "clan-no-opponent", "Битва готовится"));
      } else {
        const versus = el("div", "clan-versus");
        for (const [c, count, label] of [
          [clan, b.own, this.owner.readOnly ? "Клан" : "Твой клан"],
          [b.opponent, b.enemy, "Соперник"],
        ]) {
          const team = el("div", "clan-battle-team");
          const crest = art("", "clan-crest");
          window.KillexClanCrests.paintImage(crest, c.crest, c.emblem);
          team.append(
            el("small", "", label),
            crest,
            el(
              "strong",
              c.frame === "champion" ? "clan-champion-name" : "",
              "[" + c.prefix + "] " + c.name,
            ),
            el("b", "clan-battle-score", num(count)),
          );
          versus.append(team);
          window.KillexClanPreview.link(team, c, (id) => this.owner.openClan(id));
        }
        const bar = el("div", "clan-battle-bar"),
          own = el("span"),
          enemy = el("span");
        const total = b.own + b.enemy;
        bar.style.setProperty("--flow-phase", -performance.now() / 1000 + "s");
        own.style.flex = String(total ? b.own / total : 0.5);
        enemy.style.flex = String(total ? b.enemy / total : 0.5);
        bar.append(own, enemy);
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", "Счёт " + num(b.own) + " : " + num(b.enemy));
        bar.title = "Побеждает клан, набравший больше киллов";
        stage.append(versus, bar);
        if (!this.owner.readOnly) {
          const play = button("В бой!", () => {
            this.owner.dialog.close();
            document.getElementById("playButton").click();
          });
          play.className = "sf-button clan-battle-play";
          stage.append(play);
        }
      }
      if (this.owner.readOnly) return root;
      const prizes = el("div", "clan-battle-prizes");
      for (const [tier, percent] of [
        ["high", 30],
        ["medium", 30],
        ["low", 30],
        ["fixed", 10],
      ]) {
        const prize = el("div", "clan-battle-prize");
        prize.dataset.reward = tier;
        const spec = rules.CHESTS[tier];
        prize.append(
          art(
            spec
              ? window.KillexProgressionArt.clanChest(tier)
              : "assets/menu-icons/128/currency_coins.webp?art=20261123-interface-art",
            "clan-prize-art",
          ),
          el("b", "", percent + "%"),
          el(
            "small",
            "",
            spec ? { high: "Высшая", medium: "Средняя", low: "Малая" }[tier] : "Фикс.",
          ),
        );
        attachChestHint(prize, tier, this.owner.data?.profile);
        prizes.append(prize);
      }
      const rewards = el("section", "clan-battle-distribution"),
        label = el("h4", "", "Награды победившего клана");
      label.title =
        "Участвуют игроки с хотя бы одним зачтённым киллом, кроме новобранцев. Высшие, средние и малые сундуки получают по 30% участников, фиксированную награду - 10%. Доли округляются вниз, оставшиеся места отдаются категориям с наибольшей дробной частью; при равенстве - более ценной награде. Выше в списке - больше киллов. При равенстве выше тот, кто раньше вступил в клан; при одновременном вступлении порядок постоянный.";
      rewards.append(label, prizes);
      root.append(el('p','clan-muted','Киллы арены засчитываются после выхода в лобби. Успей выйти до окончания битвы: более поздний выход не засчитывает накопленные киллы.'), rewards, this.personalReward(state, clan));
      return root;
    }
    battleResult(result, clan) {
      const root = el("div", "clan-battle-result"),
        outcome = result.draw ? "draw" : result.won ? "win" : "loss",
        labels = { win: "Победа!", loss: "Поражение", draw: "Ничья" };
      root.dataset.outcome = outcome;
      root.setAttribute("aria-label", "Итог клановой битвы");
      root.style.setProperty("--result-glow-phase", -performance.now() / 1000 + "s");
      const team = (value, status) => {
        const node = el("div", "clan-result-team");
        node.dataset.outcome = status;
        if (value) {
          const crest = art("", "clan-result-crest");
          const emblem = el("span", "clan-result-emblem");
          crest.alt = "Герб клана «" + value.name + "»";
          window.KillexClanCrests.paintImage(crest, value.crest, value.emblem);
          emblem.append(crest);
          node.append(
            emblem,
            el(
              "strong",
              value.frame === "champion" ? "clan-champion-name" : "",
              "[" + value.prefix + "] " + value.name,
            ),
          );
          window.KillexClanPreview.link(node, value, (id) => this.owner.openClan(id));
        } else node.append(el("strong", "", "Соперник"));
        node.append(
          el(
            "span",
            "clan-result-status",
            {
              win: "Победитель",
              loss: "Проигравший",
              draw: "Ничья",
            }[status],
          ),
        );
        return node;
      };
      const summary = el("div", "clan-result-summary"),
        score = el("div", "clan-result-score");
      const ownScore = num(result.own),
        enemyScore = num(result.enemy);
      // Reserve room for every digit, grouping space, colon and gap without shortening the score.
      const scoreText = ownScore + enemyScore;
      const digits = scoreText.replace(/\s/g, "").length;
      const spaces = scoreText.length - digits;
      score.style.setProperty("--score-units", String(digits * 0.72 + spaces * 0.35 + 1));
      score.setAttribute("aria-label", "Счёт " + ownScore + " : " + enemyScore);
      score.append(
        el("span", "", ownScore),
        el("span", "clan-result-separator", ":"),
        el("span", "", enemyScore),
      );
      summary.append(el("strong", "clan-result-label", labels[outcome]), score);
      root.append(
        team(clan, outcome),
        summary,
        team(result.opponent, result.draw ? "draw" : result.won ? "loss" : "win"),
      );
      return root;
    }
    personalReward(state, clan) {
      const root = el("section", "clan-personal-reward"),
        profile = this.owner.data?.profile,
        inventory = profile?.clanChests;
      const personal = state.personal?.[profile?.id],
        last = inventory?.battleReward?.clanId === clan.id ? inventory.battleReward : null;
      const item = inventory?.items
        .filter(
          (c) =>
            !c.stored &&
            c.expiresAt > Date.now() &&
            (c.sourceClanId === clan.id || c.id === last?.chestId),
        )
        .sort((a, b) => a.earnedAt - b.earnedAt)[0];
      const active =
        state.battle && Date.now() >= state.battle.start && Date.now() < state.battle.end;
      const previewTier = ClanBattleUI.previewTier(state, profile?.id);
      let tier = null,
        status = "empty",
        label = "Твоя награда",
        note = "Участвуй в битве, чтобы получить награду";
      if (item) {
        tier = item.tier;
        status = "available";
        label = "Награда за битву";
        note =
          (item.receivedAt === null ? "Получи до " : "Ожидает места до ") + date(item.expiresAt);
      } else if (previewTier) {
        tier = previewTier;
        status = "preview";
        label = "Предварительная награда";
        note = "";
      } else if (!active && last && last.endedAt === state.lastBattle?.endedAt) {
        tier = last.tier;
        status = last.status;
        label = "Награда за битву";
        if (
          status === "available" &&
          inventory.items.some((c) => c.id === last.chestId && c.stored)
        )
          status = "stored";
        note =
          status === "credited"
            ? "Уже начислено на баланс"
            : status === "stored"
              ? "Сундук в Сокровищнице"
              : status === "opened"
                ? "Награда получена"
                : "Срок ожидания сундука истёк";
      } else if (personal?.recruitUntil > Date.now()) note = "Участие со следующей битвы";
      else if (active) note = "Нужен хотя бы один зачтённый килл";
      root.dataset.state = status;
      if (tier) root.dataset.reward = tier;
      root.setAttribute("aria-label", "Твоя награда за клановую битву");
      const spec = rules.CHESTS[tier],
        visual = tier
          ? art(
              spec
                ? window.KillexProgressionArt.clanChest(tier)
                : "assets/menu-icons/128/currency_coins.webp?art=20261123-interface-art",
              "clan-personal-reward-art",
            )
          : el("span", "clan-personal-reward-placeholder", "?");
      const copy = el("div", "clan-personal-reward-copy");
      copy.append(el("small", "clan-personal-reward-label", label));
      copy.append(
        el(
          "strong",
          "",
          spec
            ? { high: "Высший сундук", medium: "Средний сундук", low: "Малый сундук" }[tier]
            : tier === "fixed"
              ? "Фиксированная награда"
              : "Награда ещё не определена",
        ),
      );
      // Keep the actual composition of a settled reward; older awards included greatness.
      const fixedReward =
        status === "preview"
          ? rules.battleFixedReward(state.battle.own > state.battle.enemy)
          : last?.fixedReward || rules.BATTLE_WINNER_FIXED_REWARD;
      if (tier === "fixed") {
        const amounts = el("div", "clan-personal-reward-currencies");
        for (const [id, name] of [
          ["coins", "монет"],
          ["crystals", "кристаллов"],
          ["greatness", "величие"],
        ]) {
          const amount = el("span"),
            value = fixedReward[id];
          if (!value) continue;
          amount.setAttribute("aria-label", value + " " + name);
          amount.append(
            id === "greatness"
              ? window.KillexGreatnessUI.icon(20)
              : art("assets/menu-icons/64/currency_" + id + ".webp", ""),
            el("b", "", num(value)),
          );
          amounts.append(amount);
        }
        copy.append(amounts);
      }
      if (note) copy.append(el("small", "clan-personal-reward-note", note));
      root.append(visual, copy);
      attachChestHint(
        root,
        tier,
        profile,
        tier === "fixed"
          ? fixedReward
          : item?.reward || inventory?.items.find((c) => c.id === last?.chestId)?.reward,
      );
      if (item) {
        const claim = button(item.receivedAt === null ? "Получить" : "В Сокровищницу", () => {
          if (item.receivedAt === null) {
            this.owner.claimBattleChest(item.id);
            return;
          }
          this.owner.dialog?.close();
          document.dispatchEvent(
            new CustomEvent("killex:open-chests", {
              detail: { category: "treasury" },
            }),
          );
        });
        claim.className = "sf-button clan-personal-reward-claim";
        // The server moves queued chests automatically when space is available.
        copy.append(claim);
        const row = el("div", "clan-personal-reward-row");
        row.append(root);
        return row;
      }
      return root;
    }
    leagues(state, clan) {
      const root = el("aside", "clan-league-panel clan-panel"),
        head = el("div", "clan-league-heading");
      head.append(
        art(leagueArt(state.league.id), "clan-league-art"),
        el("h3", "", "Топ лиги"),
        el("strong", "", state.league.name),
      );
      const steps = el("ol", "clan-league-steps");
      steps.setAttribute("aria-label", "Ступени клановых лиг");
      const peak = Math.max(
        state.league.index,
        state.seasonPeak ?? 0,
        ...(state.trophies || []).map((trophy) => trophy.league),
      );
      for (const league of window.KillexClanRules.LEAGUES) {
        const step = el("li", "clan-league-step");
        step.dataset.state =
          league.index === state.league.index
            ? "current"
            : league.index < peak
              ? "previous"
              : "next";
        if (step.dataset.state === "current") {
          step.setAttribute("aria-current", "step");
          const glow = el("span", "clan-league-glow");
          glow.setAttribute("aria-hidden", "true");
          for (let i = 0; i < 13; i++) {
            const ray = i < 5;
            const particle = el("i", ray ? "clan-league-ray" : "clan-league-spark");
            const duration = ray ? 2.8 + i * 0.37 : 1.7 + (i % 4) * 0.31;
            particle.style.setProperty("--x", (ray ? 14 + i * 18 : 9 + ((i * 31) % 83)) + "%");
            particle.style.setProperty("--duration", duration + "s");
            particle.style.setProperty(
              "--phase",
              -((performance.now() / 1000 + i * 0.53) % duration) + "s",
            );
            glow.append(particle);
          }
          step.append(glow);
        }
        step.title =
          league.name +
          (step.dataset.state === "current"
            ? " - текущая лига"
            : step.dataset.state === "previous"
              ? " - пройдена"
              : "");
        const image = art(leagueArt(league.id), "clan-league-step-art");
        image.alt = step.title;
        step.append(image);
        steps.append(step);
      }
      root.append(
        head,
        steps,
        button("О лигах", () => this.info()),
        el("p", "clan-muted", "Итоги недели: " + date(state.week.end)),
      );
      if (!state.group) {
        root.append(el("p", "clan-no-opponent", "К сожалению для вас соперников не нашлось"));
        return root;
      }
      const z = state.group.zones;
      const rows = el("ol", "clan-league-table");
      const zones = [
        {
          id: "promote",
          first: 1,
          last: z.promote,
          label: state.league.index === 5 ? "Победитель лиги" : "Проходят в следующую лигу",
        },
        { id: "stay", first: z.promote + 1, last: z.promote + z.stay, label: "Остаются в лиге" },
        {
          id: "demote",
          first: z.promote + z.stay + 1,
          last: z.promote + z.stay + z.demote,
          label: "Выбывают",
        },
      ];
      let previousZone;
      for (const row of state.group.rows) {
        const zone = zones.find((zone) => row.place >= zone.first && row.place <= zone.last);
        if (zone && zone.id !== previousZone) {
          const heading = el("li", "clan-league-zone-heading");
          heading.dataset.zone = zone.id;
          heading.setAttribute("role", "presentation");
          const range =
            zone.first === zone.last
              ? zone.first + " место"
              : zone.first + "–" + zone.last + " места";
          heading.append(el("strong", "", zone.label), el("span", "", range));
          if (zone.id === "promote")
            heading.append(el("small", "", "При " + num(state.league.threshold) + " киллах"));
          if (zone.id === "demote" && state.league.index === 0)
            heading.append(el("small", "", "Без награды. Ниже Бронзовой лиги понижения нет"));
          rows.append(heading);
          previousZone = zone.id;
        }
        const li = el("li", "clan-league-row");
        li.dataset.outcome = row.outcome;
        li.dataset.zone = zone?.id || "stay";
        li.dataset.mine = String(row.id === clan.id);
        li.dataset.promotion = String(row.place <= z.promote);
        if (row.place <= z.promote)
          li.title =
            (state.league.index === 5 ? "Победное место" : "Место повышения") +
            " - нужно " +
            num(state.league.threshold) +
            " киллов";
        const name = el(
          "span",
          row.frame === "champion" ? "clan-champion-name" : "",
          "[" + row.prefix + "] " + row.name,
        );
        const crest = art("", "clan-league-crest");
        window.KillexClanCrests.paintImage(crest, row.crest, row.emblem);
        li.append(el("b", "", row.place), crest, name, el("strong", "", num(row.kills)));
        window.KillexClanPreview.link(li, row, (id) => this.owner.openClan(id));
        rows.append(li);
      }
      root.append(rows);
      return root;
    }
    info() {
      const head=el('header','clan-heading'),close=button('×',()=>this.dialog.close());
      close.className='booster-close';close.setAttribute('aria-label','Закрыть описание лиг');
      head.append(el('h2','','О клановых лигах'),close);
      const summary=el('div','clan-guide-summary');
      const time=window.KillexClanCalendar.localRange(window.KillexAppearance?.now?.()??Date.now()).replace('–',' - ');
      for(const text of [
        'Сезон длится 2 месяца. Битвы: январь-февраль, май-июнь, сентябрь-октябрь. Между ними идут клановые задания',
        'Битвы ежедневно '+time+' по местному времени. Медали выдаются по итогам недели в понедельник, кубок в конце сезона',
        'При поражении каждый участник клана теряет '+rules.BATTLE_LOSS_GREATNESS+' величия, включая не участвовавших в битве, но не ниже нуля. При ничьей списания нет',
        'Призовое место даёт медаль и награду даже без порога киллов. Порог нужен для повышения. Личный приз требует хотя бы 1 килл за неделю и членства в клане на момент итогов',
        'Повышение и сохранение места: в первых трёх лигах 3 повышаются, 8 остаются и 5 понижаются при группе из 16. В Платиновой и Бриллиантовой 2 повышаются, 7 остаются; в Чемпионской 1 победитель и ещё 3 остаются',
        'Медаль открывает оформление на 30 дней; Чемпионское навсегда. Остальным оставшимся: 100 монет, 100 кристаллов, 1 эфир, 2 величия. Выбывающим наград нет. Ниже Бронзовой лиги понижения нет. Новобранец во время битвы участвует со следующего дня'
      ])summary.append(el('p','',text));
      const list=el('div','clan-league-guide');
      for(const league of rules.LEAGUES){
        const row=el('article','clan-league-guide-row'),copy=el('div','clan-prize-copy'),r=league.reward;
        row.dataset.tier=league.id;
        copy.append(el('strong','',league.name),el('small','','Порог '+num(league.threshold)+' киллов'));
        const amounts=el('div','clan-prize-amounts');
        for(const [key,name] of [['coins','монет'],['crystals','кристаллов'],['bucks','эфира'],['greatness','величия']]){
          const amount=el('span'),icon=key==='greatness'?window.KillexGreatnessUI.icon(17):art('assets/menu-icons/128/currency_'+key+'.webp','');
          amount.setAttribute('aria-label',num(r[key])+' '+name);amount.title=num(r[key])+' '+name;amount.append(icon,el('span','',num(r[key])));amounts.append(amount);
        }
        copy.append(amounts);
        row.append(art(leagueArt(league.id),'clan-league-art'),copy);list.append(row);
      }
      window.KillexClanDailyQuests.guide(this.dialog,head,summary,list);
    }
  }
  class ClanChestInventory {
    constructor(owner) {
      this.owner = owner;
      this.root = el("section", "clan-chest-inventory");
      this.seen = new Set();
      this.noticeRequests = new Map();
      this.noticeProfile = null;
      this.toast = el("div", "clan-reward-toast");
      this.toast.setAttribute("popover", "manual");
      this.toast.setAttribute("role", "status");
      this.toast.setAttribute("aria-label", "Клановые награды");
      document.body.append(this.toast);
      this.resultDialog = el("dialog", "title-earned-dialog clan-result-dialog");
      this.resultDialog.id = "clanResultDialog";
      this.resultDialog.setAttribute("aria-labelledby", "clanResultHeading");
      document.body.append(this.resultDialog);
      document.addEventListener("killex:arena-profile", () => {
        if (this.resultDialog.open) this.resultDialog.close();
      });
      document.addEventListener("killex:profile", (e) => this.notify(e.detail));
      document.addEventListener(
        "close",
        () => {
          if (this.queuedNoticeProfile) this.notify(this.queuedNoticeProfile);
        },
        true,
      );
    }
    notify(profile) {
      if (this.noticeProfile && this.noticeProfile !== profile.id && this.resultDialog.open)
        this.resultDialog.close();
      if (this.noticeProfile && this.noticeProfile !== profile.id) this.toast.hidePopover();
      this.noticeProfile = profile.id;
      this.queuedNoticeProfile = profile;
      // Уведомление вне модального окна недоступно для нажатия: дождаться его закрытия.
      if (this.owner.game.isArena() || document.querySelector("dialog[open]")) {
        if (this.toast.childElementCount) {
          this.toast.hidePopover();
          this.toast.replaceChildren();
        }
        return;
      }
      // Локальная отметка закрывает обновление страницы между показом и ответом сервера.
      const pending = profile.quests?.pending || [];
      const groups = { quest: pending, clan: profile.clanChests?.notices || [] };
      const remembered = {};
      for (const [kind, rewards] of Object.entries(groups)) {
        const storageKey = `${window.KillexPlatform.storageKey(":")}${kind}-notices:${profile.id}`;
        let localSeen = [];
        try {
          const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
          if (Array.isArray(saved)) localSeen = saved.filter((id) => typeof id === "string");
        } catch (_) {}
        const ids = new Set(localSeen.filter((id) => rewards.some((r) => r.id === id)));
        remembered[kind] = { storageKey, ids };
        for (const reward of rewards)
          if (reward.notifiedAt !== undefined || ids.has(reward.id))
            this.seen.add(`${profile.id}:${kind}:${reward.id}`);
      }
      const notices = [
          ...(profile.clanChests?.notices || []).map((n) => ({
            ...n,
            noticeKey: `${profile.id}:clan:${n.id}`,
          })),
          ...pending.map((reward) => ({
            id: reward.id,
            noticeKey: `${profile.id}:quest:${reward.id}`,
            kind: "quest",
            at: reward.earnedAt,
            title: reward.chest.name,
            text: `За задание «${reward.title}». ${reward.receivedAt === null ? "Нажми «Получить» в заданиях или Сокровищнице." : reward.stored === false ? "Сундук ожидает места в Сокровищнице." : "Сундук уже добавлен в Сокровищницу."}`,
          })),
        ],
        fresh = notices.filter((n) => !this.seen.has(n.noticeKey));
      if (this.toast.matches(":popover-open")) {
        const current = new Map(notices.map((n) => [n.noticeKey, n]));
        for (const card of this.toast.querySelectorAll(".clan-notice-card")) {
          const notice = current.get(card.dataset.noticeKey);
          if (notice) card.replaceWith(this.noticeCard(notice));
          else card.remove();
        }
        const count = this.toast.querySelectorAll(".clan-notice-card").length;
        if (count) this.toast.querySelector(".clan-notice-count").textContent = String(count);
        else this.toast.hidePopover();
      }
      if (!fresh.length) {
        this.saveRewardNotices(profile);
        return;
      }
      const celebration = fresh.find(n => n.result);
      if (celebration) {
        this.toast.hidePopover();
        this.seen.add(celebration.noticeKey);
        const group = remembered.clan;
        group.ids.add(celebration.id);
        try { localStorage.setItem(group.storageKey, JSON.stringify([...group.ids])); } catch (_) {}
        this.showResult(celebration);
        this.saveRewardNotices(profile);
        return;
      }
      const title = fresh.every((n) => n.kind === "quest")
        ? "Ежедневные сундуки"
        : fresh.some((n) => n.kind === "quest")
          ? "Полученные награды"
          : "Клановые награды";
      this.toast.setAttribute("aria-label", title);
      const heading = el("header", "clan-notice-heading");
      const close = button("×", () => this.toast.hidePopover());
      close.className = "booster-close";
      close.setAttribute("aria-label", "Закрыть уведомления о наградах");
      heading.append(
        el("strong", "", title),
        el("span", "clan-notice-count", String(fresh.length)),
        close,
      );
      const list = el("div", "clan-notice-list");
      for (const n of fresh) list.append(this.noticeCard(n));
      this.toast.replaceChildren(heading, list);
      this.toast.showPopover();
      fresh.forEach((n) => {
        this.seen.add(n.noticeKey);
        remembered[n.kind === "quest" ? "quest" : "clan"].ids.add(n.id);
      });
      for (const { storageKey, ids } of Object.values(remembered)) {
        try {
          localStorage.setItem(storageKey, JSON.stringify([...ids]));
        } catch (_) {}
      }
      this.saveRewardNotices(profile);
    }
    showResult(notice) {
      const result = notice.result, dialog = this.resultDialog;
      const heading = el("header", "clan-heading"), title = el("h2", "", result.title);
      title.id = "clanResultHeading";
      const close = button("×", () => dialog.close());
      close.className = "booster-close";
      close.setAttribute("aria-label", "Закрыть итоги");
      heading.append(title, close);
      const stage = el("div", "clan-result-stage"), badge = art(
        window.KillexProgressionArt.leagueMedal(result.positive ? "gold" : "silver",256),
        "clan-result-art");
      stage.append(badge, el("small","clan-result-clan",result.clanName),
        el("h3","clan-result-headline",result.headline),
        el("p","clan-result-detail",result.detail),
        el("p","clan-result-prize",notice.text));
      const actions = el("div","title-earned-actions"), done = button("Продолжить",() => dialog.close());
      actions.append(done);
      dialog.dataset.positive = String(result.positive);
      dialog.replaceChildren(heading,stage,actions);
      window.KillexUITheme.inherit(dialog,document.body);
      window.KillexWindows.open(dialog);
      if (result.positive) window.KillexAudio?.play?.("title");
      done.focus();
    }
    saveRewardNotices(profile) {
      this.saveNoticeGroup(profile, "quest", profile.quests?.pending || []);
      this.saveNoticeGroup(profile, "clan", profile.clanChests?.notices || []);
    }
    async saveNoticeGroup(profile, kind, rewards) {
      const ids = rewards
        .filter((r) => r.notifiedAt === undefined && this.seen.has(`${profile.id}:${kind}:${r.id}`))
        .map((r) => r.id)
        .sort();
      if (!ids.length) return;
      const key = JSON.stringify([profile.id, kind, ids]);
      let request = this.noticeRequests.get(key);
      if (!request) {
        request = {
          id: window.KillexRequestIds.create(),
          busy: false,
          saved: false,
          retryAt: 0,
        };
        this.noticeRequests.set(key, request);
      }
      if (request.busy || request.saved || Date.now() < request.retryAt) return;
      request.busy = true;
      try {
        const response = await fetch(
          kind === "quest" ? "/api/quests/action" : "/api/clan-chests/action",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "notice", ids, requestId: request.id }),
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok)
          throw Error((await response.json()).error || "Не удалось сохранить показ уведомления");
        request.saved = true;
      } catch (error) {
        request.retryAt = Date.now() + 5000;
        console.warn("Не сохранена отметка уведомления о сундуке:", error.message);
        setTimeout(() => {
          if (this.noticeProfile === profile.id) this.saveNoticeGroup(profile, kind, rewards);
        }, 5100);
      } finally {
        request.busy = false;
      }
    }
    noticeCard(n) {
      const quest = n.kind === "quest";
      const expired = n.kind === "expired";
      const battle = n.text.startsWith("Клановая битва завершена:");
      const chest = quest || (!expired && n.text.startsWith("Клановый сундук"));
      const awaitingClaim =
        chest &&
        !quest &&
        n.text.includes("Нажми «Получить»") &&
        this.owner.profile?.clanChests?.items.some((item) => !item.stored);
      const card = el("article", "clan-notice-card");
      if (n.noticeKey) card.dataset.noticeKey = n.noticeKey;
      card.dataset.kind = expired ? "expired" : battle ? "battle" : "reward";
      const title = quest
        ? n.title
        : expired
          ? "Срок открытия истёк"
          : battle
            ? "Битва завершена"
            : chest
              ? "Клановый сундук"
              : "Награда клана";
      card.append(el("h4", "", title));
      const time = el("time", "clan-notice-time", date(n.at));
      time.dateTime = new Date(n.at).toISOString();
      card.append(
        time,
        el("p", "", battle ? n.text.replace(/^Клановая битва завершена:\s*/, "") : n.text),
      );
      const actions = el("div", "clan-notice-actions");
      if (chest)
        actions.append(
          button(awaitingClaim ? "В клан" : "В Сокровищницу", () => {
            this.toast.hidePopover();
            if (awaitingClaim) {
              this.owner.dialog?.close();
              document.getElementById("clanSection").click();
              return;
            }
            this.owner.chestCategory = "treasury";
            this.owner.open("chests");
          }),
        );
      card.append(actions);
      return card;
    }
    async act(action, id) {
      if (this.busy || this.owner.purchasesBlocked()) return;
      this.busy = true;
      this.render();
      try {
        const response = await fetch("/api/clan-chests/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              chestId: id,
              requestId: window.KillexRequestIds.create(),
            }),
            signal: AbortSignal.timeout(8000),
          }),
          r = await response.json();
        if (!response.ok) throw Error(r.error);
        this.owner.updateProfile(r.profile);
      } catch (e) {
        this.owner.status(e.message, true);
      } finally {
        this.busy = false;
        this.render();
      }
    }
    render() {
      const c = this.owner.profile?.clanChests;
      if (!c) return;
      const profile = this.owner.profile;
      const key = JSON.stringify([c, profile.honors, profile.quests?.pending, profile.easter?.chests, profile.fridayChests,
        (profile.account?.vipUntil || 0) > Date.now(), (profile.account?.premiumUntil || 0) > Date.now(),
        this.busy, this.owner.purchasesBlocked()]);
      if (key === this.renderKey) return;
      this.renderKey = key;
      const pending = this.owner.profile?.quests?.pending || [];
      const questChests = pending.filter((item) => item.stored !== false);
      const easter = this.owner.profile?.easter?.chests || [];
      const easterChests = easter.filter((item) => item.stored);
      const friday = this.owner.profile?.fridayChests || [];
      const fridayChests = friday.filter((item) => item.stored);
      const titles = (profile.honors?.tiers || []).filter(item => item.state === "closed");
      const titleChests = titles.filter(item => item.stored);
      const queuedTitles = titles.filter(item => !item.stored);
      const queuedClans = c.items.filter((item) => !item.stored);
      const waiting =
        pending.length -
        questChests.length +
        easter.length -
        easterChests.length +
        queuedClans.length +
        friday.length -
        fridayChests.length + queuedTitles.length;
      const storedChests = c.items.filter((item) => item.stored);
      const head = el("div", "clan-chest-inventory-heading");
      head.append(
        el("h3", "", "Сокровищница"),
        el(
          "span",
          "",
          `${c.totalStored ?? storedChests.length + questChests.length} / ${c.capacity}${waiting ? `, вне хранилища: ${waiting}` : ""}`,
        ),
      );
      const grid = el("div", "clan-owned-chests");
      for (const item of titleChests) {
        const card = el("article", "clan-owned-chest title-treasury-chest");
        card.dataset.chestId = item.id;
        const image = art(window.KillexProgressionArt.chest(item.id,256), "clan-prize-art");
        image.srcset = [128,256,512].map(size=>window.KillexArtRevision.url(window.KillexProgressionArt.chest(item.id,size))+" "+size+"w").join(", ");
        image.sizes = "96px";
        card.append(image,
          el("strong", "", item.chestName), el("small", "", "За титул «"+item.name+"»"),
          el("small", "", "Без срока открытия"));
        const open = button(profile.honors.pending?.id === item.id ? "Забрать награду" : "Открыть",
          () => this.owner.chests.open(item.id));
        window.KillexControls.state(open,this.busy || this.owner.purchasesBlocked(),this.owner.purchasesBlocked());
        card.append(open);grid.append(card);
      }
      for (const item of fridayChests) {
        const card = el("article", "clan-owned-chest friday-treasury-chest");
        card.dataset.chestId = item.id;
        card.append(
          art("assets/events/black-friday/chest.webp?art=20261123-interface-art", "clan-prize-art"),
          el("strong", "", "Сундук Чёрной пятницы"),
          el("small", "", "Лавка Мани"),
          el("small", "", "Без срока открытия"),
        );
        window.KillexBoosterTooltip.attach(card.firstElementChild, {
          name: "Сундук Чёрной пятницы",
          usage: item.contents,
        });
        const open = button(item.reward ? "Забрать награду" : "Открыть", () =>
          this.owner.chests.open(item.id),
        );
        window.KillexControls.state(
          open,
          this.busy || this.owner.purchasesBlocked(),
          this.owner.purchasesBlocked(),
        );
        card.append(open);
        grid.append(card);
      }
      for (const item of easterChests) {
        const card = el("article", "clan-owned-chest easter-treasury-chest");
        card.dataset.chestId = item.id;
        card.append(
          art("assets/events/easter-hunt/chest.webp?art=20261123-interface-art", "clan-prize-art"),
          el("strong", "", "Пасхальный сундук"),
          el("small", "", "Пасхальная охота"),
          el("small", "", "Без срока открытия"),
        );
        const open = button(item.reward ? "Забрать награду" : "Открыть", () =>
          this.owner.chests.open(item.id),
        );
        window.KillexControls.state(
          open,
          this.busy || this.owner.purchasesBlocked(),
          this.owner.purchasesBlocked(),
        );
        card.append(open);
        grid.append(card);
      }
      for (const item of questChests) {
        const card = el("article", "clan-owned-chest quest-treasury-chest");
        card.dataset.chestId = item.id;
        card.append(
          art(window.KillexProgressionArt.questChest(item.chest.art), "clan-prize-art"),
          el("strong", "", item.chest.name),
          el("small", "", `За задание «${item.title}»`),
          el("small", "", "Без срока открытия"),
        );
        card.firstChild.title = `${Object.values(item.items).reduce((sum, count) => sum + count, 0)} бустеров, ${item.coins} монет, ${item.crystals} кристаллов, ${item.greatness} величия${item.tickets ? `, ${item.tickets} бил. рулетки` : ""}`;
        const open = button("Открыть", () => this.owner.chests.open(item.id));
        window.KillexControls.state(
          open,
          this.busy || this.owner.purchasesBlocked(),
          this.owner.purchasesBlocked(),
        );
        card.append(open);
        grid.append(card);
      }
      for (const item of storedChests) {
        const card = el("article", "clan-owned-chest");
        card.dataset.chestId = item.id;
        card.dataset.reward = item.tier;
        attachChestHint(card, item.tier, this.owner.profile, item.reward);
        card.append(
          art(window.KillexProgressionArt.clanChest(item.tier), "clan-prize-art"),
          el("strong", "", item.name),
          el("small", "", "В Сокровищнице"),
          el("small", "", "Без срока открытия"),
        );
        const open = button(item.reward ? "Забрать награду" : "Открыть", () =>
          this.owner.chests.open(item.id),
        );
        window.KillexControls.state(
          open,
          this.busy || this.owner.purchasesBlocked(),
          this.owner.purchasesBlocked(),
        );
        card.append(open);
        grid.append(card);
      }
      if (
        !storedChests.length &&
        !questChests.length &&
        !easterChests.length &&
        !fridayChests.length &&
        !titleChests.length
      )
        grid.append(
          el(
            "p",
            "clan-muted",
            "Здесь хранятся сундуки за титулы, задания, события и клановые битвы. Сундуки в Сокровищнице не сгорают.",
          ),
        );
      const wasOpen = !!this.root.querySelector(".clan-reward-notices")?.open;
      this.root.replaceChildren(head, grid);
      if (waiting) {
        const queue = el("section", "treasury-waiting");
        queue.append(
          el("h4", "", "Вне Сокровищницы: " + waiting),
          el(
            "p",
            "",
            "Титульные сундуки ждут бессрочно и занимают освободившиеся места автоматически. Остальные сундуки вне Сокровищницы сгорают: без статусов через 3 ч, с VIP или Premium через 24 ч, с обоими через 48 ч.",
          ),
        );
        const groups = new Map();
        const rows = [
          ...queuedTitles.map(c => ({id:c.id,kind:"title",name:c.chestName,
            prepared:profile.honors.pending?.id===c.id,
            art:window.KillexProgressionArt.chest(c.id,256),until:null})),
          ...friday
            .filter((c) => !c.stored)
            .map((c) => ({
              name: "Сундук Чёрной пятницы",
              art: "assets/events/black-friday/chest.webp?art=20261123-interface-art",
              until: c.expiresAt,
            })),
          ...queuedClans.map((c) => ({
            id: c.id,
            unreceived: c.receivedAt === null,
            kind: "clan",
            name: c.name,
            art: window.KillexProgressionArt.clanChest(c.tier),
            until: c.expiresAt,
          })),
          ...pending
            .filter((c) => c.stored === false)
            .map((c) => ({
              id: c.id,
              unreceived: c.receivedAt === null,
              kind: "quest",
              name: c.chest.name,
              art: window.KillexProgressionArt.questChest(c.chest.art),
              until: c.expiresAt,
            })),
          ...easter
            .filter((c) => !c.stored)
            .map((c) => ({
              name: "Пасхальный сундук",
              art: "assets/events/easter-hunt/chest.webp?art=20261123-interface-art",
              until: c.expiresAt,
            })),
        ];
        for (const item of rows) {
          const key = item.unreceived ? item.id : item.name + ":" + (item.until || "safe");
          if (groups.has(key)) groups.get(key).count++;
          else groups.set(key, { ...item, count: 1 });
        }
        for (const item of groups.values()) {
          const row = el("div", "treasury-waiting-row");
          row.append(
            art(item.art, ""),
            el("strong", "", item.name + " ×" + item.count),
            el("span", "", item.until ? "Сгорит " + date(item.until) : "Без срока ожидания"),
          );
          if (item.unreceived) {
            const receive = button("Получить", () =>
              item.kind === "clan" ? this.act("claim", item.id) : this.receiveQuest(item.id),
            );
            window.KillexControls.state(
              receive,
              this.busy || this.owner.purchasesBlocked(),
              this.owner.purchasesBlocked(),
            );
            row.append(receive);
          }
          if (item.prepared) row.append(button("Забрать награду", () => this.owner.chests.open(item.id)));
          queue.append(row);
        }
        this.root.append(queue);
      }
      this.renderNotices(wasOpen);
    }
    async receiveQuest(id) {
      if (this.busy || this.owner.purchasesBlocked()) return;
      this.busy = true;
      this.render();
      try {
        const response = await fetch("/api/quests/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "receive",
            questId: id,
            requestId: window.KillexRequestIds.create(),
          }),
        });
        const data = await response.json();
        if (!response.ok) throw Error(data.error);
        this.owner.updateProfile(data.profile);
      } catch (e) {
        this.owner.status(e.message, true);
      } finally {
        this.busy = false;
        this.render();
      }
    }
    renderNotices(wasOpen = !!this.root.querySelector(".clan-reward-notices")?.open) {
      clearTimeout(this.noticeExpiryTimer);
      const now = window.KillexAppearance?.now?.() ?? Date.now(),
        active = (this.owner.profile?.clanChests?.notices || []).filter(
          (n) => n.at + rules.DAY > now,
        ),
        notices = el("details", "clan-reward-notices"),
        previous = this.root.querySelector(".clan-reward-notices");
      notices.open = wasOpen;
      notices.hidden = !active.length;
      notices.append(el("summary", "", "Уведомления о наградах: " + active.length));
      for (const n of active) {
        const row = this.noticeCard(n);
        row
          .querySelector(".clan-notice-actions")
          .append(button("Прочитано", () => this.act("dismiss", n.id)));
        notices.append(row);
      }
      if (previous) previous.replaceWith(notices);
      else this.root.append(notices);
      if (active.length) {
        const delay = Math.min(...active.map((n) => n.at + rules.DAY - now));
        this.noticeExpiryTimer = setTimeout(
          () => this.renderNotices(),
          Math.max(1, Math.min(delay, rules.DAY)),
        );
      }
    }
  }
  window.KillexClanBattleUI = ClanBattleUI;
  window.KillexClanChestInventory = ClanChestInventory;
})();

const fs=require('node:fs');
function edit(file, fn){ const old=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n'); const out=fn(old); fs.writeFileSync(file,out); }
function rep(s,a,b){if(!s.includes(a))throw Error('Missing '+a.slice(0,80));return s.replace(a,b);}
edit('public/ui/progression/black-friday.js',s=>{
 s=rep(s,'// Merchant tokens are emerald tickets, never imitations of the game\'s gold coins.','// Silver merchant tokens are visually distinct from the gold game currency.');
 s=rep(s,'const n = el("span", "manya-token", "М");','const n = img("assets/events/black-friday/token-v2.webp", "manya-token");\n    n.alt = "жетоны Мани";');
 s=rep(s,'["exchange", "Обмен жетонов"],','["exchange", "Обмен жетонов"],\n        ["achievements", "Достижения"],');
 s=rep(s,'this.tab === "orders" ? this.book(s) : this.catalog(s)','this.tab === "orders" ? this.book(s) : this.tab === "achievements" ? this.achievements(s) : this.catalog(s)');
 s=rep(s,'"Маленькие дела, большие подарки"','`Выполнено сегодня: ${s.dailyCompleted} / 10`');
 s=rep(s,'text.append(\n          caption,','text.append(\n          el("small", "manya-order-tier", `${o.tierName}: ${o.done} / ${o.quota}`),\n          caption,');
 s=rep(s,'reward.append(price, claim);','const swap = button(s.swapCost ? "Сменить: 3" : "Сменить бесплатно", () => this.act("swap", o.id), "sf-button manya-swap");\n        if (s.swapCost) swap.append(img("assets/menu-icons/64/currency_bucks.webp"));\n        swap.disabled = !!this.busy || o.claimed || (this.owner.getProfile()?.wallet?.bucks || 0) < s.swapCost;\n        reward.append(price, claim, swap);');
 s=s.replaceAll('black-friday/regalia.webp','black-friday/regalia-v2.webp');
 s=rep(s,'"Выполни 15 заказов за событие.','"Выполни 50 заказов за событие.');
 s=rep(s,'" из 15"','" из " + s.finalTarget');
 s=rep(s,'for (let i = 0; i < 15; i++)','for (let i = 0; i < 10; i++)');
 s=s.replaceAll('i < s.completedOrders','(i + 1) * 5 <= s.completedOrders');
 s=rep(s,'String(i + 1)','String((i + 1) * 5)');
 s=rep(s,'o.used >= o.limit ||','(o.limit != null && o.used >= o.limit) ||');
 s=rep(s,'img("assets/events/black-friday/casket.webp"),','img("assets/events/black-friday/token-v2.webp"),');
 s=rep(s,'`Сегодня: ${o.used} / ${o.limit}`','o.limit == null ? "Без ограничения обменов" : `Сегодня: ${o.used} / ${o.limit}`');
 s=rep(s,'    catalog(s) {',`    achievements(s) {
      const wrap = el("section", "manya-achievements");
      for (const a of s.achievements || []) {
        const card = el("article", "manya-achievement");
        const icon = img("assets/menu-icons/128/nav_achievements.webp");
        const text = el("div", "");
        text.append(el("h3", "", a.name), el("p", "", a.description));
        const steps = el("div", "manya-achievement-steps");
        a.thresholds.forEach((n,i) => {
          const step=el("span", i < a.claimed ? "is-done" : "");
          step.append(document.createTextNode((i<a.claimed ? "✓ " : "") + amount(n) + ": +" + a.rewards[i]), img("assets/menu-icons/64/nav_achievements.webp"));
          steps.append(step);
        });
        text.append(steps, el("small", "", "Прогресс: " + amount(a.value) + " " + a.unit));
        card.append(icon,text); wrap.append(card);
      }
      return wrap;
    }
    catalog(s) {`);
 s=rep(s,': action === "exchange"\n',': action === "swap"\n                ? "Заказ заменён."\n                : action === "exchange"\n');
 return s;
});
edit('public/ui/progression/events-page.js',s=>{
 s=rep(s,'huntActive && available && event.linkedEvents?.some((e) => e.id === "lucky-week")','(shopActive || huntActive) && available && event.linkedEvents?.some((e) => e.id === "lucky-week")');
 s=rep(s,'if (this.linked !== !!linked) {\n        this.linked = !!linked;','const source = shopActive ? 1 : 2;\n      if (this.linked !== !!linked || this.linkSource !== source) {\n        this.linked = !!linked;\n        this.linkSource = source;');
 s=rep(s,'if (!this.linked || !cards.includes(this.cards[2])) return;\n      const from = this.cards[2].getBoundingClientRect(),','if (!this.linked || !cards.includes(this.cards[this.linkSource])) return;\n      const from = this.cards[this.linkSource].getBoundingClientRect(),');
 return rep(s,'"data-from": "easter-hunt",','"data-from": this.linkSource === 1 ? "black-friday" : "easter-hunt",');
});
for(const f of ['public/ui/progression/event-announcement.js','public/ui/progression/events-page.js','public/ui/lobby/promotion-banners.js']) edit(f,s=>s.replaceAll('black-friday/banner.webp','black-friday/banner-v2.webp'));
edit('public/ui/roulette/roulette-dialog.js',s=>rep(s,'button.title = enabled ? "Рулетка" : "Рулетка откроется во время ивента";','button.removeAttribute("title");'));
edit('public/index.html',s=>s.replace(/(<button\b[^>]*\bid="(?:rouletteButton|blackFridayButton)"[^>]*?)\s+title="[^"]*"/g,'$1'));
edit('public/ui/shop/currency-purchase-dialog.js',s=>{
 s=rep(s,'    render(currency) {','    promotion() {\n      const s = this.owner.profile?.blackFriday;\n      return !!(s?.active && s.endsAt > (window.KillexAppearance?.now?.() ?? Date.now()));\n    }\n    render(currency) {');
 s=rep(s,'const catalog = catalogs[currency];','const catalog = catalogs[currency];\n      this.promo = this.promotion();\n      this.dialog.dataset.blackFriday = String(this.promo);');
 s=rep(s,'const bonus = el(','const total = (item.base + item.bonus) * (this.promo ? 2 : 1);\n        const extra = total - item.base;\n        const bonus = el(');
 s=rep(s,'item.bonus ? `+${number(item.bonus)} ${catalog.label}` : "Без бонуса"','extra ? `+${number(extra)} ${catalog.label}` : "Без бонуса"');
 s=rep(s,'String(item.bonus > 0)','String(extra > 0)');
 s=rep(s,'number(item.base + item.bonus)','number(total)');
 s=rep(s,'const base = el("p", "donation-base", `Базовое количество: ${number(item.base)}`);','const base = el("p", "donation-base", this.promo ? "Чёрная пятница: ×2 за ту же цену" : `Базовое количество: ${number(item.base)}`);');
 s=rep(s,'if (!this.grid) return;','if (!this.grid) return;\n      if (this.promo !== this.promotion()) { this.render(this.currency); return; }');
 return s;
});
edit('public/ui/shop/mock-payment-dialog.js',s=>{
 s=rep(s,'this.profileId = profile.id;','this.profileId = profile.id;\n      const promotion = profile.blackFriday;\n      this.currencyPromoRunId = product.type === "currency" && promotion?.active && promotion.endsAt > (window.KillexAppearance?.now?.() ?? Date.now()) ? promotion.runId : null;');
 s=rep(s,'if (this.eventId) this.storageKey += "." + this.eventId;','if (this.eventId) this.storageKey += "." + this.eventId;\n      if (product.type === "currency") this.storageKey += "." + (this.currencyPromoRunId || "regular");');
 s=rep(s,'this.description.textContent = product.description;','this.description.textContent = product.type === "currency" ? `${(product.amount * (this.currencyPromoRunId ? 2 : 1)).toLocaleString("ru-RU")} ${window.KillexVirtualProducts.currencies[product.currency].label}` : product.description;');
 s=rep(s,'...(this.eventId ? { eventId: this.eventId } : {}),','...(this.eventId ? { eventId: this.eventId } : {}),\n            ...(this.product.type === "currency" ? {currencyPromoRunId: this.currencyPromoRunId} : {}),');
 s=rep(s,'`${this.product.description} зачислено на баланс.`','`${this.description.textContent} зачислено на баланс.`');
 return s;
});
edit('src/server/events/black-friday.js',s=>rep(s,'description: "Выполнено 50 заказов Лавки Мани во время Чёрной пятницы.",','description: `Выполнено ${s.finalTarget || 15} заказов Лавки Мани во время Чёрной пятницы.`,').replace('const freshDay = () => ({ food: 0, mass: 0, life: 0, claimed: [], exchanges: {} });\n',''));

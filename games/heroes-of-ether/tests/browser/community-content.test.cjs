"use strict";
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict"), { once } = require("node:events"), { randomUUID } = require("node:crypto");
const pw = require("playwright"), { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { createGameServer } = require("../../src/server/game-server"), { OwnerAccess } = require("../../src/server/admin/owner-access");
const engine = process.argv[2] || "chromium", output = process.env.KILLEX_TEST_ARTIFACTS || path.resolve(__dirname, "../../../../artifacts/promocodes-news-social-20261113/browser-" + engine);
fs.mkdirSync(output, { recursive: true });
const report = { engine, checks: [], errors: [], missing: [] }, store = new ProfileStore(), a = store.open(), b = store.open();
const at = store.now();
for (const [session, name, gender, skin] of [[a, "Арден", "male", 0], [b, "Луна", "female", 1]]) {
  const p = store.find(session.token);
  p.name = name; p.personal = { nameSet: true, introPending: false, gender, vkUrl: "" };
  p.skinId = require("../../public/shared/player-identity").skins[skin].id;
  p.wallet = { coins: 100000, crystals: 10000, bucks: 10000 };
  p.loginReward = { date: require("../../src/server/accounts/account-benefits").loginRewardDay(at), day: 1 };
}
const access = new OwnerAccess({ ownerId: a.profile.id }), app = createGameServer({ profiles: store, ownerAccess: access, autoTick: false, testBots: { enabled: false } });
let browser;
async function closeAll(page) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => { for (const d of document.querySelectorAll("dialog[open]")) d.close(); });
    await page.waitForTimeout(35);
  }
}
async function geometry(page, selector, label) {
  const value = await page.locator(selector).evaluate(d => {
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: innerWidth, height: innerHeight,
      scrollX: d.scrollWidth - d.clientWidth, scrollY: d.scrollHeight - d.clientHeight };
  });
  assert.ok(value.x >= 0 && value.y >= 0 && value.right <= value.width + 1 && value.bottom <= value.height + 1 && value.scrollX <= 1 && value.scrollY <= 1, label + ": " + JSON.stringify(value));
  await page.locator(selector).screenshot({ path: path.join(output, label + ".png") });
  report.checks.push({ label, geometry: value });
}
async function socialLoad(page) { await page.evaluate(async () => { await window.KillexSocial.load(); }); }
(async () => {
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening");
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  console.log("test server ready", url);
  browser = await pw[engine].launch({ headless: true, ...(engine === "chromium" ? { channel: "chrome" } : {}) });
  async function player(session) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await context.addCookies([{ name: "sferorumiya_session", value: session.token, url, httpOnly: true }]);
    await context.addInitScript(() => {
      document.addEventListener("killex:profile", event => {
        window.__profile = event.detail;
        const all = Object.fromEntries((event.detail.progress?.achievements || []).map(a => [a.eventRunId ? a.id + ":" + a.eventRunId : a.id, 10]));
        localStorage.setItem(window.KillexPlatform.storageKey(".achievement-notices.v1.") + event.detail.id, JSON.stringify(all));
      });
    });
    const page = await context.newPage();
    const closeRewards = page.getByRole("button", {name:"Закрыть уведомления о наградах",exact:true});
    await page.addLocatorHandler(closeRewards, () => closeRewards.click());
    page.on("pageerror", e => report.errors.push(e.message));
    page.on("response", r => { if (r.status() === 404 && !r.url().includes("/api/")) report.missing.push(r.url()); });
    console.log("boot", session.profile.id);
    await page.goto(url); await page.waitForFunction(() => !window.KillexBoot?.active && !document.getElementById("playButton").disabled, { timeout: 30000 });
    console.log("boot ready");
    await closeAll(page);
    return { context, page };
  }
  const sender = await player(a), recipient = await player(b), page = sender.page, other = recipient.page;
  console.log("players ready");
  // Full owner UI: create a code without JSON editing, then redeem through the player dialog.
  const admin = await sender.context.newPage();
  admin.on("pageerror", e => report.errors.push(e.message));
  await admin.goto(url + "/admin.html");
  await admin.locator("#setupCode").fill(access.bootstrapCode);
  await admin.locator("#password").fill("A long test password 2026");
  await admin.locator("#loginForm button").click();
  await admin.locator("#workspace").waitFor({ state: "visible" });
  console.log("admin ready");
  await admin.locator('#ownerNavigation').waitFor({state:'visible'});
  await admin.waitForFunction(()=>document.getElementById('overviewRate').textContent!=='—');
  const payer=store.open();store.find(payer.token).name='Покупатель отчёта';
  for(const productId of ['coins:handful','account:vip'])store.confirmMockPurchase(payer.token,{productId,confirmed:true,requestId:randomUUID()});
  const secondPayer=store.open();store.find(secondPayer.token).name='Второй покупатель';store.confirmMockPurchase(secondPayer.token,{productId:'crystals:moon',confirmed:true,requestId:randomUUID()});
  await admin.locator('#ownerNavigation [data-admin-target="economy"]').click();
  await admin.locator('#paymentsSummary .stat').first().waitFor();
  assert.match(await admin.locator('#paymentsJournal').innerText(),/Реальных оплат пока нет/);
  await admin.locator('#paymentsMode').selectOption('test');await admin.locator('#paymentsRefresh').click();
  await admin.locator('#paymentsJournal .payment-entry').first().waitFor();
  assert.equal(await admin.locator('#paymentsJournal .payment-entry').count(),3);
  assert.equal(await admin.locator('#paymentsSummary .stat').first().locator('strong').innerText(),'26');
  assert.equal(await admin.locator('#paymentsSummary .stat').nth(2).locator('strong').innerText(),'2');
  for(const size of [{width:1366,height:900},{width:390,height:844}]){await admin.setViewportSize(size);assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await admin.screenshot({path:path.join(output,'admin-finance-'+size.width+'.png'),fullPage:true});}
  const downloading=admin.waitForEvent('download');await admin.locator('#paymentsExport').click();const download=await downloading;await download.saveAs(path.join(output,'finance.csv'));const csv=fs.readFileSync(path.join(output,'finance.csv'),'utf8');assert.match(csv,/Тестовые покупки — не выручка/);assert.match(csv,/"Голоса";"26"/);
  await admin.locator('#paymentsCategory').selectOption('statuses');await admin.locator('#paymentsRefresh').click();await admin.waitForFunction(()=>document.querySelectorAll('#paymentsJournal .payment-entry').length===1);assert.equal(await admin.locator('#paymentsSummary .stat').first().locator('strong').innerText(),'20');
  report.checks.push({label:'finance: real zero, simulated revenue separated, category filters, responsive charts and CSV'});
  const health={capturedAt:Date.now(),windowMs:60000,ticks:1200,targetTickMs:50,updatesHz:14,tickWorkMs:{p95:60},tickIntervalMs:{p95:110},eventLoop:{samples:100,p95Ms:120},arena:{activePlayers:3,rooms:1},persistence:{arenaBatches:10,queuedActions:150,paused:true,pendingWalBytes:900,maxWalBytes:1000},memoryMiB:{resident:950,limit:1000}};
  await admin.route('**/api/admin/performance',route=>route.fulfill({json:health}));
  await admin.locator('#ownerNavigation [data-admin-target="overview"]').click();await admin.locator('#performancePanel').evaluate(d=>d.open=true);
  await admin.waitForFunction(()=>document.querySelectorAll('#performanceStats [data-health="critical"]').length===7);
  await admin.locator('#refreshPerformance').click();assert.equal(await admin.locator('#performancePanel').evaluate(d=>d.open),true);
  await admin.screenshot({path:path.join(output,'admin-critical-health.png'),fullPage:true});
  await admin.unroute('**/api/admin/performance');await admin.locator('#refreshPerformance').click();await admin.waitForFunction(()=>document.querySelectorAll('#performanceStats [data-health="critical"]').length===0);
  report.checks.push({label:'health highlights seven critical metrics, labels thresholds, refresh keeps panel open, recovery clears colors'});
  for (const size of [{width:1366,height:900},{width:390,height:844}]) {
    await admin.setViewportSize(size);
    await admin.screenshot({path:path.join(output,'admin-overview-'+size.width+'.png'),fullPage:true});
    assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    for(const key of ['players','economy','events','promos','news','trash','audit','overview']) {
      await admin.locator('#ownerNavigation [data-admin-target="'+key+'"]').click();
      assert.equal(await admin.locator('[data-admin-view="'+key+'"]').isVisible(),true);
      assert.equal(await admin.locator('[data-admin-view]:visible').count(),1);
    }
    report.checks.push({label:'admin-navigation-'+size.width});
  }
  await admin.setViewportSize({width:1366,height:900});
  await admin.locator('#ownerNavigation [data-admin-target="players"]').click();
  await admin.locator('#players .player-row').first().click();
  await admin.locator('#selected').waitFor({state:'visible'});
  await admin.locator('#ownerNavigation [data-admin-target="economy"]').click();
  await admin.locator('#transactionsPanel').waitFor({state:'visible'});
  await admin.locator('#economyWallet').click();
  assert.equal(await admin.locator('#action').inputValue(),'wallet');
  report.checks.push({label:'admin-player-economy-link'});
  assert.equal(await admin.locator('.topbar .eyebrow').innerText(),'Экосистема KILLEX · ГЕРОИ ЭФИРА');
  if(process.env.KILLEX_ADMIN_ONLY==='1'){assert.deepEqual(report.errors,[]);assert.deepEqual(report.missing,[]);console.log(JSON.stringify({engine,adminChecks:report.checks.length,errors:report.errors}));return;}
  await admin.locator('#ownerNavigation [data-admin-target="promos"]').click();
  await admin.locator("#promoCodesPanel .content-list").getByText("Записей пока нет.").waitFor();
  await admin.locator("#promoCodesPanel").getByRole("button", { name: "Создать", exact: true }).click();
  await admin.locator('#promo-codes-title').fill("Тестовая награда");
  await admin.locator('#promo-codes-code').fill("BROWSER-GIFT");
  await admin.locator('#promo-codes-reason').fill("Проверка через браузер");
  await admin.locator('#promoCodesPanel .content-editor button[type="submit"]').click();
  await admin.locator('#promoCodesPanel .content-status').getByText("Сохранено.").waitFor();
  await admin.locator('#ownerNavigation [data-admin-target="news"]').click();
  await admin.locator("#newsAdminPanel .content-list").getByText("Записей пока нет.").waitFor();
  await admin.locator("#newsAdminPanel").getByRole("button", { name: "Создать", exact: true }).click();
  await admin.locator("#news-title").fill("Встреча героев");
  await admin.locator("#news-body").fill("Добро пожаловать в Вестник Эфира! Здесь появляются новости игры. <script>window.BAD=true</script>");
  await admin.locator("#news-visible").check();
  await admin.locator("#news-reason").fill("Проверка публикации");
  await admin.locator('#newsAdminPanel .content-editor button[type="submit"]').click();
  await admin.locator('#newsAdminPanel .content-status').getByText("Сохранено.").waitFor();
  assert.equal(store.data.gameNews.items.length, 1);
  report.checks.push({ label: "owner editor creates code and news with audit" });
  console.log("admin content saved");
  const before = store.find(a.token).wallet.coins;
  await page.locator("#promoCodeSection").click();
  await page.locator("#promoCodeInput").fill("browser-gift");
  await page.locator("#promoCodeDialog").getByRole("button", { name: "Активировать", exact: true }).click();
  await page.locator(".promo-code-status").getByText("Промокод активирован. Награды получены!").waitFor();
  assert.equal(store.find(a.token).wallet.coins, before + 100);
  await geometry(page, "#promoCodeDialog", "promo-success");
  await page.locator("#promoCodeDialog").getByRole("button", { name: "Ввести другой", exact: true }).click();
  await page.locator("#promoCodeInput").fill("BROWSER-GIFT");
  await page.locator("#promoCodeDialog").getByRole("button", { name: "Активировать", exact: true }).click();
  await page.locator(".promo-code-status").getByText("Ты уже активировал этот промокод.").waitFor();
  assert.equal(store.find(a.token).wallet.coins, before + 100); await closeAll(page);
  await admin.locator('#ownerNavigation [data-admin-target="promos"]').click();
  await admin.locator('#promoCodesPanel .content-row').filter({hasText:'BROWSER-GIFT'}).getByRole('button',{name:'Удалить',exact:true}).click();
  await admin.locator('#promoCodesPanel .content-editor').getByRole('button',{name:'Отмена',exact:true}).click();
  assert.ok(store.data.promoCodes.items.some(p=>p.code==='BROWSER-GIFT'));
  await admin.locator('#promoCodesPanel .content-row').filter({hasText:'BROWSER-GIFT'}).getByRole('button',{name:'Удалить',exact:true}).click();
  await admin.locator('#promo-delete-reason').fill('Акция завершена');
  await admin.locator('#promoCodesPanel .content-editor').getByRole('button',{name:'Удалить промокод',exact:true}).click();
  await admin.locator('#promoCodesPanel .content-status').getByText('Промокод удалён. Выданные награды сохранены.').waitFor();
  assert.equal(store.data.promoCodes.items.some(p=>p.code==='BROWSER-GIFT'),false);
  assert.equal(store.find(a.token).wallet.coins,before+100);
  report.checks.push({label:'owner deletes promo after confirmation; grants remain'});
  await admin.locator('#ownerNavigation [data-admin-target="news"]').click();
  await admin.locator('#newsAdminPanel .content-row').getByRole('button',{name:'Удалить',exact:true}).click();
  await admin.locator('#newsAdminPanel .content-editor').getByRole('button',{name:'Отмена',exact:true}).click();assert.equal(store.data.gameNews.items.length,1);
  await admin.locator('#newsAdminPanel .content-row').getByRole('button',{name:'Удалить',exact:true}).click();
  await admin.locator('#news-delete-reason').fill('Проверка восстановления статьи');
  await admin.locator('#newsAdminPanel .content-editor').getByRole('button',{name:'Удалить новость',exact:true}).click();
  await admin.locator('#newsAdminPanel .content-status').getByText('Новость удалена. Запись в журнале сохранена.').waitFor();
  assert.equal(store.data.gameNews.items.length,0);
  await admin.locator('#ownerNavigation [data-admin-target="trash"]').click();
  await admin.waitForFunction(()=>document.querySelectorAll('#trashPanel .content-row').length===2);
  await admin.screenshot({path:path.join(output,'admin-trash.png'),fullPage:true});
  for(const title of ['BROWSER-GIFT','Встреча героев']){
    await admin.locator('#trashPanel .content-row').filter({hasText:title}).getByRole('button',{name:'Восстановить',exact:true}).click();
    await admin.locator('#trashPanel .content-editor').getByRole('button',{name:'Восстановить объект',exact:true}).click();
    await admin.locator('#trashPanel .content-status').getByText('Объект восстановлен. История сохранена.').waitFor();
  }
  assert.equal(store.data.gameNews.items.length,1);assert.equal(store.data.promoCodes.items[0].redeemed,1);assert.equal(store.find(a.token).wallet.coins,before+100);
  await admin.locator('#ownerNavigation [data-admin-target="news"]').click();await admin.locator('#newsAdminPanel .content-row').getByText('Встреча героев',{exact:true}).waitFor();
  await admin.locator('#ownerNavigation [data-admin-target="promos"]').click();await admin.locator('#promoCodesPanel .content-row').filter({hasText:'BROWSER-GIFT'}).waitFor();
  report.checks.push({label:'news deletion can be cancelled; trash restores news and redeemed promo without duplicate rewards'});
  const promos = require("../../src/server/profiles/promo-codes"), content = require("../../src/server/admin/content-actions");
  const samples = [...promos.catalog.filter(r => ["currency", "theme", "frame", "chest"].includes(r.kind)),
    ...["booster", "accessory", "skin"].flatMap(kind => promos.catalog.filter(r => r.kind === kind).slice(0, 5))];
  for (const r of promos.catalog) if (samples.length < 50 && !samples.includes(r)) samples.push(r);
  content.apply(store, access, store.find(a.token), "promoCodes", {
    requestId: randomUUID(), revision: store.data.promoCodes.revision, reason: "Проверка большого набора",
    code: "LARGE-GIFT", title: "Большой набор", enabled: true, startsAt: 0, endsAt: 0, maxRedemptions: 0,
    rewards: samples.slice(0, 50).map(({kind,id}) => ({kind,id,amount:1})),
  }, promos.normalize);
  await page.locator("#promoCodeSection").click();
  await page.locator("#promoCodeInput").fill("LARGE-GIFT");
  await page.locator("#promoCodeDialog").getByRole("button", { name: "Активировать", exact: true }).click();
  await page.locator(".promo-code-status").getByText("Промокод активирован. Награды получены!").waitFor();
  for (const size of [{width:1366,height:900}, {width:390,height:844}, {width:844,height:390}, {width:320,height:568}]) {
    await page.setViewportSize(size);
    await geometry(page, "#promoCodeDialog", "promo-large-" + size.width);
  }
  assert.equal(await page.locator(".promo-code-rewards li").count(), 50);
  assert.equal(await page.getByRole("button", {name:"Следующие награды",exact:true}).count(),0);
  assert.equal(await page.locator(".promo-code-rewards img").evaluateAll(async images => {
    await Promise.all(images.map(img => img.decode())); return images.every(img => img.naturalWidth > 0);
  }), true);
  await page.locator('.promo-code-rewards li').last().scrollIntoViewIfNeeded();
  await geometry(page,"#promoCodeDialog","promo-all-rewards-last-visible");
  await closeAll(page);
  assert.equal(await page.locator("#releaseNotesButton").count(), 0);
  assert.equal(await page.evaluate(() => document.getElementById("promoCodeSection").nextElementSibling.id), "hallOfFameSection");
  assert.equal(await page.evaluate(() => document.getElementById("petsSection").nextElementSibling.id), "newsSection");
  for (const size of [{width:1366,height:900}, {width:390,height:844}, {width:844,height:390}]) {
    await page.setViewportSize(size); await page.locator("#newsSection").click();
    await page.locator('.news-tabs [data-category="news"]').click();
    await page.locator(".news-article h3").getByText("Встреча героев").waitFor();
    await geometry(page, "#releaseNotesDialog", "newspaper-" + size.width);
    assert.doesNotMatch(await page.locator(".news-date").innerText(), /\d+:\d+/);
    assert.equal(await page.evaluate(() => window.BAD), undefined);
    await closeAll(page);
  }
  await page.setViewportSize({width:1366,height:900});
  console.log("newspaper checked");
  // Outgoing and incoming proposals use the counterpart portrait.
  await page.evaluate(id => window.KillexPlayerProfile.open(id), b.profile.id);
  await page.locator("#playerProfileDialog").getByRole("button", { name: "Приглашение в брак", exact: true }).click();
  await geometry(page, ".marriage-offer-dialog", "proposal-outgoing");
  assert.equal(await page.locator(".marriage-offer-dialog .achievement-earned-name").innerText(), "Луна");
  await page.locator(".marriage-offer-dialog").getByRole("button", { name: "Отправить приглашение" }).click();
  await page.locator(".marriage-offer-dialog h2").getByText("Предложение отправлено!").waitFor();
  await socialLoad(other); await other.locator(".marriage-invitations-dialog[open]").waitFor();
  assert.equal(await other.locator(".marriage-invitations-dialog .achievement-earned-name").innerText(), "Арден");
  for (const size of [{width:1366,height:900}, {width:390,height:844}, {width:844,height:390}]) {
    await other.setViewportSize(size); await geometry(other, ".marriage-invitations-dialog", "proposal-incoming-" + size.width);
  }
  await other.locator(".marriage-invitations-dialog").getByRole("button", { name: "Принять", exact: true }).click();
  await other.locator(".marriage-invitations-dialog h2").getByText("Брак заключён!").waitFor();
  assert.equal(await other.locator(".marriage-invitations-dialog").getAttribute("data-marriage-state"), "confirmed");
  await closeAll(page); await closeAll(other); await socialLoad(page);
  await page.locator(".marriage-notice-dialog[open]").waitFor();
  await geometry(page, ".marriage-notice-dialog", "marriage-confirmed-sender");
  await page.locator(".marriage-notice-dialog").getByRole("button", {name:"Понятно",exact:true}).click();
  await page.locator(".marriage-notice-dialog").waitFor({state:"detached"});
  await page.evaluate(id => window.KillexPlayerProfile.open(id), b.profile.id);
  await page.locator("#playerProfileDialog").getByRole("button", { name: "Подарить подарок", exact: true }).click();
  await page.locator(".social-gift-card").filter({hasText:"Мишка"}).locator("button").click();
  await page.locator(".social-gift-confirm").getByRole("button", { name: "Подарить", exact: true }).click();
  await page.locator(".gift-sent-dialog[open]").waitFor(); await geometry(page, ".gift-sent-dialog", "gift-sent");
  assert.equal(await page.locator(".gift-sent-dialog .achievement-earned-name").innerText(), "Луна");
  await socialLoad(other); await other.locator(".gift-received-dialog[open]").waitFor();
  assert.equal(await other.locator(".gift-received-dialog .achievement-earned-name").innerText(), "Арден");
  for (const size of [{width:1366,height:900}, {width:390,height:844}, {width:844,height:390}]) {
    await other.setViewportSize(size); await geometry(other, ".gift-received-dialog", "gift-received-" + size.width);
  }
  await other.locator(".gift-received-dialog").getByRole("button", { name: "Спасибо!" }).click();
  await other.locator(".gift-received-dialog").waitFor({state:"detached"});
  await closeAll(page);
  await page.evaluate(id => window.KillexPlayerProfile.open(id), b.profile.id);
  await page.locator("#playerProfileDialog").getByRole("button", {name:"Расторгнуть брак",exact:true}).click();
  await page.locator(".marriage-dialog").getByRole("button", {name:"Расторгнуть",exact:true}).click();
  await page.locator(".divorce-notice-dialog[open]").waitFor();
  await geometry(page, ".divorce-notice-dialog", "divorce-initiator");
  await page.locator(".divorce-notice-dialog").getByRole("button", {name:"Понятно",exact:true}).click();
  await page.locator(".divorce-notice-dialog").waitFor({state:"detached"});
  await page.waitForTimeout(200); await socialLoad(other);
  await other.locator(".divorce-notice-dialog[open]").waitFor();
  await geometry(other, ".divorce-notice-dialog", "divorce-incoming");
  await other.reload(); await other.waitForFunction(() => !window.KillexBoot?.active);
  await other.locator(".divorce-notice-dialog[open]").waitFor();
  await other.locator(".divorce-notice-dialog").getByRole("button", { name: "Понятно" }).click();
  await other.locator(".divorce-notice-dialog").waitFor({state:"detached"});
  assert.equal(store.find(b.token).social.divorceNotices.length, 0);
  store.socialAction(a.token, { action: "gift-anonymous", targetId: b.profile.id, giftId: "teddy", confirmed: true, anonymous: true, requestId: randomUUID() });
  await socialLoad(other); await other.locator(".gift-received-dialog[open]").waitFor();
  assert.equal(await other.locator(".gift-received-dialog .achievement-earned-name").innerText(), "Анонимный игрок");
  assert.equal(await other.locator(".gift-received-dialog .player-avatar").count(), 0);
  await geometry(other, ".gift-received-dialog", "gift-anonymous");
  await other.locator(".gift-received-dialog").getByRole("button", { name: "Спасибо!" }).click();
  await closeAll(page);
  // Browser presentation checks for real notification component, independent of economic fixtures.
  // Keep background profile refreshes from replacing this isolated presentation fixture.
  await page.route("**/api/**", route => route.abort());
  await page.waitForTimeout(500);
  await page.locator("#promoCodeSection").click();
  await page.evaluate(() => {
    const p = structuredClone(window.__profile); p.id += "-notice-test";
    const a = p.progress.achievements.find(a => a.id === "generous"); a.claimed = 1;
    p.progress.achievements = [a]; window.__noticeProfile = p;
    window.KillexAchievementNoticeUI.update(p);
  });
  await page.locator("#achievementNotice[open]").waitFor();
  assert.equal(await page.evaluate(() => window.KillexWindows.top().id), "achievementNotice");
  assert.equal(await page.locator("#promoCodeDialog[open]").count(), 1);
  await page.evaluate(() => window.KillexWindows.open(document.getElementById("promoCodeDialog")));
  assert.equal(await page.evaluate(() => window.KillexWindows.top().id), "achievementNotice");
  await geometry(page, "#achievementNotice", "achievement-above-window");
  await page.locator("#achievementNotice").getByRole("button", {name:"Отлично",exact:true}).click();
  assert.equal(await page.locator("#promoCodeDialog[open]").count(), 1);
  await page.evaluate(() => {
    document.getElementById("promoCodeDialog").close(); document.body.dataset.screen = "arena";
    const p = window.__noticeProfile; p.progress.achievements[0].claimed = 2; p.revision++;
    window.KillexAchievementNoticeUI.update(p);
  });
  await page.waitForTimeout(100); assert.equal(await page.locator("#achievementNotice[open]").count(), 0);
  await page.evaluate(() => { document.body.dataset.screen = "lobby"; });
  await page.locator("#achievementNotice[open]").waitFor();
  report.checks.push({label:"achievement stacks above dialogs and waits outside lobby"});
  assert.deepEqual(report.errors, []); assert.deepEqual(report.missing, []);
  console.log(JSON.stringify({engine, checks:report.checks.length, errors:report.errors}));
})().catch(error => { report.failure = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  fs.writeFileSync(path.join(output,"report.json"), JSON.stringify(report,null,2));
  await browser?.close(); await app.close();
});

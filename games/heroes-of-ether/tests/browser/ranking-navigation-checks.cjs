"use strict";
const assert = require("node:assert/strict");
const path = require("node:path");

module.exports = async function verifyNavigation(page, directory, engine) {
  const box = async locator => { const rect = await locator.boundingBox(); assert(rect); return rect; };
  const screenshot = async name => { if (directory) await page.screenshot({path:path.join(directory,engine+"-"+name+".png")}); };
  await page.addLocatorHandler(page.locator("#achievementNotice[open]"), dialog => dialog.locator("button").first().click());
  await page.setViewportSize({width:1366,height:768});
  await page.locator("#rankingsButton").click();
  const tops = page.locator("#topsDialog");
  await tops.getByRole("button",{name:"Топ кланов",exact:true}).click();
  const rows = tops.locator(".clan-ranking-row");
  await rows.first().waitFor();
  const sidebar = await box(tops.locator(".tops-nav")), table = await box(tops.locator(".ranking-clans-table"));
  assert(sidebar.x+sidebar.width <= table.x+1 && table.width > 3*sidebar.width,"desktop sidebar proportion");
  const last = await box(rows.last());
  assert(last.y+last.height <= table.y+table.height+1,"ten desktop rows visible");
  for (const [width,height,minimum] of [[1366,768,48],[1920,1080,60]]) {
    await page.setViewportSize({width,height});
    const row = await box(rows.first()), dialog = await box(tops), footer = await box(tops.locator(".ranking-footer"));
    assert(row.height >= minimum && dialog.y+dialog.height-footer.y-footer.height < 26,
      "Table should fill desktop: "+JSON.stringify({width,row,dialog,footer}));
  }
  await page.setViewportSize({width:1366,height:768});
  await screenshot("desktop-clans");
  assert.equal(await rows.count(),10);
  assert.equal(await tops.locator(".clan-status,[role=status]").count(),0);
  assert(!await tops.locator(".interface-footer").isVisible());
  await tops.getByRole("button",{name:"Казна",exact:true}).click();
  await tops.locator(".ranking-columns").getByText("Казна").waitFor();
  await tops.getByRole("button",{name:"Топ игроков",exact:true}).click();
  await tops.getByRole("button",{name:"Киллы за день",exact:true}).click();
  await tops.locator(".daily-ranking-prizes").waitFor();
  await tops.getByRole("button",{name:"Рекорды",exact:true}).click();
  await tops.getByRole("button",{name:"Масса",exact:true}).waitFor();
  await tops.locator(".clan-ranking-player .ranking-score").filter({hasText:/2\s?630/}).first().waitFor();
  await tops.getByRole("button",{name:"Поглощения игроков",exact:true}).click();
  await tops.locator(".clan-ranking-player .ranking-score").filter({hasText:/^18$/}).first().waitFor();
  await screenshot("desktop-records");
  await tops.getByRole("button",{name:"Топ исполнителей",exact:true}).click();
  await tops.locator(".event-ranking-prizes").waitFor();
  await tops.locator(".booster-close").click();
  const failedRead = route => route.fulfill({status:503,json:{error:"Внутренняя ошибка"}});
  await page.route("**/api/clans?*",failedRead);
  await page.locator("#rankingsButton").click();
  const retry = tops.getByRole("button",{name:"Попробовать снова"});
  await retry.waitFor();
  assert.equal(await tops.locator(".clan-status,[role=status]").count(),0);
  assert(!await tops.getByText("Внутренняя ошибка").count());
  await page.unroute("**/api/clans?*",failedRead);
  await retry.click();
  await tops.getByRole("button",{name:"Рекорды",exact:true}).waitFor();
  await tops.locator(".booster-close").click();
  await page.setViewportSize({width:844,height:320});
  await page.locator("#newsSection").tap();
  await page.removeLocatorHandler(page.locator("#releaseNotesDialog[open]"));
  const news = page.locator("#releaseNotesDialog");
  for(const id of ["news","event","release"]) {
    await news.locator('[data-category="'+id+'"]').tap();
    const menu = await box(news.locator(".news-tabs")), article = await box(news.locator("article"));
    assert(menu.x+menu.width < article.x+1 && article.width > menu.width*2,"article must be right of the banners");
    const figure = news.locator(".news-event-figure");
    if(await figure.count()) assert((await box(figure)).width < article.width/2);
  }
  await screenshot("mobile-news");
  const next = news.getByRole("button",{name:"Следующая страница новостей"});
  if(await next.isEnabled()) {
    const first = await news.locator("article").getAttribute("data-article-id"); await next.tap();
    assert.notEqual(await news.locator("article").getAttribute("data-article-id"),first);
  }
  await news.locator(".booster-close").tap();
  await page.locator("#shopSection").tap();
  const shop = page.locator("#boosterDialog"), buys = shop.locator(".booster-purchase-options").first();
  const options = await buys.locator("button").all();
  assert.equal(options.length,2);
  const actions = await box(buys), shopBox = await box(shop);
  await screenshot("mobile-shop");
  assert(actions.y+actions.height <= shopBox.y+shopBox.height,"both pack sizes visible "+JSON.stringify({actions,shopBox}));
  await shop.locator(".booster-close").tap();
  await page.locator("#rouletteButton").tap();
  const wheel = page.locator("#rouletteDialog");
  assert(!await wheel.getByRole("button",{name:"Колесо",exact:true}).isVisible());
  const frame = await box(wheel.locator(".roulette-wheel-frame")), spin=await box(wheel.locator(".roulette-spin").first());
  assert(frame.width >= 210 && frame.x+frame.width < spin.x,"wheel enlarged in its own column");
  for (const panel of ["Билеты","Призы"]) {
    const tab = wheel.getByRole("button",{name:panel,exact:true});
    if (!await tab.isVisible()) continue;
    await tab.tap();
    assert(await wheel.locator(".roulette-wheel-frame").isVisible());
    await wheel.getByRole("button",{name:"Вернуться к вращению"}).tap();
    assert(await wheel.locator(".roulette-spin").first().isVisible());
  }
  await wheel.locator(".booster-close").tap();
  await page.locator("#playButton").tap();
  const toggle = page.locator("#arena .arena-chat-toggle"), chat = page.locator("#arenaChatBody");
  await toggle.tap();
  assert((await box(chat.locator(".chat-log"))).height >= 90,"room for chat history");
  const joystick = await box(page.locator("#joystick"));
  const chatBox = await box(chat);
  assert(chatBox.y+chatBox.height <= joystick.y || chatBox.x+chatBox.width <= joystick.x);
  await screenshot("mobile-chat");
  await toggle.tap();
};

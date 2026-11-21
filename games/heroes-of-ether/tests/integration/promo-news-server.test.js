"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), { once } = require("node:events"), { randomUUID } = require("node:crypto");
const { createGameServer } = require("../../src/server/game-server"), { ProfileStore } = require("../../src/server/profiles/profile-store"),
  { OwnerAccess } = require("../../src/server/admin/owner-access");
test("HTTP promo/news: owner authorization, CSRF, bounded global limit, concurrent retry and private catalog", async t => {
  const store = new ProfileStore(), owner = store.open(), a = store.open(), b = store.open(), access = new OwnerAccess({ ownerId: owner.profile.id });
  const app = createGameServer({ profiles: store, ownerAccess: access, autoTick: false, testBots: { enabled: false } });
  app.httpServer.listen(0, "127.0.0.1"); await once(app.httpServer, "listening"); t.after(() => app.close());
  const url = "http://127.0.0.1:" + app.httpServer.address().port;
  let adminCookie = "", csrf = "";
  const request = async (route, token, body, headers = {}) => {
    const res = await fetch(url + route, { method: body ? "POST" : "GET", headers: {
      Cookie: "sferorumiya_session=" + token + (token === owner.token ? "; " + adminCookie : ""), Origin: url,
      ...(body ? { "Content-Type": "application/json", "X-Owner-CSRF": csrf } : {}), ...headers,
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, headers: res.headers, data: await res.json() };
  };
  assert.equal((await request("/api/admin/promo-codes", a.token)).status, 403);
  assert.equal((await request("/api/admin/news", owner.token)).status, 401);
  const login = await request("/api/admin/setup", owner.token, { password: "Long valid admin password 2026", setupCode: access.bootstrapCode });
  assert.equal(login.status, 200); adminCookie = login.headers.get("set-cookie").split(";")[0]; csrf = login.data.csrf;
  const cmd = { requestId: randomUUID(), revision: 0, reason: "HTTP test", code: "LAST-ONE", title: "Один приз", enabled: true,
    startsAt: 0, endsAt: 0, maxRedemptions: 1, rewards: [{ kind: "currency", id: "bucks", amount: 7 }] };
  assert.equal((await request("/api/admin/promo-codes", owner.token, cmd, { "X-Owner-CSRF": "wrong" })).status, 403);
  assert.equal((await request("/api/admin/promo-codes", owner.token, cmd, { Origin: "https://foreign.invalid" })).status, 403);
  assert.equal((await request("/api/admin/promo-codes", owner.token, cmd)).status, 200);
  assert.equal((await request("/api/admin/promo-codes", owner.token, cmd)).data.replay, true);
  const input = { code: cmd.code, requestId: randomUUID() }, before = store.find(a.token).wallet.bucks;
  assert.equal((await request("/api/promo-code/redeem", a.token, input, { Origin: "https://foreign.invalid" })).status, 403);
  const attempts = await Promise.all(Array.from({ length: 10 }, () => request("/api/promo-code/redeem", a.token, input)));
  assert.ok(attempts.every(r => r.status === 200));
  assert.equal(attempts.filter(r => !r.data.replay).length, 1);
  assert.equal(store.find(a.token).wallet.bucks, before + 7);
  assert.equal((await request("/api/promo-code/redeem", a.token, { ...input, requestId: randomUUID() })).status, 409);
  assert.equal((await request("/api/promo-code/redeem", b.token, { ...input, requestId: randomUUID() })).status, 409);
  assert.equal(store.data.promoCodes.items[0].redeemed, 1);
  assert.equal(JSON.stringify(store.view(store.find(a.token))).includes("LAST-ONE"), false, "catalog and claim history are not broadcast with player snapshots");
  const deletion={action:"delete",confirmed:true,id:store.data.promoCodes.items[0].id,revision:store.data.promoCodes.revision,requestId:randomUUID(),reason:"Акция завершена"};
  assert.equal((await request("/api/admin/promo-codes",a.token,deletion)).status,403);
  assert.equal((await request("/api/admin/promo-codes",owner.token,deletion,{"X-Owner-CSRF":"wrong"})).status,403);
  assert.equal((await request("/api/admin/promo-codes",owner.token,deletion,{Origin:"https://foreign.invalid"})).status,403);
  assert.equal((await request("/api/admin/promo-codes",owner.token,deletion)).status,200);
  assert.equal((await request("/api/admin/promo-codes",owner.token,deletion)).data.replay,true);
  assert.equal((await request("/api/admin/promo-codes",owner.token)).data.items.length,0);
  assert.equal((await request("/api/promo-code/redeem",a.token,input)).status,200);
  assert.equal(store.find(a.token).wallet.bucks,before+7);
  const news = { requestId: randomUUID(), revision: 0, reason: "HTTP test", title: "Новость", body: "Сохранённая статья",
    date: "2026-11-13", category: "news", visible: false };
  const draft = await request("/api/admin/news", owner.token, news); assert.equal(draft.status, 200);
  assert.equal((await request("/api/news", a.token)).data.items.length, 0);
  const published = await request("/api/admin/news", owner.token, { ...news, id: draft.data.id, revision: draft.data.revision, visible: true, requestId: randomUUID() });
  assert.equal(published.status, 200);
  assert.equal((await request("/api/news", a.token)).data.items[0].date, news.date);
  const removeNews={action:"delete",id:draft.data.id,confirmed:true,revision:published.data.revision,requestId:randomUUID(),reason:"Удаление статьи"};
  assert.equal((await request("/api/admin/news",owner.token,{...removeNews,confirmed:false})).status,400);
  assert.equal((await request("/api/admin/news",owner.token,removeNews)).status,200);
  assert.equal((await request("/api/admin/news",owner.token,removeNews)).data.replay,true);
  assert.equal((await request("/api/news",a.token)).data.items.length,0);
  assert.equal((await request("/api/admin/trash",a.token)).status,403);
  const bin=await request("/api/admin/trash",owner.token);assert.equal(bin.data.total,2);
  const article=bin.data.items.find(item=>item.domain==="gameNews");
  const restore={trashId:article.id,revision:article.revision,confirmed:true,requestId:randomUUID(),reason:"Вернуть статью"};
  assert.equal((await request("/api/admin/trash",owner.token,restore,{"X-Owner-CSRF":"wrong"})).status,403);
  assert.equal((await request("/api/admin/trash",owner.token,restore,{Origin:"https://foreign.invalid"})).status,403);
  assert.equal((await request("/api/admin/trash",a.token,restore)).status,403);
  assert.equal((await request("/api/admin/trash",owner.token,restore)).status,200);
  assert.equal((await request("/api/admin/trash",owner.token,restore)).data.replay,true);
  assert.equal((await request("/api/news",a.token)).data.items[0].id,draft.data.id);
});

/* Synthetic HTTP lobby clients in a separate process, alongside the arena driver. */
"use strict";
const { randomUUID } = require("node:crypto"),
  { performance } = require("node:perf_hooks");
const clients = [];
const realistic = process.env.LOAD_REALISTIC === "1";
const plan = require("./realistic-lobby-plan.cjs");
const mixedSocial = realistic || process.env.LOAD_MIXED_SOCIAL === "1";
const chatLoad = process.env.LOAD_CHAT === "1";
const idleLobby = process.env.LOAD_LOBBY_IDLE === "1";
const alchemyLoad=process.env.LOAD_ALCHEMY==="1";
const actionCount = realistic ? plan.COUNT : alchemyLoad ? 12 : chatLoad ? 9 : mixedSocial ? 8 : 6;
let base,
  enabled = false,
  timers = new Set(),
  stats;
const reset = () => (stats = { requests: 0, success: 0, errors: {}, actions: {}, latencies: [] });
reset();
function scheduleIdle(c, pathname, interval, delay = interval) {
  const timer = setTimeout(async () => {
    timers.delete(timer); if (!enabled) return;
    const measured = stats, start = performance.now(); measured.requests++;
    try {
      const response = await fetch(base + pathname, { headers: { Cookie: "sferorumiya_session=" + c.token,
        ...(c.address ? { "X-Real-IP": c.address } : {}) }, signal: AbortSignal.timeout(15000) });
      await response.json(); if (!response.ok) throw Error(String(response.status));
      measured.success++; measured.actions[pathname] = (measured.actions[pathname] || 0) + 1;
    } catch (e) { measured.errors[e.message] = (measured.errors[e.message] || 0) + 1; }
    finally { measured.latencies.push(performance.now() - start); }
    if (enabled && interval) scheduleIdle(c, pathname, interval);
  }, delay);
  timers.add(timer);
}
function schedule(c, delay) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    run(c);
  }, delay);
  timers.add(timer);
}
function action(c) {
  const step = c.step++;
  if(realistic){const request=plan.extra(c,step);if(request)return request;}
  switch (step % actionCount) {
    case 9:
      return ["alchemy-exchange","/api/alchemy/action",{action:"exchange",requestId:randomUUID()}];
    case 10:
      return c.alchemyRunId ? ["alchemy-brew","/api/alchemy/action",{action:"brew",potionId:require("../../public/shared/alchemy-rules").potions[Math.floor(step/12)%16].id,runId:c.alchemyRunId,requestId:randomUUID()}] : ["profile","/api/profile"];
    case 11:
      return ["alchemy-equip","/api/alchemy/action",{action:"equip",potionId:require("../../public/shared/alchemy-rules").potions[Math.floor(step/12)%16].id,requestId:randomUUID()}];
    case 0:
      return ["profile", "/api/profile"];
    case 1:
      return ["rankings", "/api/clans?scope=rankings"];
    case 2:
      return [
        "loadout",
        "/api/profile/loadout",
        {
          requestId: randomUUID(),
          skinId: step % 12 === 2 ? "moon-dragon" : "forest-spirit",
          quickSlots: ["candy"],
        },
      ];
    case 3:
      return ["purchase", "/api/shop/buy", { requestId: randomUUID(), boosterId: "candy" }];
    case 4: {
      const index = c.bonus++;
      if (index < 6)
        return [
          "account-bonus",
          "/api/profile/account-bonus",
          {
            requestId: randomUUID(),
            kind: index < 3 ? "vip" : "premium",
            currency: ["coins", "crystals", "bucks"][index % 3],
          },
        ];
      return ["daily-reward", "/api/profile/login-reward", {}];
    }
    case 6:
      if (!mixedSocial) return ["profile", "/api/profile"];
      return ["gift", "/api/social/action", {
        action: "gift", targetId: c.targetId, giftId: "chocolates", confirmed: true, requestId: randomUUID(),
      }];
    case 7:
      if (!mixedSocial) return ["social-view", "/api/social"];
      if (c.notices.length) return ["gift-read", "/api/social/action", {
        action: "gift-read", noticeId: c.notices.shift(), requestId: randomUUID(),
      }];
      return ["social-view", "/api/social"];
    case 8:
      if (!chatLoad) return ["profile", "/api/profile"];
      return ["chat", "/api/clans/chat", {clanId:c.clanId, requestId: randomUUID(), text: `План на арену ${step}`}];
    default:
      return ["social-view", "/api/social"];
  }
}
async function run(c) {
  if (!enabled) return;
  const request = action(c),
    measured = stats;
  async function execute([name,url,body]) {
    const start=performance.now();
    measured.requests++;
    try {
    const response = await fetch(base + url, {
      method: body ? "POST" : "GET",
      headers: { Cookie: "sferorumiya_session=" + c.token, Origin: base, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok) throw Error(response.status + ": " + (data.error || "request failed"));
    measured.success++;
    if(realistic)plan.update(c,data);
    if (Array.isArray(data.social?.giftNotices)) c.notices = data.social.giftNotices.map(n => n.id);
    c.audit(body?.requestId, "lobby:" + name, name === "gift" ? { targetId: body.targetId, giftId: body.giftId } :
      name === "gift-read" ? { noticeId: body.noticeId } :
      name.startsWith("clan-") ? {clanId:body?.clanId||c.clanId,amount:body?.amount,boosterId:body?.boosterId} : undefined);
    measured.actions[name] = (measured.actions[name] || 0) + 1;
    } finally { measured.latencies.push(performance.now()-start); }
  }
  try {
    await execute(request);
    // Fetch and acknowledge a newly received gift in this visit instead of
    // waiting a full nine-action cycle before the first read can be exercised.
    if(mixedSocial && request[0]==="social-view" && c.notices.length)
      await execute(["gift-read","/api/social/action",{
        action:"gift-read",noticeId:c.notices.shift(),requestId:randomUUID(),
      }]);
  } catch (e) {
    measured.errors[e.message] = (measured.errors[e.message] || 0) + 1;
  }
  if (enabled) schedule(c, Number(process.env.LOAD_LOBBY_INTERVAL || 5000));
}
process.on("message", (m) => {
  let result;
  if (m.type === "setup") {
    base = m.base;
    if (mixedSocial && (!Array.isArray(m.profileIds) || m.profileIds.length !== m.tokens.length || m.tokens.length < 2))
      throw Error("Mixed social load requires recipient profiles");
    if(chatLoad && (!Array.isArray(m.clanIds) || m.clanIds.length!==m.tokens.length || m.clanIds.some(id=>!id)))
      throw Error("Chat load requires clan membership for every lobby player");
    clients.push(...m.tokens.map((token, i) => ({ token, slot:i+1, step: realistic ? 0 : i % actionCount, bonus: 0,alchemyRunId:m.alchemyRunId,
      address: process.env.LOAD_LOBBY_DISTINCT_IPS === "1" ? `198.18.${Math.floor(i / 250)}.${i % 250 + 1}` : null,
      targetId: m.profileIds?.[(i + 1) % m.tokens.length], clanId:m.clanIds?.[i], notices: [],
      audit: require("./load-ack-audit.cjs").createAckAudit(token) })));
    result = { clients: clients.length };
  } else if (m.type === "phase") {
    reset();
    result = {};
    if (!enabled) {
      enabled = true;
      if (idleLobby) clients.forEach((c, i) => {
        // Match the visible lobby's existing heartbeat/social/availability periods.
        // Animations have no server messages. Profiles/news load once on entry.
        for (const [pathname, interval] of [["/api/presence",20000],["/api/social",15000],["/api/service-status",10000],["/api/profile",0],["/api/news",0]])
          scheduleIdle(c, pathname, interval, i * 10000 / clients.length);
      });
      else clients.forEach((c, i) =>
        schedule(
          c,
          process.env.LOAD_LOBBY_BURST === "1"
            ? 0
            : (i * Number(process.env.LOAD_LOBBY_INTERVAL || 5000)) / clients.length,
        ),
      );
    }
  } else if (m.type === "stats") {
    const sorted = [...stats.latencies].sort((a, b) => a - b);
    result = {
      clients: clients.length,
      mode: idleLobby ? "visible-idle-lobby" : "active-lobby-actions",
      ipMode: process.env.LOAD_LOBBY_DISTINCT_IPS === "1" ? "distinct-synthetic-proxy-addresses" : "single-generator-address",
      ...stats,
      pending: stats.requests - stats.latencies.length,
      latencies: undefined,
      latencyMs: {
        p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
        p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
        max: sorted.at(-1) || 0,
      },
    };
  } else if (m.type === "stop") {
    enabled = false;
    timers.forEach(clearTimeout);
    timers.clear();
    result = {};
  }
  process.send({ id: m.id, result });
});
process.on("disconnect", () => process.exit());

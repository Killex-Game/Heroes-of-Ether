"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  path = require("node:path"),
  { randomUUID } = require("node:crypto");
const { temporary } = require("../temp"),
  { EventManager } = require("../../src/server/events/event-manager"),
  { ProfileStore } = require("../../src/server/profiles/profile-store"),
  lite = require("../../src/server/accounts/lite-account"),
  roulette = require("../../src/server/roulette/roulette-service"),
  rules = require("../../public/shared/roulette-rules");
const draft = (id) => ({
  schemaVersion: 1,
  id,
  title: "Тест цикла Lite",
  description: "Изолированный тест",
  durationMinutes: 60,
  contentPack: "core-v1",
  features: { roulette: true, lite: true },
});
for (const ending of ["expiry", "stop"])
  for (const nextId of ["first", "second"])
    test(`Lite expires by ${ending}, can be bought for ${nextId === "first" ? "repeat" : "new event"}, restores limits and preserves tickets`, (t) => {
      const folder = temporary(t, "lite-event-lifecycle"),
        profilePath = path.join(folder, "profiles.json"),
        eventPath = path.join(folder, "events.json");
      let now = Date.UTC(2026, 9, 23, 10),
        store = new ProfileStore({
          filePath: profilePath,
          now: () => now,
          rouletteConfig: { testEnabled: true },
        }),
        events = new EventManager({ filePath: eventPath, now: () => now });
      store.events = events;
      const auth = store.open(),
        p = () => store.find(auth.token),
        view = () => store.view(p()).roulette.lite;
      const event = (action, body) =>
        events.apply("owner", action, {
          revision: events.data.revision,
          requestId: randomUUID(),
          ...body,
        });
      const order = () => ({
        productId: "account:lite",
        confirmed: true,
        eventId: view().eventId,
        requestId: randomUUID(),
      });
      const purchase = (body = order()) => store.confirmMockPurchase(auth.token, body);
      const action = (name, more = {}) =>
        roulette.mutate(
          store,
          auth.token,
          { action: name, requestId: randomUUID(), rulesVersion: rules.version, ...more },
          () => 0,
        );
      const buy = (currency, quantity, eventId = view().eventId) =>
        action("tickets", { currency, quantity, eventId });
      p().wallet = { coins: 100000, crystals: 10000, bucks: 1000 };
      lite.grantTickets(p(), 9);
      // The existing unlimited test subscription must not transfer to a real run.
      // Simulate a purchase saved by an older release; closed events no longer sell Lite.
      store.events = null;
      purchase();
      assert.equal(view().eventId, "test:unlimited");
      store.events = events;
      assert.equal(view().available, false);
      assert.throws(() => purchase(), /закончилось/);
      event("upload", { manifest: draft("first") });
      event("start", { eventId: "first" });
      const firstRun = events.active().id;
      assert.equal(view().active, false);
      assert.equal(view().available, true);
      const firstOrder = order();
      purchase(firstOrder);
      assert.equal(view().active, true);
      assert.equal(p().roulette.tickets, 109);
      buy("coins", 50);
      buy("crystals", 50);
      assert.deepEqual(view().remaining, { coins: 0, crystals: 0, bucks: null });
      action("prepare");
      const firstOffer = p().roulette.offer.id;
      const before = structuredClone(p()),
        tickets = p().roulette.tickets;
      if (ending === "expiry") now = events.active().endsAt;
      else {
        now += 1000;
        event("stop", { runId: firstRun });
      }
      assert.equal(view().active, false);
      assert.equal(view().available, false);
      assert.throws(() => purchase(), /закончилось/);
      assert.throws(() => buy("bucks", 1, firstRun));
      assert.throws(() => action("spin-five", { offerId: firstOffer }));
      lite.chestOpened(p(), store.rouletteConfig, now);
      assert.deepEqual(p(), before);
      assert.equal(purchase(firstOrder).replay, true);
      assert.equal(view().active, false);
      assert.deepEqual(p(), before);
      // Restore both stores while the event is closed.
      events = new EventManager({ filePath: eventPath, now: () => now });
      store = new ProfileStore({
        filePath: profilePath,
        now: () => now,
        rouletteConfig: { testEnabled: true },
      });
      store.events = events;
      assert.equal(view().active, false);
      assert.equal(view().available, false);
      assert.equal(p().roulette.tickets, tickets);
      if (nextId !== "first") event("upload", { manifest: draft(nextId) });
      event("start", { eventId: nextId });
      now = events.scheduled()?.startsAt ?? now;
      const secondRun = events.active().id;
      assert.notEqual(secondRun, firstRun);
      assert.equal(view().active, false);
      assert.equal(view().available, true);
      assert.deepEqual(view().remaining, { coins: 50, crystals: 50, bucks: null });
      assert.throws(() => purchase({ ...firstOrder, requestId: randomUUID() }), /изменилось/);
      assert.equal(purchase(firstOrder).replay, true);
      assert.equal(view().active, false);
      assert.equal(p().roulette.tickets, tickets);
      assert.throws(() => buy("bucks", 1), /активный Lite/);
      assert.equal(action("spin-five", { offerId: firstOffer }).result.spins.length, 5);
      const afterSpinTickets = tickets - 5;
      lite.chestOpened(p(), store.rouletteConfig, now);
      assert.equal(p().roulette.tickets, afterSpinTickets);
      const secondOrder = order();
      purchase(secondOrder);
      assert.equal(view().active, true);
      assert.equal(p().roulette.tickets, afterSpinTickets + 50);
      assert.equal(purchase(secondOrder).replay, true);
      assert.equal(p().roulette.tickets, afterSpinTickets + 50);
      assert.throws(() => purchase(), /уже куплен/);
      assert.throws(() => buy("coins", 1, firstRun), /активный Lite/);
      buy("coins", 50);
      buy("crystals", 50);
      assert.deepEqual(view().remaining, { coins: 0, crystals: 0, bucks: null });
      assert.equal(p().roulette.tickets, afterSpinTickets + 150);
      assert.equal(Object.keys(p().lite.events).length, 3);
      const restored = new ProfileStore({ filePath: profilePath, now: () => now });
      restored.events = new EventManager({ filePath: eventPath, now: () => now });
      assert.equal(restored.view(restored.find(auth.token)).roulette.lite.active, true);
      assert.equal(restored.confirmMockPurchase(auth.token, secondOrder).replay, true);
      assert.deepEqual(restored.find(auth.token), p());
    });

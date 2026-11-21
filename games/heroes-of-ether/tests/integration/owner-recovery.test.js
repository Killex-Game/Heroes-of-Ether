"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const { createGameServer } = require("../../src/server/game-server");
const { ProfileStore } = require("../../src/server/profiles/profile-store");
const { OwnerAccess } = require("../../src/server/admin/owner-access");
const { Arena } = require("../../src/server/arena/arena-simulation");
const password = "Recovery fixture password 2026";
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-recovery-"));
  const filePath = path.join(dir, "profiles.json");
  const profiles = new ProfileStore({ filePath }),
    owner = profiles.open(),
    guest = profiles.open();
  profiles.ownerId = owner.profile.id;
  profiles.find(owner.token).name = "Killex";
  profiles.save(profiles.data);
  const access = new OwnerAccess({ ownerId: owner.profile.id });
  const app = createGameServer({
    profiles,
    ownerAccess: access,
    autoTick: false,
    arena: new Arena({ etherCount: 0 }),
    testBots: { enabled: false },
  });
  app.httpServer.listen(0, "127.0.0.1");
  await once(app.httpServer, "listening");
  t.after(async () => {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${app.httpServer.address().port}`;
  async function request(route, body, headers = {}) {
    const r = await fetch(url + route, {
      method: body ? "POST" : "GET",
      headers: { Origin: url, ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, cookie: r.headers.get("set-cookie"), data: await r.json() };
  }
  const setup = await request(
    "/api/admin/setup",
    { password, setupCode: access.bootstrapCode },
    { Cookie: `sferorumiya_session=${owner.token}` },
  );
  assert.equal(setup.status, 200);
  return { profiles, owner, guest, access, app, request, filePath, dir, url };
}
test("Owner recovery preserves every profile, rotates only owner binding, and survives restart", async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.profiles.data);
  const r = await f.request(
    "/api/admin/recover-profile",
    { password },
    { Cookie: `sferorumiya_session=${f.guest.token}` },
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.name, "Killex");
  assert.match(r.cookie, /HttpOnly; SameSite=Strict; Path=\/; Max-Age=31536000/);
  const token = r.cookie.split(";")[0].split("=")[1];
  assert.equal(f.profiles.find(f.owner.token), undefined);
  assert.deepEqual(
    f.profiles.find(token),
    Object.values(before.profiles).find((p) => p.id === f.owner.profile.id),
  );
  assert.deepEqual(
    f.profiles.find(f.guest.token),
    Object.values(before.profiles).find((p) => p.id === f.guest.profile.id),
  );
  const keyless = (data) => ({
    ...data,
    profiles: Object.values(data.profiles).sort((a, b) => a.id.localeCompare(b.id)),
  });
  assert.deepEqual(keyless(f.profiles.data), keyless(before));
  assert.equal(Object.keys(f.profiles.data.profiles).length, 2);
  const restored = new ProfileStore({ filePath: f.filePath });
  assert.equal(restored.find(token).id, f.owner.profile.id);
  const backups = fs.readdirSync(path.join(f.dir, "recovery-backups"));
  assert.equal(backups.length, 1);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.dir, "recovery-backups", backups[0]))),
    before,
  );
  assert.equal(f.access.session, null); // no automatic admin privilege
  const status = await f.request("/api/admin/status", null, { Cookie: r.cookie.split(";")[0] });
  assert.equal(status.status, 200);
  assert.equal(status.data.authenticated, false);
});
test("Lost recovery response can be retried without duplicate rewards or profiles", async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.profiles.byId(f.owner.profile.id));
  await f.request("/api/admin/recover-profile", { password }); // browser loses this response
  const retry = await f.request("/api/admin/recover-profile", { password });
  assert.equal(retry.status, 200);
  assert.deepEqual(f.profiles.byId(f.owner.profile.id), before);
  assert.equal(Object.keys(f.profiles.data.profiles).length, 2);
});
test("Recovery rejects wrong passwords, cross-origin, public hosts and reverse proxy requests", async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.profiles.data);
  for (const headers of [
    { Origin: "http://evil.example" },
    { Origin: "" },
    { Host: "public.example", Origin: "http://public.example" },
    { "X-Forwarded-For": "127.0.0.1" },
    { "X-Forwarded-Proto": "https" },
    { Forwarded: "for=127.0.0.1" },
  ])
    assert.equal(
      (await f.request("/api/admin/recover-profile", { password }, headers)).status,
      403,
    );
  for (let n = 0; n < 5; n++)
    assert.equal(
      (await f.request("/api/admin/recover-profile", { password: "Invalid password 2026" })).status,
      403,
    );
  assert.equal((await f.request("/api/admin/recover-profile", { password })).status, 429);
  assert.deepEqual(f.profiles.data, before);
  assert.equal(f.access.failures.length, 5);
});
test("Write failure retains old session and full save; a later retry succeeds", async (t) => {
  const f = await fixture(t),
    before = structuredClone(f.profiles.data),
    bytes = fs.readFileSync(f.filePath);
  fs.mkdirSync(f.filePath + ".tmp");
  const r = await f.request("/api/admin/recover-profile", { password });
  assert.equal(r.status, 500);
  assert.equal(r.cookie, null);
  assert.deepEqual(f.profiles.data, before);
  assert.deepEqual(fs.readFileSync(f.filePath), bytes);
  assert.ok(f.profiles.find(f.owner.token));
  fs.rmdirSync(f.filePath + ".tmp");
  assert.equal((await f.request("/api/admin/recover-profile", { password })).status, 200);
});
test("Owner with a saved active life cannot be rebound", async (t) => {
  const f = await fixture(t);
  f.profiles.find(f.owner.token).progress.session = { id: "active-test-life" };
  const before = structuredClone(f.profiles.data);
  const r = await f.request("/api/admin/recover-profile", { password });
  assert.equal(r.status, 409);
  assert.equal(r.cookie, null);
  assert.deepEqual(f.profiles.data, before);
  f.profiles.find(f.owner.token).progress.session = null;
});
test("Unconfigured recovery and non-owner profile rotation remain denied", () => {
  const access = new OwnerAccess();
  assert.throws(() => access.guardRecovery({ headers: {}, socket: {} }), /только/);
  const profiles = new ProfileStore();
  profiles.open();
  assert.throws(() => profiles.rotateOwnerSession(), /не найден/);
});

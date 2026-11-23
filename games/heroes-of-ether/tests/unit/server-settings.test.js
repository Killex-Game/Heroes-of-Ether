"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { temporary } = require("../temp");
const { loadServerSettings } = require("../../src/server/runtime/server-settings");
const { inspect } = require("../../scripts/development/doctor.cjs");
function fixture(t) {
  const root = temporary(t, "server-settings"), config = path.join(root, "config"); fs.mkdirSync(config);
  for (const file of ["arena-rooms", "arena-state-workers", "appearance-testing", "owner-admin", "pet-events", "roulette-events", "promotions"])
    fs.copyFileSync(path.join(__dirname, "../../config", (file === "owner-admin" ? "owner-admin.example" : file) + ".json"), path.join(config, file + ".json"));
  const change = (name, update) => { const file = path.join(config, name + ".json"); const value = JSON.parse(fs.readFileSync(file)); update(value); fs.writeFileSync(file, JSON.stringify(value)); };
  return { root, change };
}
test("Startup settings preserve the configured rules and do not touch data", t => {
  const { root } = fixture(t), before = fs.readdirSync(root);
  const s = loadServerSettings(root, { PORT: "3001", HOST: "127.0.0.1", TRUST_LOOPBACK_PROXY: "1" }, 2);
  assert.equal(s.port, 3001); assert.equal(s.host, "127.0.0.1"); assert.equal(s.trustLoopbackProxy, true); assert.equal(s.stateWorkerCount, 1);
  assert.deepEqual(s.arena, JSON.parse(fs.readFileSync(path.join(root, "config/arena-rooms.json"))));
  assert.deepEqual(fs.readdirSync(root), before);
});
test("Bad startup settings fail before opening a journal or cloud connection", t => {
  for (const [name, edit] of [
    ["arena-rooms", p => { p.maximumArenaPlayers = p.maximumArenas * p.arenaCapacity + 1; }],
    ["arena-rooms", p => { p.maximumArenaPlayres = 700; }],
    ["arena-state-workers", p => { p.maxWorkers = 9; }],
    ["arena-state-workers", p => { p.enabled = "true"; }],
    ["appearance-testing", p => { p.unlockClanCrests = "false"; }],
    ["owner-admin", p => { p.publicOrigin = "https://secret:password@example.test/path"; }],
  ]) {
    const f = fixture(t); f.change(name, edit);
    assert.throws(() => loadServerSettings(f.root, {}), e => e.code === "SERVER_CONFIG" && !/secret|password/.test(e.message));
    assert.equal(fs.existsSync(path.join(f.root, "data")), false);
  }
  const f = fixture(t);
  for (const env of [{ PORT: "0" }, { PORT: "3000x" }, { HOST: "example.test" }, { TRUST_LOOPBACK_PROXY: "yes" }])
    assert.throws(() => loadServerSettings(f.root, env), { code: "SERVER_CONFIG" });
});

test("Windows UTF-8 BOM configs load with the same values as Node JSON modules",t=>{
  const {root}=fixture(t),file=path.join(root,'config/arena-rooms.json');
  const expected=loadServerSettings(root,{}).arena;
  fs.writeFileSync(file,'\uFEFF'+fs.readFileSync(file,'utf8'));
  assert.deepEqual(loadServerSettings(root,{}).arena,expected);
  assert.equal(fs.existsSync(path.join(root,'data')),false);
});
test("Doctor reports stale sync without exposing credentials or profile contents", t => {
  const { root } = fixture(t); fs.mkdirSync(path.join(root, "data"));
  fs.writeFileSync(path.join(root, "config/postgresql.local.json"), JSON.stringify({ enabled: true, host:"example.invalid",port:5432,schema:"heroether_test_doctor",caFile:path.join(root,"never-open-ca.pem"),credentialsFile: path.join(root, "never-open-secret.env"), database: "hero_ether_test_doctor", sourceId: "11111111-1111-1111-1111-111111111111" }));
  fs.writeFileSync(path.join(root, "data/postgresql-status.json"), JSON.stringify({ connected: true, syncedAt: 1, checkedAt: 1, revision: 7, password: "must-not-leak", uri: "postgresql://secret" }));
  fs.writeFileSync(path.join(root, "data/profiles.json.wal-7"), "private profile data");
  const report = inspect(root, { env: {}, now: 100000 });
  assert.equal(report.database.state, "stale"); assert.equal(report.database.revision, 7);
  assert.doesNotMatch(JSON.stringify(report), /secret|must-not-leak|sourceId|credentialsFile/);
  assert.equal(report.server.processPresent, false);
  assert.deepEqual(report.localStorage.files, [{ name: "profiles.json.wal-7", bytes: 20 }]);
});

"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { temporary } = require("../temp");
const { renameAtomic } = require("../../src/server/profiles/atomic-rename");

function files(t) {
  const dir = temporary(t, "atomic-rename"), destination = path.join(dir, "saved.json"), source = destination + ".tmp";
  fs.writeFileSync(destination, '{"value":"previous"}\n');
  fs.writeFileSync(source, '{"value":"next"}\n');
  return { destination, source };
}
test("temporary Windows replacement failures preserve the acknowledged file until an atomic retry succeeds", t => {
  for (const code of ["EPERM", "EACCES", "EBUSY"]) {
    const f = files(t), rename = fs.renameSync; let attempts = 0;
    const mock = t.mock.method(fs, "renameSync", (source, destination) => {
      assert.equal(fs.readFileSync(destination, "utf8"), '{"value":"previous"}\n');
      if (++attempts < 3) throw Object.assign(Error(code), { code });
      return rename(source, destination);
    });
    renameAtomic(f.source, f.destination, { platform: "win32" });
    assert.equal(attempts, 3);
    assert.equal(fs.readFileSync(f.destination, "utf8"), '{"value":"next"}\n');
    assert.equal(fs.existsSync(f.source), false);
    mock.mock.restore();
  }
});
test("persistent Windows refusal is bounded and retains both old data and the retryable temporary file", t => {
  const f = files(t), failure = Object.assign(Error("locked"), { code: "EPERM" }); let attempts = 0;
  t.mock.method(fs, "renameSync", () => { attempts++; throw failure; });
  assert.throws(() => renameAtomic(f.source, f.destination, { platform: "win32" }), error => error === failure);
  assert.equal(attempts, 5);
  assert.equal(fs.readFileSync(f.destination, "utf8"), '{"value":"previous"}\n');
  assert.equal(fs.readFileSync(f.source, "utf8"), '{"value":"next"}\n');
});
test("Linux failures and permanent Windows failures are returned immediately without modifying either file", t => {
  const f = files(t);
  for (const [platform, code] of [["linux", "EPERM"], ["darwin", "EBUSY"], ["win32", "ENOSPC"], ["win32", "ENOENT"]]) {
    let attempts = 0; const failure = Object.assign(Error(code), { code });
    const mock = t.mock.method(fs, "renameSync", () => { attempts++; throw failure; });
    assert.throws(() => renameAtomic(f.source, f.destination, { platform }), error => error === failure);
    assert.equal(attempts, 1); mock.mock.restore();
  }
  assert.equal(fs.readFileSync(f.destination, "utf8"), '{"value":"previous"}\n');
});
test("a refused offline profile save does not publish the new world or lose the old checkpoint", t => {
  const { ProfileStore } = require("../../src/server/profiles/profile-store");
  const filePath = path.join(temporary(t, "offline-save-failure"), "profiles.json");
  const store = new ProfileStore({ filePath }), user = store.open();
  const previous = store.data, bytes = fs.readFileSync(filePath);
  const next = structuredClone(previous); next.profiles[Object.keys(next.profiles)[0]].name = "Сохранён";
  const failure = Object.assign(Error("file locked"), { code: "EPERM" });
  const mock = t.mock.method(fs, "renameSync", () => { throw failure; });
  assert.throws(() => store.writeSnapshot(next), error => error === failure);
  assert.equal(store.data, previous); assert(fs.readFileSync(filePath).equals(bytes));
  mock.mock.restore(); store.writeSnapshot(next);
  assert.equal(store.data, next);
  const recovered = new ProfileStore({ filePath });
  assert.equal(recovered.find(user.token).name, "Сохранён");
});

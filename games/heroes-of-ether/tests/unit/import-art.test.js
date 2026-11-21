/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { temporary } = require("../temp");
const { importArt } = require("../../scripts/assets/import-player-skins");
const manifest = require("../../public/assets/skins/manifest.json");
function dirs(t) {
  const root = temporary(t, "art");
  const src = path.join(root, "src"),
    dest = path.join(root, "dest");
  fs.mkdirSync(src);
  return { src, dest };
}
test("Импорт копирует PNG без изменения байтов и распознаёт исходные имена", (t) => {
  const { src, dest } = dirs(t);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfVEAAAAASUVORK5CYII=",
    "base64",
  );
  for (const s of manifest) fs.writeFileSync(path.join(src, s.original), png);
  const result = importArt(src, dest);
  assert.ok(result.every((r) => r.status === "copied"));
  for (const s of manifest) assert.deepEqual(fs.readFileSync(path.join(dest, s.id + ".png")), png);
});
test("Импорт сообщает об отсутствующих исходниках, не создавая фиктивных PNG", (t) => {
  const { src, dest } = dirs(t);
  assert.ok(importArt(src, dest).every((r) => r.status === "missing"));
  assert.deepEqual(fs.readdirSync(dest), []);
});
test("Импорт не принимает текст, переименованный в PNG", (t) => {
  const { src, dest } = dirs(t);
  fs.writeFileSync(path.join(src, manifest[0].original), "not an image");
  assert.throws(() => importArt(src, dest), /не похож на PNG/);
});

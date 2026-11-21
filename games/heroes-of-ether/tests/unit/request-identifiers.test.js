/* LAN HTTP: идентификаторы без secure-only API, уникальность и отсутствие прямых вызовов. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { webcrypto } = require("node:crypto");
const { create } = require("../../public/shared/request-identifiers");
test("HTTP без randomUUID: уникальные UUID v4 из getRandomValues", () => {
  const cryptoApi = { getRandomValues: (bytes) => webcrypto.getRandomValues(bytes) };
  const ids = Array.from({ length: 1000 }, () => create(cryptoApi));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test("HTTPS/localhost: вызов штатного randomUUID сохраняет контекст Crypto", () => {
  const api = {
    randomUUID() {
      assert.equal(this, api);
      return "native-id";
    },
  };
  assert.equal(create(api), "native-id");
  assert.throws(() => create({}), /Обнови браузер/);
});
test("Кнопки клиента не обращаются напрямую к API, недоступному по LAN HTTP", () => {
  function check(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) check(file);
      else if (file.endsWith(".js"))
        assert.doesNotMatch(fs.readFileSync(file, "utf8"), /crypto\.randomUUID/, file);
    }
  }
  check(path.resolve(__dirname, "../../public/ui"));
});

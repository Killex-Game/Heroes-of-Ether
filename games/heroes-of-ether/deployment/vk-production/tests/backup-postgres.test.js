"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { backup } = require("../backup-postgres");
const env = {
  BACKUP_ENABLED: "true",
  PGSERVICE: "test",
  PGSERVICEFILE: "/test/service",
  PGPASSFILE: "/test/pass",
  PGSSLROOTCERT: "/test/ca",
  PGSSLMODE: "verify-full",
  AGE_RECIPIENT: "age1test",
  S3_ENDPOINT: "https://storage.example.invalid",
  S3_BUCKET: "test-backups",
};
test("по умолчанию никакие утилиты не запускаются", async () => {
  assert.deepEqual(await backup({ env: {}, execute: () => assert.fail("Must not run") }), {
    status: "disabled",
  });
});
test("зашифрованный dump загружается первым, маркер последним; временные файлы удалены", async () => {
  const calls = [];
  let dumpPath;
  const result = await backup({
    env,
    execute: async (command, args) => {
      calls.push({ command, args });
      if (command === "pg_dump") {
        dumpPath = args.at(-1);
        await fs.writeFile(dumpPath, "test database");
      }
      if (command === "age") await fs.writeFile(args[3], "encrypted database");
    },
  });
  assert.equal(result.status, "uploaded");
  assert.deepEqual(
    calls.map((c) => c.command),
    ["pg_dump", "pg_restore", "age", "aws", "aws"],
  );
  assert.ok(calls[3].args[5].endsWith("database.dump.age"));
  assert.ok(calls[4].args[5].endsWith("complete.json"));
  await assert.rejects(fs.access(dumpPath));
});
test("сбой загрузки не оставляет маркер успеха", async () => {
  let uploads = 0;
  await assert.rejects(
    backup({
      env,
      execute: async (command, args) => {
        if (command === "pg_dump") await fs.writeFile(args.at(-1), "test");
        if (command === "age") await fs.writeFile(args[3], "encrypted");
        if (command === "aws") {
          uploads++;
          throw Error("network failed");
        }
      },
    }),
    /Backup step failed/,
  );
  assert.equal(uploads, 1);
});

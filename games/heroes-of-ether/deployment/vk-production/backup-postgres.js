/* Отдельная резервная копия PostgreSQL -> age -> S3. По умолчанию ВЫКЛЮЧЕНА.
 * Запускать планировщиком Linux только после настройки backup.env.example.
 * Дополняет WAL/PITR, не заменяет его. Никогда не читает data/profiles.json.
 */
"use strict";
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const run = promisify(execFile);

async function backup({ env = process.env, execute = run } = {}) {
  if (env.BACKUP_ENABLED !== "true") return { status: "disabled" };
  for (const name of [
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGPASSFILE",
    "PGSSLROOTCERT",
    "AGE_RECIPIENT",
    "S3_ENDPOINT",
    "S3_BUCKET",
  ])
    if (!env[name] || env[name].includes("REPLACE")) throw Error(`Configure ${name}`);
  if (env.PGSSLMODE !== "verify-full") throw Error("PGSSLMODE must be verify-full");
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.S3_BUCKET)) throw Error("Invalid S3 bucket");
  if (new URL(env.S3_ENDPOINT).protocol !== "https:") throw Error("S3 must use HTTPS");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "sferorumiya-backup-"));
  const dump = path.join(directory, "database.dump");
  const encrypted = path.join(directory, "database.dump.age");
  const manifest = path.join(directory, "complete.json");
  const key = `snapshots/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const invoke = async (command, args) => {
    try {
      await execute(command, args, { env, timeout: 3600000, windowsHide: true });
    } catch (_) {
      // stderr сторонней утилиты может содержать параметры соединения.
      throw Error(`Backup step failed: ${command}; verify remote completion marker before retrying`);
    }
  };
  try {
    await invoke("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", dump]);
    await invoke("pg_restore", ["--list", dump]); // Проверка каталога, не полное восстановление.
    await invoke("age", ["--recipient", env.AGE_RECIPIENT, "--output", encrypted, dump]);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(encrypted)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    const size = (await fs.stat(encrypted)).size;
    if (!size) throw Error("Encrypted backup is empty");
    const report = {
      format: 1,
      key,
      sha256,
      encryptedBytes: size,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(manifest, JSON.stringify(report, null, 2), { mode: 0o600 });
    const destination = `s3://${env.S3_BUCKET}/${key}`;
    await invoke("aws", [
      "--endpoint-url",
      env.S3_ENDPOINT,
      "s3",
      "cp",
      encrypted,
      `${destination}/database.dump.age`,
      "--only-show-errors",
    ]);
    // complete.json загружается последним: наличие одного dump ещё не означает успешный бэкап.
    await invoke("aws", [
      "--endpoint-url",
      env.S3_ENDPOINT,
      "s3",
      "cp",
      manifest,
      `${destination}/complete.json`,
      "--only-show-errors",
    ]);
    return { status: "uploaded", ...report };
  } finally {
    for (const file of [dump, encrypted, manifest]) {
      await fs.unlink(file).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await fs.rmdir(directory);
  }
}
if (require.main === module)
  backup()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
module.exports = { backup };

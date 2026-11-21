/* Защита файла сохранений от одновременного запуска двух серверов. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
function acquireServerLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    const pid = Number(fs.readFileSync(file, "utf8"));
    if (!Number.isInteger(pid) || pid < 1)
      throw Error("Не удалось проверить data/server.lock. Сервер не запущен.");
    try {
      process.kill(pid, 0);
      throw Error("С этим сохранением уже работает сервер или тестовая команда.");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    fs.unlinkSync(file); // Только проверенный файл блокировки, без каталогов.
  }
  fs.writeFileSync(file, String(process.pid), { flag: "wx" });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === String(process.pid))
      fs.unlinkSync(file);
  };
}
module.exports = { acquireServerLock };

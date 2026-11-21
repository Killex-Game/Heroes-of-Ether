/* Перед обновлением: on, затем дождаться оповещения (1 сек) и штатно остановить сервер.
 * Флаг сохраняется при перезапуске. Снимать через off только после проверки готовности.
 * На VPS install-maintenance-nginx.sh устанавливает страницу, независимую от Node.
 * /api/service-status доступен без создания профиля, при закрытом входе.
 */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const action = process.argv[2];
if (!["on", "off", "status"].includes(action))
  throw Error("Использование: node scripts/deployment/maintenance.cjs on|off|status");
const flag = path.resolve(__dirname, "../../data/maintenance.enabled");
// Resolve the shared data directory: the public hint survives release switches.
// No private data is exposed; nginx reads only this small availability notice.
const publicStatus = path.join(path.dirname(fs.realpathSync(path.dirname(flag))), "maintenance-public.json");
if (action === "on") {
  fs.writeFileSync(flag, new Date().toISOString() + "\n", { flag: "w" });
  const temporary = publicStatus + "." + process.pid + ".tmp";
  let fd, created = false;
  try {
    fd = fs.openSync(temporary, "wx", 0o644); created = true;
    fs.writeFileSync(fd, JSON.stringify({ maintenance: true, mode: "maintenance", title: "Техническое обновление", message: "Устанавливаем обновление игры.", retryAfter: 5 }) + "\n");
    fs.fchmodSync(fd, 0o644);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, publicStatus);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (created) try { fs.unlinkSync(temporary); } catch (e) { if (e.code !== "ENOENT") throw e; }
  }
}
if (action === "off") {
  try { fs.unlinkSync(publicStatus); } catch (e) { if (e.code !== "ENOENT") throw e; }
  try {
    fs.unlinkSync(flag);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
console.log(JSON.stringify({ maintenance: fs.existsSync(flag) }));

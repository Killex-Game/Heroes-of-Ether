"use strict";
// Keep the game runtime separate from Codex and other applications' Node installs.
const fs = require("node:fs"), path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
function runtime(platform = process.platform) {
  const bundled = path.join(root, "operations/runtimes", platform === "win32"
    ? "node-v24.22.3-win-x64/node.exe" : "node-v24.22.3-linux-x64/bin/node");
  return fs.existsSync(bundled) ? bundled : process.execPath;
}
function start() {
  const executable = runtime();
  const checked = spawnSync(executable, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true });
  const match = /^v(\d+)\.(\d+)\.(\d+)\s*$/.exec(checked.stdout || "");
  if (checked.status !== 0 || !match || Number(match[1]) < 24 ||
      (Number(match[1]) === 24 && (Number(match[2]) < 22 ||
        (Number(match[2]) === 22 && Number(match[3]) < 3)))) {
    console.error("Для запуска игры нужен Node.js 24.22.3 или новее. См. operations/README.txt.");
    process.exitCode = 1; return;
  }
  if (process.platform === 'win32' && fs.existsSync(path.join(root,'games/heroes-of-ether/data/admin-control.json'))) {
    const admin = spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'start-admin.ps1')],
      {stdio:'inherit',windowsHide:true,timeout:30000});
    if(admin.status!==0){console.error('Не удалось запустить независимую админку. Игра не запущена.');process.exitCode=1;return;}
  }
  const child = spawn(executable, ["server.js"], {
    cwd: path.join(root, "games/heroes-of-ether"), stdio: "inherit", windowsHide: true,
  });
  child.once("error", () => { console.error("Не удалось запустить игровой сервер."); process.exitCode = 1; });
  // On a console Ctrl+C reaches both processes. Never force-kill the child:
  // its normal signal handler must finish the durable progress queue.
  process.on("SIGINT", () => { if (process.platform !== "win32") child.kill("SIGINT"); });
  process.on("SIGTERM", () => {
    if (process.platform !== "win32") return child.kill("SIGTERM");
    // Windows child.kill() uses TerminateProcess, which skips the WAL drain.
    const stop = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(__dirname, "stop-console.ps1"), "-GameProcessId", String(child.pid)],
    { stdio: "inherit", windowsHide: true });
    stop.once("error", () => console.error("Не удалось отправить штатную остановку игровому серверу."));
  });
  child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
if (require.main === module) start();
module.exports = { runtime };

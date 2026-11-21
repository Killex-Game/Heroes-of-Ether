/* Временный сетевой туннель для тестировщика. */
"use strict";
// Бесплатный localhost.run через системный SSH; игровой сервер запускается отдельно.
const fs = require("node:fs"),
  path = require("node:path"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "../.."),
  directory = path.join(root, "data/tunnel");
const ssh = path.join(process.env.WINDIR || "C:\\Windows", "System32/OpenSSH/ssh.exe");
const stateFile = path.join(directory, "ssh-state.json");
fs.mkdirSync(directory, { recursive: true });
if (fs.existsSync(stateFile)) {
  const previous = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  try {
    process.kill(previous.pid, 0);
    throw Error("Tunnel is already running: " + previous.pid);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}
const child = spawn(
  ssh,
  [
    "-T",
    "-4",
    "-C",
    "-F",
    "none",
    "-o",
    "IPQoS=none",
    "-o",
    "PreferredAuthentications=none",
    "-o",
    "BatchMode=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "IdentityAgent=none",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "UserKnownHostsFile=data/tunnel/known_hosts",
    "-o",
    "ServerAliveInterval=30",
    "-o",
    "ServerAliveCountMax=3",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ConnectTimeout=15",
    "-R",
    "80:127.0.0.1:3000",
    "nokey@localhost.run",
    "--",
    "--output",
    "json",
  ],
  { cwd: root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
);
const state = {
  provider: "localhost.run",
  pid: process.pid,
  sshPid: child.pid,
  port: 3000,
  url: null,
};
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
save();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop();
  for (const line of lines) {
    const match = line.match(/https:\/\/[a-z0-9-]+\.lhr\.life/);
    if (match) {
      state.url = match[0];
      save();
      fs.writeFileSync(path.join(directory, "url.txt"), state.url + "\n");
      console.log("Public URL:", state.url);
    }
  }
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  state.stoppedAt = new Date().toISOString();
  save();
  process.exitCode = code || 0;
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());

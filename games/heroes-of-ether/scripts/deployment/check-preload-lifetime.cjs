"use strict";
// Changing systemd ExecStart does not change the running Node process's
// execArgv. Worker threads continue inheriting its preloads until it exits.
const fs = require("node:fs"), path = require("node:path"), { fileURLToPath } = require("node:url");

function references(target, argv, cwd, nodeOptions = "") {
  const resolve = value => value.startsWith("file:") ? fileURLToPath(value) : path.resolve(cwd, value);
  const wanted = path.resolve(target), loads = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (["--require", "-r", "--import"].includes(arg)) {
      if (!argv[i + 1]) return true; // Incomplete evidence is never permission to delete.
      loads.push(argv[++i]);
    } else if (/^--(?:require|import)=/.test(arg)) loads.push(arg.slice(arg.indexOf("=") + 1));
    else if (arg.startsWith("-r") && arg.length > 2) loads.push(arg.slice(2));
  }
  // NODE_OPTIONS supports quoting and module loaders. Fail closed instead of
  // guessing shell parsing or logging the process environment.
  if (/(?:^|\s)(?:--require\b|--import\b|-r)/.test(nodeOptions)) return true;
  return loads.some(value => {
    try {
      const candidate = resolve(value);
      if (candidate === wanted) return true;
      return fs.existsSync(candidate) && fs.existsSync(wanted) &&
        fs.realpathSync(candidate) === fs.realpathSync(wanted);
    } catch { return true; }
  });
}

function inspect(pid, file) {
  if (!Number.isSafeInteger(pid) || pid < 1 || !path.isAbsolute(file)) throw Error("Expected live PID and absolute preload path");
  const proc = `/proc/${pid}`;
  let argv, cwd, nodeOptions;
  try {
    argv = fs.readFileSync(proc + "/cmdline", "utf8").split("\0").filter(Boolean);
    cwd = fs.readlinkSync(proc + "/cwd");
    nodeOptions = fs.readFileSync(proc + "/environ", "utf8").split("\0")
      .find(value => value.startsWith("NODE_OPTIONS="))?.slice(13) || "";
  } catch (error) {
    if (error.code === "ENOENT" && !fs.existsSync(proc)) return { pid, running:false, safeToRemove:true };
    throw Error("Unable to verify live preload references");
  }
  return { pid, running:true, safeToRemove:!references(file, argv, cwd, nodeOptions) };
}

if (require.main === module) {
  try {
    const result = inspect(Number(process.argv[2]), process.argv[3]);
    console.log(JSON.stringify(result));
    if (!result.safeToRemove) process.exitCode = 2;
  } catch (error) {
    console.error(error.message); process.exitCode = 1;
  }
}
module.exports = { references, inspect };

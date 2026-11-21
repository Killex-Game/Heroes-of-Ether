"use strict";
const { spawnSync } = require("node:child_process");
const { selectChecks, root } = require("./event-checks.cjs");
try {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--list" && !arg.startsWith("--pack="))) throw Error("Use --pack=<id|all> and/or --list");
  const selected = selectChecks(args.find(a => a.startsWith("--pack="))?.slice(7) || "all");
  console.log(JSON.stringify({ ...selected, scope: "Functional regression only. Browser checks and paired >=1h VPS load evidence are separate release requirements." }, null, 2));
  if (!args.includes("--list")) {
    // Bounded test concurrency; this is not a 105/350/700-client load generator.
    const result = spawnSync(process.execPath, ["--test", "--test-concurrency=2", ...selected.files],
      { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

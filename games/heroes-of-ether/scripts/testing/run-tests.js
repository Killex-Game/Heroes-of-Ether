"use strict";

// Запускаем только модульные и сетевые проверки. Браузерные сценарии запускаются отдельно.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");
const concurrency = Number(process.env.TEST_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
  throw new RangeError("TEST_CONCURRENCY must be an integer from 1 to 8");
const directories = ["tests/unit", "tests/integration"];
const files = directories.flatMap((directory) =>
  fs
    .readdirSync(path.join(root, directory))
    .filter((name) => /\.test\.(?:js|cjs)$/.test(name))
    .map((name) => path.join(directory, name)),
);
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=" + concurrency, ...files], {
  cwd: root,
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

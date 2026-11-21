/* Локальная подготовка тестовых данных: manage-test-bots. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const file = path.join(__dirname, "../../config/test-bots.json"),
  action = process.argv[2] || "status";
if (!["on", "off", "status"].includes(action)) {
  console.error("Использование: npm run dev:bots -- on|off|status");
  process.exitCode = 1;
} else {
  if (action !== "status") {
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(
      file + ".tmp",
      JSON.stringify({ ...config, enabled: action === "on" }, null, 2) + "\n",
    );
    fs.renameSync(file + ".tmp", file);
  }
  console.log(
    JSON.parse(fs.readFileSync(file, "utf8")).enabled
      ? "Тестовые боты включены. Выходят на арену только вместе с живыми игроками."
      : "Тестовые боты выключены. Тестовые кланы и их результаты сохранены.",
  );
}

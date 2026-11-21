/* Подготовка графических ресурсов: import-player-skins. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const skins = require("../../public/assets/skins/manifest.json");

function importArt(sourceDir, destination = path.join(__dirname, "../../public/assets/skins")) {
  const directory = path.resolve(sourceDir);
  if (!fs.statSync(directory).isDirectory()) throw new Error("Укажи папку с четырьмя PNG.");
  fs.mkdirSync(destination, { recursive: true });
  const results = [];
  for (const skin of skins) {
    const source = [skin.original, skin.id + ".png"]
      .map((name) => path.join(directory, name))
      .find((p) => fs.existsSync(p));
    if (!source) {
      results.push({ id: skin.id, status: "missing", message: skin.original });
      continue;
    }
    const stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
      throw new Error("Нужен PNG не больше 8 МБ: " + source);
    const data = fs.readFileSync(source);
    if (!data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      throw new Error("Файл не похож на PNG: " + source);
    const target = path.join(destination, skin.id + ".png");
    fs.writeFileSync(target, data); // Оригинальные пиксели и прозрачность не меняются.
    results.push({ id: skin.id, status: "copied", message: path.basename(target) });
  }
  return results;
}
if (require.main === module) {
  if (!process.argv[2]) {
    console.error('Пример: npm run import-art -- "C:\\Users\\User\\Downloads\\skins"');
    process.exitCode = 1;
  } else {
    try {
      const results = importArt(process.argv[2]);
      for (const item of results)
        console.log((item.status === "copied" ? "Подключён: " : "Не найден: ") + item.message);
      if (results.some((item) => item.status === "missing")) process.exitCode = 1;
      else console.log("Готово. Обнови страницу игры через Ctrl+F5.");
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
module.exports = { importArt };

/* Подготовка графических ресурсов: import-boosters. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

// Читаем только JSON, встроенный в предоставленный каталог. Его скрипты не исполняются.
function readCatalog(file) {
  const html = fs.readFileSync(file, "utf8");
  const match = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("В каталоге нет данных бустеров.");
  const data = JSON.parse(match[1]);
  const ids = new Set();
  if (!Array.isArray(data.items) || data.items.length !== 22)
    throw new Error("Ожидается каталог из 22 бустеров.");
  for (const item of data.items) {
    if (
      !/^[a-z_]+$/.test(item.id) ||
      ids.has(item.id) ||
      !["common", "advanced", "rare"].includes(item.tier)
    ) {
      throw new Error("Неверный или повторяющийся идентификатор бустера.");
    }
    if (
      typeof item.svg !== "string" ||
      !item.svg.includes("<svg") ||
      /<script|<foreignObject|\son\w+\s*=|(?:href|src)\s*=/i.test(item.svg)
    ) {
      throw new Error("Ожидается самостоятельная SVG-иконка: " + item.id);
    }
    ids.add(item.id);
  }
  return data;
}
function importBoosters(directory = path.join(__dirname, "../../public/assets/boosters")) {
  const data = readCatalog(path.join(directory, "catalog.html"));
  const items = data.items.map(({ id, name, tier, effect, params, missing, svg }) => {
    const svgIcon = `svg/${tier}/${id}.svg`;
    const pngIcon = `png/${id}.png`;
    fs.mkdirSync(path.join(directory, "svg", tier), { recursive: true });
    fs.writeFileSync(path.join(directory, svgIcon), svg, "utf8");
    // Присланные иллюстрации имеют приоритет; исходные SVG остаются для каталога.
    const icon = fs.existsSync(path.join(directory, pngIcon)) ? pngIcon : svgIcon;
    return { id, name, tier, effect, params, missing, icon: "assets/boosters/" + icon };
  });
  fs.writeFileSync(
    path.join(directory, "boosters.json"),
    JSON.stringify({ items, tiers: data.tiers }, null, 2) + "\n",
    "utf8",
  );
  return items.length;
}
if (require.main === module) console.log("Подготовлено иконок и карточек: " + importBoosters());
module.exports = { readCatalog, importBoosters };

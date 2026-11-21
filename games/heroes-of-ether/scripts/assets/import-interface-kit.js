/* Подготовка графических ресурсов: import-interface-kit. */
"use strict";
// Только извлечение JSON и изображений: скрипты демонстрационного HTML не выполняются.
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "../..");
function readKit(file) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(/const KIT=([\s\S]*?);\s*const ASSETS=/);
  if (!match) throw Error("Не найдены данные KIT в каталоге интерфейса.");
  const kit = JSON.parse(match[1]);
  if (kit.assets?.length !== 80) throw Error("Ожидалось 80 SVG-пресетов.");
  const ids = new Set();
  const files = [];
  for (const asset of kit.assets) {
    if (
      !/^[a-z_]+$/.test(asset.id) ||
      ids.has(asset.id) ||
      !["identity", "controls", "surfaces"].includes(asset.group)
    )
      throw Error("Некорректный id пресета.");
    ids.add(asset.id);
    files.push({ path: `svg/${asset.group}/${asset.id}.svg`, data: decode(asset.data, "svg+xml") });
  }
  for (const [id, data] of Object.entries(kit.art)) {
    if (!/^[a-z_]+$/.test(id)) throw Error("Некорректный id иллюстрации.");
    const type = data.startsWith("data:image/png;") ? "png" : "svg+xml";
    files.push({ path: `art/${id}.${type === "png" ? "png" : "svg"}`, data: decode(data, type) });
  }
  return { kit, files };
}
function decode(uri, type) {
  const prefix = `data:image/${type};base64,`;
  if (!uri.startsWith(prefix) || !/^[A-Za-z0-9+/=]+$/.test(uri.slice(prefix.length)))
    throw Error("Неподдерживаемое изображение.");
  const data = Buffer.from(uri.slice(prefix.length), "base64");
  if (type === "svg+xml") {
    const svg = data.toString("utf8");
    if (
      !/<svg\b/.test(svg) ||
      /<\s*(script|foreignObject|iframe|animate|set)\b|\bon\w+\s*=|\b(?:href|src)\s*=\s*["'](?!#)|url\(\s*(?!#)/i.test(
        svg,
      )
    )
      throw Error("SVG содержит активное или внешнее содержимое.");
  } else if (data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw Error("Некорректный PNG.");
  return data;
}
function importKit(file = path.join(root, "design/ui_catalog.html")) {
  const { kit, files } = readKit(file);
  const destination = path.join(root, "public/assets/ui");
  for (const entry of files) {
    const target = path.join(destination, entry.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
  }
  const manifest = {
    name: kit.name,
    version: kit.version,
    assets: kit.assets.map(({ data, png, ...asset }) => asset),
    illustrations: kit.illustrations,
  };
  fs.writeFileSync(
    path.join(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return files.length;
}
if (require.main === module)
  console.log(`Импортировано файлов интерфейса: ${importKit(process.argv[2])}.`);
module.exports = { readKit, importKit };

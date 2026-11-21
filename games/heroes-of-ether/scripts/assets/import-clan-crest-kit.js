/* Подготовка графических ресурсов: import-clan-crest-kit. */
"use strict";
// Source kit is data only. Its HTML/JavaScript is never executed.
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, "../.."),
  source = path.join(root, "design/clan-crest-kit-v1"),
  out = path.join(root, "public/assets/clan-crests");
const read = (name) => JSON.parse(fs.readFileSync(path.join(source, name), "utf8"));
const frames = read("frames.json"),
  colors = read("palette.json"),
  symbols = read("symbols.json");
fs.mkdirSync(out, { recursive: true });
function restyle(file, id, isFrame) {
  let svg = fs.readFileSync(path.join(source, file), "utf8");
  const allowed = new Set([
    "svg",
    "title",
    "defs",
    "linearGradient",
    "radialGradient",
    "stop",
    "g",
    "path",
    "circle",
    "ellipse",
    "rect",
    "polygon",
    "polyline",
    "line",
  ]);
  for (const match of svg.matchAll(/<\/?([\w:-]+)/g))
    if (!allowed.has(match[1])) throw Error("Unsupported SVG element: " + match[1]);
  if (/\son\w+\s*=|(?:href|style)\s*=|<!|<\?/i.test(svg))
    throw Error("Unexpected active SVG content");
  svg = svg
    .replace(/<title[^>]*>.*?<\/title>/gs, "")
    .replace(/\s(?:role|aria-labelledby)="[^"]*"/g, "");
  svg = svg.replace(
    /<linearGradient id="([^"]*gold[^"]*)"[^>]*>.*?<\/linearGradient>/gs,
    (_, key) =>
      '<linearGradient id="' +
      key +
      '" x1="0" y1="0" x2="0.35" y2="1"><stop stop-color="#fff8ce"/><stop offset=".17" stop-color="#fff185"/><stop offset=".34" stop-color="#ffca32"/><stop offset=".48" stop-color="#c77a0b"/><stop offset=".55" stop-color="#ffe990"/><stop offset=".75" stop-color="#e7a317"/><stop offset="1" stop-color="#8e480b"/></linearGradient>',
  );
  const palette = {
    "#291832": "#391044",
    "#321B41": "#451453",
    "#AD7E3B": "#c58011",
    "#D2A455": "#efba31",
    "#79502D": "#8a4611",
    "#BC8B46": "#d68e18",
    "#966735": "#8b4e17",
    "#C791E2": "#e6a0ff",
    "#603479": "#6918ad",
    "#F1D5FE": "#fbe0ff",
    "#C18CE6": "#d481ff",
    "#8F50C2": "#a43ae4",
    "#5D337F": "#67139e",
    "#352144": "#361057",
  };
  svg = svg.replace(/#[a-fA-F0-9]{6}/g, (hex) => palette[hex.toUpperCase()] || hex);
  const shadow =
    '<filter id="' +
    id +
    '-relief" x="-12%" y="-12%" width="124%" height="130%"><feDropShadow dx="0" dy="' +
    (isFrame ? 3 : 5) +
    '" stdDeviation="' +
    (isFrame ? 1.4 : 2) +
    '" flood-color="#38104b" flood-opacity=".55"/></filter>';
  svg = svg
    .replace("</defs>", shadow + "</defs>")
    .replace(/<g stroke-linecap=/, '<g filter="url(#' + id + '-relief)" stroke-linecap=');
  if (isFrame) {
    const frame = frames.find((f) => f.id === id);
    const bevel =
      '<path d="' +
      frame.inner_path +
      '" fill="none" stroke="#481650" stroke-width="27" stroke-linejoin="round"/><path d="' +
      frame.inner_path +
      '" fill="none" stroke="url(#' +
      id +
      '-gold)" stroke-width="22" stroke-linejoin="round"/><path d="' +
      frame.inner_path +
      '" fill="none" stroke="#fff2a4" stroke-width="2.5" opacity=".8"/>';
    svg = svg.replace(/(<g[^>]*>)/, bevel + "$1");
  }
  fs.writeFileSync(path.join(out, id + ".svg"), svg);
  return svg.replace(/^.*?<svg[^>]*>/s, "").replace(/<\/svg>\s*$/, "");
}
const art = {
  frames: frames.map((f) => ({
    ...f,
    size_label: f.size_label.replace(/\s*[\u00b7\u2022]\s*/gu, " — "),
    svg: restyle(f.file, f.id, true),
  })),
  colors: colors.map(({ id, name, hex }) => ({ id, name, hex })),
  symbols: symbols.map((s) => ({ ...s, svg: restyle(s.file, s.id, false) })),
};
fs.writeFileSync(
  path.join(root, "public/shared/clan-crest-art-data.js"),
  "(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.KillexClanCrestArt=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>(" +
    JSON.stringify(art) +
    "));\n",
);
console.log(
  "Restyled " +
    frames.length +
    " frames, " +
    symbols.length +
    " symbols, " +
    colors.length +
    " enamel colours.",
);

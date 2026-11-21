/* npm-installed Prettier parses CSS; the original layout/cascade stays in its own files.
   Repeatable build: unwrap our fallbacks, recollect colors and regenerate palette/SVG variants. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const parser = require("prettier/plugins/postcss").parsers.css;
const theme = require("../../public/shared/interface-theme");
const root = path.resolve(__dirname, "../.."),
  publicRoot = path.join(root, "public");
const index = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
const files = [...index.matchAll(/href="(styles\/[^" ]+\.css)"/g)]
  .map((m) => m[1])
  .filter((f) => !f.endsWith("interface-themes.css"));
const colors = new Map(),
  art = new Map(),
  aliases = new Map();
const colorToken = (h) => "--ui-c-" + h.slice(1).toLowerCase();
const assetToken = (f) => "--ui-art-" + f.replace(/\W/g, "-");
function goldTrim(hex) {
  let h = hex.slice(1);
  if (h.length < 5) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  const hue = delta && r >= g && g >= b ? (60 * (g - b)) / delta : 0;
  return hue >= 18 && hue <= 65 && delta > 0.025;
}
function convert(value, file, prop) {
  const protectedUrls = [];
  value = value.replace(/url\(([^)]+)\)/g, (whole, url) => {
    const cleaned = url.trim().replace(/^["']|["']$/g, "");
    const asset = path.posix.normalize(path.posix.join(path.posix.dirname(file), cleaned));
    let result = whole;
    if (/^assets\/ui\/svg\/.+\.svg$/.test(asset) && !/item_slot_|divider\.svg/.test(asset)) {
      const short = asset.slice("assets/ui/svg/".length),
        token = assetToken(short);
      art.set(token, { asset, short });
      result = `var(${token}, ${whole})`;
    }
    protectedUrls.push(result);
    return `__UI_URL_${protectedUrls.length - 1}__`;
  });
  value = value.replace(/\b(white|black)\b/g, (v) => (v === "white" ? "#ffffff" : "#000000"));
  value = value.replace(/rgba?\(([\d.\s,]+)\)/g, (whole, parts) => {
    const n = parts
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);
    if (n.length < 3 || n.length > 4) return whole;
    return (
      "#" +
      n
        .slice(0, 3)
        .map((x) => Math.round(x).toString(16).padStart(2, "0"))
        .join("") +
      (n.length === 4
        ? Math.round(n[3] * 255)
            .toString(16)
            .padStart(2, "0")
        : "")
    );
  });
  value = value.replace(/#[a-f\d]{8}\b|#[a-f\d]{6}\b|#[a-f\d]{4}\b|#[a-f\d]{3}\b/gi, (h) => {
    h = h.toLowerCase();
    if (/^(border|outline)|box-shadow|^--gold$/.test(prop) && goldTrim(h)) return h;
    const token = colorToken(h);
    colors.set(token, h);
    return `var(${token}, ${h})`;
  });
  return value.replace(/__UI_URL_(\d+)__/g, (_, i) => protectedUrls[i]);
}
for (const file of files) {
  const full = path.join(publicRoot, file);
  let css = fs.readFileSync(full, "utf8"),
    previous;
  do {
    previous = css;
    css = css
      .replace(/var\(\s*--ui-c-[a-f\d]+,\s*(#[a-f\d]+)\s*\)/gi, "$1")
      .replace(/var\(\s*--ui-art-[\w-]+,\s*(url\([^)]*\))\s*\)/g, "$1");
  } while (css !== previous);
  const ast = parser.parse(css),
    edits = [];
  function walk(node, parent) {
    if (node.type === "css-decl") {
      const selector = parent?.raws?.selector || "";
      // These colors communicate teams, promotion/relegation and online presence.
      if (
        /clan-battle-score|clan-battle-bar span:(first|last)-child|clan-battle-member-list|clan-league-(row|zone-heading)|account-active-badge|data-(promotion|relegation|podium|reward|tier|rarity)|presence-dot|online-dot|player-online-indicator|chest-rarity|chest-modal|clan-ranking|leader-(row|rank|self)|title-medal|achievement-badge/.test(
          selector,
        )
      )
        return;
      // Artwork filters, faction/status colors and each clan preview's own palette remain semantic.
      if (
        ["filter", "color", "text-shadow"].includes(node.prop) ||
        /^--(text|muted|sf-ink|sf-muted|sf-plum)$/.test(node.prop) ||
        node.prop.startsWith("--clan-panel-") ||
        node.prop.startsWith("--xp-") ||
        /^--(vip|premium|chest|podium)-/.test(node.prop)
      )
        return;
      const start = node.source.start.offset,
        end = node.source.end.offset,
        raw = css.slice(start, end),
        colon = raw.indexOf(":");
      const prefix = raw.slice(0, colon + 1),
        value = raw.slice(colon + 1),
        converted = convert(value, file, node.prop);
      if (converted !== value) edits.push({ start, end, text: prefix + converted });
      if (converted !== value && node.prop.startsWith("--") && parent?.raws?.selector === ":root")
        aliases.set(node.prop, converted.replace(/;\s*$/, ""));
    }
    for (const child of node.nodes || []) walk(child, node);
  }
  walk(ast);
  for (const e of edits.sort((a, b) => b.start - a.start))
    css = css.slice(0, e.start) + e.text + css.slice(e.end);
  fs.writeFileSync(full, css);
}
// Root aliases are redeclared per scope so a clan never inherits the player's computed colors.
let output = "/* Generated by scripts/assets/build-interface-themes.js. */\n";
output +=
  "[data-ui-theme] {\n" +
  [...aliases].map(([key, value]) => `  ${key}: ${value.trim()};`).join("\n") +
  "\n}\n";
const ids = ["default", ...Object.keys(theme.palettes)];
for (const id of ids) {
  output += `[data-ui-theme="${id}"] {\n`;
  for (const [token, hex] of colors) output += `  ${token}: ${theme.color(hex, id)};\n`;
  for (const [token, { asset, short }] of art) {
    const target = id === "default" ? asset : `assets/ui/themes/${id}/${short}`;
    output += `  ${token}: url("../../${target}");\n`;
    if (id !== "default") {
      const kept = [];
      const svg = fs
        .readFileSync(path.join(publicRoot, asset), "utf8")
        // The edge gradient is the gold moulding, separate from the colored surface.
        .replace(/<linearGradient\b[^>]*id="[^"]*-edge"[\s\S]*?<\/linearGradient>/g, (block) => {
          kept.push(block);
          return `__KEEP_GOLD_${kept.length - 1}__`;
        })
        .replace(
          /((fill|stroke|stop-color|flood-color)=["'])(#[a-f\d]{3,8})(["'])/gi,
          (_, before, attribute, hex, after) =>
            before +
            ((attribute === "fill" || attribute === "stroke") && goldTrim(hex)
              ? hex
              : theme.color(hex, id)) +
            after,
        )
        .replace(/__KEEP_GOLD_(\d+)__/g, (_, i) => kept[i]);
      const full = path.join(publicRoot, target);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, svg);
    }
  }
  output += "}\n";
}
fs.writeFileSync(path.join(publicRoot, "styles/theme/interface-themes.css"), output);
console.log(
  JSON.stringify({ styles: files.length, colorTokens: colors.size, artVariants: art.size * 6 }),
);

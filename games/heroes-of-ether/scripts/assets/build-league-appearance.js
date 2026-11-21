/* Векторные коллекции лиг: отдельные композиции для лобби, мини-профиля и рамки. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { themes, frameTheme } = require("../../public/shared/league-appearance");
const destination = path.resolve(__dirname, "../../public/assets/league-appearance");
fs.mkdirSync(destination, { recursive: true });
const svg = (w, h, body, id = "") =>
  `<svg${id ? ` id="${id}"` : ""} xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const defs = (t) =>
  `<defs>
 <linearGradient id="metal" x1="0" y1="0" x2=".8" y2="1" gradientUnits="objectBoundingBox"><stop stop-color="${t.dark}"/><stop offset=".22" stop-color="${t.light}"/><stop offset=".4" stop-color="${t.metal}"/><stop offset=".62" stop-color="${t.light}"/><stop offset="1" stop-color="${t.metal}"/></linearGradient>
 <radialGradient id="sky"><stop stop-color="${t.metal}"/><stop offset=".55" stop-color="${t.dark}"/><stop offset="1" stop-color="#100e26"/></radialGradient>
 <linearGradient id="mist" x2="0" y2="1"><stop stop-color="${t.light}" stop-opacity=".16"/><stop offset="1" stop-color="${t.metal}" stop-opacity=".02"/></linearGradient>
 <radialGradient id="gem"><stop stop-color="white"/><stop offset=".3" stop-color="${t.light}"/><stop offset=".72" stop-color="${t.metal}"/><stop offset="1" stop-color="${t.dark}"/></radialGradient>
 </defs>`;
const star = (x, y, size, color) =>
  `<path d="M${x} ${y - size} Q${x} ${y} ${x + size} ${y} Q${x} ${y} ${x} ${y + size} Q${x} ${y} ${x - size} ${y} Q${x} ${y} ${x} ${y - size}" fill="${color}"/>`;
function crown(x, y, scale) {
  return `<g transform="translate(${x} ${y}) scale(${scale})" stroke="#6c3c18" stroke-width="2" stroke-linejoin="round"><path d="M-44 22 -52 -15 -22 2 0 -33 22 2 52 -15 44 22Z" fill="url(#metal)"/><path d="M-43 22H43V33H-43Z" fill="url(#metal)"/><path d="M0 -9 9 5 0 18 -9 5Z" fill="url(#gem)"/><g fill="#fff7b9"><circle cx="-52" cy="-15" r="5"/><circle cx="0" cy="-33" r="6"/><circle cx="52" cy="-15" r="5"/></g></g>`;
}
// Self-contained SVG images also work when used as CSS backgrounds.
const rasterData = (file) =>
  "data:image/webp;base64," + fs.readFileSync(path.resolve(destination, file)).toString("base64");
const paintedLaurel = rasterData("ornaments/gold-laurel.webp");
const paintedCrown = rasterData("ornaments/champion-crown.webp");
function decorDefs(t) {
  const tint = {
    bronze: [1.14, 0.72, 0.38],
    silver: [1.03, 1.1, 1.2],
    platinum: [0.78, 1.12, 1.06],
    diamond: [0.68, 1.04, 1.24],
  }[t.id];
  const tone = tint
    ? '<filter id="laurel-tone" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>' +
      tint
        .map(
          (slope, i) =>
            "<feFunc" + "RGB"[i] + ' type="linear" slope="' + slope + '" intercept=".015"/>',
        )
        .join("") +
      "</feComponentTransfer></filter>"
    : "";
  const core =
    t.id === "champions"
      ? '<image id="painted-crown" width="512" height="429" href="' + paintedCrown + '"/>'
      : '<image id="league-emblem" width="256" height="256" href="' +
        rasterData("../progression/webp/256/leagues/" + t.id + ".webp") +
        '"/>';
  return (
    "<defs>" +
    tone +
    '<image id="painted-laurel" width="512" height="512" href="' +
    paintedLaurel +
    '"/>' +
    core +
    "</defs>"
  );
}
function backgroundEmblem(t, x, y, scale = 1) {
  const tone = ["gold", "champions"].includes(t.id) ? "" : ' filter="url(#laurel-tone)"';
  const core =
    t.id === "champions"
      ? '<use href="#painted-crown" transform="translate(-54 -51) scale(.2109375)"/>'
      : '<use href="#league-emblem" transform="translate(-54 -61) scale(.421875)"/>';
  return (
    '<g transform="translate(' +
    x +
    " " +
    y +
    ") scale(" +
    scale +
    ')">' +
    core +
    '<use href="#painted-laurel" transform="translate(-94 -94) scale(.3671875)"' +
    tone +
    "/>" +
    "</g>"
  );
}
function laurels(x, y, scale) {
  let parts = "";
  for (const side of [-1, 1])
    for (let i = 0; i < 7; i++) {
      const angle = ((i * 13 - 39) * Math.PI) / 180,
        px = side * (73 + 15 * Math.cos(angle)),
        py = i * 18 - 55;
      parts += `<ellipse cx="${px}" cy="${py}" rx="8" ry="18" transform="rotate(${side * (32 + i * 7)} ${px} ${py})" fill="url(#metal)" stroke="${themes[0].dark}" stroke-width=".8"/>`;
    }
  return `<g transform="translate(${x} ${y}) scale(${scale})">${parts}</g>`;
}
function championFrame(t) {
  let gems = "";
  for (let i = 1; i < 12; i++)
    gems +=
      '<g transform="rotate(' +
      i * 30 +
      ' 128 128)"><path d="M128 27l3 5 -3 5 -3 -5Z" fill="url(#ruby)" stroke="#ffe263" stroke-width=".8"/></g>';
  return svg(
    256,
    256,
    "<g>" +
      defs({ ...t, metal: "#ffc526", light: "#fff59d", dark: "#af5410" }) +
      decorDefs(t) +
      '<defs><linearGradient id="ruby" x2=".8" y2="1"><stop stop-color="#ff8b67"/><stop offset=".35" stop-color="#ff2146"/><stop offset=".65" stop-color="#a40024"/><stop offset="1" stop-color="#f93450"/></linearGradient></defs>' +
      '<defs><mask id="frame-laurel-mask"><rect width="256" height="256" fill="white"/><circle cx="128" cy="128" r="98" fill="black"/><path d="M70 220H186V256H70Z" fill="black"/></mask></defs>' +
      '<g mask="url(#frame-laurel-mask)"><use href="#painted-laurel" transform="scale(.5)"/></g>' +
      '<circle cx="128" cy="128" r="97" fill="none" stroke="#6d071d" stroke-width="17"/>' +
      '<circle cx="128" cy="128" r="97" fill="none" stroke="url(#ruby)" stroke-width="13"/>' +
      '<circle cx="128" cy="128" r="105" fill="none" stroke="url(#metal)" stroke-width="3"/>' +
      '<circle cx="128" cy="128" r="89.5" fill="none" stroke="#ffe77a" stroke-width="2"/>' +
      gems +
      star(61, 60, 4, "#fff4b2") +
      star(202, 173, 3, "#fff4b2") +
      "</g>",
  );
}
function frame(t) {
  return t.id === "champions"
    ? championFrame(t)
    : require("./league-frame-design")(frameTheme(t.id));
}
function sparkles(t, w, h, count = 80) {
  // Общая анимация фонов: движение и мерцание в разных фазах.
  // Градиентные ореолы без blur-фильтров и отдельного игрового цикла.
  const particles = Array(8).fill("");
  for (let i = 0; i < count; i++) {
    const x = 32 + ((i * 197 + 47) % (w - 64)),
      y = 32 + ((i * 137 + 31) % (h - 64)),
      size = 4 + (i % 5);
    particles[i % particles.length] +=
      i % 9 === 0
        ? `<circle cx="${x}" cy="${y}" r="${size * 3}" fill="url(#spark-glow)"/>${star(x, y, size, t.light)}${star(x, y, size * 0.45, "#fffdf1")}`
        : `<circle cx="${x}" cy="${y}" r="${4 + (i % 3)}" fill="url(#spark-glow)" opacity=".45"/><circle cx="${x}" cy="${y}" r="${0.9 + (i % 3) * 0.4}" fill="${t.light}" opacity="${0.4 + (i % 5) * 0.12}"/>`;
  }
  let elements = `<defs><radialGradient id="spark-glow"><stop stop-color="#fffdf1" stop-opacity=".85"/><stop offset=".2" stop-color="${t.light}" stop-opacity=".6"/><stop offset=".55" stop-color="${t.metal}" stop-opacity=".2"/><stop offset="1" stop-color="${t.metal}" stop-opacity="0"/></radialGradient></defs><style>
    .league-sparkles { animation: league-spark-drift var(--period) ease-in-out var(--phase) infinite alternate; }
    .league-spark-shine { animation: league-spark-shine var(--shine-period) ease-in-out var(--phase) infinite; }
    @keyframes league-spark-drift {
      from { transform: translate(calc(-1 * var(--dx)), calc(-1 * var(--dy))); }
      to { transform: translate(var(--dx), var(--dy)); }
    }
    @keyframes league-spark-shine {
      0%, 100% { opacity: .45; }
      45% { opacity: 1; }
      70% { opacity: .75; }
    }
    @media (prefers-reduced-motion: reduce) { .league-sparkles, .league-spark-shine { animation: none; } }
    :root:target .league-sparkles, :root:target .league-spark-shine { animation: none; }
  </style>`;
  for (const [i, layer] of particles.entries()) {
    const dx = (i % 2 ? -1 : 1) * (12 + (i % 4) * 4),
      dy = (i % 3 ? -1 : 1) * (10 + ((i + 1) % 3) * 5);
    elements += `<g class="league-sparkles" style="--dx:${dx}px;--dy:${dy}px;--period:${6.5 + (i % 5) * 0.8}s;--shine-period:${3.8 + (i % 4) * 0.7}s;--phase:${-i * 1.7}s"><g class="league-spark-shine">${layer}</g></g>`;
  }
  return elements;
}
function scene(t, mini) {
  const w = mini ? 1200 : 1600,
    h = mini ? 420 : 1000,
    cx = w / 2,
    cy = mini ? h / 2 - 10 : 400;
  let elements = sparkles(t, w, h);
  const sideX = mini ? 170 : 240,
    sideY = mini ? h / 2 - 5 : 400;
  if (!mini)
    elements += `<g opacity=".92">${backgroundEmblem(t, sideX, sideY)}${backgroundEmblem(t, w - sideX, sideY)}</g>`;
  // Архитектура остаётся у краёв; центр спокоен для интерфейса и аватара.
  for (const sign of [-1, 1]) {
    const x = sign < 0 ? w : 0;
    for (let i = 0; i < 5; i++) {
      const dx = 70 + i * 57,
        top = mini ? 210 + i * 9 : 630 + i * 22;
      elements += `<path d="M${x + sign * dx} ${h}V${top}l${sign * 22} -45 ${sign * 22} 45V${h}" fill="url(#mist)" stroke="${t.metal}" stroke-opacity=".25"/>`;
    }
  }
  elements += `<path d="M0 ${h * 0.8}Q${cx} ${cy} ${w} ${h * 0.8}" fill="none" stroke="${t.light}" stroke-width="1" opacity=".15"/>`;
  if (mini) {
    // A fluid viewport keeps both emblems whole. Each nested SVG preserves the
    // emblem's proportions while the atmospheric backdrop fills the panel.
    const emblem = (x) =>
      `<svg x="${x}%" y="25%" width="20%" height="46%" viewBox="-100 -100 200 200" opacity=".92">${backgroundEmblem(t, 0, 0)}</svg>`;
    return `<svg id="still" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">${defs(t)}${decorDefs(t)}<svg width="100%" height="100%" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"><rect width="${w}" height="${h}" fill="url(#sky)"/>${elements}</svg>${emblem(4)}${emblem(76)}<rect x="1.5%" y="4.3%" width="97%" height="91.4%" rx="12" fill="none" stroke="url(#metal)" stroke-width="1" opacity=".4"/></svg>`;
  }
  elements += `<rect x="18" y="18" width="${w - 36}" height="${h - 36}" rx="40" fill="none" stroke="url(#metal)" stroke-width="2" opacity=".4"/>`;
  return svg(
    w,
    h,
    defs(t) + decorDefs(t) + `<rect width="${w}" height="${h}" fill="url(#sky)"/>` + elements,
    "still",
  );
}
function clanScene(theme) {
  const t =
    theme.id === "champions"
      ? { ...theme, metal: "#ec2543", light: "#ffd970", dark: "#630e2d" }
      : theme;
  const motifs = [
    '<path d="M0 0H144V144H0Z M18 18H126V126H18Z M36 0V36H0M108 0V36H144M0 108H36V144M108 144V108H144"/><circle cx="72" cy="72" r="26"/><path d="M58 89Q72 55 86 89M58 55Q72 89 86 55"/>',
    '<path d="M72 0Q12 36 72 72Q132 108 72 144M0 72Q36 12 72 72Q108 132 144 72"/><path d="M72 30 80 64 114 72 80 80 72 114 64 80 30 72 64 64Z"/>',
    '<path d="M72 0 144 36V108L72 144 0 108V36Z"/><circle cx="72" cy="72" r="28"/><path d="M72 28V116M28 72H116M41 41L103 103M103 41L41 103"/>',
    '<path d="M72 0 144 72 72 144 0 72Z M72 22 122 72 72 122 22 72Z"/><ellipse cx="72" cy="72" rx="60" ry="22" transform="rotate(45 72 72)"/><ellipse cx="72" cy="72" rx="60" ry="22" transform="rotate(-45 72 72)"/>',
    '<path d="M0 0H144V144H0Z M0 0 72 36 144 0M0 144 72 108 144 144M0 0 36 72 0 144M144 0 108 72 144 144M72 36 108 72 72 108 36 72Z M72 0V36M0 72H36M108 72H144M72 108V144"/>',
    '<path d="M72 0Q20 30 12 72Q20 114 72 144Q124 114 132 72Q124 30 72 0Z"/><path d="M44 79 37 48 57 61 72 38 87 61 107 48 100 79Z M45 85H99 M50 94H94"/><path d="M34 113Q15 86 29 64M110 113Q129 86 115 64"/>',
  ];
  const pattern = `<pattern id="clan-weave" width="144" height="144" patternUnits="userSpaceOnUse"><g fill="none" stroke="${t.light}" stroke-width="1.4" stroke-linejoin="round">${motifs[t.rank]}</g></pattern>`;
  const patternMask =
    '<radialGradient id="weave-fade"><stop stop-color="white" stop-opacity=".14"/><stop offset="1" stop-color="white" stop-opacity=".75"/></radialGradient><mask id="pattern-mask"><rect width="1600" height="1000" fill="url(#weave-fade)"/></mask>';
  return svg(
    1600,
    1000,
    defs(t) +
      decorDefs(t) +
      `<defs>${pattern}${patternMask}<linearGradient id="clan-fabric" x2="1" y2="1"><stop stop-color="${t.dark}"/><stop offset=".48" stop-color="${t.metal}"/><stop offset="1" stop-color="${t.dark}"/></linearGradient></defs>
    <rect width="1600" height="1000" fill="url(#sky)"/>
    <path d="M0 0H520L210 1000H0Z M1600 0H1080L1390 1000H1600Z" fill="url(#clan-fabric)" opacity=".72"/>
    <rect width="1600" height="1000" fill="url(#clan-weave)" mask="url(#pattern-mask)" opacity=".38"/>
    <path d="M32 0V968H1568V0M64 0V936H1536V0" fill="none" stroke="url(#metal)" stroke-width="2" opacity=".65"/>
    <path d="M350 0 100 1000M1250 0 1500 1000" stroke="${t.light}" stroke-width="2" opacity=".25"/>
    <g opacity=".9">${backgroundEmblem(t, 800, 110, 0.85)}</g>
    <g opacity=".65">${backgroundEmblem(t, 195, 400, 0.8)}${backgroundEmblem(t, 1405, 400, 0.8)}</g>
    <path d="M595 122H695M905 122H1005" stroke="url(#metal)" stroke-width="2"/>
    ${star(595, 122, 9, t.light)}${star(1005, 122, 9, t.light)}${sparkles(t, 1600, 1000, 56)}`,
    "still",
  );
}
for (const t of themes)
  for (const [kind, art] of [
    ["frame", frame(t)],
    ["lobby", scene(t, false)],
    ["profile", scene(t, true)],
    ["clan", clanScene(t)],
  ])
    if (
      (!process.argv.includes("--profiles-only") || kind === "profile") &&
      (!process.argv.includes("--frames-only") || (kind === "frame" && t.id !== "champions"))
    )
      fs.writeFileSync(path.join(destination, `${t.id}-${kind}.svg`), art + "\n");
console.log(
  process.argv.includes("--profiles-only")
    ? "Created 6 responsive profile backgrounds."
    : process.argv.includes("--frames-only")
      ? "Created 5 laurel frames; champion unchanged."
      : "Created 24 league appearance SVG assets.",
);

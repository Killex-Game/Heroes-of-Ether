/* Дополнительные формы и геральдические поля. Авторская геометрия проекта. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KillexCrestVariants = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";
  const shapes = [
    ["f11_french", "Французский щит", "M78 65H434V278Q434 395 256 455Q78 395 78 278Z"],
    ["f12_spanish", "Испанский щит", "M90 64H422V287Q422 450 256 450Q90 450 90 287Z"],
    ["f13_norman", "Норманнский щит", "M80 100Q256 8 432 100Q433 337 256 465Q79 337 80 100Z"],
    [
      "f14_english",
      "Английский щит",
      "M72 80Q152 103 256 55Q360 103 440 80L425 286Q410 395 256 460Q102 395 87 286Z",
    ],
    [
      "f15_polish",
      "Польский щит",
      "M93 65Q168 90 256 49Q344 90 419 65L441 96Q398 139 418 242Q458 381 256 460Q54 381 94 242Q114 139 71 96Z",
    ],
    [
      "f16_gothic",
      "Готический щит",
      "M79 106L256 48L433 106L403 303Q369 393 256 469Q143 393 109 303Z",
    ],
    [
      "f17_concave",
      "Вогнутый щит",
      "M74 75Q151 113 256 61Q361 113 438 75Q405 193 425 285Q431 394 256 455Q81 394 87 285Q107 193 74 75Z",
    ],
    [
      "f18_trefoil",
      "Трилистный щит",
      "M78 100Q106 85 112 63Q179 107 256 57Q333 107 400 63Q406 85 434 100Q400 180 420 280Q433 398 256 458Q79 398 92 280Q112 180 78 100Z",
    ],
    [
      "f19_drop",
      "Каплевидный щит",
      "M256 48Q443 72 424 250Q411 371 256 466Q101 371 88 250Q69 72 256 48Z",
    ],
    ["f20_triangle", "Треугольный щит", "M64 84Q256 53 448 84Q430 288 256 456Q82 288 64 84Z"],
    [
      "f21_tourney",
      "Турнирный щит",
      "M92 67H420V143Q360 139 363 192Q365 227 420 230V300Q393 407 256 458Q109 407 92 300Z",
    ],
    [
      "f22_byzantine",
      "Византийский щит",
      "M116 66H396L435 119V280Q420 407 256 458Q92 407 77 280V119Z",
    ],
    ["f23_varangian", "Варяжский щит", "M89 66H423L413 296L256 461L99 296Z"],
    [
      "f24_renaissance",
      "Щит Возрождения",
      "M92 80Q164 112 256 51Q348 112 420 80Q396 170 425 244Q440 343 376 387Q294 414 256 462Q218 414 136 387Q72 343 87 244Q116 170 92 80Z",
    ],
    [
      "f25_bastion",
      "Крепостной щит",
      "M82 77H146V99H219V61H293V99H366V77H430V286Q415 389 256 459Q97 389 82 286Z",
    ],
  ];
  // Фаски строятся по исходному контуру: силуэт и ширина обода не зависят от света.
  function outlinePoints(path) {
    const tokens = path.match(/[MLHVQZ]|-?\d+(?:\.\d+)?/g),
      points = [];
    let i = 0,
      x = 0,
      y = 0;
    const number = () => Number(tokens[i++]);
    while (i < tokens.length) {
      const command = tokens[i++];
      if (command === "M" || command === "L") {
        x = number();
        y = number();
      } else if (command === "H") x = number();
      else if (command === "V") y = number();
      else if (command === "Q") {
        const cx = number(),
          cy = number(),
          endX = number(),
          endY = number();
        const steps = Math.max(
          4,
          Math.ceil((Math.hypot(cx - x, cy - y) + Math.hypot(endX - cx, endY - cy)) / 16),
        );
        for (let step = 1; step <= steps; step++) {
          const t = step / steps,
            u = 1 - t;
          points.push([
            u * u * x + 2 * u * t * cx + t * t * endX,
            u * u * y + 2 * u * t * cy + t * t * endY,
          ]);
        }
        x = endX;
        y = endY;
        continue;
      } else if (command === "Z") break;
      points.push([x, y]);
    }
    const last = points.at(-1),
      first = points[0];
    if (Math.hypot(last[0] - first[0], last[1] - first[1]) < 0.01) points.pop();
    // Sample straight edges too: side ornaments and highlights must follow the
    // whole rim, rather than gathering at the endpoints of a long straight side.
    return points.flatMap((p, index) => {
      const next = points[(index + 1) % points.length],
        steps = Math.max(1, Math.ceil(Math.hypot(next[0] - p[0], next[1] - p[1]) / 16));
      return Array.from({ length: steps }, (_, n) => [
        p[0] + (next[0] - p[0]) * n / steps,
        p[1] + (next[1] - p[1]) * n / steps,
      ]);
    });
  }
  const pointText = (p) => p.map((n) => n.toFixed(2)).join(",");
  function contour(points, offset) {
    return points.map((p, i) => {
      const a = points[(i + points.length - 1) % points.length],
        b = points[(i + 1) % points.length],
        d1 = Math.hypot(p[0] - a[0], p[1] - a[1]),
        d2 = Math.hypot(b[0] - p[0], b[1] - p[1]),
        n1 = [(p[1] - a[1]) / d1, (a[0] - p[0]) / d1],
        n2 = [(b[1] - p[1]) / d2, (p[0] - b[0]) / d2],
        scale = offset / Math.max(0.5, 1 + n1[0] * n2[0] + n1[1] * n2[1]);
      return [p[0] + (n1[0] + n2[0]) * scale, p[1] + (n1[1] + n2[1]) * scale];
    });
  }
  function goldLight(light) {
    const stops = [
        [88, 33, 3],
        [196, 86, 3],
        [255, 173, 6],
        [255, 224, 82],
        [255, 255, 238],
      ],
      pos = Math.max(0, Math.min(0.9999, light)) * 4,
      index = Math.floor(pos),
      t = pos - index;
    return (
      "#" +
      stops[index]
        .map((v, i) =>
          Math.round(v + (stops[index + 1][i] - v) * t)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  }
  function frameArt(path) {
    const points = outlinePoints(path),
      outlines = [12, 10, 1, -8, -10, -12].map((n) => contour(points, n));
    let facets = "";
    for (let band = 0; band < outlines.length - 1; band++) {
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length,
          a = points[i],
          b = points[j],
          length = Math.hypot(b[0] - a[0], b[1] - a[1]),
          light = (-0.64 * (b[1] - a[1]) + 0.77 * (b[0] - a[0])) / length,
          brightness =
            band === 0
              ? 0.38 + 0.22 * light
              : band === 1
                ? 0.52 + 0.18 * light
                : band === 2
                  ? 0.52 - 0.18 * light
                  : band === 3
                    ? 0.24 - 0.17 * light
                    : 0.35 + 0.18 * light,
          color = `url(#rim-face-${Math.max(0, Math.min(8, Math.round(brightness * 8)))})`,
          polygon = [
            outlines[band][i],
            outlines[band][j],
            outlines[band + 1][j],
            outlines[band + 1][i],
          ]
            .map(pointText)
            .join(" ");
        facets += `<polygon points="${polygon}" fill="${color}" stroke="${color}" stroke-width=".6"/>`;
      }
    }
    const ring = `M${outlines[0].map(pointText).join("L")}Z M${outlines[5].map(pointText).join("L")}Z`,
      ridge = `M${outlines[2].map(pointText).join("L")}Z`,
      outerEdge = `M${outlines[0].map(pointText).join("L")}Z`,
      innerEdge = `M${outlines[5].map(pointText).join("L")}Z`,
      bottom = points.reduce((best, p) => (p[1] > best[1] ? p : best)),
      upper = points
        .flatMap((p, i) => {
          const next = points[(i + 1) % points.length];
          if ((p[0] - 256) * (next[0] - 256) > 0 || p[0] === next[0]) return [];
          const t = (256 - p[0]) / (next[0] - p[0]);
          return [[256, p[1] + t * (next[1] - p[1])]];
        })
        .reduce((best, p) => (p[1] < best[1] ? p : best)),
      jewel = ([x, y], angle = 0, scale = 1) =>
        `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})"><path d="M0 -22L13 0L0 22L-13 0Z" fill="#e79817" stroke="#6c3208" stroke-width="2.4"/><path d="M0 -19L10 0L0 18L-10 0Z" fill="url(#rim-ornament)" stroke="#fff0a2" stroke-width="1.5"/><path d="M0 -18L-10 0L0 4Z" fill="#fff9c8"/><path d="M0 4L10 0L0 18Z" fill="#b76008"/><path d="M0 -18V4L10 0Z" fill="#ffd943"/></g>`,
      sideAt = (right, targetY) => {
        const candidates = points.map((p, i) => ({ p, i })).filter(({ p }) => right ? p[0] > 300 : p[0] < 212);
        const { p, i } = candidates.reduce((a, b) => Math.abs(a.p[1] - targetY) < Math.abs(b.p[1] - targetY) ? a : b);
        const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
        let angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI - 90;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        return { p, angle };
      },
      leafMount = ({ p: [x, y], angle }) =>
        `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M0 -32C-13 -25 -14 -11 -7 0C-14 11 -13 25 0 32C13 25 14 11 7 0C14 -11 13 -25 0 -32Z" fill="url(#rim-ornament)" stroke="#783508" stroke-width="2"/><path d="M0 -28C-8 -17 -4 -10 0 -6M0 28C8 17 4 10 0 6" fill="none" stroke="#fff3a8" stroke-width="2.5" stroke-linecap="round"/><path d="M0 -28C6 -16 4 -9 0 -5M0 28C-6 16 -4 9 0 5" fill="none" stroke="#ab5809" stroke-width="2"/><ellipse rx="8" ry="9" fill="url(#rim-ornament)" stroke="#854006" stroke-width="2"/><path d="M-4 0Q-5 -6 1 -6" fill="none" stroke="#fff9ce" stroke-width="2.5" stroke-linecap="round"/></g>`,
      mounts = [false, true].map(right => {
        const corner = sideAt(right, 118), leaf = sideAt(right, 270);
        return jewel(corner.p, corner.angle, .72) + leafMount(leaf);
      }).join("");
    // Broad reflected light bands continue across all facets. Their contrast is
    // intentional: polished metal alternates cream highlights and amber shade.
    const reflections = [[0, .18], [.13, -.28], [.2, -.03], [.27, .5], [.3, .5],
      [.36, -.12], [.47, -.32], [.56, -.03], [.64, .48], [.68, .5], [.75, -.18], [.87, -.3], [1, .25]],
      faceGradients = Array.from({ length: 9 }, (_, shade) =>
        `<linearGradient id="rim-face-${shade}" gradientUnits="userSpaceOnUse" x1="25" y1="0" x2="420" y2="512">${reflections.map(([offset, light]) =>
          `<stop offset="${offset}" stop-color="${goldLight(shade / 8 + light)}"/>`).join("")}</linearGradient>`).join("");
    return `<defs>${faceGradients}
      <linearGradient id="rim-shine" x1="0" y1="0" x2=".8" y2="1"><stop stop-color="#fffbe5" stop-opacity=".3"/><stop offset=".23" stop-color="#fff9da" stop-opacity="0"/><stop offset=".31" stop-color="#fffbe6" stop-opacity=".62"/><stop offset=".38" stop-color="#fff9da" stop-opacity="0"/><stop offset=".7" stop-color="#fff9da" stop-opacity="0"/><stop offset=".78" stop-color="#fffbe6" stop-opacity=".5"/><stop offset=".85" stop-color="#fff9da" stop-opacity="0"/></linearGradient>
      <linearGradient id="rim-edge" x2=".7" y2="1"><stop stop-color="#fff9c6"/><stop offset=".24" stop-color="#ffdf68"/><stop offset=".46" stop-color="#fffce2"/><stop offset=".7" stop-color="#dc9718"/><stop offset="1" stop-color="#fff2a2"/></linearGradient>
      <linearGradient id="rim-ornament" x1="0" y1="0" x2="1" y2=".7"><stop stop-color="#d47a07"/><stop offset=".25" stop-color="#fff5b6"/><stop offset=".48" stop-color="#ffdb51"/><stop offset=".72" stop-color="#e4a11a"/><stop offset="1" stop-color="#ac5306"/></linearGradient>
      <filter id="rim-shadow" x="-.1" y="-.1" width="1.2" height="1.2"><feDropShadow dx="0" dy="3" stdDeviation="1.8" flood-color="#48200a" flood-opacity=".7"/></filter>
      </defs><g filter="url(#rim-shadow)"><path d="${ring}" fill="#8d4409" fill-rule="evenodd"/>${facets}<path d="${ring}" fill="url(#rim-shine)" fill-rule="evenodd"/><path d="${outerEdge}" fill="none" stroke="#49250c" stroke-width="3.2" stroke-linejoin="round"/><path d="${innerEdge}" fill="none" stroke="#71380a" stroke-width="2.8" stroke-linejoin="round"/><path d="${ridge}" fill="none" stroke="url(#rim-edge)" stroke-width="3" stroke-linejoin="round"/>${mounts}${jewel(upper)}${jewel(bottom)}</g>`;
  }
  const frames = shapes.map(([id, name, path]) => ({
    id,
    name,
    inner_path: path,
    symbol_box: [127, 123, 258, 272],
    svg: frameArt(path),
    vector: true,
  }));
  const colors = [
    ["c21_snow", "Белая эмаль", "#FAF6E9"],
    ["c22_coal", "Уголь", "#26292D"],
    ["c23_navy", "Морская глубина", "#123158"],
    ["c24_scarlet", "Киноварь", "#B72120"],
    ["c25_teal", "Петроль", "#146A70"],
    ["c26_copper", "Медь", "#C36B36"],
    ["c27_olive", "Олива", "#6E752B"],
    ["c28_sand", "Песчаник", "#D8B775"],
    ["c29_chocolate", "Шоколад", "#613D28"],
    ["c30_cerulean", "Василёк", "#527BCB"],
    ["c31_pine", "Тёмная хвоя", "#124937"],
    ["c32_pearl", "Жемчуг", "#DFE4DE"],
  ].map(([id, name, hex]) => ({ id, name, hex }));
  const patterns = [
    ["solid", "Однотонное поле", ""],
    ["per_pale", "Рассечение", "M0 0H256V512H0Z"],
    ["per_fess", "Пересечение", "M0 256H512V512H0Z"],
    ["quarterly", "Четверочастный щит", "M0 0H256V256H0ZM256 256H512V512H256Z"],
    ["chief", "Глава", "M0 0H512V164H0Z"],
    ["pale", "Столб", "M204 0H308V512H204Z"],
    ["dexter", "Правый край", "M0 0H169V512H0Z"],
    ["sinister", "Левый край", "M343 0H512V512H343Z"],
    ["fess", "Пояс", "M0 213H512V315H0Z"],
    ["bend", "Правая перевязь", "M-70 0H70L582 512H442Z"],
    ["bend_sinister", "Левая перевязь", "M442 0H582L70 512H-70Z"],
    ["chevron", "Стропило", "M0 348L256 116L512 348V454L256 222L0 454Z"],
    ["cross", "Простой крест", "M205 0H307V205H512V307H307V512H205V307H0V205H205Z"],
    [
      "saltire",
      "Косой крест",
      "M-60 0H60L256 196L452 0H572L316 256L572 512H452L256 316L60 512H-60L196 256Z",
    ],
    ["bordure", "Кайма", ""],
    ["base", "Оконечность", "M0 350H512V512H0Z"],
    ["lozenge", "Ромб", "M256 70L410 256L256 442L102 256Z"],
    ["checkered", "Шахматное поле", ""],
  ].map(([id, name, path]) => ({ id, name, path }));
  const metals = [
    { id: "gold", name: "Золото" },
    { id: "silver", name: "Серебро", tint: [1, 1.04, 1.1] },
    { id: "bronze", name: "Бронза", tint: [1.05, 0.75, 0.38] },
    { id: "copper", name: "Красная медь", tint: [1.15, 0.64, 0.42] },
    { id: "steel", name: "Воронёная сталь", tint: [0.45, 0.53, 0.62] },
  ];
  const presets = [
    { name: "Алый и золото", color: "c24_scarlet", secondary: "c17_honey", pattern: "chevron" },
    { name: "Лазурь и серебро", color: "c04_sapphire", secondary: "c21_snow", pattern: "cross" },
    { name: "Хвоя и кость", color: "c31_pine", secondary: "c18_ivory", pattern: "bend" },
    { name: "Уголь и золото", color: "c22_coal", secondary: "c17_honey", pattern: "quarterly" },
    { name: "Алый и белый", color: "c21_snow", secondary: "c24_scarlet", pattern: "per_pale" },
    { name: "Море и медь", color: "c23_navy", secondary: "c26_copper", pattern: "chief" },
  ];
  const symbols = [{"id":"s22_bear","name":"Медведь"},{"id":"s23_unicorn","name":"Единорог"},{"id":"s24_kraken","name":"Кракен"},{"id":"s25_rose","name":"Геральдическая роза"}];
  return { frames, colors, patterns, metals, presets, symbols };
});

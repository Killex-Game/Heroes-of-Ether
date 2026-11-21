/* Пять лавровых рамок. Чемпионская композиция собирается отдельно и не меняется. */
"use strict";
module.exports = function laurelFrame(t) {
  const rank = t.rank;
  const f = (n) => Number(n.toFixed(2));
  const stops = (values) =>
    values.map(([at, color]) => `<stop offset="${at}" stop-color="${color}"/>`).join("");
  const definitions = `<defs>
    <linearGradient id="band" x1="0" y1="0" x2=".8" y2="1">${stops([
      [0, t.dark],
      [0.16, t.light],
      [0.33, t.metal],
      [0.52, t.light],
      [0.68, t.metal],
      [1, t.dark],
    ])}</linearGradient>
    <linearGradient id="leaf" x1="0" y1="1" x2=".5" y2="0">${stops([
      [0, t.dark],
      [0.3, t.metal],
      [0.62, t.light],
      [0.82, t.metal],
      [1, t.light],
    ])}</linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2=".6" y2="1">${stops([
      [0, "#fff5bd"],
      [0.3, "#edba51"],
      [0.55, "#a76824"],
      [0.78, "#ffe291"],
      [1, "#bb7b2e"],
    ])}</linearGradient>
    <linearGradient id="enamel" x1="0" y1="0" x2="0" y2="1">${stops([
      [0, t.light],
      [0.32, t.metal],
      [0.7, t.dark],
      [1, t.metal],
    ])}</linearGradient>
  </defs>`;
  let branch = `<path d="M99 229C16 205 1 106 69 44" fill="none" stroke="${t.dark}" stroke-width="2.8"/><path d="M99 228C18 202 5 107 69 44" fill="none" stroke="url(#gold)" stroke-width="1.2"/>`;
  const count = [7, 8, 9, 9, 10][rank];
  for (let i = 0; i < count; i++) {
    const angle = ((108 + (i * (rank >= 3 ? 134 : 124)) / (count - 1)) * Math.PI) / 180;
    const x = 128 + 104 * Math.cos(angle),
      y = 128 + 104 * Math.sin(angle);
    const size = (i === count - 1 ? 0.78 : 1) * (rank === 0 ? 0.9 : 1);
    branch += `<g transform="translate(${f(x)} ${f(y)}) rotate(${f((angle * 180) / Math.PI + 90)}) scale(${size})">
      <path d="M0 0C2 -11 16 -17 26 -12C22 -2 10 4 0 0Z" fill="url(#leaf)" stroke="${t.dark}" stroke-width=".85"/>
      <path d="M1 -.3Q11 -8 25 -12Q18 -3 9 -.6Z" fill="${t.light}" opacity=".35"/>
      <path d="M0 0Q12 -6 25 -12M9 -4L10 -11M15 -7L18 -3" fill="none" stroke="${t.light}" stroke-width=".65" opacity=".8"/>
      ${rank >= 2 ? `<path d="M2 0Q12 8 20 3Q14 -3 2 0Z" fill="url(#leaf)" stroke="${t.dark}" stroke-width=".65"/>` : ""}
    </g>`;
  }
  let details = "";
  const rimWidth = [8, 9, 11, 10, 11][rank];
  if (rank >= 1)
    details += `<circle cx="128" cy="128" r="96" fill="none" stroke="${t.light}" stroke-width=".65" stroke-dasharray="${rank === 1 ? "1 5" : rank === 2 ? "2 4" : "1 3"}"/>`;
  if (rank >= 3)
    details += `<circle cx="128" cy="128" r="96" fill="none" stroke="${t.dark}" stroke-width="2.8"/><circle cx="128" cy="128" r="95" fill="none" stroke="${t.light}" stroke-width=".6"/>`;
  // Small crests distinguish the higher leagues without spikes around the portrait.
  if (rank === 2) {
    details += `<g transform="translate(128 27)">`;
    for (let i = 0; i < 8; i++)
      details += `<path d="M0 -9Q2 -4 0 0Q-2 -4 0 -9Z" transform="rotate(${i * 45})" fill="url(#gold)" stroke="#97591f" stroke-width=".5"/>`;
    details += `<circle r="3.8" fill="url(#gold)" stroke="#fff2a3" stroke-width=".8"/></g>`;
  }
  if (rank === 3)
    details += `<path d="M111 30Q128 9 145 30Q136 25 128 35Q120 25 111 30Z" fill="url(#band)" stroke="url(#gold)" stroke-width="1.2"/><path d="M128 18V33M118 27Q128 19 138 27" fill="none" stroke="${t.light}" stroke-width=".9"/>`;
  if (rank === 4) {
    for (const [x, y, s] of [
      [128, 24, 1],
      [114, 29, 0.55],
      [142, 29, 0.55],
    ])
      details += `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0 -10 7 -2 0 9 -7 -2Z" fill="url(#enamel)" stroke="url(#gold)" stroke-width="1.1"/><path d="M0 -10V9L-7 -2H7Z" fill="${t.light}" opacity=".6"/><path d="M0 -10 -2 -2 0 9 3 -2Z" fill="${t.metal}" opacity=".7"/></g>`;
    details += `<path d="M119 225Q128 214 137 225L128 233Z" fill="url(#band)" stroke="url(#gold)" stroke-width="1.2"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    ${definitions}<g stroke-linecap="round" stroke-linejoin="round">
    ${branch}<g transform="translate(256 0) scale(-1 1)">${branch}</g>
    <circle cx="128" cy="128" r="96" fill="none" stroke="${t.dark}" stroke-width="${rimWidth + 2}"/>
    <circle cx="128" cy="128" r="96" fill="none" stroke="url(#band)" stroke-width="${rimWidth}"/>
    <circle cx="128" cy="128" r="102" fill="none" stroke="url(#gold)" stroke-width="1.5"/>
    <circle cx="128" cy="128" r="89.5" fill="none" stroke="url(#gold)" stroke-width="1.5"/>
    <path d="M61 65A93 93 0 0 1 169 43" fill="none" stroke="${t.light}" stroke-width="1.1" opacity=".9"/>
    ${details}</g></svg>`;
};

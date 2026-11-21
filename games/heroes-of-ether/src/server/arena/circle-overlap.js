/* Геометрия пересечения кругов. */
"use strict";
// Доля площади меньшего круга, находящаяся внутри другого круга.
// Одинаково работает для равных частей и большой сферы с маленькой.
function overlapFraction(a, b) {
  const r = Math.min(a.radius, b.radius),
    R = Math.max(a.radius, b.radius);
  if (!(r > 0) || !Number.isFinite(R)) return 0;
  const dx = a.x - b.x,
    dy = a.y - b.y;
  if (Math.abs(dx) >= R + r || Math.abs(dy) >= R + r) return 0;
  const d = Math.hypot(dx, dy);
  if (d >= R + r) return 0;
  if (d <= R - r) return 1;
  const unit = (n) => Math.max(-1, Math.min(1, n));
  const area =
    r * r * Math.acos(unit((d * d + r * r - R * R) / (2 * d * r))) +
    R * R * Math.acos(unit((d * d + R * R - r * r) / (2 * d * R))) -
    0.5 * Math.sqrt(Math.max(0, (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)));
  return Math.max(0, Math.min(1, area / (Math.PI * r * r)));
}
module.exports = { overlapFraction };

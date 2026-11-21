"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { clearSegment, segmentTester, route } = require("../../src/server/arena/projectile-route");

test("indexed routes preserve exact contour intersections in sparse and crowded rooms", () => {
  let seed = 891;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (const extent of [400, 5000]) {
    const circles = Array.from({ length: 560 }, () => ({
      x: random() * extent,
      y: random() * extent,
      r: 2 + random() * 100,
    }));
    // A very large circle spans many local groups and must not be excluded.
    circles.push({ x: extent * 0.8, y: extent * 0.8, r: extent * 0.4 });
    const order = circles.slice(),
      testSegment = segmentTester(circles);
    for (let i = 0; i < 1200; i++) {
      const a = { x: random() * extent, y: random() * extent };
      const b = i % 3 ? { x: a.x + random() * 500 - 250, y: a.y + random() * 500 - 250 } : a;
      assert.equal(testSegment(a, b), clearSegment(a, b, circles));
    }
    for (const c of circles.slice(0, 30)) {
      const a = { x: c.x - c.r * 2, y: c.y - c.r };
      const b = { x: c.x + c.r * 2, y: c.y - c.r };
      assert.equal(testSegment(a, b), clearSegment(a, b, circles));
    }
    assert.deepEqual(circles, order);
  }
});

test("route broad phase preserves tangent, crossing, outward and enclosing contours", () => {
  const circles = [{ x: 50, y: 50, r: 20 }];
  assert.equal(clearSegment({ x: 0, y: 30 }, { x: 100, y: 30 }, circles), true);
  assert.equal(clearSegment({ x: 0, y: 31 }, { x: 100, y: 31 }, circles), false);
  assert.equal(clearSegment({ x: 0, y: 50 }, { x: 100, y: 50 }, circles), false);
  assert.equal(clearSegment({ x: 30, y: 50 }, { x: 0, y: 50 }, circles), true);
  assert.equal(clearSegment({ x: 30, y: 50 }, { x: 31, y: 50 }, circles), false);
  assert.equal(clearSegment({ x: 50, y: 50 }, { x: 50, y: 50 }, circles), false);
  assert.equal(
    clearSegment({ x: 50, y: 50 }, { x: 51, y: 50 }, [{ x: 500, y: 50, r: 480 }]),
    false,
  );
});

test("far-away parts do not alter a local ricochet route or allow passage through a blocking ball", () => {
  const start = { x: 100, y: 200 };
  const blocker = { x: 200, y: 200, r: 45 };
  const target = { x: 310, y: 200, r: 25 };
  const circles = [blocker, target];
  const world = { width: 5000, height: 4000 };
  const path = route(start, circles, [target], world);
  assert.ok(path.length > 1);
  const distant = Array.from({ length: 560 }, (_, i) => ({
    x: 2500 + (i % 28) * 50,
    y: 2000 + Math.floor(i / 28) * 50,
    r: 15,
  }));
  // More visibility-graph nodes can choose another equally safe path. Every
  // resulting segment still has to respect the actual physical contours.
  const densePath = route(start, [...circles, ...distant], [target], world);
  assert.ok(densePath.length > 1);
  let previous = start;
  for (const point of densePath) {
    assert.equal(clearSegment(previous, point, circles), true);
    previous = point;
  }
  assert.ok(Math.abs(Math.hypot(previous.x - target.x, previous.y - target.y) - target.r) < 0.01);
});

/* Модульные проверки игровых правил. */
"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { overlapFraction } = require("../../src/server/arena/circle-overlap"),
  { Arena, radiusForMass } = require("../../src/server/arena/arena-simulation");
const view = require("../../public/shared/arena-camera-and-layout");
test("Площадь пересечения: касание, вложенные круги, равные и симметрия", () => {
  const a = { x: 0, y: 0, radius: 100 };
  assert.equal(overlapFraction(a, { ...a, x: 200 }), 0);
  assert.equal(overlapFraction(a, a), 1);
  assert.equal(overlapFraction(a, { x: 50, y: 0, radius: 50 }), 1);
  const expected = 2 / 3 - Math.sqrt(3) / (2 * Math.PI);
  assert.ok(Math.abs(overlapFraction(a, { ...a, x: 100 }) - expected) < 1e-12);
  for (const r of [24, 50, 100, 1000]) {
    const b = { x: 70, y: 40, radius: r };
    assert.equal(overlapFraction(a, b), overlapFraction(b, a));
  }
});
test("Неравные круги: формула совпадает с независимым численным интегрированием", () => {
  const a = { x: 0, y: 0, radius: 100 },
    b = { x: 72, y: 0, radius: 45 };
  const slices = 20000,
    dx = 90 / slices;
  let area = 0;
  for (let i = 0; i < slices; i++) {
    const x = b.x - b.radius + (i + 0.5) * dx;
    area +=
      2 *
      Math.min(
        Math.sqrt(Math.max(0, a.radius * a.radius - x * x)),
        Math.sqrt(Math.max(0, b.radius * b.radius - (x - b.x) ** 2)),
      ) *
      dx;
  }
  assert.ok(Math.abs(overlapFraction(a, b) - area / (Math.PI * b.radius * b.radius)) < 1e-6);
});
test("Соединение на глубине R − r/3: равные и неравные части, порядок и сохранение массы", () => {
  for (const masses of [
    [2, 2],
    [50, 50],
    [4500, 500],
    [500, 4500],
  ]) {
    const arena = new Arena({ etherCount: 0, world: { width: 10000, height: 10000 } }),
      p = arena.addPlayer(0, "p");
    p.parts = masses.map((mass, i) => ({
      id: i ? "small" : "p",
      mass,
      radius: radiusForMass(mass),
      x: 5000,
      y: 5000,
      vx: 0,
      vy: 0,
    }));
    p.mergeAt = 30000;
    p.stopped = true;
    const [a, b] = p.parts,
      edge = Math.max(a.radius, b.radius) - Math.min(a.radius, b.radius) / 3;
    b.x = a.x + edge - 0.001;
    arena.moveParts(p, 29999, 0);
    assert.equal(p.parts.length, 2, "задержка ещё действует");
    b.x = a.x + edge + 0.001;
    arena.moveParts(p, 30000, 0);
    assert.equal(p.parts.length, 2);
    b.x = a.x;
    b.y = a.y + edge + 0.001;
    arena.moveParts(p, 30000, 0);
    assert.equal(p.parts.length, 2, "порог одинаков по обеим осям");
    b.y = a.y;
    b.x = a.x + edge - 0.001;
    arena.moveParts(p, 30000, 0);
    assert.equal(p.parts, null);
    assert.equal(p.mass, masses[0] + masses[1]);
  }
});
test("Компактная группа из 16 частей приближена, разлёт ограничивает приближение", () => {
  const world = { width: 6120, height: 4080 },
    mass = 22194;
  const makeParts = (gap) =>
    Array.from({ length: 16 }, (_, i) => ({
      x: 2000 + (i % 4) * gap,
      y: 1500 + Math.floor(i / 4) * gap,
      mass: mass / 16,
      radius: radiusForMass(mass / 16),
    }));
  const compact = { mass, parts: makeParts(200) };
  const oldBaseline = view.desiredScale(
    { mass, parts: compact.parts.map(({ mass }) => ({ mass })) },
    1914,
    950,
    world,
  );
  const zoom = view.desiredScale(compact, 1914, 950, world);
  assert.ok(
    zoom > oldBaseline * 1.3,
    "Крупная компактная группа должна быть ближе прежнего масштаба",
  );
  const frame = view.groupFrame(compact);
  assert.ok(frame.width * zoom <= 1914 * 0.8 + 1e-6);
  assert.ok(frame.height * zoom <= 950 * 0.72 + 1e-6);
  assert.ok(view.desiredScale({ mass, parts: makeParts(600) }, 1914, 950, world) < zoom);
  for (const [width, height] of [
    [390, 844],
    [1366, 768],
    [1914, 950],
  ]) {
    const scale = view.desiredScale(compact, width, height, world);
    assert.ok(scale >= view.minimumScale(width, height, world));
    assert.ok(Number.isFinite(scale));
  }
});

test("Камера: разлёт отдельных частей не расширяет обзор; потолок 90% для разных экранов", () => {
  const world = { width: 2400, height: 1600 };
  for (const [width, height] of [
    [320, 844],
    [390, 844],
    [1280, 900],
    [1920, 1080],
    [3440, 1440],
  ])
    for (const mass of [10, 1000, 5000, 500000]) {
      const scale = view.desiredScale({ mass }, width, height, world);
      assert.equal(
        view.desiredScale(
          { mass, viewRadius: 100000, parts: [{ mass, x: 100000, y: -100000 }] },
          width,
          height,
          world,
        ),
        scale,
      );
      assert.ok(width / scale <= 2160 + 1e-7);
      assert.ok(height / scale <= 1440 + 1e-7);
    }
});
test("Плавный зум: скорость не зависит от FPS, нет скачка после роста массы", () => {
  const values = [];
  for (const fps of [30, 60, 144]) {
    let scale = 1;
    for (let i = 0; i < fps * 2; i++) scale = view.approachScale(scale, 0.5, 1 / fps);
    values.push(scale);
  }
  assert.ok(Math.abs(values[0] - Math.exp(-0.24)) < 1e-12);
  assert.ok(Math.max(...values) - Math.min(...values) < 1e-12);
  assert.ok(view.approachScale(1, 0.5, 1 / 60) > 0.99);
  let s = 1;
  for (let i = 0; i < 1000; i++) s = view.approachScale(s, 0.6, 1 / 60);
  assert.equal(s, 0.6);
  assert.ok(view.nameSize(100, 0.6) < view.nameSize(100, 1));
  const floor = view.minimumScale(3440, 1440, { width: 2400, height: 1600 });
  assert.ok(
    view.approachScale(0.6, 2, 1 / 60, floor) >= floor,
    "расширение окна не открывает всю карту во время плавного зума",
  );
});
test("Камера продолжает отдаляться каждые 25 000 массы на реальном размере арены", () => {
  const world = { width: 2400, height: 1600 },
    width = 1366,
    height = 768,
    base = 768 / 650;
  assert.equal(view.desiredScale({ mass: 10 }, width, height, world), base * 1.3);
  let last = base * 1.3;
  for (const mass of [100, 500, 1000, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 480000]) {
    const next = view.desiredScale({ mass }, width, height, world);
    assert.ok(next < last);
    last = next;
  }
  for (const mass of [150, 1000, 25000, 50000, 75000]) {
    const before = view.desiredScale({ mass: mass - 0.001 }, width, height, world);
    const after = view.desiredScale({ mass: mass + 0.001 }, width, height, world);
    assert.ok(before - after < (mass <= 1000 ? 1e-6 : 1e-7), "на пороге нет ступеньки");
  }
});

test("Маленький герой крупнее на 30%, от 1000 массы прежний масштаб", () => {
  const world = { width: 2400, height: 1600 };
  for (const [mass, previous] of [
    [50, 1.179785450512734],
    [100, 1.1776059661422495],
    [150, 1.1754394729191555],
    [1000, 1.140500701098678],
    [5000, 1.0140027717307034],
    [25000, 0.7697451005239099],
    [75000, 0.666734963458533],
  ]) {
    const player = { mass, x: 1200, y: 800, radius: radiusForMass(mass) };
    // Крупные тела дополнительно ограничиваются прежней геометрией группы.
    const scale = view.desiredScale({ mass }, 1366, 768, world);
    assert.equal(scale, previous * (mass <= 150 ? 1.3 : 1));
    if (mass <= 150) assert.equal(view.desiredScale(player, 1366, 768, world), scale);
  }
});

test("Приближение зависит от общей массы, разлёт маленьких частей помещается в кадр", () => {
  const world = { width: 2400, height: 1600 };
  for (const [width, height] of [
    [390, 844],
    [1366, 768],
    [1920, 1080],
  ]) {
    const parts = [0, 1].map((i) => ({
      mass: 50,
      radius: radiusForMass(50),
      x: 700 + i * (width < 500 ? 350 : 1000),
      y: 800,
    }));
    const scale = view.desiredScale({ parts }, width, height, world);
    const frame = view.groupFrame({ parts });
    assert.ok(scale * frame.width <= width, "обе части остаются видимыми");
    assert.ok(scale >= view.minimumScale(width, height, world));
    const camera = { scale: view.desiredScale({ mass: 100 }, width, height, world) };
    const grown = view.desiredScale({ mass: 1000 }, width, height, world);
    view.updateZoom(camera, grown, 1 / 60);
    assert.ok(camera.scale > grown, "рост массы не переключает зум одним кадром");
  }
  const parts = Array.from({ length: 16 }, () => ({ mass: 1000 / 16 }));
  assert.equal(view.desiredScale({ parts }, 1366, 768, world), 0.9880727129912967);
});
test("Число, площадь и габариты частей расширяют обзор даже до 25 000", () => {
  const world = { width: 2400, height: 1600 },
    width = 1366,
    height = 768;
  const single = view.desiredScale({ mass: 2000 }, width, height, world);
  let last = single;
  for (const count of [2, 4, 8, 16]) {
    const scale = view.desiredScale(
      { parts: Array.from({ length: count }, () => ({ mass: 2000 / count })) },
      width,
      height,
      world,
    );
    assert.ok(scale < last);
    assert.ok(scale > single * 0.8, "даже 16 частей не дают чрезмерный обзор");
    last = scale;
  }
  const parts = Array.from({ length: 8 }, () => ({
    mass: 18000,
    radius: radiusForMass(18000),
    x: 500,
    y: 500,
  }));
  const scale = view.desiredScale({ parts }, width, height, world);
  assert.ok(scale < view.desiredScale({ mass: 144000 }, width, height, world));
  assert.ok(scale >= view.minimumScale(width, height, world));
  for (let i = 0; i < parts.length; i++) {
    parts[i].x = i * 1000;
    parts[i].y = 10000 - i * 1000;
  }
  assert.ok(view.desiredScale({ parts }, width, height, world) < scale);
});

test("Рост второстепенной части и смена главной не перебрасывают центр камеры", () => {
  const parts = [
    { id: "a", mass: 100, radius: radiusForMass(100), x: 100, y: 500 },
    { id: "b", mass: 100, radius: radiusForMass(100), x: 1100, y: 500 },
  ];
  const before = view.groupFrame({ parts, mainPartId: "a" });
  parts[1].mass += 10;
  parts[1].radius = radiusForMass(110);
  const after = view.groupFrame({ parts, mainPartId: "b" });
  assert.ok(Math.abs(after.x - before.x) < 1, "рост края вместо скачка центра масс на 24 единицы");
  assert.deepEqual(after, view.groupFrame({ parts, mainPartId: "a" }));
  const camera = { x: before.x, y: before.y, scale: 1 };
  view.followCenter(camera, after, 1 / 60);
  assert.ok(camera.x > before.x && camera.x - before.x < 0.01);
});
test("Камера плавно следует за группой при 30/60/144 FPS, ограничивает резкую потерю части", () => {
  const positions = [];
  for (const fps of [30, 60, 144]) {
    const camera = { x: 0, y: 0, scale: 1 };
    for (let i = 0; i < fps; i++) view.followCenter(camera, { x: 10, y: 20 }, 1 / fps);
    positions.push(camera.x);
    assert.ok(camera.x > 9.9 && camera.x < 10);
    for (let i = 0; i < fps; i++) {
      const before = { ...camera };
      view.followCenter(camera, { x: 1000, y: -1000 }, 1 / fps);
      assert.ok(Math.hypot(camera.x - before.x, camera.y - before.y) <= 180 / fps + 1e-8);
    }
  }
  assert.ok(Math.max(...positions) - Math.min(...positions) < 1e-8);
});
test("Группа учитывает большие части; крошечный дальний осколок не меняет центр и габариты", () => {
  const parts = [
    { mass: 5000, radius: radiusForMass(5000), x: 800, y: 500 },
    { mass: 5000, radius: radiusForMass(5000), x: 1200, y: 500 },
  ];
  const before = view.groupFrame({ parts });
  parts.push({ mass: 10, radius: radiusForMass(10), x: 100000, y: 100000 });
  const after = view.groupFrame({ parts });
  for (const key of ["x", "y", "width", "height"]) assert.equal(before[key], after[key]);
});

test("Рост радиуса плавный, не выходит за целевой размер и одинаков при разных FPS", () => {
  const values = [];
  for (const fps of [30, 60, 144]) {
    const displayed = { radius: 40 },
      target = 200;
    view.animateRadius(displayed, target, 1 / fps);
    assert.ok(
      displayed.radius > 40 && displayed.radius < 70,
      "первый кадр не перескакивает к новому размеру",
    );
    for (let i = 1; i < fps / 2; i++) {
      const before = displayed.radius;
      view.animateRadius(displayed, target, 1 / fps);
      assert.ok(displayed.radius >= before && displayed.radius <= target);
    }
    values.push(displayed.radius);
    assert.ok(displayed.radius > 199, "размер догоняет массу за полсекунды");
    for (let i = 0; i < fps; i++) view.animateRadius(displayed, target, 1 / fps);
    assert.equal(displayed.radius, target);
  }
  assert.ok(Math.max(...values) - Math.min(...values) < 1e-9);
});

test("Повторный прирост не сбрасывает анимацию; потеря массы не вызывает переразмера", () => {
  const displayed = { radius: 40 };
  for (let i = 0; i < 5; i++) view.animateRadius(displayed, 100, 1 / 60);
  const before = displayed.radius,
    velocity = displayed.radiusVelocity;
  view.animateRadius(displayed, 150, 1 / 60);
  assert.ok(displayed.radius > before && displayed.radius < 150);
  assert.ok(velocity > 0);
  let previous = displayed.radius;
  for (let i = 0; i < 120; i++) {
    view.animateRadius(displayed, 20, 1 / 60);
    assert.ok(displayed.radius <= previous && displayed.radius >= 20);
    previous = displayed.radius;
  }
  assert.equal(displayed.radius, 20);
});

test("Камера мягко начинает и заканчивает зум, сохраняя предел скорости и обзора", () => {
  for (const fps of [30, 60, 144]) {
    const camera = { scale: 1 };
    let last = 1;
    view.updateZoom(camera, 0.8, 1 / fps, 0.5);
    assert.ok(
      camera.scale > Math.exp(-0.12 / fps),
      "плавный старт медленнее максимальной скорости",
    );
    last = camera.scale;
    for (let i = 0; i < fps * 8; i++) {
      view.updateZoom(camera, 0.8, 1 / fps, 0.5);
      assert.ok(camera.scale <= last + 1e-12 && camera.scale >= 0.8 - 1e-12);
      assert.ok(Math.log(last / camera.scale) <= 0.12 / fps + 1e-12);
      last = camera.scale;
    }
    assert.ok(Math.abs(camera.scale - 0.8) < 1e-6);
  }
});
test("Вертикальная группа больших шаров не открывает лишнюю карту за счёт большого запаса по высоте", () => {
  const world = { width: 6120, height: 4080 };
  for (const mass of [25000, 40000, 65000, 70000]) {
    const radius = radiusForMass(mass / 16);
    const vertical = {
      parts: Array.from({ length: 16 }, (_, i) => ({
        mass: mass / 16,
        radius,
        x: Math.floor(i / 4) * radius * 1.6,
        y: (i % 4) * radius * 2.5,
      })),
    };
    const horizontal = { parts: vertical.parts.map((p) => ({ ...p, x: p.y, y: p.x })) };
    const frame = view.groupFrame(vertical);
    const scale = view.desiredScale(vertical, 1920, 960, world);
    const previousHeightFit = (960 * 0.72) / frame.height;
    assert.ok(
      scale > previousHeightFit * 1.2,
      "минимум на 20% ближе для показанной вытянутой группы",
    );
    assert.ok(scale >= view.desiredScale(horizontal, 1920, 960, world) * 0.82);
    assert.ok(frame.height * scale <= 960 * 0.9 + 1e-8, "основные части помещаются по высоте");
    assert.ok(frame.width * scale <= 1920 * 0.8 + 1e-8);
    if (mass === 65000)
      assert.equal(view.desiredScale(horizontal, 1920, 960, world), 0.5796996204474442);
  }
});

test("Изменение ориентации группы не даёт ступенек масштаба", () => {
  const world = { width: 6120, height: 4080 };
  const radius = radiusForMass(65000 / 16);
  const source = Array.from({ length: 16 }, (_, i) => ({
    mass: 65000 / 16,
    radius,
    x: (Math.floor(i / 4) - 1.5) * radius * 1.6,
    y: ((i % 4) - 1.5) * radius * 2.5,
  }));
  let last;
  for (let i = 0; i <= 900; i++) {
    const angle = (i * Math.PI) / 1800;
    const parts = source.map((p) => ({
      ...p,
      x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
      y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
    }));
    const scale = view.desiredScale({ parts }, 1920, 960, world);
    if (last) assert.ok(Math.abs(scale / last - 1) < 0.003);
    last = scale;
  }
});

test("Однострочный ник растёт умеренно и вписывается в диаметр с небольшим запасом", () => {
  const measure = (text, size) => text.length * size * 0.6,
    name = "[КЛАН] ДлинноеИмяИгрока [100000]";
  assert.ok(view.nameSize(24, 1) < view.nameSize(100, 1));
  assert.ok(view.nameSize(10000, 1) <= 26);
  for (const radius of [24, 100, 450])
    for (const scale of [0.6, 1, 1.6]) {
      const layout = view.nameLayout(name, "12", radius, scale, measure);
      assert.ok(layout.size >= 6 && layout.size <= 26);
      assert.ok(layout.textWidth + layout.badgeRadius * 2 + 3 <= radius * scale * 2.15 + 1e-8);
      assert.ok(layout.textWidth > 0);
    }
});

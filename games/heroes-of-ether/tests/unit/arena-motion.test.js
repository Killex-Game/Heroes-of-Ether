"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Motion } = require("../../public/shared/arena-motion");
const body = (x, spawnSerial = 1, key = "a:one") => ({
  key,
  player: { id: key.split(":")[0], spawnSerial },
  part: { x, y: 200 },
});

test("Много обычных попаданий не задерживают общую шкалу анимации", () => {
  const motion = new Motion(),
    baseline = new Motion();
  const shots = Array.from({ length: 100 }, (_, i) => ({
    ...body(50, 1, "projectile:" + i),
    kind: "projectile",
  }));
  for (const m of [motion, baseline]) m.sync([body(100), ...shots], 10, 500);
  const ends = shots.map((s, i) => ({
    key: s.key,
    tick: 11 + (i % 3),
    x: 75,
    y: 200,
    hold: false,
  }));
  motion.sync([body(140)], 14, 700, ends);
  baseline.sync([body(140)], 14, 700);
  for (let now = 700; now < 900; now += 17) {
    motion.advance(now);
    baseline.advance(now);
    assert.equal(motion.cursor, baseline.cursor);
  }
  assert.equal(motion.sample("projectile:0"), null);
});
function movement({ fps = 60, jitter = [0], period = 50 } = {}) {
  const motion = new Motion(),
    events = [];
  for (let tick = 0; tick <= 200; tick++)
    events.push({ tick, at: tick * period + jitter[tick % jitter.length] });
  events.sort((a, b) => a.at - b.at);
  const speeds = [];
  let index = 0,
    previous;
  for (let at = 0; at < 9500; at += 1000 / fps) {
    while (index < events.length && events[index].at <= at) {
      const e = events[index++];
      motion.sync([body(100 + e.tick * 5)], e.tick, e.at);
    }
    motion.advance(at);
    const p = motion.sample("a:one");
    if (p && previous && at > 2000) speeds.push(((p.x - previous.x) / (at - previous.at)) * 1000);
    if (p) previous = { ...p, at };
  }
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  return {
    mean,
    cv: Math.sqrt(speeds.reduce((sum, n) => sum + (n - mean) ** 2, 0) / speeds.length) / mean,
    motion,
  };
}
test("Ровная скорость между шагами сервера при 30, 60 и 144 кадрах", () => {
  for (const fps of [30, 60, 144]) {
    const r = movement({ fps });
    assert.ok(Math.abs(r.mean - 100) < 1, JSON.stringify({ fps, mean: r.mean }));
    assert.ok(r.cv < 0.025, JSON.stringify({ fps, cv: r.cv }));
  }
});
test("Джиттер доставки и замедлившийся сервер не создают ступени каждый пакет", () => {
  for (const period of [50, 65, 85]) {
    const r = movement({ period, jitter: [0, 17, 35, 8, 28, 1] });
    assert.ok(r.cv < 0.12, JSON.stringify({ period, cv: r.cv }));
    assert.ok(Math.abs(r.mean - 5000 / period) < 4, JSON.stringify({ period, mean: r.mean }));
  }
});

test("Периодические паузы записи сглаживаются без прогнозирования и отката координат", () => {
  const m = new Motion(),
    events = [];
  for (let tick = 0; tick < 800; tick++)
    events.push({ tick, at: tick * 50 + Math.floor(Math.min(tick, 400) / 20) * 100 });
  let index = 0,
    previous = -Infinity,
    frozen = 0,
    largestDelay = 0;
  for (let at = 0; at < 39000; at += 1000 / 60) {
    while (index < events.length && events[index].at <= at) {
      const event = events[index++];
      m.sync([body(event.tick * 5)], event.tick, event.at);
    }
    m.advance(at);
    const point = m.sample("a:one");
    if (!point) continue;
    assert.ok(point.x >= previous, "позиция не откатывается назад");
    assert.ok(point.x <= m.latest / 10, "не показываем неподтверждённое движение");
    if (at > 5000 && at < 22000 && point.x === previous) frozen++;
    previous = point.x;
    largestDelay = Math.max(largestDelay, m.playbackDelayMs);
  }
  assert.equal(frozen, 0);
  assert.ok(largestDelay > 160 && largestDelay <= 240);
  assert.ok(m.playbackDelayMs <= 121, "стабильное соединение возвращает обычный запас");
});
test("Обрыв останавливает рисунок на подтверждённой позиции, восстановление не проигрывает старую жизнь", () => {
  const m = new Motion();
  m.sync([body(100)], 0, 0);
  m.sync([body(105)], 1, 50);
  for (let at = 60; at < 1000; at += 16) m.advance(at);
  assert.equal(m.sample("a:one").x, 105);
  m.sync([body(500)], 40, 2000);
  m.advance(2001);
  assert.equal(m.sample("a:one").x, 500);
  m.sync([body(1500, 2)], 41, 2050);
  m.advance(2051);
  assert.equal(m.sample("a:one").x, 1500);
  m.clear();
  assert.equal(m.sample("a:one"), null);
});
test("Деление, исчезновение части и повтор снимка не накапливают старые траектории", () => {
  const m = new Motion();
  for (let tick = 0; tick < 1000; tick++) {
    const bodies = [body(100 + tick), body(200 + tick, 1, "a:two")];
    m.sync(bodies, tick, tick * 50);
    m.sync(bodies, tick, tick * 50 + 1);
    m.advance(tick * 50 + 2);
  }
  assert.equal(m.tracks.size, 2);
  for (const track of m.tracks.values()) assert.ok(track.points.length <= 32);
  assert.ok(m.arrivals.length <= 24);
  const latest = m.latest;
  m.sync([body(-500)], 1, 50000);
  assert.equal(m.latest, latest);
  m.sync([body(1100)], 1000, 50000);
  assert.ok(m.sample("a:two"), "исчезновение ждёт того же времени, что и движение");
  assert.ok(m.sample("a:one").x <= 1100);
  for (let at = 50016; at < 50400; at += 16) m.advance(at);
  m.sync([body(1101)], 1005, 50401);
  for (let at = 50402; at < 50800; at += 16) m.advance(at);
  assert.equal(m.sample("a:two"), null);
});

test("Поглощение, рост массы и конец полёта показываются на общей шкале времени", () => {
  const m = new Motion();
  const attacker = (mass) => ({ ...body(100, 1, "owner:one"), part: { x: 100, y: 200, mass } });
  const projectile = (x) => ({ ...body(x, 1, "projectile:hook"), kind: "projectile" });
  m.sync([attacker(100), body(200), projectile(150)], 0, 0);
  m.sync([attacker(120)], 1, 50, [
    { key: "a:one", tick: 1, x: 110, y: 200 },
    { key: "projectile:hook", tick: 1, x: 190, y: 200 },
  ]);
  m.cursor = 25;
  assert.equal(m.sample("a:one").x, 155);
  assert.equal(m.sample("projectile:hook").x, 170);
  assert.equal(m.visible().find((b) => b.key === "owner:one").part.mass, 100);
  m.cursor = 50;
  assert.equal(m.sample("a:one"), null, "поглощённая часть исчезает без затухания");
  assert.equal(m.sample("projectile:hook").x, 190, "сам контакт показывается хотя бы один кадр");
  assert.equal(m.visible().find((b) => b.key === "owner:one").part.mass, 120);
  assert.equal(m.sample("projectile:hook"), null);
  m.cursor = 150;
  assert.ok(!m.visible().some((b) => b.key === "a:one"));
  m.cursor = 250;
  assert.equal(m.sample("a:one"), null);
});

test("Деление и слияние частей существующей жизни не меняют прозрачность", () => {
  const m = new Motion();
  m.sync([body(100)], 0, 0);
  m.sync([body(100), body(200, 1, "a:two")], 4, 200);
  for (const time of [200, 250, 300]) {
    m.cursor = time;
    assert.equal(m.visible().find((b) => b.key === "a:two").opacity, 1);
  }
  m.sync([body(200, 1, "a:two")], 8, 400);
  m.cursor = 400;
  assert.equal(m.sample("a:one"), null);
  assert.equal(m.visible().find((b) => b.key === "a:two").opacity, 1);
});

test("Новая жизнь плавно появляется, только уничтожение Огнём даёт затухание", () => {
  const m = new Motion();
  m.sync([body(100)], 0, 0);
  m.sync([body(100), body(200, 1, "new:one")], 4, 200);
  m.cursor = 200;
  assert.equal(m.visible().find((b) => b.key === "new:one").opacity, 0);
  m.cursor = 300;
  assert.equal(m.visible().find((b) => b.key === "new:one").opacity, 0.5);
  m.sync([body(100)], 8, 400, [{ key: "new:one", tick: 8, x: 210, y: 200, reason: "fire" }]);
  m.cursor = 500;
  const ghost = m.visible().find((b) => b.key === "new:one");
  assert.equal(ghost.opacity, 0.5);
  assert.equal(ghost.position.x, 210);
  assert.equal(ghost.retiring, true);
  m.cursor = 600;
  assert.equal(m.sample("new:one"), null);
});

test("Модель вышедшего игрока не появляется заново и не получает второе затухание", () => {
  const m = new Motion();
  m.sync([body(100)], 0, 0);
  const remnant = body(100, 1, "remnant:one");
  remnant.player.departure = { remainingMs: 16000, fadeMs: 1000 };
  m.sync([remnant], 4, 200);
  m.cursor = 200;
  assert.equal(m.sample("a:one"), null);
  assert.equal(m.visible()[0].opacity, 1);
  m.sync([], 8, 400);
  m.cursor = 400;
  assert.deepEqual(m.visible(), []);
});

test("Пропуск снимка попадания не начинает подтягивать цель до контакта", () => {
  const m = new Motion();
  m.sync([body(500)], 0, 0);
  m.sync([body(428)], 4, 200, [], [{ key: "a:one", tick: 2, x: 500, y: 200 }]);
  m.cursor = 75;
  assert.equal(m.sample("a:one").x, 500);
  m.cursor = 150;
  assert.equal(m.sample("a:one").x, 464);
  const size = m.tracks.get("a:one").points.length;
  m.sync([body(428)], 4, 201, [], [{ key: "a:one", tick: 2, x: 500, y: 200 }]);
  assert.equal(m.tracks.get("a:one").points.length, size);
});

test("Часть при делении и еда W проходят от точки рождения к снимкам без прозрачности", () => {
  for (const kind of [undefined, "food"]) {
    const m = new Motion();
    m.sync([body(100)], 0, 0);
    m.sync([body(100)], 4, 200);
    const child = { ...body(180, 1, "a:child"), kind };
    child.part.birth = { tick: 4, x: 100, y: 200 };
    m.sync([body(100), child], 6, 300);
    m.cursor = 200;
    assert.equal(m.sample(child.key).x, 100);
    m.cursor = 250;
    const shown = m.visible().find((b) => b.key === child.key);
    assert.equal(shown.position.x, 140);
    assert.equal(shown.opacity, 1);
    m.cursor = 300;
    assert.equal(m.sample(child.key).x, 180);
  }
});

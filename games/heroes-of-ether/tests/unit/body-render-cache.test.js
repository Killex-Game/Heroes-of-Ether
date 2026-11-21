"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { Tiles, BodyTiles } = require("../../public/arena/body-renderer");
test("Arena raster cache reuses tiles, evicts least recently used pixels, and releases on exit", () => {
  const cache = new Tiles(300, 3);
  let paints = 0;
  const create = () => {
    paints++;
    return { canvas: { width: 10, height: 10 } };
  };
  const first = cache.get("a", create),
    second = cache.get("b", create);
  cache.get("c", create);
  assert.equal(cache.get("a", create), first);
  assert.equal(paints, 3);
  cache.get("d", create);
  assert.equal(second.canvas.width, 0);
  assert.equal(cache.pixels, 300);
  assert.deepEqual([...cache.entries.keys()], ["c", "a", "d"]);
  cache.clear();
  assert.equal(first.canvas.width, 0);
  assert.equal(cache.entries.size, 0);
  assert.equal(cache.pixels, 0);
});

test("A repeated visible working set exceeding the budget does not repaint or evict itself", () => {
  const cache = new BodyTiles(300, 300);
  let paints = 0;
  const create = () => {
    paints++;
    return { canvas: { width: 10, height: 10 } };
  };
  for (let frame = 0; frame < 120; frame++) {
    cache.beginFrame();
    for (const key of ["a", "b", "c", "d", "e"]) {
      const tile = cache.acquire(key, 10, create);
      assert.equal(Boolean(tile), ["a", "b", "c"].includes(key));
    }
    assert.equal(cache.pixels, 300);
  }
  assert.equal(paints, 3);
});

test("Changing the view releases old portraits and respects the per-frame raster budget", () => {
  const cache = new BodyTiles(200, 100);
  const create = () => ({ canvas: { width: 10, height: 10 } });
  cache.beginFrame();
  const a = cache.acquire("a", 10, create);
  assert.equal(cache.acquire("b", 10, create), null);
  cache.beginFrame();
  const b = cache.acquire("b", 10, create);
  cache.beginFrame();
  assert.ok(cache.acquire("c", 10, create));
  assert.equal(a.canvas.width, 0);
  assert.equal(b.canvas.width, 10);
  cache.clear();
  assert.equal(b.canvas.width, 0);
  assert.equal(cache.pixels, 0);
  assert.ok(cache.acquire("after-rejoin", 10, create));
});

test("Large portraits bypass software rasterization without consuming the cache", () => {
  const cache = new BodyTiles(8 * 1024 * 1024);
  let paints = 0;
  for (let frame = 0; frame < 60; frame++) {
    cache.beginFrame();
    assert.equal(
      cache.acquire("large", 1024, () => {
        paints++;
      }),
      null,
    );
  }
  assert.equal(paints, 0);
  assert.equal(cache.pixels, 0);
});

test("A transient miss cannot evict portraits just used in the current frame", () => {
  const cache = new BodyTiles(100, 100);
  const create = () => ({ canvas: { width: 10, height: 10 } });
  cache.beginFrame();
  const a = cache.acquire("a", 10, create);
  cache.beginFrame();
  assert.equal(cache.acquire("zoomed", 10, create), null);
  assert.equal(cache.acquire("a", 10, create), a);
  cache.beginFrame();
  assert.equal(cache.acquire("zoomed", 10, create), null);
  cache.beginFrame();
  assert.ok(cache.acquire("zoomed", 10, create));
  assert.equal(a.canvas.width, 0);
});

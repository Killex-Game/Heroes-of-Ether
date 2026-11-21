"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { GraphDelta } = require("../../scripts/benchmarks/experimental-step-workers/graph-delta");

test("room graph round trips changes in both directions without replacing shared bodies", () => {
  const a = new GraphDelta(0), b = new GraphDelta(1);
  const body = { x: -0, y: Infinity, mass: 123.456, optional: undefined };
  const root = { players: new Map([["p", body]]), capture: { source: body }, set: new Set([body]),
    sparse: [, body], date: new Date(1234) };
  root.self = root;
  const remote = b.decode(structuredClone(a.encode(root)));
  assert.deepEqual(remote, root);
  const remoteBody = remote.players.get("p");
  assert.strictEqual(remoteBody, remote.capture.source);
  assert.strictEqual(remoteBody, [...remote.set][0]);
  assert.equal(b.encode(remote).updates.length, 0);
  remoteBody.mass += 50; delete remoteBody.optional; remoteBody.foo = "new";
  remote.players.set("second", { x: NaN, mass: 4 });
  remote.date.setTime(9876); remote.sparse.length = 4;
  const back = a.decode(structuredClone(b.encode(remote)));
  assert.strictEqual(back, root);
  assert.strictEqual(back.players.get("p"), body);
  assert.deepEqual(root, remote);
  assert.equal(a.encode(root).updates.length, 0);
  body.mass -= 2; root.set.delete(body); root.sparse[3] = body;
  assert.deepEqual(b.decode(structuredClone(a.encode(root))), root);
  assert.strictEqual(remote.players.get("p"), remoteBody);
});

test("room graph bounds its live cache and handles disappearing/reappearing objects", () => {
  const a = new GraphDelta(), b = new GraphDelta(1), root = { rows: [] };
  const retained = { x: 1 };
  for (let i = 0; i < 100; i++) {
    root.rows = [{ index: i }, ...(i % 2 ? [retained] : [])];
    assert.deepEqual(b.decode(structuredClone(a.encode(root))), root);
    assert.ok(a.nodes.size <= 4); assert.ok(b.nodes.size <= 4);
    assert.ok(a.tokens.size <= 4); assert.ok(b.tokens.size <= 4);
  }
});

test("room graph retains field order, sparse arrays and map ordering", () => {
  const a = new GraphDelta(), b = new GraphDelta(1), root = { a: 1, b: 2, c: 3, list: [1,,3] };
  const remote = b.decode(structuredClone(a.encode(root)));
  delete root.b; root.b = 4; delete root.list[0]; root.list.extra = "x";
  b.decode(structuredClone(a.encode(root)));
  assert.deepEqual(Object.keys(remote), Object.keys(root));
  assert.deepEqual(remote, root);
  assert.equal(0 in remote.list, false);
});

test("unchanged food produces no per-food updates, while nested mutation is delivered", () => {
  const a = new GraphDelta(), b = new GraphDelta(1);
  const root = { food: Array.from({ length: 1200 }, (_, i) => ({ id: `e${i}`, x: i, y: i,
    birth: { tick: 1, x: i, y: 0 } })) };
  const remote = b.decode(structuredClone(a.encode(root)));
  assert.equal(a.encode(root).updates.length, 0);
  root.food[3].birth.x++;
  const delta = a.encode(root);
  assert.equal(delta.updates.length, 1);
  assert.deepEqual(delta.updates[0][2], ["x"]);
  assert.deepEqual(b.decode(structuredClone(delta)), root);
  assert.strictEqual(b.decode(structuredClone(a.encode(root))), remote);
});

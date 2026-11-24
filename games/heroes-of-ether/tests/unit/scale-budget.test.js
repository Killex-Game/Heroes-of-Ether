'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { estimate } = require('../../scripts/benchmarks/scale-budget.cjs');
const input = require('../../docs/performance/scale-budget-300k.json');
test('Unknown capacity and costs cannot turn a 300k target into a capacity claim', () => {
  const r = estimate(input);
  assert.equal(r.allPlayersInFullRoomsLowerBound, 10000);
  assert.equal(r.nodes, null); assert.equal(r.monthlyRub, null);
  assert.equal(r.withinUpperBudget, null); assert.equal(r.productionCapacityProven, false);
  assert.equal(r.missing.length, 8);
});
test('Regional rounding, network bottleneck and one failed node per region are included', () => {
  const r = estimate({ ...input, peakCcu: 120, regions: [{name:'A',share:.5},{name:'B',share:.5}],
    arenaFraction: .5, roomFill: .5, headroom: 1, measurements: {
      sustainableRoomsPerNode: 2, wireBytesPerArenaPlayerSecond: 100000,
      wireBytesPerLobbyPlayerSecond: 10000, usableNodeMbps: 10, nodeMonthlyRub: 2000, nonComputeMonthlyRub: 3000
    }});
  assert.equal(r.regions[0].rooms, 2); assert.equal(r.regions[0].cpuNodes, 1);
  assert.equal(r.regions[0].networkNodes, 3); assert.equal(r.nodes, 8);
  assert.equal(r.monthlyRub, 19000); assert.equal(r.withinUpperBudget, true);
});
test('Invalid estimates cannot silently hide users or suppress headroom', () => {
  assert.throws(() => estimate({...input, regions:[{name:'A', share:.5}]}), /sum/);
  assert.throws(() => estimate({...input, roomFill:1.1}), /<= 1/);
  assert.throws(() => estimate({...input, headroom:.5}));
  assert.throws(() => estimate({...input, measurements:{sustainableRoomsPerNode:0}}), /positive/);
});

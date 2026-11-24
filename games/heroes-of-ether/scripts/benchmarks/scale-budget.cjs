'use strict';
const fs = require('node:fs');
const assert = require('node:assert/strict');

// Planning only: never changes admission limits or provisions infrastructure.
function estimate(input) {
  const positive = (value, key) => {
    assert(Number.isFinite(value) && value > 0, `${key} must be positive`);
    return value;
  };
  const fraction = (value, key) => {
    positive(value, key); assert(value <= 1, `${key} must be <= 1`); return value;
  };
  const ccu = positive(input.peakCcu, 'peakCcu');
  assert(Number.isSafeInteger(ccu));
  const capacity = positive(input.roomCapacity, 'roomCapacity');
  assert(Number.isSafeInteger(capacity));
  const regions = input.regions;
  assert(Array.isArray(regions) && regions.length > 0);
  assert.equal(new Set(regions.map(r => r.name)).size, regions.length);
  for (const region of regions) {
    assert(typeof region.name === 'string' && region.name.trim());
    fraction(region.share, 'region.share');
  }
  assert(Math.abs(regions.reduce((s, r) => s + r.share, 0) - 1) < 1e-9, 'region shares must sum to 1');
  const missing = [], measured = input.measurements || {};
  const arenaFraction = input.arenaFraction == null ? (missing.push('arenaFraction'), null) : fraction(input.arenaFraction, 'arenaFraction');
  const roomFill = input.roomFill == null ? (missing.push('roomFill'), null) : fraction(input.roomFill, 'roomFill');
  const read = key => measured[key] == null ? (missing.push('measurements.' + key), null) : positive(measured[key], key);
  const roomsPerNode = read('sustainableRoomsPerNode'), egress = read('wireBytesPerArenaPlayerSecond');
  const lobbyEgress = read('wireBytesPerLobbyPlayerSecond'), nodeMbps = read('usableNodeMbps');
  const unitPrice = read('nodeMonthlyRub'), fixedPrice = read('nonComputeMonthlyRub');
  const headroom = input.headroom == null ? 1.3 : positive(input.headroom, 'headroom');
  assert(headroom >= 1);
  const reserve = input.failureReserveNodesPerRegion == null ? 1 : input.failureReserveNodesPerRegion;
  assert(Number.isSafeInteger(reserve) && reserve >= 0);
  const totalWire = arenaFraction != null && egress != null && lobbyEgress != null
    ? ccu * (arenaFraction * egress + (1 - arenaFraction) * lobbyEgress) : null;
  const rows = regions.map(region => {
    const players = ccu * region.share;
    const rooms = arenaFraction != null && roomFill != null ? Math.ceil(players * arenaFraction / (capacity * roomFill)) : null;
    const cpuNodes = rooms != null && roomsPerNode != null ? Math.ceil(rooms * headroom / roomsPerNode) : null;
    const mbps = totalWire == null ? null : totalWire * region.share * 8 / 1e6;
    const networkNodes = mbps != null && nodeMbps != null ? Math.ceil(mbps * headroom / nodeMbps) : null;
    const nodes = cpuNodes == null || networkNodes == null ? null : Math.max(cpuNodes, networkNodes) + reserve;
    return { name: region.name, peakPlayers: players, rooms, cpuNodes, networkNodes, nodes, peakWireMbps: mbps };
  });
  const nodes = rows.some(r => r.nodes == null) ? null : rows.reduce((s, r) => s + r.nodes, 0);
  const monthlyRub = nodes == null || unitPrice == null || fixedPrice == null ? null : nodes * unitPrice + fixedPrice;
  const budget = input.monthlyBudgetRub;
  assert(Array.isArray(budget) && budget.length === 2 && budget.every(n => Number.isFinite(n) && n > 0) && budget[0] <= budget[1]);
  return {
    planningOnly: true, productionCapacityProven: false,
    allPlayersInFullRoomsLowerBound: Math.ceil(ccu / capacity),
    regions: rows, nodes, monthlyRub, monthlyBudgetRub: budget,
    withinUpperBudget: monthlyRub == null ? null : monthlyRub <= budget[1],
    missing, assumptions: { headroom, failureReserveNodesPerRegion: reserve },
    limitations: ['Aggregate estimate, not a load test; level bands and geography may add rooms.',
      'Database write capacity, gateway capacity, asset delivery, backups and failover require independent validation.',
      'Monthly traffic requires the integral of real concurrency and bytes; peak is not monthly average.']
  };
}
if (require.main === module) {
  if (!process.argv[2]) throw Error('Usage: node scripts/benchmarks/scale-budget.cjs INPUT.json');
  console.log(JSON.stringify(estimate(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))), null, 2));
}
module.exports = { estimate };

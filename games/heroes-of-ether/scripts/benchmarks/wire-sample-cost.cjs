'use strict';
// Offline, synthetic packets only. Values are counted separately from object
// keys/punctuation; nested details must not be added again to the total.
const fs = require('node:fs'), path = require('node:path');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
function analyze(packets) {
  const fields = {}, playerFields = {}, foodFields = {};
  let packetBytes = 0, valueBytes = 0, updates = 0, births = 0;
  for (const packet of packets) {
    if (!packet || packet.type !== 'state') throw Error('Expected a synthetic state packet');
    packetBytes += bytes(packet);
    for (const [key, value] of Object.entries(packet)) {
      const size = bytes(value);
      fields[key] = (fields[key] || 0) + size; valueBytes += size;
    }
    for (const player of packet.playersDelta?.upsert || []) {
      updates++;
      for (const [key, value] of Object.entries(player))
        playerFields[key] = (playerFields[key] || 0) + bytes(value);
    }
    for (const [key, value] of Object.entries(packet.foodDelta || {}))
      foodFields[key] = (foodFields[key] || 0) + bytes(value);
    for (const row of packet.foodDelta?.upsert || []) if (row[3]) births++;
  }
  return {packets:packets.length,packetBytes,valueBytes,keyAndSyntaxBytes:packetBytes-valueBytes,
    fields,playerFields,foodFields,playerUpdates:updates,foodMetadataRows:births};
}
function main(directory) {
  if (!directory) throw Error('Usage: node scripts/benchmarks/wire-sample-cost.cjs SYNTHETIC_WIRE_DIRECTORY');
  const reports = fs.readdirSync(directory).filter(name => name.endsWith('.ndjson')).sort().map(name => {
    const source = fs.readFileSync(path.join(directory,name),'utf8');
    const packets = source.split(/\r?\n/).filter(line=>line.trim()).map(JSON.parse);
    return {file:name,...analyze(packets)};
  });
  if (!reports.length) throw Error('No captured packets');
  return {scope:'Bounded offline samples, not all traffic, latency or maximum CCU',
    byteUnit:'UTF-8, serialized JSON; excludes WebSocket/TLS/IP overhead',reports};
}
if (require.main === module) console.log(JSON.stringify(main(process.argv[2]),null,2));
module.exports = {analyze,main};

"use strict";
// Explicit synthetic-client evidence. Session tokens never enter the artifact.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
function createAckAudit(token) {
  const directory = process.env.LOAD_ACK_DIR;
  if (!directory) return () => {};
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, process.pid + ".ndjson");
  const key = createHash("sha256").update(token).digest("hex");
  return (id, type, details) => {
    if (!id) return;
    fs.appendFileSync(file, JSON.stringify({ key, id, type, ...details }) + "\n");
  };
}
module.exports = { createAckAudit };

/* Local benchmark only: measure bounded young-generation size. */
"use strict";
const threads = require("node:worker_threads");
if (threads.isMainThread && process.env.LOAD_WORKER_YOUNG_MB) {
  const Original = threads.Worker;
  threads.Worker = class extends Original {
    constructor(file, options = {}) {
      super(file, String(file).endsWith("state-worker.js") ? {
        ...options,
        resourceLimits: { ...options.resourceLimits,
          maxYoungGenerationSizeMb: Number(process.env.LOAD_WORKER_YOUNG_MB) },
      } : options);
    }
  };
}

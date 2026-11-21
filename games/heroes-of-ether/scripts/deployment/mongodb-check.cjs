"use strict";
const { MongoClient } = require("mongodb");
const { credentials, safeError } = require("../../src/server/persistence/mongodb-config");
(async () => {
  const client = new MongoClient(credentials(process.argv[2]), {
    maxPoolSize: 3,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 20000,
    appName: "HeroEther-setup",
  });
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    const databases = await client
      .db("admin")
      .admin()
      .listDatabases({ nameOnly: true, authorizedDatabases: true });
    const result = [];
    for (const d of databases.databases) {
      if (["admin", "local", "config"].includes(d.name)) continue;
      const collections = await client.db(d.name).listCollections({}, { nameOnly: true }).toArray();
      result.push({ database: d.name, collections: collections.map((c) => c.name) });
    }
    console.log(JSON.stringify({ connected: true, databases: result }));
  } finally {
    await client.close();
  }
})().catch((e) => {
  console.error(safeError(e));
  for (const server of e.reason?.servers?.values?.() || []) {
    const error = server.error;
    console.error(
      JSON.stringify({
        type: server.type,
        error: error?.name,
        code: error?.code,
        cause: error?.cause?.code,
        tls: error?.cause?.reason,
        syscall: error?.cause?.syscall,
      }),
    );
  }
  process.exitCode = 1;
});

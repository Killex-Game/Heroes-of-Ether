"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseEnv } = require("node:util");

function credentials(file) {
  const env = parseEnv(fs.readFileSync(file, "utf8"));
  let uri = env.MONGODB_URI?.trim();
  if (!uri)
    throw Object.assign(Error("В файле подключения отсутствует MONGODB_URI."), {
      code: "MONGO_CONFIG",
    });
  uri = uri
    .replace(/<(?:db_)?username>/g, encodeURIComponent(env.MONGODB_USERNAME || ""))
    .replace(/<(?:db_)?password>/g, encodeURIComponent(env.MONGODB_PASSWORD || ""));
  if (!/^mongodb\+srv:\/\//.test(uri) || /[<>]/.test(uri))
    throw Object.assign(Error("Нужна заполненная строка подключения Atlas mongodb+srv."), {
      code: "MONGO_CONFIG",
    });
  const url = new URL(uri);
  if (!url.username || !url.password || url.hostname !== "heroether.bkvetas.mongodb.net")
    throw Object.assign(Error("Проверь пользователя БД и адрес HeroEther в файле подключения."), {
      code: "MONGO_CONFIG",
    });
  for (const [key, value] of url.searchParams) {
    if ((/^(tls|ssl)$/i.test(key) && value !== "true") || /insecure|allowInvalid/i.test(key))
      throw Object.assign(Error("Небезопасные параметры TLS запрещены."), { code: "MONGO_CONFIG" });
  }
  return uri;
}

function loadConfig(root) {
  const file = path.join(root, "config/mongodb.local.json");
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!value.enabled) return null;
  if (
    !path.isAbsolute(value.credentialsFile || "") ||
    !/^hero_ether(?:_test_[a-z0-9_]+)?$/.test(value.database || "") ||
    !/^[0-9a-f-]{36}$/.test(value.sourceId || "")
  )
    throw Object.assign(Error("Некорректный config/mongodb.local.json."), { code: "MONGO_CONFIG" });
  return {
    credentialsFile: value.credentialsFile,
    database: value.database,
    sourceId: value.sourceId,
    intervalMs: 30000,
  };
}

// Driver messages can include credentials/hosts/query fragments. Never log them.
function safeError(error) {
  const code = error?.code;
  if (code === 18) return "MONGO_AUTH_FAILED";
  if (code === 13) return "MONGO_PERMISSION_DENIED";
  if (typeof code === "string" && /^[A-Z_0-9]{1,50}$/.test(code)) return code;
  return error?.name === "MongoServerSelectionError"
    ? "MONGO_CONNECTION_FAILED"
    : "MONGO_OPERATION_FAILED";
}
module.exports = { credentials, loadConfig, safeError };

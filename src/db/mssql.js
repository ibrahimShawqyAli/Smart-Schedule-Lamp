// src/db/mssql.js
import sql from "mssql";
import logger from "../logger.js";

function bool(v, def = false) {
  if (v === undefined) return def;
  const s = String(v).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

const hasInstance = !!process.env.MSSQL_INSTANCE;

const config = {
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE || "LampModulationDB",
  user: process.env.MSSQL_USER || "lamp_app",
  password: process.env.MSSQL_PASSWORD || "",
  options: {
    encrypt: bool(process.env.MSSQL_ENCRYPT, false),
    trustServerCertificate: bool(
      process.env.MSSQL_TRUST_SERVER_CERTIFICATE,
      true
    ),
    enableArithAbort: true,
  },
  pool: {
    max: Number(process.env.MSSQL_POOL_MAX || 10),
    min: Number(process.env.MSSQL_POOL_MIN || 1),
    idleTimeoutMillis: Number(process.env.MSSQL_POOL_IDLE || 30000),
  },
};

// Prefer fixed port (like your working sqlcmd).
// Only use instanceName if MSSQL_INSTANCE is set.
if (hasInstance) {
  config.options.instanceName = process.env.MSSQL_INSTANCE;
} else {
  config.port = Number(process.env.MSSQL_PORT || 1433);
}

// Log effective (sanitized) config once
logger.info(
  {
    server: config.server,
    port: hasInstance ? null : config.port,
    instance: hasInstance ? config.options.instanceName : null,
    database: config.database,
    user: config.user,
    encrypt: config.options.encrypt,
    trustServerCertificate: config.options.trustServerCertificate,
  },
  "MSSQL effective config"
);

let poolPromise;

/** Get a shared pool (connects once). */
export async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        logger.info("MSSQL connected");
        return pool;
      })
      .catch((err) => {
        // Important: clear promise on failure so future calls can retry
        poolPromise = undefined;
        logger.error({ err }, "MSSQL connection error");
        throw err;
      });
  }
  return poolPromise;
}

export { sql };

import sql from "mssql";
import logger from "../logger.js";

const config = {
  server: process.env.MSSQL_SERVER || "localhost",
  database: process.env.MSSQL_DATABASE || "LampModulationDB",
  user: process.env.MSSQL_USER || "lamp_app",
  password: process.env.MSSQL_PASSWORD || "",
  options: {
    encrypt: (process.env.MSSQL_ENCRYPT || "false") === "true",
    trustServerCertificate:
      (process.env.MSSQL_TRUST_SERVER_CERTIFICATE || "true") === "true",
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 1,
    idleTimeoutMillis: 30000,
  },
};

let poolPromise;

export async function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        logger.info("MSSQL connected");
        return pool;
      })
      .catch((err) => {
        logger.error({ err }, "MSSQL connection error");
        throw err;
      });
  }
  return poolPromise;
}

export { sql };

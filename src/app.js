import express from "express";
import apiRouter from "./routes/api.js";
import logger from "./logger.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Simple health
app.post("/health", (_req, res) => res.json({ ok: true }));

// All APIs via body-only endpoints
app.use("/api", apiRouter);

// Central error handler
// (zod will throw; we catch and return)
app.use((err, _req, res, _next) => {
  logger.error({ err }, "Unhandled error");
  const status = err?.status || 400;
  res.status(status).json({ ok: false, error: err.message || "error" });
});

export default app;

import express from "express";
import { z } from "zod";
import { getPool, sql } from "../db/mssql.js";
import { toSqlTimeHHMMSS } from "../utils/toSqlTime.js";
import { daysToMask, maskToDays } from "../utils/dayMask.js";
import { toHHMM } from "../utils/hhmm.js";

const router = express.Router();

/* =========================
   DEVICES
   ========================= */

// POST /devices.create  { name, location?, timezone?, modulation_code? }
router.post("/devices.create", async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    location: z.string().optional().nullable(),
    timezone: z.string().optional(),
    modulation_code: z.number().int().min(0).max(16777215).optional(),
  });
  const body = schema.parse(req.body);
  const pool = await getPool();

  const r = await pool
    .request()
    .input("name", sql.NVarChar(100), body.name)
    .input("location", sql.NVarChar(200), body.location ?? null)
    .input("timezone", sql.NVarChar(64), body.timezone ?? "Africa/Cairo")
    .input("mod", sql.Int, body.modulation_code ?? null).query(`
      INSERT INTO iot.devices (name, location, timezone, modulation_code)
      OUTPUT INSERTED.*
      VALUES (@name, @location, @timezone, @mod)
    `);

  const device = r.recordset[0];

  // Initialize device_state row
  await pool.request().input("device_id", sql.Int, device.id).query(`
      IF NOT EXISTS (SELECT 1 FROM iot.device_state WHERE device_id=@device_id)
      INSERT INTO iot.device_state (device_id, desired_power_on, desired_modulation, forced, source)
      VALUES (@device_id, 0, 0, 0, 0)
    `);

  res.json({ ok: true, device });
});

// POST /devices.list  { }  (no params)
router.post("/devices.list", async (_req, res) => {
  const pool = await getPool();
  const r = await pool
    .request()
    .query(`SELECT * FROM iot.devices ORDER BY id DESC`);
  res.json({ ok: true, devices: r.recordset });
});

// POST /devices.get { device_id }
router.post("/devices.get", async (req, res) => {
  const schema = z.object({ device_id: z.number().int().positive() });
  const { device_id } = schema.parse(req.body);
  const pool = await getPool();

  const device = await pool
    .request()
    .input("id", sql.Int, device_id)
    .query(`SELECT * FROM iot.devices WHERE id=@id`);

  const state = await pool
    .request()
    .input("id", sql.Int, device_id)
    .query(`SELECT * FROM iot.device_state WHERE device_id=@id`);

  const schedule = await pool.request().input("id", sql.Int, device_id).query(`
      SELECT * FROM iot.schedules WHERE device_id=@id AND active=1
    `);

  res.json({
    ok: true,
    device: device.recordset[0] || null,
    state: state.recordset[0] || null,
    schedule: schedule.recordset[0] || null,
  });
});

// POST /devices.update { device_id, name?, location?, timezone?, modulation_code?, is_active? }
router.post("/devices.update", async (req, res) => {
  const schema = z.object({
    device_id: z.number().int().positive(),
    name: z.string().optional(),
    location: z.string().optional().nullable(),
    timezone: z.string().optional(),
    modulation_code: z
      .number()
      .int()
      .min(0)
      .max(16777215)
      .nullable()
      .optional(),
    is_active: z.boolean().optional(),
  });
  const body = schema.parse(req.body);
  const pool = await getPool();

  const r = await pool
    .request()
    .input("id", sql.Int, body.device_id)
    .input("name", sql.NVarChar(100), body.name ?? null)
    .input("location", sql.NVarChar(200), body.location ?? null)
    .input("timezone", sql.NVarChar(64), body.timezone ?? null)
    .input("mod", sql.Int, body.modulation_code ?? null)
    .input(
      "active",
      sql.Bit,
      typeof body.is_active === "boolean" ? (body.is_active ? 1 : 0) : null
    ).query(`
      UPDATE iot.devices
      SET
        name = COALESCE(@name, name),
        location = CASE WHEN @location IS NULL THEN NULL ELSE @location END,
        timezone = COALESCE(@timezone, timezone),
        modulation_code = @mod,
        is_active = COALESCE(@active, is_active),
        updated_at_utc = SYSUTCDATETIME()
      WHERE id=@id;
      SELECT * FROM iot.devices WHERE id=@id;
    `);

  res.json({ ok: true, device: r.recordset[0] });
});

/* =========================
   SCHEDULES
   ========================= */

// POST /schedules.set { device_id, time_on, time_off, off_days_mask (0..127), active? }
// POST /schedules.set { device_id, time_on, time_off, off_days?: string[], off_days_mask?: 0..127, active? }
router.post("/schedules.set", async (req, res) => {
  const schema = z
    .object({
      device_id: z.number().int().positive(),
      time_on: z.string().min(1),
      time_off: z.string().min(1),
      off_days: z.array(z.string()).optional(),
      off_days_mask: z.number().int().min(0).max(127).optional(),
      active: z.boolean().optional(),
      push_now: z.boolean().optional(), // <- default false
    })
    .refine((v) => v.off_days || v.off_days_mask !== undefined, {
      message: "Provide off_days (array) or off_days_mask (number)",
    });

  let b;
  try {
    b = schema.parse(req.body);
  } catch (e) {
    return res
      .status(400)
      .json({ ok: false, error: e.errors?.[0]?.message || "Invalid body" });
  }

  // Normalize times to "HH:mm:ss"
  let onHHMMSS, offHHMMSS;
  try {
    onHHMMSS = toSqlTimeHHMMSS(b.time_on);
    offHHMMSS = toSqlTimeHHMMSS(b.time_off);
  } catch (e) {
    return res
      .status(400)
      .json({ ok: false, error: `Invalid time: ${e.message}` });
  }

  // Compute mask
  let mask = b.off_days_mask ?? 0;
  if (b.off_days) mask = daysToMask(b.off_days);

  const activeBit = b.active === undefined ? 1 : b.active ? 1 : 0;

  // Transaction: deactivate old, insert new
  const pool = await getPool();
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin();

    await new sql.Request(tx)
      .input("id", sql.Int, b.device_id)
      .query(`UPDATE iot.schedules SET active = 0 WHERE device_id = @id;`);

    const r = await new sql.Request(tx)
      .input("id", sql.Int, b.device_id)
      .input("on", sql.VarChar(8), onHHMMSS)
      .input("off", sql.VarChar(8), offHHMMSS)
      .input("mask", sql.TinyInt, mask)
      .input("active", sql.Bit, activeBit).query(`
        INSERT INTO iot.schedules (device_id, time_on_local, time_off_local, off_days_mask, active)
        OUTPUT INSERTED.*
        VALUES (@id, @on, @off, @mask, @active);
      `);

    await tx.commit();

    const s = r.recordset[0];
    const responseSchedule = {
      ...s,
      time_on_local: toHHMM(s.time_on_local), // "HH:mm"
      time_off_local: toHHMM(s.time_off_local), // "HH:mm"
      off_days: maskToDays(Number(s.off_days_mask || 0)),
    };

    // Do NOT push now — just return
    return res.json({
      ok: true,
      schedule: responseSchedule,
      pushed_now: false,
    });
  } catch (err) {
    try {
      await tx.rollback();
    } catch {}
    return res
      .status(500)
      .json({
        ok: false,
        error: "Failed to set schedule",
        detail: String(err?.message || err),
      });
  }
});
// POST /schedules.get { device_id }
router.post("/schedules.get", async (req, res) => {
  const schema = z.object({ device_id: z.number().int().positive() });
  const { device_id } = schema.parse(req.body);
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, device_id)
    .query(`SELECT * FROM iot.schedules WHERE device_id=@id AND active=1`);
  res.json({ ok: true, schedule: r.recordset[0] || null });
});

/* =========================
   STATE + FORCE
   ========================= */

// POST /state.get { device_id }
router.post("/state.get", async (req, res) => {
  const schema = z.object({ device_id: z.number().int().positive() });
  const { device_id } = schema.parse(req.body);
  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, device_id)
    .query(`SELECT * FROM iot.device_state WHERE device_id=@id`);
  res.json({ ok: true, state: r.recordset[0] || null });
});

// POST /force.set { device_id, power: "ON"|"OFF", modulation: boolean, duration_sec?: number }
router.post("/force.set", async (req, res) => {
  const schema = z.object({
    device_id: z.number().int().positive(),
    power: z.enum(["ON", "OFF"]),
    modulation: z.boolean(),
    duration_sec: z.number().int().positive().optional(),
  });
  const b = schema.parse(req.body);
  const pool = await getPool();

  const expiresAt = b.duration_sec
    ? new Date(Date.now() + b.duration_sec * 1000).toISOString()
    : null;

  const r = await pool
    .request()
    .input("id", sql.Int, b.device_id)
    .input("pwr", sql.Bit, b.power === "ON" ? 1 : 0)
    .input("mod", sql.Bit, b.modulation ? 1 : 0)
    .input("exp", sql.DateTimeOffset, expiresAt).query(`
      UPDATE iot.device_state
      SET desired_power_on=@pwr,
          desired_modulation=@mod,
          forced=1,
          force_expires_at=@exp,
          source=1,
          updated_at_utc=SYSUTCDATETIME(),
          version = NEXT VALUE FOR iot.state_version_seq
      WHERE device_id=@id;

      SELECT d.modulation_code FROM iot.devices d WHERE d.id=@id;
    `);

  // Best-effort WS push
  const modCode = r.recordset[0]?.modulation_code ?? null;
  req.app.locals.hub.sendState(b.device_id, {
    type: "state_change",
    device_id: b.device_id,
    power: b.power,
    modulation: b.modulation,
    modulation_code: modCode,
    reason: "force",
    ts: new Date().toISOString(),
  });

  // Log event
  await pool
    .request()
    .input("device_id", sql.Int, b.device_id)
    .input("etype", sql.TinyInt, 2) // forced_change
    .input(
      "details",
      sql.NVarChar(sql.MAX),
      JSON.stringify({
        power: b.power,
        modulation: b.modulation,
        duration_sec: b.duration_sec ?? null,
      })
    )
    .query(
      `INSERT INTO iot.events_log (device_id, event_type, details_json) VALUES (@device_id, @etype, @details)`
    );

  res.json({ ok: true });
});

// POST /force.clear { device_id }
router.post("/force.clear", async (req, res) => {
  const schema = z.object({ device_id: z.number().int().positive() });
  const { device_id } = schema.parse(req.body);
  const pool = await getPool();

  await pool.request().input("id", sql.Int, device_id).query(`
      UPDATE iot.device_state
      SET forced=0, force_expires_at=NULL, source=0, updated_at_utc=SYSUTCDATETIME(),
          version = NEXT VALUE FOR iot.state_version_seq
      WHERE device_id=@id;
    `);

  res.json({ ok: true });
});

export default router;

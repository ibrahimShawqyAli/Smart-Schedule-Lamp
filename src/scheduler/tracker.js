// src/scheduler/tracker.js
import { DateTime } from "luxon";
import { getPool, sql } from "../db/mssql.js";
import logger from "../logger.js";
import { isOffDay } from "../utils/dayMask.js";
import { isWithinWindow } from "../utils/timeWindow.js";
import { toHHMM } from "../utils/hhmm.js";

const REASSERT_LOG = true; // set false to not log "reassert" events

/**
 * Internal helper: recompute and (if needed) update+push for ONE device now.
 * Returns { updated, sent, reason }
 */
async function recomputeDeviceNow(deviceId, hub) {
  const pool = await getPool();
  const { recordset } = await pool.request().input("id", sql.Int, deviceId)
    .query(`
    SELECT
      d.id AS device_id, d.name, d.timezone, d.modulation_code,
      s.id AS schedule_id, s.time_on_local, s.time_off_local, s.off_days_mask, s.active,
      st.desired_power_on, st.desired_modulation, st.forced, st.force_expires_at, st.source, st.version
    FROM iot.devices d
    OUTER APPLY (
      SELECT TOP (1) *
      FROM iot.schedules s
      WHERE s.device_id = d.id AND s.active = 1
      ORDER BY s.id DESC
    ) s
    LEFT JOIN iot.device_state st ON st.device_id = d.id
    WHERE d.is_active = 1 AND d.id = @id;
  `);

  if (!recordset.length)
    return { updated: false, sent: false, reason: "no_device" };
  const row = recordset[0];

  // Expire forced if needed
  let forced = row.forced === true || row.forced === 1;
  if (forced && row.force_expires_at) {
    const exp =
      row.force_expires_at instanceof Date
        ? DateTime.fromJSDate(row.force_expires_at)
        : DateTime.fromISO(String(row.force_expires_at));
    if (exp.isValid && exp <= DateTime.utc()) {
      await pool.request().input("device_id", sql.Int, row.device_id).query(`
        UPDATE iot.device_state
        SET forced = 0, force_expires_at = NULL, source = 0,
            updated_at_utc = SYSUTCDATETIME(),
            version = NEXT VALUE FOR iot.state_version_seq
        WHERE device_id = @device_id;
      `);
      forced = false;
    }
  }
  if (forced) {
    // push whatever is already stored (forced state), so the device re-syncs now
    const payload = {
      type: "state_change",
      device_id: row.device_id,
      power: (row.desired_power_on ? 1 : 0) ? "ON" : "OFF",
      modulation: !!row.desired_modulation,
      modulation_code: row.modulation_code ?? null,
      reason: "forced_reassert",
      ts: DateTime.utc().toISO(),
    };
    const sent = hub.sendState(row.device_id, payload);
    if (REASSERT_LOG) {
      await pool
        .request()
        .input("device_id", sql.Int, row.device_id)
        .input("etype", sql.TinyInt, sent ? 3 : 5)
        .input(
          "details",
          sql.NVarChar(sql.MAX),
          JSON.stringify({ reason: "forced_reassert" })
        )
        .query(`INSERT INTO iot.events_log (device_id, event_type, details_json)
                VALUES (@device_id, @etype, @details)`);
    }
    return { updated: false, sent, reason: "forced" };
  }

  if (!row.schedule_id) {
    // No active schedule → reassert current desired (likely OFF)
    const payload = {
      type: "state_change",
      device_id: row.device_id,
      power: (row.desired_power_on ? 1 : 0) ? "ON" : "OFF",
      modulation: !!row.desired_modulation,
      modulation_code: row.modulation_code ?? null,
      reason: "no_schedule_reassert",
      ts: DateTime.utc().toISO(),
    };
    const sent = hub.sendState(row.device_id, payload);
    if (REASSERT_LOG) {
      await pool
        .request()
        .input("device_id", sql.Int, row.device_id)
        .input("etype", sql.TinyInt, sent ? 3 : 5)
        .input(
          "details",
          sql.NVarChar(sql.MAX),
          JSON.stringify({ reason: "no_schedule_reassert" })
        )
        .query(`INSERT INTO iot.events_log (device_id, event_type, details_json)
                VALUES (@device_id, @etype, @details)`);
    }
    return { updated: false, sent, reason: "no_active_schedule" };
  }

  const tz = row.timezone || "Africa/Cairo";
  const nowLocal = DateTime.now().setZone(tz);
  const weekdayShort = nowLocal.toFormat("ccc");

  const offMask = Number(row.off_days_mask ?? 0);
  const offDay = isOffDay(offMask, weekdayShort);

  let desiredPower = 0;
  let desiredMod = 0;
  if (!offDay) {
    const onStr = toHHMM(row.time_on_local); // "HH:mm"
    const offStr = toHHMM(row.time_off_local); // "HH:mm"
    const inWin = isWithinWindow(nowLocal, onStr, offStr);
    desiredPower = inWin ? 1 : 0;
    desiredMod = inWin ? 1 : 0;
  }

  const currentPower = row.desired_power_on ? 1 : 0;
  const currentMod = row.desired_modulation ? 1 : 0;

  let reason = "reassert";
  if (
    desiredPower !== currentPower ||
    desiredMod !== currentMod ||
    row.source !== 0
  ) {
    // update DB to new desired
    await pool
      .request()
      .input("device_id", sql.Int, row.device_id)
      .input("pwr", sql.Bit, desiredPower)
      .input("mod", sql.Bit, desiredMod).query(`
        UPDATE iot.device_state
        SET desired_power_on = @pwr,
            desired_modulation = @mod,
            forced = 0,
            source = 0,
            updated_at_utc = SYSUTCDATETIME(),
            version = NEXT VALUE FOR iot.state_version_seq
        WHERE device_id = @device_id;
      `);
    reason = "schedule";
  }

  // Always push (even if no change)
  const payload = {
    type: "state_change",
    device_id: row.device_id,
    power: desiredPower ? "ON" : "OFF",
    modulation: !!desiredMod,
    modulation_code: row.modulation_code ?? null,
    reason,
    ts: DateTime.utc().toISO(),
  };
  const sent = hub.sendState(row.device_id, payload);

  // Log
  if (reason === "schedule" || REASSERT_LOG) {
    await pool
      .request()
      .input("device_id", sql.Int, row.device_id)
      .input("etype", sql.TinyInt, sent ? 3 : 5)
      .input(
        "details",
        sql.NVarChar(sql.MAX),
        JSON.stringify({ reason, desiredPower, desiredMod })
      ).query(`
        INSERT INTO iot.events_log (device_id, event_type, details_json)
        VALUES (@device_id, @etype, @details);
      `);
  }

  return { updated: reason === "schedule", sent, reason };
}

/**
 * Tracker:
 * - on every tick, evaluate schedules for all active devices
 * - ALWAYS push the resulting desired state (changed or not)
 * - exposes recompute(deviceId) for immediate push
 */
export function createTracker({ hub, tickMs = 5000 }) {
  let timer = null;

  async function tick() {
    const pool = await getPool();
    const q = `
      SELECT
        d.id AS device_id,
        d.name,
        d.timezone,
        d.modulation_code,
        s.id AS schedule_id,
        s.time_on_local,
        s.time_off_local,
        s.off_days_mask,
        s.active,
        st.desired_power_on,
        st.desired_modulation,
        st.forced,
        st.force_expires_at,
        st.source,
        st.version
      FROM iot.devices d
      LEFT JOIN iot.schedules s
        ON s.device_id = d.id
       AND s.active = 1
      LEFT JOIN iot.device_state st
        ON st.device_id = d.id
      WHERE d.is_active = 1;
    `;

    const { recordset } = await pool.request().query(q);

    // Deduplicate devices if multiple active schedules slipped in
    const seen = new Set();

    for (const row of recordset) {
      if (seen.has(row.device_id)) continue;
      seen.add(row.device_id);

      try {
        // Reuse the same logic as recompute: it will update if needed and ALWAYS push
        await recomputeDeviceNow(row.device_id, hub);
      } catch (err) {
        logger.error(
          { err, deviceId: row.device_id },
          "Tracker loop error for device"
        );
      }
    }
  }

  return {
    start() {
      if (!timer) {
        const ms = Number(process.env.TRACKER_TICK_MS || tickMs);
        timer = setInterval(() => {
          tick().catch((e) => logger.error({ e }, "Tracker tick error"));
        }, ms);
        logger.info({ tickMs: ms }, "Tracker started");
        // fire once at boot
        tick().catch((e) => logger.error({ e }, "Initial tracker tick error"));
      }
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      logger.info("Tracker stopped");
    },
    // Immediate recompute+push for one device (e.g., after /schedules.set)
    recompute(deviceId) {
      return recomputeDeviceNow(deviceId, hub);
    },
  };
}

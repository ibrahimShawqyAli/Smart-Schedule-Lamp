import { DateTime } from "luxon";

/**
 * Decide if nowLocal is within [on, off) window (supports overnight).
 * on/off are "HH:mm" strings in device's timezone.
 */
export function isWithinWindow(nowLocal, onHHmm, offHHmm) {
  const [onH, onM] = onHHmm.split(":").map(Number);
  const [offH, offM] = offHHmm.split(":").map(Number);

  const on = nowLocal.set({
    hour: onH,
    minute: onM,
    second: 0,
    millisecond: 0,
  });
  const off = nowLocal.set({
    hour: offH,
    minute: offM,
    second: 0,
    millisecond: 0,
  });

  if (on.equals(off)) {
    // Convention: if on==off => OFF all day (you can change to ON all day)
    return false;
  }

  if (on < off) {
    // same-day window
    return nowLocal >= on && nowLocal < off;
  } else {
    // overnight window (on today → off tomorrow)
    return nowLocal >= on || nowLocal < off;
  }
}

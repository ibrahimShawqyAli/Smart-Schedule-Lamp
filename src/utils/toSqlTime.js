// Accepts "7:00", "07:00", "07:00:00" → returns "HH:mm:00"
export function toSqlTimeHHMMSS(value) {
  if (value == null) throw new Error("time required");
  const s = String(value).trim();

  // Match "H:MM" / "HH:MM" / optionally ":SS"
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) throw new Error("invalid time format, use HH:mm");

  let hours = Number(m[1]);
  let minutes = Number(m[2]);
  let seconds = m[3] ? Number(m[3]) : 0;

  if (hours < 0 || hours > 23) throw new Error("hour out of range");
  if (minutes < 0 || minutes > 59) throw new Error("minute out of range");
  if (seconds < 0 || seconds > 59) throw new Error("second out of range");

  const HH = String(hours).padStart(2, "0");
  const MM = String(minutes).padStart(2, "0");
  const SS = String(seconds).padStart(2, "0");
  return `${HH}:${MM}:${SS}`;
}

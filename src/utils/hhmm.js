// Normalizes MSSQL TIME values (Date or string) to "HH:mm"
export function toHHMM(value) {
  if (value == null) return null;

  if (typeof value === "string") {
    return value.slice(0, 5); // "HH:mm" or "HH:mm:ss"
  }

  if (value instanceof Date) {
    // IMPORTANT: TIME from SQL is effectively UTC-based in the JS Date object
    const h = String(value.getUTCHours()).padStart(2, "0");
    const m = String(value.getUTCMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  const s = String(value);
  return s.slice(0, 5);
}

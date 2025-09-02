// off-days bit mask: Sun=1, Mon=2, Tue=4, Wed=8, Thu=16, Fri=32, Sat=64
export const DayBit = {
  Sun: 1,
  Mon: 2,
  Tue: 4,
  Wed: 8,
  Thu: 16,
  Fri: 32,
  Sat: 64,
};

export function isOffDay(mask, weekdayShort) {
  const bit = DayBit[weekdayShort];
  return (mask & bit) === bit;
}

// NEW: normalize tokens like "fri", "FRI", "Friday" → "Fri"
export function normalizeDayToken(d) {
  if (!d) return null;
  const s = String(d).trim().toLowerCase();
  if (s.startsWith("sun")) return "Sun";
  if (s.startsWith("mon")) return "Mon";
  if (s.startsWith("tue")) return "Tue";
  if (s.startsWith("wed")) return "Wed";
  if (s.startsWith("thu")) return "Thu";
  if (s.startsWith("fri")) return "Fri";
  if (s.startsWith("sat")) return "Sat";
  return null;
}

// NEW: ["Fri","Sun"] → 33
export function daysToMask(daysArray) {
  if (!Array.isArray(daysArray)) return 0;
  let mask = 0;
  for (const d of daysArray) {
    const k = normalizeDayToken(d);
    if (k && DayBit[k]) mask |= DayBit[k];
  }
  return mask;
}

// (optional) 33 → ["Sun","Fri"]
export function maskToDays(mask) {
  const out = [];
  for (const k of Object.keys(DayBit)) {
    if ((mask & DayBit[k]) === DayBit[k]) out.push(k);
  }
  return out;
}

// Calendar-day helpers for a configurable IANA timezone. Day boundaries follow
// that timezone's midnight, not the server's local time or UTC.

function partsInZone(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return parts;
}

export function todayInTz(tz, now = new Date()) {
  const p = partsInZone(now, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

export function nowTimeInTz(tz, now = new Date()) {
  const p = partsInZone(now, tz);
  return `${p.hour}:${p.minute}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const weekday = dt.getUTCDay(); // 0 = Sunday
  const diff = weekday === 0 ? 6 : weekday - 1; // days since Monday
  dt.setUTCDate(dt.getUTCDate() - diff);
  return dt.toISOString().slice(0, 10);
}

export function datesBetween(startStr, endStr) {
  const out = [];
  let cur = startStr;
  while (cur <= endStr) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

// Auto-classifies a logged entry by local time of day. Approximate by design —
// not something the user has stated, just a grouping hint for the dashboard.
export function mealTypeFromTime(timeStr) {
  if (!timeStr || typeof timeStr !== 'string' || !/^\d{1,2}:/.test(timeStr)) return null;
  const hour = Number(timeStr.split(':')[0]);
  if (!Number.isFinite(hour)) return null;
  if (hour >= 4 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 21) return 'dinner';
  return 'snack';
}

export function isValidIanaTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

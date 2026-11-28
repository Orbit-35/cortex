// The server's rules for an entry (main.py SyncEntry), checked on the device before saving
// (DESIGN D58). An entry that breaks them would be refused at sync time and never reach
// the other devices, so it's better to refuse it here, where the bug happens. Pure: no DOM,
// no storage, so it runs in tests and in the native shells unchanged.

const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

// A date-time the server's datetime.fromisoformat() takes: ISO form, year 1-9999, a real day.
export function isIsoTime(v) {
  if (typeof v !== "string") return false;
  const m = ISO.exec(v);
  if (!m) return false;
  const [y, mo, d, h = 0, mi = 0, s = 0] = m.slice(1, 7).map((x) => Number(x || 0));
  if (y < 1 || mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return false;
  const days = new Date(Date.UTC(2000, mo, 0)).getUTCDate(); // days in that month (leap-year safe below)
  const leap = mo === 2 && d === 29 && !((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0);
  return d >= 1 && d <= days && !leap;
}

const isStr = (v) => typeof v === "string";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// Returns null when the entry is fine, otherwise a short reason like the server's
// ("recorded_at: bad date").
export function checkEntry(e) {
  if (!isObj(e)) return "entry: not an object";
  if (!isStr(e.client_id) || e.client_id.length < 8 || e.client_id.length > 64) return "client_id: must be 8-64 characters";
  for (const f of ["module", "metric", "source"]) if (!isStr(e[f])) return `${f}: must be text`;
  if (e.value !== null && !(typeof e.value === "number" && Number.isFinite(e.value))) return "value: must be a number or empty";
  for (const f of ["unit", "external_id"]) if (e[f] !== null && !isStr(e[f])) return `${f}: must be text or empty`;
  if (!isObj(e.data)) return "data: must be an object";
  for (const f of ["recorded_at", "updated_at"]) if (!isIsoTime(e[f])) return `${f}: bad date`;
  if (e.deleted_at !== null && !isIsoTime(e.deleted_at)) return "deleted_at: bad date";
  return null;
}

// Weights are stored exactly as typed, with their unit ("lb" or "kg"), and only
// converted for display or maths. So a 225 lb set stays 225, never 224.99.

export const KG_PER_LB = 0.45359237;

export function toKg(value, unit) {
  if (!(value > 0)) return 0;
  return unit === "lb" ? value * KG_PER_LB : value;
}

export function convert(value, from, to) {
  if (value == null || from === to || !from) return value;
  return to === "lb" ? value / KG_PER_LB : value * KG_PER_LB;
}

// Up to two decimals, no trailing zeros: 102.5 -> "102.5", 100 -> "100", 1.25 -> "1.25".
export const fmtNum = (n) => String(Math.round(n * 100) / 100);

// Show a stored weight in the display unit. Same unit: exactly as typed. Converted: 1 decimal.
export function showWeight(value, unit, display) {
  if (value == null) return "";
  if (!unit || unit === display) return fmtNum(value);
  return String(Math.round(convert(value, unit, display) * 10) / 10);
}

// Parse what was typed into a weight box. Accepts "102,5" (comma keyboards). "" -> null.
export function parseWeight(text) {
  const s = String(text ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

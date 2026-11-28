// One list of entry shapes, checked against both the server (tests/api/sync.test.mjs) and
// the device's own check (tests/check.test.mjs), so the two rule sets can't drift (D58).
export const base = () => ({
  client_id: "case-0000-0001", module: "test", metric: "m", value: 1, unit: null, data: {},
  recorded_at: "2026-11-20T10:00:00.000Z", source: "manual", external_id: null,
  updated_at: "2026-11-20T12:00:00.000Z", deleted_at: null,
});

// [name, changes, accepted?]
export const CASES = [
  ["a normal entry", {}, true],
  ["no weight (bodyweight)", { value: null }, true],
  ["a decimal weight", { value: 82.5 }, true],
  ["a unit", { unit: "kg" }, true],
  ["a delete marker", { deleted_at: "2026-11-20T13:00:00.000Z" }, true],
  ["a date only", { recorded_at: "2026-11-20" }, true],
  ["a time zone offset", { recorded_at: "2026-11-20T10:00:00+05:30" }, true],
  ["an import id", { source: "import", external_id: "row-9" }, true],
  ["leap day", { recorded_at: "2024-02-29T10:00:00Z" }, true],
  ["a 64-character id", { client_id: "x".repeat(64) }, true],
  ["not a date", { recorded_at: "not-a-date" }, false],
  ["a blank recorded_at", { recorded_at: "" }, false],
  ["a blank updated_at", { updated_at: "" }, false],
  ["a blank deleted_at", { deleted_at: "" }, false],
  ["year 0", { recorded_at: "0000-01-01T00:00:00Z" }, false],
  ["year 10000", { recorded_at: "+010000-01-01T00:00:00.000Z" }, false],
  ["Feb 30", { recorded_at: "2026-02-30T10:00:00Z" }, false],
  ["Feb 29 in a normal year", { recorded_at: "2026-02-29T10:00:00Z" }, false],
  ["month 13", { recorded_at: "2026-13-01T10:00:00Z" }, false],
  ["a word for a weight", { value: "heavy" }, false],
  ["a number for a module", { module: 7 }, false],
  ["a list for data", { data: ["x"] }, false],
  ["a 7-character id", { client_id: "x".repeat(7) }, false],
  ["a 65-character id", { client_id: "x".repeat(65) }, false],
  ["a zone on a date only", { recorded_at: "2025-01-01Z" }, false],
  ["a 25-hour zone", { recorded_at: "2026-11-20T10:00:00+25:00" }, false],
  ["year 1 pushed into year 0 by its zone", { recorded_at: "0001-01-01T00:00:00+01:00" }, false],
  ["year 1 in UTC", { recorded_at: "0001-01-01T00:00:00Z" }, true],
  ["year 9999, last minute", { recorded_at: "9999-12-31T23:59:00Z" }, true],
  ["a negative zone", { recorded_at: "2026-11-20T10:00:00-07:00" }, true],
];

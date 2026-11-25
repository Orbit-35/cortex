# Plan: sync errors are never silent (next: D58)

From a test agent's investigation (Nov 2026, no code changed). Build in this order, one commit each, test agent after.

## What happens today (confirmed with a throwaway UI test)
- The server refuses an entry that fails `SyncEntry` (main.py) or clashes with `UNIQUE(source, external_id)`, and lists it in `rejected`.
- The client (`core/cortex.js` syncOnce) only logs `console.warn`, then removes it from the outbox like a sent entry. It stays on that device only, other devices never get it, `getStatus()` says nothing and the pill says "synced". No retry unless the entry is edited again.
- **Worst case:** a rejected *delete*. `cortex.js` deletes the local entry for any sent delete marker, rejected or not, so the device drops it while the server and other devices keep it. Lost silently and for good.
- **Server poison row:** `updated_at: ""` passes validation as None and is saved with NULL; every later pull that includes it returns 500 (also a fresh device's full pull). Not reachable from the app (`stamp()` always sets it), only from direct API calls or a future importer.

## How likely
No current app screen can produce a rejected entry (every field is checked or generated). Realistic sources: future importers (the same export on two devices → UNIQUE clash), a future id scheme over 64 characters, or a bug. Before D52's date guard, a half-typed year was a real way in.

## Fix
1. **Server hardening (small, first):** empty `recorded_at`/`updated_at` are invalid (no more poison row); return reasons, e.g. optional `rejected_reasons: {id: "bad date" | "duplicate import" | ...}` (keeps `rejected: [str]`); fix the comment that says every IntegrityError is a UNIQUE clash. API tests: empty times rejected not 500, a pull after a bad row is still 200, reasons returned.
2. **Check before saving (`cortex.js`):** pure `checkEntry(e)` mirroring `SyncEntry` (strings, finite number or null, plain-object data, client_id 8-64 chars, parseable date with year 1-9999). `putEntries`/`addEntry` throw before writing, so a bug shows where it happens. One shared case list for a unit test and an API test.
3. **Remember rejections:** a `rejected` store (DB_VERSION 2) or a `meta` "rejected" list, holding the entry, time and reason. Never hard-delete a local entry whose delete marker was rejected. Editing the entry clears it and retries (already works). After an app update, put rejected entries back in the outbox once (covers a fix to the server rules). No other auto-retry: the same entry fails the same way.
4. **Show it:** `getStatus()` adds `rejected: n`; `listRejected()` export. Lifting pill: red "N not synced" (class `sync bad`, `--danger`). Tap → message explaining the server refused them, with Try again. Guitar and Home have no pill yet; a shared pill in the `.cx-top` header (D54) can come later.
5. **UI test** `tests/ui/sync-rejected.ui.test.mjs`: pill shows "1 not synced"; device B doesn't get it; fixing it clears the error and B gets it; a rejected delete keeps the local copy; UNIQUE clash on a second device.

## DESIGN.md
New D58. Mark D52's "console warning only" trade-off superseded. Touches D10 (a delete marker is dropped only after the server accepts it), D11/D12 (outbox gains a "rejected" state), D13 (`checkEntry` in core). Update CLAUDE.md's client-storage line if a `rejected` store is added.

## Owner on the phone
Whether the red pill reads clearly next to the gear on the real phone.

# Cortex design log

Every significant design choice, why it was made, and what was traded away. Newest entries go at the bottom of each section. When a decision is reversed, don't delete it: mark it **Superseded** and link to the replacement, so the history stays readable.

Entry format: **Decision** (what), **Why** (the reasoning), **Trade-off** (what it costs or what to watch for).

## How the system fits together

```
 Phone / PC browser (later: Capacitor, Tauri)            Server (FastAPI + SQLite)
┌─────────────────────────────────────────────┐         ┌──────────────────────────┐
│ page (static/<module>/)   ← layout only      │         │ main.py                  │
│        │ calls                               │         │                          │
│ core (static/core/cortex.js)                 │  POST   │ /api/sync                │
│   IndexedDB: entries │ outbox │ meta(cursor) │ ──────► │   upsert by client_id    │
│                                              │ ◄────── │   return rev > cursor    │
│ service worker (static/sw.js): app shell     │         │ entries table (cortex.db)│
└─────────────────────────────────────────────┘         └──────────────────────────┘
```

Life of one logged set:

1. The page calls `cortex.addEntry(...)`.
2. The core gives it a UUID (`client_id`) and writes it to `entries` and `outbox` in one IndexedDB transaction. The page redraws from local data. Nothing has touched the network yet.
3. `sync()` sends the whole outbox plus the device's cursor to `POST /api/sync`.
4. The server inserts or updates each entry by `client_id`, stamps each change with the next revision number (`rev`), and replies with every entry whose `rev` is above the cursor, plus the new cursor.
5. The core clears confirmed items from the outbox, applies the server's entries locally, and stores the new cursor.

If step 3 or 4 fails (server down, no signal), nothing is lost: the outbox still holds the entry and the next sync retries.

## Data model

### D1. One generic `entries` table
- **Decision:** every module stores rows in one table: `module, metric, value, unit, data (JSON), recorded_at, source, external_id`.
- **Why:** a new module is a new page plus a naming convention, not a schema change. Sync, backup and export are written once and work for every module.
- **Trade-off:** the database can't enforce module-specific rules (e.g. "lifting needs reps"); that lives in the page. Add a dedicated table only when a module truly can't fit.

### D2. `UNIQUE(source, external_id)`
- **Decision:** an imported row is identified by where it came from plus its id there.
- **Why:** re-running an importer can never create duplicates.
- **Trade-off:** manual entries have `external_id = NULL`, which SQL treats as distinct, so this constraint doesn't protect them. `client_id` (D5) does.

### D3. SQLite, single file
- **Decision:** `cortex.db`, gitignored. Path overridable with the `CORTEX_DB` environment variable.
- **Why:** zero setup, trivially backed up by copying one file, plenty for one user. The override lets tests use a throwaway database and never touch real data.
- **Trade-off:** one writer at a time. Fine here; Postgres remains possible because nothing depends on SQLite-only features beyond the migration helper.

### D4. Timestamps are UTC ISO-8601 strings in one canonical format
- **Decision:** `YYYY-MM-DDTHH:MM:SS.mmmZ`. The server normalises every incoming timestamp to this.
- **Why:** with exactly one format, timestamps sort and compare correctly as plain strings, in SQL and in JavaScript (which produces this format natively).
- **Trade-off:** rows written before this rule keep their old `+00:00` format; the migration only normalises `updated_at`.

## Local-first and sync

### D5. Local-first: the device is the source of truth for its own writes
- **Decision:** every write goes to IndexedDB first; the server is a sync hub and backup. Pages never call `/api/entries` directly.
- **Why:** logging must be instant and must work with no signal. If the UI waits on the network, a dead zone means lost data.
- **Trade-off:** data exists in several places, so there must be sync and conflict rules (below). More moving parts than "just POST to the server".

### D6. Client-generated UUID (`client_id`) as the entry's identity
- **Decision:** the device that creates an entry assigns its UUID. The server's integer `id` is internal only.
- **Why:** an offline device can't ask the server for an id. A UUID chosen at birth means the entry has the same identity everywhere, which makes uploads idempotent: sending the same entry twice is recognised and changes nothing.
- **Trade-off:** 36-character keys instead of small integers. Irrelevant at this scale.

### D7. Outbox holds full entry state, one slot per entry
- **Decision:** the `outbox` store is keyed by `client_id` and holds the latest complete version of each unsent entry, not a list of operations.
- **Why:** "create then delete while offline" collapses into one item automatically, and replaying is trivially safe. No operation ordering to get wrong.
- **Trade-off:** can't express field-level merges (two devices editing different fields of the same entry). Not needed for log-style data.

### D8. Sync cursor is a server revision counter (`rev`), not a timestamp
- **Decision:** every change on the server gets the next number from one counter. Devices remember the highest number they have seen and ask for everything above it.
- **Why:** the original idea was "changes since my last sync time", but device clocks disagree, and a change stamped slightly in the past would be silently skipped forever. A counter issued by one authority, inside a write lock (`BEGIN IMMEDIATE`), has no such gap.
- **Trade-off:** one extra column. If the server database is replaced and a device's cursor is ahead of it, the server resends everything (handled), but entries that device had already synced are not re-uploaded automatically.

### D9. Conflicts: last write wins, by `updated_at`
- **Decision:** when the server already has an entry, an incoming version replaces it only if its `updated_at` is strictly newer. Equal or older is ignored.
- **Why:** simplest rule that is predictable, and "equal is ignored" is what makes retries harmless.
- **Trade-off:** `updated_at` comes from device clocks, so a device with a badly wrong clock could win or lose an edit unfairly. Acceptable while entries are effectively write-once; revisit if entries become heavily edited.

### D10. Soft delete (`deleted_at`)
- **Decision:** deleting sets `deleted_at` instead of removing the row. Lists filter these out.
- **Why:** a removed row leaves nothing to sync, so other devices would keep the entry (or re-upload it). A marker travels like any other change.
- **Trade-off:** rows accumulate forever on the server. Also required by D8, which relies on `MAX(rev)` never going backwards. Devices drop the marker once the server has confirmed it.

### D11. Unsent local edits beat incoming server data
- **Decision:** when applying a sync reply, entries that still have an outbox item are skipped. An outbox item is cleared only if it is unchanged since it was sent.
- **Why:** protects an edit made while a sync request was in flight from being overwritten or dropped.
- **Trade-off:** none significant; the pending edit goes up on the next sync and D9 settles it.

### D12. When sync runs
- **Decision:** on page load, after every local write, when the browser reports the connection is back, when the app returns to the foreground, and every 20 s while anything is pending or the last attempt failed. Only one sync runs at a time.
- **Why:** the browser's "online" event only reports Wi-Fi/cell state. It says nothing when the network is fine but the server is unreachable, so a retry timer is needed too.
- **Trade-off:** a small amount of background polling while pending. A device with nothing pending only learns about other devices' changes on load or foreground.

## App shell and PWA

### D13. Shared core module with no page code
- **Decision:** storage and sync live in `static/core/cortex.js`: no DOM access, server address set via `configure({ apiBase })`.
- **Why:** the long-term plan is three shells (web, Capacitor on Android, Tauri on Windows) with different layouts over the same data layer. All three run a web view, so IndexedDB plus this one file works in each unchanged.
- **Trade-off:** native shells load pages from the device, not from the server, so the server will need CORS and auth before they can sync. Not built yet.

### D14. Service worker: stale-while-revalidate, never touches `/api`
- **Decision:** `static/sw.js` precaches the app shell and serves cached files immediately while fetching a fresh copy for next time. API, docs and non-GET requests bypass it.
- **Why:** the app opens instantly and offline. Keeping data out of the HTTP cache means there is exactly one offline data store (IndexedDB) and one sync path.
- **Trade-off:** after a page changes, the first reload shows the old version and the second shows the new one. New shell files must be added to the `SHELL` list. Service workers need HTTPS or localhost.

### D15. Plain static pages, no build step
- **Decision:** hand-written HTML/CSS/ES modules served directly by FastAPI.
- **Why:** nothing to install or compile; edit and reload. Fine at this size.
- **Trade-off:** no components or type checking. Likely revisited when the desktop dashboards arrive.

## Lifting

### D18. Progress is measured by estimated 1RM (Epley), best set per day
- **Decision:** each set gets `e1RM = weight × (1 + reps/30)` (a single counts as its weight). The chart plots each training day's best e1RM; a rep-records table lists the heaviest weight at each rep count.
- **Why:** raw weight alone hides progress made in reps (80×8 after 80×5 is progress). e1RM puts every set on one scale, and "best per day" turns many sets into one honest point per session. Epley is the most common formula and fine in the 1-10 rep range.
- **Trade-off:** it's an estimate, increasingly optimistic above ~12 reps. The rep-records table shows the real lifts alongside it.

### D19. Charts are hand-written SVG, no chart library
- **Decision:** `drawChart` in the lifting page builds the SVG directly. Maths lives in `static/lifting/stats.js` (pure functions, tested by `node tests/stats.test.mjs`).
- **Why:** a CDN library would break offline use (D5) unless vendored and cached, and there's no build step (D15). One line chart is ~60 lines. Keeping the maths separate means the desktop dashboards can reuse it.
- **Trade-off:** each new chart type is hand work. Revisit (vendor a library into `static/`) when dashboards need many chart types.

### D20. Entering past numbers: a date field on the log form, stored at local noon
**Superseded by D25** (past workouts replace the per-set date field; the "local noon" rule still applies).

- **Decision:** the log form has a date field defaulting to today. A past day is saved with `recorded_at` at 12:00 local time; the field stays on that day until "Today" is tapped, so a whole old session can be typed in a row. PR detection only compares against sets recorded before the new one.
- **Why:** old PRs and history from before Cortex need a way in, and it's the same data as a normal set, so it uses the same form and the same `entries` rows (D1). Noon is as far from midnight as possible, so time-zone and daylight-saving shifts can't move it onto a neighbouring day.
- **Trade-off:** backfilled sets have no real time of day. Bulk history from another app is better done with an importer (D2) than by typing.

### D22. Workouts and exercises are entries too, with reserved metric names
- **Decision:** a workout is an entry with `metric = "_workout"` (start time in `recorded_at`; name, notes, duration and exercise order in `data`). Each set points to its workout with `data.workout`. Custom exercises and edits are `_exercise` entries; settings use `module = "settings"`.
- **Why:** keeps D1: no new tables, and workouts sync, back up and work offline through the same path as everything else. Typed exercise names are slugged with leading `_` stripped, so they can never collide with a reserved name.
- **Trade-off:** code reading sets must skip `_`-prefixed metrics (`isSet()`). The server can't enforce "a set's workout exists". A workout can't contain the same exercise twice (exercise order is a list of keys).

### D23. Exercise keys are permanent; built-ins ship as code, your changes overlay them
- **Decision:** a set's `metric` is its exercise's key (`bench_press`), which never changes. The built-in library lives in `static/lifting/library.js` with names, equipment and muscles. Your exercises and edits are `_exercise` entries with the deterministic id `exercise:<key>`, layered on top.
- **Why:** renaming touches one record, not every set, and merging two exercises is a rewrite of one key to another. Shipping built-ins as code means nothing is seeded per device (seeding would create a copy per device). A deterministic id means two devices editing the same exercise update the same record (D9 settles it) instead of creating duplicates.
- **Trade-off:** keys are slugs of the first name, so an old key can look odd after a rename (it's never shown). Changing a built-in's muscles in code changes history's stats for everyone who hasn't overridden it.

### D24. Weights are stored as typed, with their unit
- **Decision:** a set stores the number entered and `unit` (`lb` or `kg`). Display converts to the chosen unit (a setting, default lb); maths converts to kg. Editing a workout writes back untouched sets exactly as they were.
- **Why:** converting on save would turn 225 lb into 102.058 kg and back into 224.99 lb. Plates are real numbers in the unit you lift in.
- **Trade-off:** every calculation must go through `toKg()`. Converted numbers are rounded to one decimal for display.

### D25. Logging is per workout, saved as a whole
- **Decision:** the Log tab starts a live workout (timer from the moment you start, sets ticked off), adds a past workout (date + duration in hours/minutes, stored at local noon per D20), or edits a saved one. All three use one editor working on a draft; Save/Finish writes the workout and all its sets in one IndexedDB transaction (`putEntries`). A live draft is kept in device storage until finished.
- **Why:** you think in workouts, not loose sets. Saving as a whole means another device never sees half a workout, and the draft survives the phone killing the app mid-session. One editor for all three modes keeps them consistent.
- **Trade-off:** a live workout isn't visible on other devices until finished, and is lost if the phone's site data is cleared mid-workout. Unticked sets are discarded on Finish (with a warning).

### D26. Pre-workout sets are grouped into one workout per day, deterministically
- **Decision:** sets without `data.workout` (logged before D25) are attached to a workout with the id `workout:legacy:<YYYY-MM-DD>`, created if missing.
- **Why:** the id depends only on the data, so if two devices run the migration they produce the same workout and the same edits, which sync to one result.
- **Trade-off:** a day's sets become one workout even if they were two sessions. Durations come from the first-to-last set span, or stay blank.

### D27. Muscle credit: primary 1 set, each secondary 0.5
- **Decision:** for muscle charts (radar, split), a set counts as 1 set for the exercise's primary muscle and 0.5 for each secondary muscle.
- **Why:** this "fractional" method is what Boostcamp and Fitbod use and Hevy recommends, and a 2025 meta-analysis (Pelland et al.) found it predicted growth better than counting only primaries or counting everything fully.
- **Trade-off:** 0.5 is a convention, not a measurement. Muscle tags are editable per exercise.

### D28. Five bottom tabs; one editor screen on top
- **Decision:** Log · Progress · Exercises · Bodyweight · Profile as a bottom bar (five is the Android maximum). The workout editor opens over the tabs as its own history entry, so the phone's back button closes it. Page code is split into ES modules per concern (`units`, `library`, `workouts`, `stats`, `app`) with no build step (D15).
- **Why:** each tab has one job, reachable with a thumb. Pure modules are tested in Node.
- **Trade-off:** Exercises, Bodyweight and Profile start as placeholders.

## Security and hosting

### D16. No auth yet; tailnet only
- **Decision:** the API is open. It must only be reachable on the local network or over Tailscale (`tailscale serve`, never `funnel`) until login exists.
- **Why:** single user, and auth done badly is worse than a network boundary done properly.
- **Trade-off:** anyone on the same network can read and write. Login is a prerequisite for any public exposure and for the native shells.

### D17. Public repo, private data
- **Decision:** the repository is public; databases, exports, raw import files and secrets are gitignored. Test data is obviously fake.
- **Why:** the code is worth sharing; the life data is not.
- **Trade-off:** personal context and real examples must live outside the repo.

## Operations

### D21. Daily server backups, newest 30 kept
- **Decision:** while the server runs, it checks hourly and copies `cortex.db` to `backups/cortex-YYYY-MM-DD.db` once per day using SQLite's backup API, then deletes all but the newest 30. Folder overridable with `CORTEX_BACKUPS`; gitignored.
- **Why:** the server copy is the merged history of every device; losing that one file shouldn't mean losing it. The backup API gives a consistent snapshot even mid-write (a plain file copy might not). Writing to a temp name and renaming means a half-written copy never looks like a real backup.
- **Trade-off:** backups sit on the same disk as the database, so they protect against corruption and mistakes, not a dead drive. Copying them off the machine (cloud drive, the future Pi) is a later step.

## Open questions

- Editing an entry (not just create/delete): the sync layer supports it, no UI yet.
- Pruning old soft-deleted rows without breaking D8.
- Recovering automatically when the server database is restored from an older backup (see D8).
- Auth model that works for browser, Capacitor and Tauri alike.
- Multiple users (a goal): entries will need an owner (`user_id`) and sync must scope by it. Deterministic ids (D23, D26) will need the owner in them.
- Warm-up sets: should they count toward volume and PRs? Currently every set counts.

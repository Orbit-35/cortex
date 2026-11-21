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
**Superseded by D36** (the strategy changed; "never touches `/api`" still holds).

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

### D19. Charts are hand-written SVG, no chart library (maths moved to core/chart.js by D50)
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

### D29. Perceived effort (RPE) per set, optional
- **Decision:** a set can carry `data.rpe` from 6 to 10 in half steps (10 = nothing left, 9 = one more rep possible, …). Set it by tapping the set number in the workout screen; shown as "@8".
- **Why:** RPE is the common way to record how hard a set was (Stronger, Strong and Hevy all offer it), and the 6-10 scale with half steps is the standard RIR-based one.
- **Trade-off:** one more tap per set if you use it; nothing is computed from it yet (it could later feed autoregulation or e1RM adjustments).

### D30. One exercise view, reused
- **Decision:** the screen behind an exercise's name (from a workout, or the Exercises tab) and the Progress tab render the same view: a per-session chart switchable between est. 1RM, heaviest weight and session volume, records, rep records and the full history of that exercise.
- **Why:** one piece of code, consistent everywhere. Per-session points (not per set) keep the chart readable; the per-set detail is in the history list right below.
- **Trade-off:** none left: the Progress tab became the overview (D31) and links into this view from "Top lifts".

### D31. Progress overview: lifetime totals, milestones, muscle balance
- **Decision:** the Progress tab shows lifetime tiles (workouts, volume, PRs, time training), a volume milestone against real-world objects with a "journey" list, a radar chart and a donut of sets per muscle group (range: 4 weeks / 3 months / 1 year / all), and top lifts (most-trained exercises with best est. 1RM). The maths is in `static/lifting/progress.js`, tested.
- **Why:** answers "where do I stand" at a glance. Radar shows balance (shape), the donut shows share (%), which is why both exist.
- **Trade-off:** lifetime numbers only count what's in Cortex (see the Stronger baseline idea, on hold).

### D32. Six muscle groups for charts; a set credits each group at most once
- **Decision:** the 13 tagged muscles roll up into Chest, Back (incl. lower back, traps), Shoulders, Arms (biceps, triceps, forearms), Legs (quads, hamstrings, glutes, calves), Core. Per set, a group gets 1 if it holds the primary muscle, else 0.5 if it holds any secondary, never more than 1.
- **Why:** six axes keep a radar and a donut readable (more slices stop being comparable). Capping per group stops e.g. a deadlift counting glutes ½ + hamstrings ½ as a full extra leg set.
- **Trade-off:** finer detail (e.g. biceps vs triceps) isn't shown yet; the data supports it later.

### D33. A PR is counted when it happened
- **Decision:** a set counts as a PR if, at the moment it was done, it beat every earlier set of that exercise by est. 1RM or by weight at that rep count (same rule as the live 🏆, D18/`prKind`). The first-ever set of an exercise is not a PR. Recomputed from history on every load, never stored.
- **Why:** stays correct after edits, deletes and merges, and old PRs that were later beaten still count.
- **Trade-off:** cost grows with history (fine for thousands of sets; cache it if it ever gets slow).

### D34. Volume milestones use rough, commonly cited weights (icons are Lucide names since D51)
- **Decision:** a fixed list of ~20 objects from a Labrador (30 kg) to the Great Pyramid in `progress.js`, with our own selection and wording.
- **Why:** fun, and only needs to be roughly right.
- **Trade-off:** the figures are approximate; changing the list changes everyone's "next milestone".

### D35. Exercises can be edited, hidden and merged, never hard-deleted
- **Decision:** edits write an `_exercise` override (D23). Hiding sets `hidden` (history stays, lists skip it). Merging moves every set of A to B (renumbering where a workout had both), rewrites workouts' exercise lists, and hides A with `merged_into`.
- **Why:** history is the point of the app, so nothing that has sets can vanish. Merge fixes duplicates without retyping.
- **Trade-off:** a merge rewrites many entries at once (one sync batch). A workout open in the editor during a merge keeps the old key until reopened.

### D36. App updates: one fingerprinted version at a time, auto-reload
- **Decision:** the server serves `/sw.js` stamped with a hash of every file under `static/` (`app_version()`), and `/api/version` returns the same hash. The service worker serves the app cache-first from a cache named after that version. A new version downloads the full set of files, replaces the old cache in one step, and the page reloads itself (a live workout reopens; an unsaved edit of a saved workout delays the reload). The phone checks for updates whenever the app comes to the foreground. Settings shows "Up to date ✓" or "Updating…".
- **Why:** stale-while-revalidate (D14) refreshed each file separately and only on the next launch, so the phone ran a week-old version at the gym and could even mix files from two versions. A hash computed by the server means no version number to remember to bump.
- **Trade-off:** each update re-downloads every app file (small: well under 1 MB). The reload is a visible flash when an update lands.

### D37. Set types: warm-up, drop set, failure
- **Decision:** a set can carry `data.type` = `warmup` | `drop` | `failure` (null = normal). Warm-ups are shown as "W", not numbered, and **excluded** from volume, set counts, PRs, muscle charts and exercise charts (`isWorking()`). Drop and failure sets count normally and are labelled D / F.
- **Why:** warm-ups would otherwise inflate volume and muscle sets, and could never be PRs anyway. This is the convention in Strong/Hevy.
- **Trade-off:** history and "Previous" still show warm-ups so you can repeat them.

### D38. Supersets are a `group` on the workout's exercise list
- **Decision:** exercises in a workout can share `data.exercises[i].group`; consecutive exercises with the same group are shown as one superset (coloured bar). Created from the picker ("Add as superset") or the exercise menu ("Superset with next").
- **Why:** a superset is about how exercises were done together in one workout, not a property of the exercises or sets, so it belongs on the workout's list. No change to sets.
- **Trade-off:** groups only display when members are adjacent; moving one member away splits the visual group. Nothing (e.g. a rest timer) uses grouping yet.

### D39. Exercise cues live on the exercise, notes live on the workout
- **Decision:** a cue ("elbows tucked") is stored on the exercise definition (`_exercise` override, `cue`) and shown pinned every time the exercise appears. A note is stored on that workout only.
- **Why:** cues are reminders for every session; notes are about one session. Keeping them apart means a cue is written once.
- **Trade-off:** editing a cue writes the exercise override immediately (outside the workout save).

### D40. Picker selects several exercises before adding
- **Decision:** tapping exercises in the picker toggles a numbered selection; a bottom bar adds them all (in tap order), or adds them as a superset. Creating an exercise opens the full form (name, main and helper muscles, cue) and selects it on save.
- **Why:** adding one exercise per trip through the picker was slow and gave no feedback; creating exercises without muscles left them out of the muscle charts.

### D41. In-app confirm dialog for anything that loses data (set deletes changed by D49)
- **Decision:** destructive or final actions ask first in a styled bottom dialog (`ask()` in `app.js`) instead of the browser's `confirm()`. It covers deleting a set that has values, removing an exercise from a workout (always), cancelling or deleting a workout, finishing a workout, leaving an edit with unsaved changes, merging and hiding exercises. The dangerous button is red and on the right; the safe one is labelled with what it keeps ("Keep going", not "Cancel", when the action itself is called Cancel). Tapping outside or the back gesture means no.
- **Why:** the owner wanted more confirmation. The browser's `confirm()` shows the site address, looks like a system error, and is easy to tap through mid-set.
- **Trade-off:** one extra tap on Finish and on removals. Empty sets still delete without asking, since nothing is lost.

## Home and guitar

### D42. A home screen of apps; the installed app still opens on Lifting
- **Decision:** `/` is a launcher page (`static/index.html`) with a tile per app. The manifest keeps `start_url: /lifting/` and adds shortcuts (long-press the Cortex icon: Lifting, Guitar tuner, All apps). Each app has a grid icon in its top bar that goes to `/`. One service worker (`/sw.js`) caches every app's shell.
- **Why:** lifting is opened mid-gym and should stay one tap away; other apps are one extra tap or a long-press. One installed app (not one per module) matches the "phone OS + apps" idea.
- **Trade-off:** Android refreshes an installed app's shortcuts only when it re-reads the manifest (can take a day, or reinstall).

### D43. Guitar tuner runs entirely on the device and stores nothing (storage part superseded by D44)
- **Decision:** `static/guitar/`: microphone → Web Audio analyser (4096 samples, ~85 ms) → YIN pitch detection (`pitch.js`) ~30 times a second → median of the last 5 readings → cents off the target string (`music.js`). Tunings: standard, drop D, half/whole step down, drop C, open G/D, DADGAD, chromatic. A4 reference adjustable 430–450 Hz. Auto mode picks the closest string; tapping a string locks it. A string held within ±3 cents for 0.5 s is marked tuned. "Hear" plays a soft reference pluck, and detection pauses while it sounds.
- **Why:** no ads, offline, private. Phone voice processing (echo cancellation, noise suppression, auto gain) is turned off because it treats a sustained note as noise. YIN avoids octave errors on guitar tones, whose overtones are often louder than the fundamental (tested down to a 30% fundamental, within 1 cent).
- **Details:** no `entries` are written; the chosen tuning and A4 are per-device preferences in `localStorage`. The mic is released when the app goes to the background (battery, privacy) and picked up again on return. The screen is kept awake while tuning.
- **Trade-off:** the microphone needs HTTPS, so it works through the Tailscale address or on localhost, not plain `http://<ip>:8000`.
- **Known limit (tested on the phone):** if Android's microphone permission for Chrome is set to "Ask every time", Chrome refuses every site's microphone without showing any question (`NotAllowedError`, site permission still "prompt"). It works with Chrome set to "Allow only while using the app". The native Android app (Capacitor) fixes this properly: Cortex gets its own microphone permission, which Android can ask for every time.

### D44. Tuning picker behind a button; custom tunings sync as entries
- **Decision:** the tuning list moved from a chip row at the top into a bottom sheet opened by a button showing the current tuning (top right). Chromatic is listed first, then the guitar presets, then "Your tunings" and "New custom tuning". A custom tuning has a name and 4–8 strings, each set with −/+ in semitones (B0 to G5), starting from the tuning in use; tapping a note plays it. Custom tunings are entries: `module=guitar`, `metric=_tuning`, id `tuning:<uuid>`, `data={name, notes:["E2", …]}` (low to high, sharps). Deleting one needs a second tap.
- **Why:** the owner found the chip row cluttered. Custom tunings are worth keeping across devices and reinstalls, unlike the per-device choice of tuning and A4 (still `localStorage`).
- **Trade-off:** sharps only in custom tunings (E♭ shows as D♯).
- **Confirmations:** creating or saving a tuning asks first (showing its notes), deleting asks in a red dialog, and leaving the editor with unsaved changes (Cancel, tap outside, back gesture) asks "Discard?". A toast confirms the result.

### D45. One theme file and one shared dialog for all of Cortex; accent is pink
- **Decision:** colour tokens live in `static/core/theme.css`, linked by every page (pages keep only their own extras, like lifting's muscle-group colours). The accent is the owner's portfolio pink `#ff2e88`, with near-black text on pink fills (5.6:1; white would be 3.5:1). The danger colour moved to orange-red `#ff6a3d` so it can't be mistaken for the accent. The confirm dialog and toast live in `static/core/ui.js` (DOM code, so kept out of `cortex.js`); lifting's `ask()` is now a thin wrapper over it.
- **Why:** the owner wants all of Cortex in their portfolio's pink, and changing the look later should be a one-file edit. One dialog means every app confirms the same way.
- **Trade-off:** one more request per page (cached by the service worker, so only on updates).

### D46. Tuner meter: arc with a gliding dot (Superseded by D47)
- **Decision:** the needle gauge became a thick arc (−50 to +50 cents) with a dot that glides to the reading every animation frame and a coloured band from the centre to the dot. Colour shows closeness: pink when far, amber within 12 cents, green with a glow within 3. The note sits large inside the arc; "Tune up / Tune down / In tune" is a coloured pill below. The meter fills the screen width (up to 480 px).
- **Why:** the owner found the needle plain and small. The band and colour read at a glance from arm's length while tuning.

### D47. Tuner meter: analogue needle; listening starts on open (meter part superseded by D48)
- **Decision:** the meter is a needle gauge again, but richer: ticks every cent (longer every 5, numbered every 10), coloured zones under the scale (green ±3, amber ±12, pink beyond), a tapered needle with a glow and pivot cap. The needle is driven by a spring (pulls to the reading with a slight overshoot) every animation frame, and rests dimmed at the centre when nothing is heard. Under the meter: the note with its neighbouring semitones either side, a large cents value with Hz, and flat/sharp lights around a "Tune up / Tune down / In tune" pill. The full-screen "Start tuner" page is gone: the mic opens when the tuner opens; problems (blocked, unsupported, waiting for permission, audio paused until a tap) show inline under the meter with "Try again".
- **Why:** the owner preferred a needle, and found the arc-and-dot version too simple and its movement unpleasant. A spring reads as a physical meter; the extra cues (lights, neighbours, cents) answer "which way and how far" without reading numbers. The start page was an extra tap every time.
- **Also:** the tuner and home pages now reload into a new version as soon as it's installed (`keepUpdated()` in `core/ui.js`, same rule as lifting's D36), except while a custom tuning is half-edited.

### D48. Tuner meter back to the first version
- **Decision:** the meter is the original simple needle gauge from D43 (needle, ±50 scale, green in-tune mark, note, "Tune up / Tune down / In tune", Hz and cents line). Kept from later work: the tuning button and list, custom tunings and their confirmations (D44), the pink theme (D45), and starting to listen on open with inline mic messages (D47).
- **Why:** the owner preferred the first version after trying both redesigns ("something feels off"). Open question for later: what exactly felt better about it.

### D49. Long-press is a gesture, not text selection; deleting a set never asks
- **Decision:** every page sets `user-select: none` and `-webkit-touch-callout: none` on the body and allows selection again in inputs, textareas and `.selectable`; `noCallout()` in `core/ui.js` blocks the long-press context menu outside text fields. Deleting a single set (swipe or set menu) happens straight away with no dialog; everything else in D41 still confirms.
- **Why:** the owner long-presses rows and cards and got Chrome's text selection instead; long-press will also start drag-to-reorder. The set confirm felt like friction for something small and quick to retype.
- **Trade-off:** a mis-swipe loses a typed set (an Undo toast is an open question in docs/PLAN.md). Text outside inputs can't be copied unless marked `.selectable`.

### D50. One chart module for all apps; a single session still draws
- **Decision:** the line-chart maths (nice ticks, scales, labels, line, dots) lives in `static/core/chart.js` as pure functions returning SVG markup; pages add their own crosshair and tooltip. With one data point the chart shows a centred dot and one date label, no line, plus "Log another session to see a trend". With none it says so.
- **Why:** the owner wanted a chart even after the first session, and Guitar (tempo charts) and Bodyweight need the same chart. Pure functions can be tested in Node (`tests/chart.test.mjs`); the old code divided by zero with one point.
- **Trade-off:** the page still owns interaction code; a second page that wants a tooltip copies ~15 lines until that's shared too.

### D51. Icons are Lucide SVGs from one shared file; no emoji anywhere
- **Decision:** every icon is an inline SVG from `static/core/icons.js` (path data copied unchanged from Lucide 1.77.0, licence notice at the top), drawn with the shared `.ic` rule in `core/theme.css` so it takes the text colour. Emoji in the lifting UI (trophy, bin, pin, note, chain, arrows, tick, milestone objects) were replaced. Toasts stay plain text. `tests/icons.test.mjs` fails if an emoji or arrow symbol appears in `static/` outside a code comment.
- **Why:** the owner dislikes emoji; they render differently on every phone, can't follow the pink theme, and look out of place in the native app. Lucide matches the existing tab-bar icons (24 px grid, stroke 2, round ends) and its ISC licence is fine for a public repo.
- **Trade-off:** milestone objects without a Lucide picture use the nearest one (paw print for horse and elephant, fish for whales, bone for T. rex). New icons must be copied in from lucide-static, never drawn from memory.

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

## Future: standalone apps (logged, not decided)

Today Cortex is a web app installed from Chrome (a PWA). On Android it opens full screen with its own icon, but it is still run by Chrome. Options, cheapest first:

1. **Windows, today, free:** open Cortex in Chrome or Edge on the PC and choose "Install". It gets its own window, Start-menu entry and taskbar icon. Same code, zero work, still browser-run.
2. **Android standalone (Capacitor):** wraps the same pages into a real APK. Runs in Android's built-in WebView, not the Chrome app, and can use native features later (volume control, Health Connect, notifications for the rest timer).
3. **Windows standalone (Tauri):** same idea for a desktop `.exe`, small (uses Windows' built-in WebView2).

Both 2 and 3 are already the long-term plan (D13) and reuse `static/core/` unchanged. What they need first: the pages bundled into the app instead of downloaded from the server, the server address set via `configure({ apiBase })`, and **CORS + login on the server**, because the app is no longer the same website as the API. Login is also needed for other people using Cortex, so it's one piece of work serving both goals.

## Open questions

- Editing an entry (not just create/delete): the sync layer supports it, no UI yet.
- Pruning old soft-deleted rows without breaking D8.
- Recovering automatically when the server database is restored from an older backup (see D8).
- Auth model that works for browser, Capacitor and Tauri alike.
- Multiple users (a goal): entries will need an owner (`user_id`) and sync must scope by it. Deterministic ids (D23, D26) will need the owner in them.
- Warm-up sets: should they count toward volume and PRs? Currently every set counts.

# Plan: Guitar songs and practice log

Part of [the master plan](../PLAN.md). The research is in [docs/research/guitar-songs-practice.md](../research/guitar-songs-practice.md). DESIGN numbers get assigned when each part is built.

## Findings that shape the plan
1. **The tuner assumes it is the whole app.** It opens the mic on load and again on return. With tabs, the mic must open **only on the Tuner tab**, or opening Songs would ask for the microphone.
2. **Two wake-lock users are coming:** the tuner and the practice timer. They need a shared, counted wake lock, or leaving the tuner would let the screen sleep during a session.
3. **Guitar and lifting handle back differently.** Guitar uses `{sheet}` and `open[]`; lifting uses `{ui}` and `stack[]`. Guitar is about to have around 8 overlays, so it needs one stack where each overlay has its own "OK to leave?" check, lifting's style.
4. **The tuning pref (`guitar:tuning`) already works as a link point.** `sw.js` ignores query strings, so `/guitar/?tuning=dropd` works offline.
5. **`sw.js` SHELL lists files by hand.** Every new file must be added, or the app breaks offline. A test guard enforces this.
6. **`drawChart` lives inside `lifting/app.js`** and depends on lifting-only helpers and CSS. It has to move to `core/chart.js` before guitar can use it.
7. **The server has no HTTP client.** The lookup route uses the standard library `urllib` in a thread, so there is no new dependency.
8. **Pure modules must use relative imports**, so Node tests can load them.
9. **Lifting already solves "a live session survives a reload"** (D25): a localStorage key, a "reopen after update" flag, and clearing `history.state` on boot. Practice copies all three.

## Files
```
static/guitar/
  index.html      shell: top bar, 3 views, tab bar, overlay containers (CSS moves out)
  guitar.css      all guitar styles
  app.js          shell only: tabs, boot, load + derive data, onChange refresh, keepUpdated, deep links
  nav.js          overlay stack + history with per-overlay leave guards; pref; esc; icons
  tuner-ui.js     today's tuner code; exports activate(), deactivate(), useTuning(snapshot), pickTuning(cb)
  songs-ui.js     list, detail, editor, status sheet
  practice-ui.js  practice tab, live session screen, "in progress" bar, past/edit session form
  songs.js        pure: song shape, labels, links, filter/sort/search, refresh schedule
  practice.js     pure: timer maths, day/week keys, weekly summary, streaks, totals, per-song stats
  music.js, pitch.js   unchanged
static/core/ui.js     + holdAwake(key) / releaseAwake(key)
static/core/chart.js  drawChart moved from lifting (phase 5)
static/core/cortex.js + lookupSong(q) (phase 6)
lookup.py + main.py   GET /api/lookup/song (phase 6)
tests/songs.test.mjs, tests/practice.test.mjs, tests/lookup_test.py
```
`app.js` passes a shared `state` object and a `showTab` callback into each UI module. Each module exports `init(ctx)` and `render()`, so there are no circular imports.

## Data (`module=guitar`)
### `_song`: id `song:<uuid>`
- **Fields:** `recorded_at` is the creation time; `value` and `unit` stay empty.
- **`data`:**
  ```
  { title, artist, status: "want"|"learning"|"can_play", confidence: 1-5|null,
    tuning: { id, name, notes }, capo: 0-12, links: [{ kind: "tabs"|"video"|"lesson"|"other", url, label? }],
    notes, target_bpm?, cover_url?, ext?: { itunes_id?, mbid? } }
  ```
- **Nothing derived is stored** (review interval, next review, last played). It's all worked out from sessions, so two devices can't fight over a counter.
- **Tuning shown:** the live tuning if its id still exists, otherwise the snapshot. A deleted custom tuning therefore still displays and still sets the tuner.

### `_practice`: id `practice:<uuid>`
- **The id** is made at Start, so Finish is safe to repeat.
- **`value`** is whole minutes (at least 1), with `unit=min`.
- **`recorded_at`:** the real start time, or local noon for past sessions (D20).
- **`data`:**
  ```
  { duration_s, mode: "timer"|"manual", songs: [{ song, title, bpm?, confidence? }], notes }
  ```
- The song `title` is a snapshot, so history stays readable after a song is deleted.
- A confidence entered on Finish also updates the song, in the same `putEntries` call.

### Live session: on the device only, not synced (like D25)
- **Storage:** `guitar:live` in localStorage:
  ```
  { v:1, id, start, pausedMs, pausedAt, songs, notes }
  ```
- **Elapsed time** is `now − start − pausedMs − (pausedAt ? now − pausedAt : 0)`. Nothing ticks, so it stays right through reloads, a locked phone and updates.
- **Why localStorage:** it reads instantly at boot, so the timer shows on the first paint.
- **First Start:** call `navigator.storage.persist()`.

## Navigation
- **Tabs:**
  - `#tuner` (the default), `#songs`, `#practice`.
  - Switching uses `replaceState`, so tabs aren't history steps; same as lifting.
  - Lifting's tab bar is copied with 3 columns and SVG icons.
- **`nav.js` overlay stack:**
  - `openOverlay(id, {canLeave})` pushes `{ui:id}`.
  - One `popstate` handler: `cancelAsk()` first, then pop down to the target. If `canLeave()` returns false, it pushes back and asks "Discard…?".
  - `closeOverlays(n)` replaces the `history.go(-2)` calls.
  - On boot, a leftover `history.state.ui` is cleared.
- **Overlays:**
  - tuning: `picker`, `editor`
  - songs: `song`, `songedit`, `status`
  - practice: `session`, `sessionedit`, `songpick`
- **Mic:**
  - Showing the Tuner tab calls `activate()`, which starts the mic. Leaving calls `deactivate()`, which stops it.
  - `visibilitychange` only resumes the mic on the Tuner tab.
  - A `data-mic="on|off"` attribute on `#stage` lets tests check it.
- **Wake lock:**
  - A counted set of keys in `core/ui.js`, re-acquired when the page becomes visible again.
  - `"tuner"` while the mic is open; `"practice"` while the timer runs.
- **Deep links:**
  - `/guitar/?tuning=<id>#tuner` (the query is stripped after boot).
  - `/guitar/#practice`.
  - Manifest shortcut "Guitar", plus "Practice".
- **`keepUpdated`:**
  - Waits while an editor or form has unsaved changes.
  - If the session screen is open, it reopens it after the reload.

## Pure modules
**`songs.js`**
- **Constants:**
  - `STATUSES`
  - `CONFIDENCE` labels: 1 Just started, 2 Parts of it, 3 All the way slowly, 4 Nearly there, 5 Solid.
- **Reading and validating:**
  - `songFromEntry` fills in defaults and never throws.
  - `songData(form)` validates: a title is required; capo is 0–12, confidence 1–5 and BPM 20–300.
- **Tuning:** `tuningLabel` gives "Drop D · Capo 2", and `resolveTuning` picks the live tuning or the snapshot.
- **Links:**
  - `safeUrl` allows http(s) only. It adds https to bare domains and rejects `javascript:` and `data:`.
  - `linkKind` is detected from the host.
  - `searchUrls` builds Songsterr and YouTube search links.
- **Search and sort:**
  - `searchKey` ignores accents and case.
  - `filterSongs`
  - `sortSongs`: recent, title, artist, added or confidence. It's stable, and never-played songs go last.
- **Phase 4:** `refreshPlan(song, plays, today)` with `REFRESH_STEPS=[7,14,30,60]`.

**`practice.js`**
- **Timer:** `newLive`, `pauseLive`, `resumeLive` and `elapsedMs` all return new objects. A clock set backwards gives 0.
- **Turning sessions into entries:** `sessionFromLive`, `sessionFromForm`, `sessionFromEntry`.
- **Day keys:**
  - `dayKeyOf(iso)` gives the local day.
  - `addDays`, `weekStartKey` (Monday) and `daysBetween` work on `YYYY-MM-DD` with `Date.UTC`, so time zones and daylight-saving changes can't break week maths.
- **Summaries:**
  - `weekSummary` gives 7 days, Monday first.
  - `weekStreak` gives `{current, best, thisWeekCounted}`. A day counts at **5+ minutes**, and a week counts with **one** such day. The current, unfinished week never breaks a streak.
- **Stats:**
  - `totals`
  - `songStats` gives last played, count, minutes and plays.
  - `relDays` gives "today", "12d ago" and so on.
  - `calendarWeeks(n=12)`

## Phases (one commit per numbered line)
### Phase 0: split `app.js`, no behaviour change (S)
1. Create `guitar.css`, `nav.js` and `tuner-ui.js`, and move the wake lock to `core/ui.js`. Add the new files to the SHELL. The tuner regression test must pass before and after.

### Phase 1: tabs (S–M)
2. Tab bar, the three views, empty-state placeholders, hash routing.
   - The mic and wake lock follow the tab.
   - `?tuning=` deep link and the toast offset.
   - Home tile becomes "Guitar".
   - DESIGN entry.

### Phase 2: songs (L)
3. `songs.js` with tests.
4. **List, detail and editor.**
   - **List:**
     - Filter chips (All / Learning / Can play / Want to learn) with counts, search, and a sort sheet. Filter and sort are remembered.
     - Cards show the cover or initial, title, artist, status, a tuning label button, confidence dots and "Played 12d ago". A + button sits above the tab bar.
   - **Detail:**
     - The status chip opens a small sheet. The tuning row sets the tuner.
     - A 5-segment confidence control that saves straight away with a toast.
     - Links (new tab, `noopener`) plus "Find tabs" and "Find a lesson".
     - Notes and a stats line, Edit, and "Practice this".
   - **Editor:**
     - Fields: title (required), artist, status, confidence.
     - The tuning comes from the existing picker in "choose" mode, which doesn't change the tuner.
     - A capo stepper, links with detected kind, notes.
     - A Delete button and an unsaved-changes guard.
   - **Confirmations:**
     - Create: `Add “X”?` with body "Learning · Standard · Capo 2", then a toast.
     - Save: a confirm, then a toast.
     - Delete: red, with body "Its N practice sessions stay in your log."
     - Leaving with unsaved changes: Keep editing / Discard.
     - Status change: a toast "Moved to Can play".
   - **Empty states:**
     - No songs: an explainer and an "Add a song" button.
     - An empty filter: an explanation.
     - A search miss: an `Add “x”` button.
5. **Tap a song's tuning to set the tuner.**
   - It switches to the Tuner tab with a toast: "Tuner set to Drop D. Capo 2: tune the open strings first".
   - A snapshot-only tuning becomes a temporary tuning stored in `guitar:tempTuning`.
   - DESIGN entries for songs and for links + the tuning shortcut.

### Phase 3: practice (L). The first version is phases 0–3.
6. `practice.js` with tests, including the time-zone matrix.
7. **Timer.**
   - **Start:** from the Practice tab, or "Practice this", which prefills the song.
   - **Session screen:**
     - A huge clock, Pause/Resume, and Finish.
     - Discard is small, in a menu.
     - Song chips via a multi-select picker, each with an optional BPM and confidence. Notes.
     - It saves to `guitar:live` on every change.
   - **Back closes the screen, but the session keeps running.** A "Practising 12:34 · Pause" bar shows above the tabs on every tab.
   - **Finish:**
     - Ask `Finish practice?` with body "32 min · Wonderwall", buttons Keep going / Finish.
     - Under a minute, it offers to discard instead.
     - Saving gives a toast. If a Learning song was rated 5: "Move “X” to Can play?", default no.
   - **Discard:** red confirm, then a toast.
   - **Over 4 hours:** "Still practising?" with "Set length…" or "Keep going".
8. **Add and edit past sessions:**
   - date (no future dates) and optional time
   - duration chips (10/15/20/30/45/60) plus a ±5 stepper
   - songs and notes
   - Delete with a confirm.
9. **The Practice tab, top to bottom:**
   1. The start card or the live card.
   2. "This week": 7 day bars, "4 of 7 days · 1h 50m".
   3. "3-week streak · best 7", or "Practise this week to make it 4".
   4. Totals.
   5. A 12-week dot calendar.
   6. History grouped by week.
   7. "Add past session".
   - No notifications and no "streak lost" wording.
   - Song cards show last played.
   - DESIGN entries for sessions, the streak rule and derived stats.

### Phase 4: needs refresh (M)
10. **The schedule:**
    - The steps are 7→14→30→60 days, capped.
    - A play rated 4–5 (or unrated) moves up a step, 3 keeps it, and 1–2 resets to 7.
    - Only "Can play" songs are included.
    - **UI:**
      - A Songs banner, "3 songs need a refresh".
      - Each row has "Still solid" / "Getting rusty" buttons, which log a 5-minute session.
      - The detail shows "Next refresh in 12 days".
    - DESIGN entry.

### Phase 5: BPM and tempo chart (M)
11. Move `drawChart` to `core/chart.js`, with a target line and the single-point fix. Lifting switches over in the same commit, with the lifting chart smoke test.
12. **BPM:**
    - A target BPM in the editor and the BPM reached on session chips.
    - The detail shows "Current 84 / target 120 BPM" and a chart with a dashed target line.

### Phase 6: song info lookup (M)
13. **`GET /api/lookup/song?q=&limit=8`:**
    - **Input:** 2–100 characters, `limit` 1–10.
    - **Providers:** iTunes first, MusicBrainz only if iTunes fails or finds nothing. Cover from the Cover Art Archive URL.
    - **HTTP:** `urllib` in a thread, a 6 s timeout, and a 1 MB response cap.
    - **User-Agent:** `Cortex/<version> ( self-hosted personal app )`. Contact details are added only from an env var that is never committed.
    - **Limits:** iTunes ≤18 calls per minute, and MusicBrainz at least 1.1 s apart. Identical requests share one call. A full window answers from the cache, then MusicBrainz, then 429.
    - **Cache:** a separate SQLite file `cache/lookup.db` (gitignored), never `cortex.db`. Hits last 30 days, empty results 1 day.
    - **Tests:** stdlib only, with fake providers and an injected clock.
14. **Client:**
    - A "Look up" button next to the title shows up to 8 results, and a pick fills the fields.
    - Offline: "Lookup needs a connection", and it never blocks saving.
    - Covers use `<img loading=lazy>` with an initial-letter tile as fallback.
    - DESIGN entry covering the privacy trade-offs.

### Later
Sections per song, a metronome, a weekly goal setting, snooze for refresh, Spotify, syncing the live session.

## Unit tests
- **songs:**
  - defaults
  - validation
  - `safeUrl` rejects `javascript:` and `data:`
  - `linkKind`
  - the tuning label and snapshot fallback
  - accent-insensitive search
  - stable sort
  - refresh sequences
- **practice:**
  - **Timer:** pause/resume, the clock going backwards, finishing while paused.
  - **Week edges:** Sunday 23:59 vs Monday 00:00; the year change Dec 28 2026–Jan 3 2027; a leap day; daylight-saving dates in the US and EU.
  - **Streaks:**
    - none, this week only, last week but not this week (still unbroken)
    - a gap resets, and best is greater than current
    - a 4-minute day doesn't count, two 3-minute sessions do
  - **Time zones:** run under several zones:
    ```powershell
    node tests/practice.test.mjs
    $env:TZ="Pacific/Auckland"; node tests/practice.test.mjs
    $env:TZ="America/Los_Angeles"; node tests/practice.test.mjs
    $env:TZ="UTC"; node tests/practice.test.mjs; Remove-Item Env:TZ
    ```

## Headless UI scenarios (for test subagents, using [the harness](testing.md))
Use fake data only ("Test Song", "Fake Artist").

| # | Scenario | Check |
|---|---|---|
| T1 | Tuner regression | Opens on Tuner with the mic on; the picker opens and back closes it; custom tuning create → confirm → toast |
| T2 | Tabs and mic | Songs tab turns the mic off; a fresh load of `#songs` never calls `getUserMedia` |
| T3 | Empty states | Songs and Practice empty states show on a fresh DB |
| T4 | Create a song | Confirm → toast → card; a `song:` entry exists; it syncs to the server |
| T5 | Unsaved-changes guard | Back while dirty → Discard dialog; Keep editing keeps it; nothing written |
| T6 | Edit and delete | Toasts; soft delete |
| T7 | Tuning tap | Drop D + capo 2 sets the tuner and the toast mentions the capo; it still works after the custom tuning is deleted |
| T8 | Filter, sort, search | Counts right; "beyonce" finds "Beyoncé"; `Add “x”`; sort survives a reload |
| T9 | Link safety | `javascript:` rejected; valid links get `noopener` |
| T10 | Timer and reload | Start time set 25 min back → reload shows ≥25:00; paused stays paused |
| T11 | Finish | The confirm shows minutes and songs; the entry is right; song confidence updated; live cleared |
| T12 | Short session / discard | Under a minute offers discard; Discard writes nothing |
| T13 | Past sessions and stats | Week strip, streak = 2, totals, grouping; edit and delete |
| T14 | Back stack | Detail → edit → chooser closes in order; a reload with an overlay open lands on the tab |
| T15 | Offline | Reload from cache; a song created offline syncs later; lookup shows the offline message |
| T17 | Lifting chart (phase 5) | Renders with 1 and with 2+ points |
| T18 | Lookup (phase 6) | `CORTEX_LOOKUP_FAKE=1` fixture provider; never calls Apple or MusicBrainz |

## Risks
| Risk | Handling |
|---|---|
| The split breaks the tuner | Phase 0 alone, gated by T1/T14 |
| Mic left open on other tabs | Tab-gated, `data-mic`, T2 |
| Wake-lock fights | Counted keys |
| A new file missing from SHELL | Guard test plus T15 |
| Back-stack bugs with about 8 overlays | One stack, T5/T14 |
| Live session lost if storage is cleared | Documented, `storage.persist()` |
| Clock changes | Timestamps, clamping, the 4 h question |
| XSS through titles or links | `esc()` everywhere plus `safeUrl` |
| Last write wins on whole-song edits | Accepted (D9) |
| MusicBrainz throttling | Cache, limiter, iTunes first; lookup is optional |

## Open questions for the owner (recommended answer first)
1. Progress as 1–5 confidence with labels, rather than a percentage? (Yes.)
2. Weeks start on Monday? (Yes.)
3. A day counts at 5+ minutes, and a week counts with 1 such day? Or 3 days, like Fender Play? (1 day; a weekly goal setting later.)
4. Always open on Tuner, or on the last tab used? (Tuner.)
5. Rating a Learning song 5 asks "Move to Can play?", never automatically? (Yes.)
6. Confirm before creating a song or session? (Yes, as you asked for confirmations.)

## Effort
| Phase | Size |
|---|---|
| 0 Split `app.js` | S |
| 1 Tabs | S–M |
| 2 Songs | L |
| 3 Practice | L |
| 4 Needs refresh | M |
| 5 BPM and tempo chart | M |
| 6 Song info lookup | M |

The first version (phases 0–3) is about 2–4 focused sessions.

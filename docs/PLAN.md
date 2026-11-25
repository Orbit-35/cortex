# Cortex: the plan (Nov 2026)

What gets built next, in what order, and how each step is checked. Detailed plans for each area are in `docs/plans/`. The research behind them is in `docs/research/`.

| Area | Detailed plan | Research |
|---|---|---|
| Test kit | [plans/testing.md](plans/testing.md) | – |
| Lifting (queued changes, Bodyweight, Profile, rest timer) | [plans/lifting.md](plans/lifting.md) | [research/lifting-queued-ui.md](research/lifting-queued-ui.md) |
| Android app | [plans/android.md](plans/android.md) | [research/android-app.md](research/android-app.md) |
| Guitar songs and practice | [plans/guitar.md](plans/guitar.md) | [research/guitar-songs-practice.md](research/guitar-songs-practice.md) |
| Audio and ear care | [plans/audio.md](plans/audio.md) | [research/audio.md](research/audio.md) |

This is a plan, not a decision log. Each step adds its DESIGN.md entry in the commit that builds it. DESIGN numbers are given out in build order, starting at D49.

## How every change is built and checked
1. Build one small step and commit it, updating DESIGN.md in the same commit.
2. Run `npm test` (once the test kit exists): unit tests, API tests and headless browser tests, all on a throwaway server and database.
3. A **test subagent** checks the change with the prompt in `tests/AGENT.md`. It runs the tests, clicks through the changed screens on a phone-sized browser, looks at the screenshots, and reports pass or fail.
4. Fix whatever it finds, then hand over. Anything that can only be checked on a real phone is listed for the owner.
5. Push only when the owner says so. Always push before a risky step (marked **push first** below).

## Order
Effort: S = under an hour or two, M = about half a day, L = a day or more.

### Stage 0: test kit (M). Done (DESIGN D55).
- Add `package.json`, `tests/run.mjs`, and the headless Edge driver (no npm packages).
- Add the throwaway-server helper. It refuses port 8000 and the real `cortex.db`.
- Add API tests for `/api/sync`, plus static checks (every file is in the `sw.js` SHELL, no stray `/api` fetches).
- Write the first UI tests: home, logging a workout, offline, two devices syncing, the tuner with a fake mic.
- Write `tests/AGENT.md`, the prompt for test subagents.

### Stage 1: lifting quick wins (S–M each). Done (DESIGN D49–D51).
1. No text selection on long-press.
2. Deleting a set no longer asks.
3. Shared chart in `core/chart.js`; a chart with one session shows a dot.
4. Lucide icons in `core/icons.js`, every emoji removed, and a test that fails if one comes back.

### Stage 2: Android app (M overall). Needs the owner's setup steps.
- **Owner:** install Android Studio, set two environment variables, turn on USB debugging. See [plans/android.md](plans/android.md#owners-steps-in-order-with-checkpoints).
- **Build steps:**
  - **C1:** tooling.
  - **C2:** `cap add android` (**push first**).
  - **C3:** manifest with the mic permission.
  - **C4:** CORS.
  - **C5:** `core/shell.js` (**push first**). This adds the server-address screen, routes every request through `apiBase`, turns off the service worker in the app, fixes folder links, and handles the back button, haptics and keep-awake.
  - **C6:** safe-area insets.
  - **C7:** icon and splash.
  - **C8:** `npm run android`.
- **Then:** move the data from Chrome (sync first), and work through the phone checklist.
- **Result:** the tuner's mic works in the app, which asks for permission each time as you want.

### Next up: sync errors are never silent (S–M)
Planned with the owner for the next session. Today a server-refused entry disappears from the outbox with only a console warning, and a refused delete is lost for good. Plan and findings: [plans/sync-errors.md](plans/sync-errors.md).

### Stage 3: lifting editor (M–L each)
5. No ticking. PRs show as a trophy while typing, and a summary appears after Finish (**push first**).
6. The ••• button opens a small popup menu.
7. Hold and drag to reorder exercises (**push first**). This empties the CLAUDE.md queue.

### Stage 4: Guitar songs and practice, first version (L + L)
- **Phase 0:** split the tuner code into modules, with no change in behaviour.
- **Phase 1:** tabs Tuner | Songs | Practice. The mic is only on while the Tuner tab is showing.
- **Phase 2:** songs. Status, confidence 1–5, tuning and capo (tap to set the tuner), links, notes, filters, search.
- **Phase 3:** practice. A timer that survives reloads, adding past sessions, the week strip, a weekly streak with no guilt, totals, history.

### Stage 5: the rest of Lifting
- Bodyweight tab: one weigh-in a day, range chips, chart, stats.
- Profile: a year heatmap and lifetime stats, a reorganised Settings with your name and picture, export and import.
- Rest timer.

### Stage 6: Audio, needs the Android app
- **Phase 0:** experiments on the phone. They decide how the fine volume slider can work.
- **Phase 1:** listening log.
- **Phase 2:** per-headphone offsets and the estimated weekly dose.
- **Phase 4:** safe calibration.
- **Phase 3:** the fine dB slider, which never turns sound up.

### Later
- **Guitar:**
  - "Needs refresh" list
  - BPM and tempo chart
  - song info lookup (iTunes, then MusicBrainz, through the server)
  - sections per song
  - metronome
  - Spotify
- **Lifting:** photos and posts.
- **Android:** self-hosted live updates.
- **Windows:** the desktop app (Tauri).
- **Other modules:** everything else in IDEAS.md.

## Decisions that join the plans together
The detailed plans were written separately. Where they overlap:
- **Chart:** `static/core/chart.js` (not `lifting/`). Lifting moves it in Stage 1 and Guitar reuses it. It also includes the one-point fix.
- **Icons:** `static/core/icons.js` is shared by every app. Guitar's tab icons come from it too.
- **Browser vs app:** `static/core/shell.js` owns every difference: `isNative`, `buzz()`, `keepAwake()`, the server address and the back button.
  - Guitar's counted `holdAwake(key)` in `core/ui.js` sits on top of `keepAwake()`.
  - Lifting's PR buzz and the rest timer use `buzz()`.
  - Stage 1 code should call `navigator.vibrate` through a small helper, so Stage 2 changes only one place.
- **Testing:** every plan's "headless UI test" uses the committed test kit from Stage 0 instead of one-off scratch scripts.
- **Settings:** the Android "Server" row and the Rest timer options go into the reorganised Settings sections (Profile P2). Until P2 exists they're added as rows at the end.
- **Entries:**
  - **Lifting:** sets, `_workout`, `_exercise` (adding `rest_s`).
  - **Body:** `body/bodyweight`, one per day.
  - **Guitar:** `_tuning`, `_song`, `_practice`.
  - **Audio:** `listen`, `_headphone`, `_calibration`.
  - **Settings:** one entry per field.
  - Everything that can be worked out from other entries (stats, streaks, last played, PRs, dose) is never stored.
- **Never in the repo:**
  - the `*.ts.net` address
  - signing keys
  - `cortex.db`, backups and exports
  - real names or contact details (including in User-Agent strings)

## Owner's to-do list
| When | What | Time |
|---|---|---|
| Stage 2 | Install Android Studio, set the env vars, turn on USB debugging (exact commands in plans/android.md) | about 1.5 h, mostly downloading |
| Stage 2 | Before installing the app: finish any live workout in Chrome and check the sync pill says "synced" | 5 min |
| Stage 2 | Back up the debug signing key outside the repo | 2 min |
| Stage 2 | Type the server address into the app (only on the phone) | 2 min |
| After each stage | Run the phone checklist the test agents hand over | 10–30 min |
| Stage 6 | Run the audio experiments (I'll walk you through them) | about 1 h |

## Questions for the owner (recommended answer first)
These don't block Stage 0, Stage 1 or Stage 2.

**Lifting, before Stage 3:**
1. Remove the greyed "last time" hints in a live workout, now that there's no ticking? The Previous column fills a set with one tap. (Yes.) **Answered: yes.**
2. On Finish, mention sets that have a weight but no reps and so won't be saved? (Yes.) **Answered: yes.**
3. An Undo button after deleting a set? (Your call. Without it, a mis-swipe loses a typed set.) **On hold:** the owner likes the idea but isn't sure yet.
4. Keep "Superset with next" in the new ••• menu? (Yes, or supersets can't be made.) **On hold:** ask again before building the ••• menu.

**Lifting, Stage 5:**

5. Bodyweight: one weigh-in per day, with a confirm when logging? (Yes.)
6. Profile picture stored inside the data now, or wait for photo storage? (Now; it's small.)

**Guitar, before Stage 4:**

7. Progress as confidence 1–5 with labels, instead of a percentage? (Yes.)
8. A week counts for the streak if you practise at least 5 minutes on 1 day? Or 3 days, like Fender Play? (1 day; add a goal setting later.)
9. Weeks start on Monday? (Yes.)
10. Open on the Tuner tab every time, rather than the last tab used? (Yes.)
11. Rating a Learning song 5 asks "Move to Can play?" rather than moving it automatically? (Yes.)

**Other:**

12. Spotify: do you have Premium? Its 2026 developer rules require it.
13. What felt better about the first tuner design? This helps if we change it again.

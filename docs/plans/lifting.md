# Plan: the rest of Lifting

Part of [the master plan](../PLAN.md). The research is in [docs/research/lifting-queued-ui.md](../research/lifting-queued-ui.md). Line numbers refer to commit `8868b3c`. DESIGN numbers are assigned at build time.

**Every commit:**
- updates DESIGN.md and trims the CLAUDE.md queue
- adds new files to `sw.js` SHELL
- passes `node tests/*.test.mjs`
- uses theme tokens only, no emojis, and fake test data
- uses confirmations through `ask()` for creating and destructive actions, except set delete

## Phase 1: low-risk foundations (any order)
### A6. No text selection on long-press (S)
- `index.html` body rule: `-webkit-user-select:none; user-select:none; -webkit-touch-callout:none`.
- Inputs, textareas and `.selectable` get `text` back. Add `img, a { -webkit-user-drag:none }`.
- A document `contextmenu` listener prevents the default except in inputs. Optionally make note text `.selectable` so notes can still be copied.
- **UI test:**
  1. Long-press a card for 600 ms: `getSelection()` is empty and `contextmenu` is `defaultPrevented`.
  2. In the workout-name input, selection still works.

### A1. Set delete never asks (S)
- `app.js:444-453` `case "delset"`: drop the `ask`. This covers swipe-to-trash and the set menu.
- Optional: an Undo toast. **Ask the owner.**
- DESIGN: D41 is amended, and set delete becomes the exception.
- **UI test:**
  1. Swipe the row and tap the trash.
  2. No `.cx-ask` shows and there is one row fewer.

### A7. Shared chart; a single point still draws (S–M)
- Move the maths from `drawChart` (`app.js:907-961`) into a pure **`static/core/chart.js`**. Guitar needs it too, so it goes in `core`, not `lifting`.
  - `lineChart(points, {W,H,pad,area,target,fmtY,fmtX})` returns `{svg, xs, ys}`. `niceTicks` is exported separately.
  - When the span is 0, the point sits in the centre with one date label and no line.
- With zero points, show the empty message. With one point, show the hint "Log another session to see a trend."
- **Tests (`chart.test.mjs`):**
  - one point: no NaN, one dot, no line
  - two points: one segment
  - flat values
  - `niceTicks`
  - `area`
- **UI test:** one seeded set, then two.

### A3. Lucide icons in `static/core/icons.js`; no emojis anywhere (M)
- **`icons.js`:**
  - the ISC notice
  - an `ICONS` map of copied path data. Copy it from lucide.dev; never invent paths.
  - `icon(name, {label})` returns an inline `<svg class="ic">`
- The shared `.ic` rule goes in `theme.css`.
- **Replace:**
  - 🏆 → `trophy`: 137, 355, 870
  - `‹` → `chevron-left`: 299, 621, 888, 1051, 1146
  - ••• → `ellipsis`: 327
  - 📌 → `pin`: 341, 832, 840, 1064
  - 🗑 → `trash-2`: 353
  - ↑↓ → `chevron-up` / `chevron-down`: 371-372
  - ✓ → `check`: 1172
  - the milestone icons in `progress.js` `OBJECTS` → Lucide names
- **Rules:**
  - Never pass `icon()` output through `esc()`.
  - Toasts stay plain text.
  - Icon-only buttons keep an `aria-label`.
- **Tests:**
  - `icons.test.mjs`: every `OBJECTS` icon exists, and the aria handling is right.
  - `no-emoji.test.mjs`: scans `static/**` for `\p{Extended_Pictographic}`.

## Phase 2: workout editor
### A2. No ticking; PR feedback inline and in a finish summary (M–L). Push before this one.
- **`workouts.js`:**
  - Drop `done`.
  - `keptRows` keeps every row with valid reps and a parseable weight, in every mode.
  - Old live drafts load fine, and any rows in them with values now save.
- **New pure `draftPrs(draft, workSets)`:** a Map from row id to `"e1rm"` or `"reps"`, compared with earlier history and earlier rows in the draft. It leaves out the workout's own saved sets when editing. PRs are still never stored (D33).
- **`app.js`:**
  - Remove the tick column, `case "tick"` and `tick()`.
  - Typing sets `r.at` the first time a row is complete.
  - The `change` handler recomputes PRs and patches only the `.setno` cells, so focus isn't lost. It buzzes when a row newly becomes a PR. There are no PR toasts.
- **Finish:**
  - With nothing logged: "No sets logged yet. Cancel this workout instead?"
  - Otherwise: "Finish workout? N sets will be saved. M sets have no reps and won't be saved."
  - After saving, a **summary** renders inside the editor sheet: duration, sets, volume, and a PR list. Done closes it. The summary stays inside the sheet so no new `pushState` races with `history.back()`.
- **DESIGN:**
  - D25 is superseded in part (ticking and dropping unticked sets).
  - D33 is amended (the live trophy now comes from `draftPrs`).
- **Tests:**
  - **The rewritten `workouts.test` block:** values without a tick are saved, and weight without reps is dropped.
  - **`draftPrs`:**
    - a first-ever exercise is not a PR
    - an e1RM PR is found
    - a rep PR is found
    - two rows in the draft: only the right one is marked
    - warm-ups never count
    - edit mode ignores the workout's own sets
- **UI test:**
  1. Seed 100×5 from last week.
  2. 105×5 shows a trophy and a buzz, with no toast.
  3. A row with no reps is mentioned in the Finish dialog.
  4. The summary shows 1 PR.
  5. Exactly one set is stored.
  6. A reload in the middle keeps the values.
- **Open questions:**
  - Remove the greyed "last time" placeholders in live mode? Recommended: yes, since the Previous column is one tap.
  - Keep the "no reps" note? Recommended: yes.

### A4. ••• is a small popover menu (M)
- **Markup:** one `<div id="exmenu" popover="auto" role="menu">`, outside the re-rendered sheet. Items:
  - Add note
  - Add/Edit cue
  - Superset with next / Leave superset (kept so the feature isn't lost)
  - Remove exercise (red)
- **Positioning:**
  - Anchor positioning: `position-area: block-end span-inline-start; position-try-fallbacks: flip-block`.
  - Manual fallback from `getBoundingClientRect` when it isn't supported.
  - Fallback to `hidden` toggling when there's no Popover API.
- **History:**
  - Opening pushes `{ui:"exmenu"}`.
  - `toggle` → closed calls `history.back()` if that state is still current.
  - `popstate` hides the popover.
- **Critical:**
  - `popstate` calls `cancelAsk()`, so an item's action must not call `ask()` until the menu's history step has popped.
  - Items therefore store `pendingMenuAct` and close the menu. The action runs in `popstate`, through a `runExerciseAct(act, xi)` helper.
- **Click-through:** ignore editor clicks within 350 ms of a light dismiss.
- **Remove:** the inline `.menu-grid` and its CSS.
- **Optional:** move the superset logic into tested `workouts.js` helpers.
- **UI test:**
  1. Opens under the button.
  2. A tap outside closes it without triggering anything underneath.
  3. Back closes only the menu.
  4. The Remove confirm stays open (no race).
  5. Near the bottom of the screen it flips upwards.
  6. Superset still works.

### A5. Long-press drag to reorder (M–L). Push before this one.
- **Pure `moveExercise(exercises, from, to, idGen)`:**
  - Dropped between two members of a superset, the card joins it.
  - A card that loses its neighbours leaves its group.
  - A split group gets new ids for its later runs.
  - Groups of one are cleared.
- **Gesture:**
  - Start: a 400 ms hold on `.ex`, but not on inputs, set rows or the trash. Moving 8 px first cancels, so scrolling still works.
  - Lift:
    - blur the input
    - add a dashed pink slot
    - take the card out of flow with a shadow and `scale(1.02)`
    - pointer capture, `vibrate(12)`
  - Move:
    - the slot follows the midpoints of the other cards
    - auto-scroll within 80 px of the edges
    - a non-passive `touchmove` calls `preventDefault` only while dragging
  - Drop:
    - run `moveExercise`
    - re-key `editor.notes` and `cueEdit` by exercise key instead of index
    - `changed()`, then re-render
    - swallow the next click
  - Cancel on `pointercancel`, on the app going to the background, or on `popstate`.
- **Remove:** Move up/down from the exercise menu. The set-order arrows stay. New hint: "Hold an exercise to drag it".
- **DESIGN:** D38 is amended with the superset drop rules. Record why it's hand-rolled and that SortableJS is the fallback.
- **Tests:**
  - **`moveExercise`:**
    - a simple move
    - moving to the same place does nothing
    - a superset member moved away leaves its group, and a group of one is cleared
    - a plain card dropped between two members joins them
    - a split group gets two ids
    - the input isn't mutated
  - **UI:**
    - A → end gives the order B, C, A, also in the saved draft
    - nothing opens after the drop
    - a short touch plus a move scrolls instead of lifting
    - superset joins and leaves work
    - back during a drag doesn't break anything

## Phase 3: Bodyweight tab (L)
- **Entry:**
  - `module=body`, `metric=bodyweight`, `value` as typed, `unit` lb/kg, `data={note}`
  - **id `bodyweight:<YYYY-MM-DD>`, one per day:**
    - Two devices on the same day settle by last write wins instead of duplicating.
    - Logging again the same day asks "Replace 183.0 lb with 182.4 lb?".
  - `recorded_at` is now, or local noon for a past day.
- **Pure `bodyweight.js`:**
  - Ranges: 1W 2W 3W 4W 1M 3M 6M 1Y All. Months are calendar months.
  - `dailySeries`, `inRange`
  - `bwSummary`: latest, highest and lowest with dates, average, change over the range, weekly rate (least squares), this week since Monday, consistency over 28 days
  - an optional smoothed `trend`
- **UI, top to bottom:**
  1. A log card: a big decimal input and a date, with a confirm.
  2. A stock-style header: the latest value with the change over the range, in neutral colours.
  3. The range chips (3M by default, remembered).
  4. An area chart from `core/chart.js`.
  5. Stat tiles.
  6. The last 30 entries. Tapping one edits it, and Delete uses a red confirm.
  - Validation: must be above 0 and at most 1000.
- **Tests:**
  - kg↔lb conversion
  - deleted entries are ignored
  - range edges, including months
  - highest and lowest
  - a −0.5/week line gives a weekly rate of about −0.5
  - `thisWeek` is empty when there's nothing before Monday
  - consistency
  - a stable id
- **UI test:**
  1. The empty state shows.
  2. Logging 150.0 confirms and creates one entry.
  3. One point renders.
  4. Logging again the same day shows the Replace dialog.
  5. Seed 40 days: the range chips change the point count.
  6. Switching to kg converts the values.
  7. Delete removes the entry.
- **Open question:** is one weigh-in per day OK?

## Phase 4: Profile tab (L, 3 commits)
### P1. Heatmap and lifetime stats (M)
- **Header:** the avatar or initials, the name (or "You"), and "Training since …".
- **A 52-week heatmap** in GitHub style, scrolled to today.
  - Fixed levels by working sets: 0, 1–9, 10–19, 20–29, 30+.
  - Tapping a day opens its workout.
  - Underneath: workouts this year, the current and longest streaks in weeks.
- **Lifetime tiles:** workouts, volume, sets, reps, time, PRs, workouts per week, most-trained exercise, bodyweight change.
- **Pure, in `progress.js`:** `calendar`, `level`, `weekStreaks`, each tested.

### P2. Settings sections, name and picture (M)
- **The Settings overlay** (from the gear on Profile, plus a row at the bottom of Profile) gets these sections:
  - Units
  - Rest timer
  - Profile
  - Data
  - About: version, "Icons: Lucide (ISC)". No personal URL.
- **Storage:** one settings entry per field, `setting:display_name` and `setting:avatar`, so two devices can't clobber each other.
- **Picture:** 256×256, centre-cropped, JPEG at 0.8, under 40 KB, stored as a data URL. Confirm before using it, and a red confirm to remove it.
- **Later:** move the picture to real photo storage in step 5.

### P3. Export and import, in `static/core/backup.js` (M)
- **Export:**
  - JSON of every module, `{format:"cortex-export", version:1, …}`
  - a CSV of sets, escaped per RFC 4180
- **Import adds only ids that aren't on the device yet.** `putEntries` stamps `updated_at=now`, so overwriting from a file would let an old backup beat newer edits.
- **Native:** `a[download]` doesn't work in the Capacitor WebView, so a later Filesystem/Share plugin is needed.
- Exports hold personal data and must never be committed.
- **Tests:**
  - an export → import round trip
  - importing the same file twice adds 0
  - invalid files
  - CSV escaping
  - deleted entries aren't exported

## Phase 5: Rest timer (M–L), after A2, A4 and P2
- **Pure `rest.js`:**
  - `restFor`: the exercise's own rest, then the setting, then 90 s
  - `startRest`, `adjust` (±15 s, at least 5 s left), `restState`
  - `shouldAutoStart`: no when it isn't the last member of a superset, and no on the second completion of a row
- **Trigger:** a live row first becoming complete. With no ticking, that's the same moment `r.at` is set. There's also a manual timer button.
- **State:**
  - Kept in the live draft (`draft.rest`), so it survives reloads. It is never written to entries.
  - Each exercise's own rest is `rest_s` on its `_exercise` override. Add it in `library.js`, `saveExerciseDef` and `mergeExercise`.
  - It's set from the popover ("Rest timer: 1:30") and the exercise edit form.
- **`#restbar`:**
  - Sits outside the re-rendered editor.
  - Shows a progress bar, a big m:ss, and −15 / +15 / Skip.
  - At the end: a buzz `[200,100,200]` and a Web Audio beep (the audio context is created on the first tap), then "Rest over", hidden after 10 s.
  - After the app comes back from the background, it recomputes from `until`.
  - The screen stays awake (optional).
- **Native later:** `notifyRestOver(until)` uses local notifications. The web has no scheduled notifications.
- **Tests:**
  - the `restFor` order
  - states at 0%, 50%, 100% and past the end
  - the `adjust` floor
  - superset auto-start: the first member doesn't start it, the last does
  - `resolveExercises` keeps `rest_s`
- **UI test:**
  - The bar shows 1:30, +15 makes it 1:45, Skip hides it.
  - "Rest over" plus the buzz pattern at the end.
  - Superset behaviour.
  - A reload resumes the countdown.
  - Setting an exercise's rest to 3:00 stores `rest_s:180`.

## Order
| # | Item | Needs | Size |
|---|---|---|---|
| 1 | A6 no text selection | – | S |
| 2 | A1 set delete without confirm | – | S |
| 3 | A7 `core/chart.js` + single point | – | S–M |
| 4 | A3 icons + no-emoji test | – | M |
| 5 | A2 no ticking, PR summary | 4 | M–L |
| 6 | A4 popover menu | 4 | M |
| 7 | A5 drag reorder | 6, 1 | M–L |
| 8–9 | Bodyweight (module, then UI) | 3, 4 | M + M |
| 10 | Profile P1 | 4 | M |
| 11 | Profile P2 | 10 | M |
| 12 | Profile P3 export/import | 11 | M |
| 13 | Rest timer | 5, 6, 11 | M–L |

After step 7 the CLAUDE.md queue is empty, so remove it.

## Cross-cutting risks
- **History:**
  - Never call `ask()` in the same tick as a pending `history.back()`.
  - Each new overlay is one `pushState`.
- **Old drafts:** saved live drafts must still load. Treat missing fields as null.
- **Supersets:** drag rules, rest timer auto-start, and the superset menu items.
- **Sync:**
  - deterministic ids for bodyweight
  - one settings entry per field
  - add-only import
  - `rest_s` and cues share one override, so the last write wins between them (an existing limit)

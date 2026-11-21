# Plan: automated testing harness

Part of [the master plan](../PLAN.md). Goal: one command (`npm test`) that test subagents and the owner can run to check every change, with no npm dependencies, using a throwaway server and Edge headless.

## Facts checked (Nov 2026)
- **Browsers:** Edge is at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.
- **Node v24:** built-in `WebSocket`, `fetch`, `node:test` and `node:sqlite`, so no packages are needed.
- **Python venv:** has no pytest or httpx, so API tests are written in Node too.
- **`main.py`:** reads `CORTEX_DB` and `CORTEX_BACKUPS`. It writes a backup at startup, so tests must always set `CORTEX_BACKUPS`.

## Rules for every test server
- A new temp folder holding `test.db` and `bk/`, deleted afterwards.
- A random free port, refusing 8000, bound to `127.0.0.1`, with no `--reload` (orphaned child processes on Windows).
- The helper refuses outright if `CORTEX_DB` resolves to the repo's `cortex.db`.
- A guaranteed kill: `proc.kill()`, then `taskkill /T /F` as a fallback.
- **Canary:** the runner compares the real `cortex.db` mtime and size before and after, and warns if it changed while nothing was on port 8000.

## Layout
```
package.json                 # "type": "module"; scripts below. Capacitor deps join it later.
tests/
  run.mjs                    # unit -> api -> ui; stops if unit fails; --only, --grep; summary + exit code
  AGENT.md                   # prompt template for test subagents
  *.test.mjs                 # existing pure-module tests (unchanged)
  static-guards.test.mjs     # source scans (below)
  api/  sync.test.mjs  entries.test.mjs  migrate.test.mjs
  ui/
    lib/ cdp.mjs browser.mjs page.mjs server.mjs seed.mjs devices.mjs steps.mjs
         fakes/fake-mic.js fakes/capacitor-stub.js
    run-steps.mjs            # node tests/ui/run-steps.mjs steps.json [--device phone|desktop]
    *.ui.test.mjs
    steps/                   # committed smoke step files
    out/                     # gitignored: screenshots, HTML dumps, console logs
```
**Scripts:**
- `test`: `node tests/run.mjs`
- `test:unit`: `node --test tests/*.test.mjs`
- `test:api`
- `test:ui`
- `test:steps`
- `test:clean`: kill orphaned `cortex-test-` Edge and Python processes.

**From PowerShell:** use `npm.cmd test` or `node tests/run.mjs`. `npm.ps1` may be blocked by the execution policy.

**`.gitignore` additions:** `tests/ui/out/`, `node_modules/`, `.test-tmp/`.

## Driver
- **`cdp.mjs`** (about 60 lines): a WebSocket client with `send`/`on` and flat sessions.
- **`browser.mjs`:**
  - Finds the browser: `CORTEX_BROWSER`, then Edge, then Chrome.
  - Launches with `--headless=new --remote-debugging-port=0`, a temp `--user-data-dir`, and these flags:
    - `--use-fake-ui-for-media-stream` (auto-accepts the mic prompt)
    - `--autoplay-policy=no-user-gesture-required`
    - `--mute-audio`
    - `--no-first-run`
  - Reads the port from `DevToolsActivePort`.
  - `newContext()` (`Target.createBrowserContext`) gives a separate IndexedDB, localStorage and service worker. That works as **a second device** inside the same browser.
- **`page.mjs`:**
  - **Navigation and checks:** `goto`, `eval`, `waitFor`, `click`, `clickText`, `text`, `count`, `visible`
  - **Touch input:** `tap`, `longPress(sel, ms)`, `drag(sel, {dy})`, all through `Input.dispatchTouchEvent`
  - **Other actions:** `type`, `shot(name)`, `setOffline(bool)`
  - **Local storage and sync:** `cortex(fn, ...args)` and `syncIdle()`
  - **Errors:** a `page.errors` list
- **`page.cortex()`** runs `(await import("/core/cortex.js"))[fn](...)`. It gets the same module instance the page uses, so tests read local storage and drive sync **without test hooks in app code**.
- **Devices:**
  - `phone` (the default): 412×915, DPR 2.625, touch, Android user agent.
  - `desktop`: 1366×900.
- **Offline:** `Network.emulateNetworkConditions` on the page **and** the service-worker target (via auto-attach). A second mode, "server down", stops the server and restarts it on the same DB and port.
- **Fake mic:** a script that runs before the page loads and replaces `getUserMedia` with an oscillator. `window.__fakeMic.set({freq, gain, partials})` changes the tone, and `{deny:true}` makes it reject with `NotAllowedError`.
- **On failure:** auto screenshot plus `body.outerHTML` into `out/`. Every UI test asserts there were no console errors.

## Seeding
- `entry()` and `workout({at, sets})` factories POST to `/api/sync` before the page opens. Check the `_workout` shape in `workouts.js` first.
- To seed only one device's local storage (unsynced), use `page.cortex("putEntries", …)` while offline.

## API tests (Node `fetch` + `node:test`)
**`sync.test.mjs`:**
- A push comes back in the pull and the cursor goes up.
- The same batch sent twice changes nothing.
- Last write wins: older is ignored, newer replaces, equal is ignored.
- A soft delete shows in pulls and is hidden from `GET /api/entries`.
- `since > cursor` resends everything.
- A `UNIQUE(source, external_id)` clash is listed in `rejected` without blocking the batch.
- Timestamps are made canonical (stored in UTC).
- Bad input returns 422 (short `client_id`, more than 2000 entries, `since:-1`).
- Two clients interleaving pushes converge.
- 20 concurrent pushes get unique, gap-free revs.

**`entries.test.mjs`:**
- A duplicate POST returns 409, and DELETE of a missing id returns 404.
- `/api/metrics` is ordered by most recent.
- `/sw.js` has no `__VERSION__` placeholder left and sends `no-cache`.
- `/api/version` is 12 hex characters.

**`migrate.test.mjs`:** builds a pre-sync DB with `node:sqlite`, starts the server on it, and checks the rows are backfilled and the backup landed in `CORTEX_BACKUPS`.

## First UI tests
- **home:** tiles and links work on phone and desktop, with no console errors.
- **lifting-log:**
  1. Start a workout, pick an exercise, type weight and reps, finish.
  2. The workout appears in the list.
  3. The local entries are right.
  4. After sync, the server has them.
- **lifting-offline:**
  1. Let the service worker install.
  2. Go offline and reload: the shell still loads.
  3. Log a workout: the outbox has pending entries and the server has none.
  4. Go online: it syncs. Repeat in "server down" mode.
- **sync-two-devices:**
  - A logs and B sees it.
  - A deletes and B loses it.
  - Both edit the same `_exercise` offline: the later edit wins on both.
  - An unsent local edit survives an incoming remote change.
- **tuner:**
  - The fake mic at 110 Hz shows A and "in tune"; at 113 Hz it shows sharp.
  - Deny shows the blocked-mic help.
  - A custom tuning saves as a `_tuning` entry.

## Static guards (fast source scans)
- No `fetch("/api` outside `core/cortex.js`. `/api/version` in `lifting/app.js` is allow-listed until the Android work fixes it.
- Every file a page imports is in `sw.js` `SHELL`, otherwise offline use breaks silently.
- `core/cortex.js` has no DOM code (D13).
- Later: `capacitor.config.json` has `webDir: "static"` and no committed `server.url`.

## Step files (quick visual checks)
```json
{ "url": "/lifting/", "device": "phone", "seed": "tests/ui/fixtures/two-workouts.json",
  "steps": [ {"wait": "#view-log"}, {"click": "#gear"}, {"type": ["#weight", "100"]}, {"offline": true},
             {"cortex": ["getStatus"], "expect": {"pending": 0}}, {"shot": "settings"} ] }
```
`run-steps.mjs` starts its own throwaway server and browser and kills both at the end.

## Test subagent prompt (`tests/AGENT.md`)
- **Scope:** verify the change, don't edit app code, and don't commit.
- **Steps:**
  1. Run `node tests/run.mjs`.
  2. Run or write a step file for the changed screens on "phone".
  3. Open the PNGs and check the layout: overflow, clipped text, tap targets at least 44 px, pink accent.
- **Safety:** never use port 8000, never point at `cortex.db` or `backups/`, and run `npm run test:clean` if anything is left over.
- **Report:**
  - PASS or FAIL per group
  - for each failure: the test, the assertion, the screenshot path and a diagnosis
  - console errors
  - a list of things that "need the owner on the phone"

## Once the Android app exists
- `static/` stays the web dir, so UI tests test exactly what ships in the APK.
- **"Shell mode" fixture:**
  - A second origin serves `static/`, standing in for `https://localhost`.
  - `capacitor-stub.js` injects `window.Capacitor` and fake plugins.
  - The server-address setting is preset.
  - It catches a missing CORS header, relative `/api` fetches, and the service worker registering in native.
  - `main.py` reads allowed origins from `CORTEX_CORS_ORIGINS` (default `https://localhost`).
- **Plugins:** every plugin call goes through one wrapper module per feature (e.g. `static/audio/native.js`), so the fakes swap in cleanly.
- **`npm run test:android`:** Kotlin JVM unit tests (`gradlew testDebugUnitTest`). Skipped when there's no SDK.
- **`npm run test:device` (opt-in):**
  - `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
  - The same driver then controls the real app on the phone, for smoke checks.

## DESIGN entry
- **Automated tests:** a Node + CDP harness with no dependencies and a throwaway server.
- **Trade-off:** Chromium only, and real-device behaviour isn't covered.

## Effort
| Part | Size |
|---|---|
| Driver, server helper and runner | M (about a day) |
| API tests | S |
| First UI tests | M |
| Static guards | S |

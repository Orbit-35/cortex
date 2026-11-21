# Plan: the native Android app

Part of [the master plan](../PLAN.md). The research is in [docs/research/android-app.md](../research/android-app.md).
- **Approach:** Capacitor 8, with the pages **bundled into the APK** (Option B).
- **Origin:** the app runs at `https://localhost`.
- **Sync:** it syncs to the PC over Tailscale when it can reach it.

## Problems found in the code
1. **Folder links open the launcher.** Capacitor's local server only serves `index.html` for `/`. For any path without a dot it serves the root `index.html`, so `/lifting/` and `/guitar/` would open the launcher.
   - Fix (native only): rewrite link taps from `X/` to `X/index.html`.
2. **Fetches and service worker registration outside `cortex.js`:**
   - `lifting/app.js:1169` calls `/api/version` directly.
   - The service worker is registered inline in lifting and in `ui.js keepUpdated()`.
   - Lifting's `showVersion()` reads `caches.keys()`, which is empty in the app.
3. **`.gitignore` patterns `raw/`, `data/` and `exports/` match at any depth**, so `raw/` would hide `android/.../res/raw/`. Anchor them as `/raw/`, `/data/` and `/exports/`.
4. **Every new core file must be in the `sw.js` SHELL.** Enforce it with a test.
5. **DESIGN says "CORS + login" before a native shell.**
   - This plan does CORS only.
   - The tailnet stays the only boundary (single user).
   - Record that in DESIGN.
6. **In PowerShell 5.1, `curl` is `Invoke-WebRequest`.** Commands must use `curl.exe`.

## Owner's steps, in order (with checkpoints)
1. **Check the basics:**
   - `node -v` shows v22 or newer.
   - `Get-PSDrive C` shows at least 15 GB free.
   - `Get-ExecutionPolicy -Scope CurrentUser`: if it says `Restricted`, run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
2. **Install Android Studio:**
   - Run `winget install --id Google.AndroidStudio -e`, open it, choose the Standard setup and accept every licence. It downloads 3–5 GB.
   - Help > About should say Otter 2025.2.1 or newer.
   - In SDK Manager:
     - SDK Platforms: Android 16 (API 36).
     - SDK Tools: Build-Tools 36, Platform-Tools and Command-line Tools.
   - **Check:**
     ```powershell
     Test-Path "$env:LOCALAPPDATA\Android\Sdk\platforms\android-36"            # True
     Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"       # True
     ```
3. **Set the environment variables:**
   ```powershell
   $sdk = "$env:LOCALAPPDATA\Android\Sdk"
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", $sdk, "User")
   [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
   $p = [Environment]::GetEnvironmentVariable("Path", "User")
   if ($p -notlike "*Android\Sdk\platform-tools*") { [Environment]::SetEnvironmentVariable("Path", "$p;$sdk\platform-tools", "User") }
   ```
   - **Close VS Code and every terminal**, then reopen them.
   - **Check:** `adb version` and `& "$env:JAVA_HOME\bin\java" -version` (it should say openjdk 21).
4. **Phone (Samsung, Android 13):**
   - Settings > About phone > Software information > tap **Build number** 7 times.
   - Developer options > **USB debugging** on.
   - Connect a **data** cable. Accept "Allow USB debugging" and tick "Always allow".
   - **Check:** `adb devices` shows `device`.
     - If it shows `unauthorized`, accept the prompt again.
     - If the list is empty, install the Samsung USB driver or try another port.
     - If "Auto Blocker" is on, turn it off.
5. **Tailscale on the phone:** connected. If `*.ts.net` names stop working, set Private DNS to Off or Automatic.
6. **Before the first install:** in the Chrome PWA, finish or cancel any live workout. The sync pill should say "synced".
7. **First build:**
   - Run `npm install`, then `npx cap doctor` (it should say Android is "looking great"), then `npm run android`.
   - The first build takes 10–15 minutes. It should end with "BUILD SUCCESSFUL" and "Installed on 1 device".
   - If Play Protect warns, tap More details > Install anyway.
8. **Back up the signing key**, kept outside the repo:
   ```powershell
   Copy-Item "$env:USERPROFILE\.android\debug.keystore" "<backup folder>\cortex-debug.keystore"
   ```
   **Why:** a different key means the app has to be uninstalled before it can be reinstalled, and that wipes its data.
9. **In the app:**
   - Type the `https://…ts.net` address into the first-run "Server address" screen, tap Test, then Save.
   - Type it **only on the phone**, never into a repo file.
   - `tailscale serve status` on the PC shows the address.
10. **Debugging:** open `edge://inspect/#devices` and inspect "WebView in dev.cortex.app".

## Repo commits
- **C1: Node tooling and config (S).**
  - **`package.json`:** private, MIT, no author. Dependencies: `@capacitor/core`, `@capacitor/android`, `@capacitor/app`, `@capacitor/haptics`. Dev dependencies: `@capacitor/cli`, `@capacitor/assets`. Commit the lock file.
  - **`capacitor.config.json`:**
    ```json
    { "appId": "dev.cortex.app", "appName": "Cortex", "webDir": "static", "backgroundColor": "#111418",
      "server": { "androidScheme": "https", "hostname": "localhost" },
      "plugins": { "SystemBars": { "insetsHandling": "css", "style": "DARK" } } }
    ```
    - **The appId is permanent**: changing it makes a new app with empty storage.
    - `androidScheme` and `hostname` are pinned because the CORS allow-list depends on the exact origin.
    - **Never** a `server.url`.
  - **`.gitignore` additions:**
    - `node_modules/`
    - `android/app/build/`, `android/build/`, `android/.gradle/`, `android/.idea/`
    - `local.properties`
    - the copied web assets under `android/app/src/main/assets/`
    - `*.apk`, `*.aab`, `*.jks`, `*.keystore`, `keystore.properties`
    - and anchor `/raw/`, `/data/`, `/exports/`
- **C2: `npx cap add android` (M; a big but mechanical diff).**
  - Committed untouched, so later diffs show only our edits.
  - Check that no `local.properties` and no `assets/public` are tracked.
- **C3: manifest and theme (S).**
  - Permissions: `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, and the microphone feature with `required="false"`.
  - `android:allowBackup="false"`: the server is the backup, and this keeps data out of Google Drive.
  - No cleartext traffic.
  - Dark bars (`#111418`). No edge-to-edge on Android 13.
  - Capacitor's `BridgeWebChromeClient` already shows Android's mic prompt, so no Java is needed.
- **C4: CORS in `main.py` (S).**
  ```python
  from fastapi.middleware.cors import CORSMiddleware
  CORS_ORIGINS = [o for o in os.environ.get("CORTEX_CORS_ORIGINS", "https://localhost").split(",") if o]
  app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS,
                     allow_methods=["GET", "POST"], allow_headers=["Content-Type"], max_age=86400)
  ```
  - No wildcard and no credentials. Same-origin PWA requests are unchanged.
  - **CORS is not auth:** the tailnet stays the boundary.
- **C5: `static/core/shell.js`, `apiBase` everywhere, no service worker in the app (M; the core of the work).**
  - **`shell.js`** is imported first by every page.
  - **`isNative`, and `plugin(name)`** via `window.Capacitor.Plugins` (no bundler).
  - **Server address:**
    - stored in `localStorage["cortex:server"]`
    - checked by a pure `normalizeServerUrl`: https only, no path
    - passed to `cortex.configure({apiBase})`
  - **Link rewrite**, native only.
  - **Back button:**
    ```js
    App.addListener("backButton", ({ canGoBack }) => {
      if (location.pathname === "/" || location.pathname === "/index.html" || !canGoBack) App.minimizeApp();
      else history.back();
    });
    ```
    `history.back()` keeps every existing popstate behaviour (overlays, `cancelAsk`, the discard check). The app minimises rather than exiting, so a live workout survives.
  - **Wrappers:**
    - `buzz(pattern)`: Haptics in the app, `navigator.vibrate` on the web.
    - `keepAwake()`: `navigator.wakeLock`, with a keep-awake plugin only if the phone test fails.
    - Guitar's counted `holdAwake` uses this underneath; see [guitar.md](guitar.md).
  - **`cortex.js`:**
    - `apiBase: null` means "no server", and sync is skipped quietly.
    - `getStatus().configured`.
    - A new `serverVersion()` replaces lifting's direct `/api/version` fetch.
  - **`ui.js`:**
    - `keepUpdated()` returns early in the app.
    - New `askServer({firstRun})` sheet with Test and Save, plus "Use offline for now", since the app is local-first.
  - **Pages:**
    - **Launcher:** shows the first-run server sheet, and a native-only "Server" link.
    - **Lifting:**
      - service worker registration guarded by `!isNative`
      - `showVersion()` compares the bundled `version.json` with the server's version ("A newer build is on the PC: reinstall")
      - a "Server: … Change" settings row
      - the sync pill shows "not set up"
    - **Guitar:**
      - `buzz` and `keepAwake`
      - the mic-blocked text points to Android Settings > Apps > Cortex
  - **`sw.js`:** add `shell.js` to the SHELL.
  - **`tests/shell.test.mjs`:** `normalizeServerUrl`, plus every static file is in the SHELL.
- **C6: safe-area variables (S).** Every `env(safe-area-inset-X)` becomes `var(--safe-area-inset-X, env(safe-area-inset-X))`:
  - 7 in lifting
  - 3 in guitar
  - 1 in home
  - 2 in `ui.js`
  - Nothing changes in Chrome. It's ready for edge-to-edge later.
- **C7: icon and splash (S).**
  - 1024 px icon sources in `assets/`, with the motif in the central 66%, plus a 2732 px splash.
  - Run `npx @capacitor/assets generate --android --iconBackgroundColor "#111418" --splashBackgroundColor "#111418"`.
- **C8: build scripts (S).**
  - `scripts/stamp-version.mjs` writes `{version: app_version()}`, taken from Python, into the copied assets after `cap copy`.
  - npm scripts:
    - `android:build` = `cap sync android && node scripts/stamp-version.mjs`
    - `android` = build, `gradlew installDebug`, then `adb shell am start -n dev.cortex.app/.MainActivity`
    - `android:apk`, `android:open`, `android:logs`, `android:uninstall`
  - Each round trip takes about 1 minute after the first build.
- **C9: moving data from the PWA (a procedure).**
  1. Finish or cancel any live workout in Chrome, since it doesn't transfer.
  2. The pill says "synced".
  3. Install the app and set the server; it pulls everything.
  4. Compare the Progress tiles between the two.
  5. Re-pick the per-device preferences (tuning, A4).
  6. Keep the PWA for about 2 weeks as a fallback.
- **C10 (later, optional): self-hosted live updates** with Capawesome (MIT):
  - The server builds a zip of `static/` on the fly. `GET /api/app-bundle` returns `{version, min_native}`.
  - It rolls back if the new version doesn't call `ready()`.
  - Only web files update this way. New plugins or permissions still need a reinstall.

## What stays the same in Chrome
- Everything native is gated on `isNative`.
- The web `apiBase` stays `""`.
- The service worker logic is only guarded, not changed.
- The CSS fallback resolves to the same `env()` values.
- The PWA URLs are unchanged.
- CORS only adds headers for `https://localhost`.
- `buzz` and `keepAwake` fall back to today's calls.
- `cap sync` only copies out of `static/`.

## Testing
**On the PC (test subagents):**
1. Unit tests, including `shell.test`.
2. **CORS** against a throwaway server (`CORTEX_DB` and `CORTEX_BACKUPS` in the scratchpad, port 8765):
   - `curl.exe -i -X OPTIONS …/api/sync -H "Origin: https://localhost" -H "Access-Control-Request-Method: POST"` → 200 with the allow-origin header.
   - The same request from `https://evil.example` → 400, with no header.
   - A POST without an Origin → 200, with no header.
3. **A fake `https://localhost` in Edge headless:**
   - **Setup:**
     - A copy of `static/` served over HTTPS with a throwaway cert, using **Capacitor's routing rule**, so the folder-link bug would show up.
     - A `window.Capacitor` stub that records calls.
     - Edge started with `--ignore-certificate-errors`.
   - **Checks:**
     - The server sheet appears, rejects `http://` and accepts `https://`.
     - The Lifting tile opens lifting.
     - No service worker is registered.
     - A real cross-origin sync to uvicorn with TLS works.
     - Plain PWA mode still installs the service worker and works offline.
     - Back calls `history.back()` on pages and `minimizeApp()` on the launcher.
4. **After the owner's steps 2–3:**
   - `npx cap doctor` and `npm run android:apk` succeed.
   - `apkanalyzer` lists the mic, audio-settings and vibrate permissions, and `version.json` is in the APK.
   - `git status` shows no build output or keys.
5. **Optional, with the phone on USB:** forward the app's WebView DevTools socket with `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`. The same driver then checks IndexedDB counts against the PWA.

**On the phone (owner checklist):**
- [ ] **Install:** the icon, the dark splash, and it opens on the launcher.
- [ ] **Server screen:** Test works with Tailscale on and gives a clear error with it off. After Save, the pill says synced.
- [ ] **Data:** it matches the PWA (Progress tiles, an old workout, custom exercises and tunings).
- [ ] **Offline:** log a set in flight mode and it shows "1 pending". Flight mode off and it's synced, and it shows in the PWA.
- [ ] **Tuner:**
  - Android's own mic prompt for Cortex appears.
  - "Only this time" works.
  - The mic is released after Home.
  - The screen stays awake for more than 2 minutes.
- [ ] **Haptics:** they work.
- [ ] **Back gesture:**
  - It closes overlays in order.
  - "Discard?" shows on a dirty edit.
  - It closes the guitar sheets.
  - It goes from a page to the launcher, then minimises the app.
- [ ] **Live workout:** survives swipe-closing the app.
- [ ] **Screen edges and keyboard:** the bars are dark, nothing hides under them, and the keyboard doesn't cover inputs.
- [ ] **Long-press:** no pull-to-refresh and no text selection, but inputs are still selectable.
- [ ] **Settings:** the version row and "Server … Change" work.
- [ ] **The Chrome PWA:** still works, updates and works offline.

## Risks and rollback
- **Folder links:** new module links must end in `/` (rewritten) or name `index.html`. A test catches this.
- **Lost signing key:** back it up (step 8), and always sync before uninstalling.
- **The appId is permanent.**
- **CORS isn't auth:** accepted while single-user and tailnet-only. Login is needed before any public exposure.
- **App and server drift:** the sync contract must stay backward compatible, and the Settings version row shows drift.
- **Later platform changes:**
  - Capacitor 9's `ACCESS_LOCAL_NETWORK`.
  - Android 15 edge-to-edge (C6 prepares for it).
  - If the WebView ever blocks 100.x addresses, use `CapacitorHttp`.
- **Rollback:**
  - On the phone: sync, then `npm run android:uninstall`. The PWA is untouched.
  - In the repo: commits are independent. C4 is harmless to keep, and C5/C6 are gated.
  - Deleting `android/`, `package*.json` and `capacitor.config.json` gets back to a plain PWA.
- **Push before C2 and before C5.**

## DESIGN entries
**New:**
- **Android app:** Capacitor 8 with bundled pages, `android/` committed, a permanent appId, the launcher as start page, server-URL mode for development only, `allowBackup=false`, the mic permission owned by Cortex.
- **CORS:** an exact allow-list. Not auth; D16 holds.
- **Server address:** a per-device setting entered on a first-run screen, never in the repo. `null` means local-only.
- **`core/shell.js`:** every browser-vs-app difference lives here (no service worker, link rewrite, back rule, buzz and keepAwake, safe-area variables).
- **App version and updates:** the stamped `version.json`, a reinstall over USB, the backed-up key.
- (Later) live updates.

**Mark:**
- **D36:** the native part is superseded; the rest applies to the web only.
- **D42:** the native start page is the launcher.
- **D43:** "Known limit" resolved in the native app.
- **D13:** CORS done, auth open.
- **"Future: standalone apps":** Android decided.
- **Open questions:** app/server protocol compatibility.

**Also update:** CLAUDE.md (the `shell.js` rule, `npm run android`, the roadmap) and IDEAS.md Platform.

## Effort
| Step | Size |
|---|---|
| Owner setup | about 1.5 h, mostly downloads |
| C1 tooling and config | S |
| C2 `cap add android` | M |
| C3 manifest and theme | S |
| C4 CORS | S |
| **C5 shell.js and page changes** | **M** |
| C6 safe-area variables | S |
| C7 icon and splash | S |
| C8 build scripts | S |
| PC tests | M |
| Phone checklist | 30 min |

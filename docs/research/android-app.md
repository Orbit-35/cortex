# Research: native Android app (Capacitor), Nov 2026

Research notes, not decisions. A decision goes into DESIGN.md when we build it.

## Versions
- Capacitor **8** (8.6.x is the latest stable; 9 is only a release candidate).
- Needs Node 22+ (the PC has 24), Android Studio Otter 2025.2.1+ (brings its own JDK), minSdk 24, compile/target SDK 36. Android 13 (API 33) is fine.
- Capacitor 9 later: minSdk 26, target 37, and a new `ACCESS_LOCAL_NETWORK` permission (check that it doesn't affect Tailscale).

## Load from the server, or bundle the pages? Bundle them (Option B)
- **Option A, `server.url` = the Tailscale address:** the Capacitor docs say it is for live-reload during development, not production.
  - No PC means no app, which breaks local-first.
  - Once `sw.js` controls the page, Capacitor's bridge is no longer injected, so native plugins silently disappear.
  - Still handy for a quick dev session: `npx cap run android --live-reload`.
- **Option B, bundle `static/` into the APK:** the app runs at `https://localhost` and works offline. IndexedDB stays in app storage until the app is uninstalled.
  - Sync goes to the server through `configure({ apiBase })`, which is already in `cortex.js`.
  - Needs FastAPI `CORSMiddleware` with `allow_origins=["https://localhost"]` (Tauri will need this too). The alternative is `CapacitorHttp`.
  - Don't register the service worker inside the app (`if (!window.Capacitor)`); the APK already holds the files.
  - Every change means `npx cap sync android` plus a reinstall, about a minute over USB.
- **Live updates later, if rebuilding gets annoying:** the Capawesome Live Update plugin is MIT, free and can be self-hosted (FastAPI serves a zip of `static/`, with rollback). Ionic Appflow is closed to new customers.

## Code changes needed for Option B
- Fetches outside `cortex.js` that use relative `/api/...` paths must go through `apiBase` (for example `/api/version` in `lifting/app.js`).
- Skip `sw.js` registration in the native shell (`ui.js` `keepUpdated`, `lifting/app.js`).
- The server address lives in a setting typed once in the app, or in a gitignored config file. **Never in the repo.**
- Pad for the system bars with `var(--safe-area-inset-top, env(safe-area-inset-top))`. Capacitor 8's SystemBars plugin injects these variables.

## Microphone
- Capacitor 8's `BridgeWebChromeClient` turns the WebView's mic request into Android's permission prompt automatically.
- Add to `AndroidManifest.xml`:
  ```xml
  <uses-permission android:name="android.permission.RECORD_AUDIO" />
  <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
  ```
- "Ask every time" then applies to Cortex itself, and the prompt really appears.
- The tuner already turns off echo cancellation, noise suppression and auto gain. Use `ctx.sampleRate`, and start/resume the AudioContext from a tap.

## Steps (PowerShell)
1. Install Android Studio, Standard setup. In SDK Manager, add API 36, Build-Tools, Platform-Tools and Command-line Tools.
2. Set the environment variables, then open a new terminal:
   ```powershell
   [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
   [Environment]::SetEnvironmentVariable("JAVA_HOME", "C:\Program Files\Android\Android Studio\jbr", "User")
   $p = [Environment]::GetEnvironmentVariable("Path","User")
   [Environment]::SetEnvironmentVariable("Path", "$p;$env:LOCALAPPDATA\Android\Sdk\platform-tools", "User")
   ```
3. Add Capacitor:
   ```powershell
   npm init -y
   npm i @capacitor/core@8 @capacitor/android@8
   npm i -D @capacitor/cli@8
   npx cap init Cortex <app id> --web-dir static
   ```
   Add `node_modules/` to `.gitignore`.
4. `npx cap add android`, then add the two mic permissions to the manifest.
5. On the phone, enable USB debugging: Settings > About phone > Software information > tap Build number 7 times, then Developer options > USB debugging. Check that `adb devices` lists the phone.
6. Build and install: `npx cap sync android; npx cap run android`. Debug the app from the PC at `chrome://inspect`.
7. Icons: put the PNGs in `assets/`, then run `npx @capacitor/assets generate --android`.

## Pitfalls
- The app's storage is new and empty. Let the Chrome PWA sync fully (empty outbox) first; the app then pulls everything from the server.
- Uninstalling the app wipes unsynced data.
- Tailscale must be connected on the phone for sync to work. Android "Private DNS" can break MagicDNS names; set it to Off or Automatic if names stop resolving.
- The `tailscale serve` certificate is a real one, so the WebView trusts it.

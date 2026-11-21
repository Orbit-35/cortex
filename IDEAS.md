# Cortex ideas

Future modules and features. Nothing here is decided or scheduled. When an idea gets built, its decisions go into `DESIGN.md` and it moves to the roadmap in `CLAUDE.md`. Each idea has a short **How it could work** note, so the first real question is already answered when we pick it up.

Most ideas fit the existing core: a module is a page plus a naming convention on the `entries` table (DESIGN D1), and it gets offline use, sync and backups for free.

## Fitness (lifting, extensions)

- **Rest timer:** starts when a set is ticked, buzzes when rest is over. Per-exercise default rest. *How:* lives in the live-workout screen. A notification when the app is in the background needs the native Android app (Capacitor).
- **Photos and posts:** a journal of posts with pictures, notes and an optional attached workout; progress photos per workout. *How:* needs file storage (server folder + upload queue on the phone, compressed to about 200-400 KB each, never in git). About 50-100 MB a year at one photo per workout.
- **Profile:** GitHub-style calendar of workouts, profile picture, lifetime stats.
- **Bodyweight:** stock-style chart (1 week to all time), highest/lowest/average, weekly change, weigh-in consistency, recent entries.
- **Bring in old history:** Stronger has no export. Options: a one-time "starting baseline" of lifetime totals, typing PRs as past workouts, or an importer if an export ever appears. Health Connect doesn't store per-set weights, so it can't carry the history.
- **Warm-up sets:** mark sets as warm-ups so they don't count toward volume and PRs.
- **Routines/templates:** save a workout as a template ("Push day") and start from it.

## Notes and clipboard

A quick place for notes and ideas that also works as a **shared clipboard between phone and PC**, without Phone Link (which drains battery on both devices and is slow to turn on and off).

- **Notes/ideas:** quick capture, searchable, synced, works offline.
- **Send text from phone to PC:**
  - *Share menu:* "Share → Cortex" from any app. An installed web app can register as a share target on Android, so this works before the native app exists.
  - *Text-selection menu:* "Cortex" as an option when you select text, like Copy and Translate. Needs the native Android app (Capacitor), because it's a native "process text" action.
- **Send text from PC to phone:** a global keyboard shortcut (macro) that sends the current selection or clipboard to Cortex. Needs the Windows desktop app (Tauri), or an AutoHotkey script calling Cortex's API as a stopgap.
- **Cortex clipboard: opt-in, not automatic.** Windows' clipboard history (**Win + V**) records everything you copy, on that PC only; it stays on as the local "undo" for re-pasting something old. Cortex's clipboard only holds what you **choose** to send (via the shortcut or the share menu), and that's what syncs to your other devices. Choosing makes it a curated list rather than a firehose, and keeps passwords and other things you copy out of Cortex.
- **In the Windows app:** a clipboard panel listing what you've sent from any device, newest first, with one click or a shortcut to copy an item back. Pin items you reuse, delete ones you don't.
- *How:* a `clips`/`notes` module on `entries`. Sync already moves data between devices within seconds when both are online; instant push to the other device would need a live connection (WebSocket) later.

## Ratings

Rate and remember **movies, shows, books, albums, restaurants**, and anything else.

- Score, date, notes, maybe tags ("rewatch", "recommend to …").
- Look up details automatically from free sources: films/TV from TMDB, books from Open Library, albums from MusicBrainz (with cover art), restaurants by name/location.
- Lists: favourites, want-to-watch/read/listen/visit, ranked lists per year.
- *How:* `module=ratings`, `metric=<movie|book|album|restaurant|…>`, `value`=score, `data`={title, external ids, notes}. Importers could bring in Letterboxd or Goodreads exports (both offer CSV).

## Audio and ear care

Control audio precisely, track listening, and protect hearing. Research notes: `docs/research/audio.md`.

- **A better volume slider:** Android's volume moves in about 15-25 fixed steps, and each step is a bigger jump than it feels (loudness is logarithmic). Goal: a **continuous slider in decibels**, so you can set an exact level you know is safe and still right for the situation.
- **Same loudness across headphones:** earbuds and over-ear headphones need different slider positions for the same loudness. It's less about distance than about **sensitivity** (how loud a headphone plays from the same signal) and **seal/fit** (in-ear blocks outside noise, open headphones leak).
  - Each pair gets a **calibration offset in dB**, set once by ear or from published sensitivity figures.
  - Cortex detects which pair is connected (Bluetooth name) and applies its offset, so "70 dB" sounds the same on every pair.
  - Offsets will be tuned by hand by testing.
- **Safe calibration mode:** while testing and tuning a pair's offset (not during normal listening), volume is capped at a safe level.
  - Testing starts **quiet** and steps up in small increments, never jumping.
  - The cap is applied after the offset being tested, so a wrong or mistyped number can't produce a loud blast mid-test.
  - Normal listening has no Cortex cap; Android's own "high volume" warning still applies as usual.
- **Listening stats and sound dose:** time listened, average level, and a daily/weekly "dose" against safe-listening guidance (WHO/EU safe-listening limits, roughly 80 dB for 40 hours a week).
  - Android has a built-in sound-dose meter on newer versions, but it isn't available on Android 13, so Cortex would estimate it from volume level × time × headphone offset.
- *How:* needs the **native Android app**. Fine-grained volume can come from combining the system's steps with an extra digital gain stage (some existing apps do this through Android's audio-effects API). Stats need a background service. Real exact dB SPL needs per-headphone calibration; without it, levels are relative ("+3 dB louder than usual").

## Guitar

Research notes for songs and the practice log: `docs/research/guitar-songs-practice.md`.

- **Tuner, no ads (built, DESIGN D43):** listens through the microphone and shows the note and how many cents sharp or flat. Standard tuning plus drop D, half-step down and custom tunings. *How:* works as a web page today, using the microphone and a pitch-detection algorithm (YIN or autocorrelation). Offline, private, no ads. One of the easiest ideas on this list.
- **Songs + practice log (next, build together):** guitar gets bottom tabs (Tuner, Songs, Practice).
  - *Song:* status (Can play / Learning with a progress level / Want to learn), tuning (incl. custom) + capo with a tap to switch the tuner, links (tabs, lessons), notes, and later a Spotify link.
  - *Practice session:* duration, what you worked on, which songs, notes; streaks and totals. Same pattern as workouts.
- **Spotify (researched Nov 2026):** since Feb 2026, a Development Mode app needs the developer's account to have **Spotify Premium**, allows at most **5 users**, and loses some endpoints (new releases, artist top tracks, other users' profiles…). Reading and creating your own playlists still works (some playlist fields were renamed in the Feb 2026 migration). Enough for a personal "Can play / Learning" playlist sync; opening it to many users would need Spotify's extended quota. Login uses OAuth (PKCE), so the server must keep the refresh token out of the repo.

## Media (needs more thought)

- **Media inbox / manager:** a dashboard of new clips and voice memos. Sorting stays manual, but fast: see what's new, preview, rename, then move to a folder or make a new one with a tap or two, instead of digging through the file manager.
  - *How:* on Android it needs the native app to read and move files in the gallery and recordings. On the PC, Chrome and Edge can work with a chosen folder directly (File System Access API), so a PC version could come first. Also needs a decision on whether files stay on each device or go through the server (storage size matters for video).
  - *Open questions:* which folders it watches, whether files sync between devices or only get sorted where they are, and naming rules (e.g. date + tag).
- **Quick video trimmer (maybe):** cut the start/end or a middle section and save a smaller file.
  - *How:* ffmpeg. "Trim without re-encoding" is near-instant and lossless but cuts at the nearest keyframe (can be off by up to a second or two). "Re-encode" cuts exactly and can shrink the file (lower resolution/bitrate) but takes longer. Can run on the PC/server; on the phone it needs the native app.
- **YouTube → MP3/MP4, no ads:** paste a link, pick audio or video and quality, get the file. Runs on your own server, so no shady sites.
  - *How:* `yt-dlp` (the widely used open-source downloader) plus ffmpeg for converting, called by the server; the file appears in Cortex to save. Works from the phone's share menu ("Share → Cortex" on a YouTube link).
  - *Note:* YouTube's terms only allow downloading where YouTube offers it or you have rights to the content (your own uploads, Creative Commons, etc.), so treat it as a personal tool for that. It also needs `yt-dlp` updated now and then, as YouTube changes often break it.

## Earlier roadmap ideas

- **Body/food:** meals, calories/protein, maybe barcode lookup.
- **Video challenge** (details to be written down).
- **Importers:** each app's export → entries (DESIGN D2), raw files kept in `raw/`.

## Platform

- **Standalone apps:** Android (Capacitor) and Windows (Tauri) over the same core.
  - *Android research (Nov 2026):* Capacitor 8 needs Android Studio Otter (2025.2.1+), which brings its own JDK 21; Android 7+ (our phone is 13). Not installed on the PC yet (~10 GB). The app gets its **own** microphone permission (manifest `RECORD_AUDIO`, granted through the WebView's permission request), so "Ask every time" works for Cortex itself. getUserMedia needs a secure origin: either bundled files (`https://localhost`) or `server.url` pointing at the HTTPS Tailscale address; plain HTTP breaks the mic. Option A, `server.url` = Tailscale address: updates are instant like the web app, but the first launch needs the PC reachable. Option B, bundled files: works fully offline, needs CORS on the API and a rebuild/reinstall per change. **Update (later research, Nov 2026): go with B.** A breaks offline use and clashes with the service worker (plugins vanish); Capacitor documents `server.url` as development-only. Full notes: `docs/research/android-app.md`. See DESIGN.md, "Future: standalone apps". Several ideas above (text-selection menu, PC shortcut, audio control, rest-timer notifications) need these.
- **Login and other people:** accounts, each person's data kept separate. Needed before anyone else uses Cortex and before the standalone apps can sync.
- **Always-on server:** Raspberry Pi or a hosted server, so sync doesn't depend on the PC being on.

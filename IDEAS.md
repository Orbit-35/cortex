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

Control audio precisely, track listening, and protect hearing.

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

- **Tuner, no ads:** listens through the microphone and shows the note and how many cents sharp or flat. Standard tuning plus drop D, half-step down and custom tunings. *How:* works as a web page today, using the microphone and a pitch-detection algorithm (YIN or autocorrelation). Offline, private, no ads. One of the easiest ideas on this list.
- **Song lists:** songs you can play, songs you're learning (with progress, notes, tabs/links), and a wishlist, linked to **Spotify** playlists. *How:* Spotify's API (log in once with your account) can create and read playlists, so "Can play" and "Learning" could be real playlists you listen to.
- **Practice log:** minutes practised, what you worked on, streaks. Same pattern as workouts.

## Earlier roadmap ideas

- **Body/food:** meals, calories/protein, maybe barcode lookup.
- **Video challenge** (details to be written down).
- **Importers:** each app's export → entries (DESIGN D2), raw files kept in `raw/`.

## Platform

- **Standalone apps:** Android (Capacitor) and Windows (Tauri) over the same core. See DESIGN.md, "Future: standalone apps". Several ideas above (text-selection menu, PC shortcut, audio control, rest-timer notifications) need these.
- **Login and other people:** accounts, each person's data kept separate. Needed before anyone else uses Cortex and before the standalone apps can sync.
- **Always-on server:** Raspberry Pi or a hosted server, so sync doesn't depend on the PC being on.

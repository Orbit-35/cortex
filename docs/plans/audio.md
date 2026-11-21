# Plan: Audio and ear care

Part of [the master plan](../PLAN.md). The research is in [docs/research/audio.md](../research/audio.md). Everything here needs the [Android app](android.md) first.

## Architecture (all phases)
- **Native (Kotlin)**, in `android/app/src/main/java/<app id path>/audio/`:
  - `AudioPlugin.kt`: the Capacitor bridge, `@CapacitorPlugin(name="Audio")`.
  - `ListenService.kt`: the foreground service.
  - `SegmentRecorder.kt`: pure, unit-tested.
  - `SegmentStore.kt`: append-only JSONL in `filesDir`.
  - `GainController.kt` (phase 3), `Calibrator.kt` (phase 4), `Lab.kt` (phase 0, debug only).
- **Web**, in `static/audio/`:
  - `index.html` and `app.js`.
  - Pure modules, tested in Node: `dose.js`, `segments.js`, `headphones.js`, `slider.js`, `calibrate.js`.
  - `native.js`: the **only** file that touches `Capacitor`. Tests swap in a fake there.
  - Add these to the `sw.js` SHELL, and add an Audio tile on the home page.
- **Rule:** Kotlin records raw facts and enforces the safety limits. All interpretation (dose, stats, offsets) is in JS, so it's testable on the PC and identical on the web dashboard.

## Entries (`module=audio`)
| What | metric | id | value / unit | data |
|---|---|---|---|---|
| Listening segment | `listen` | `listen:<uuid>` (native) | seconds / `s` | `{end, device, device_type, index, max_index, stream_db, cut_db, abs_vol, usage}`; `recorded_at` = start |
| Headphone pair | `_headphone` | `headphone:<key>` | – | `{name, type, full_scale_dba, method:"ear"\|"meter"\|"spec", ref, hidden, notes}` |
| Calibration (phase 4) | `_calibration` | `calibration:<uuid>` | result dBA | `{device, method, steps, cap_db}` |
| Settings | existing `module=settings` convention | `settings:audio` | | `{logging, default_full_scale_dba:100}` |

- **Device key:**
  - Bluetooth: `bt:` plus 12 hex characters of a SHA-256 of the MAC.
  - Wired: `wired:<slug>`.
  - Phone speaker: `speaker`.
  - **The MAC is never shown, logged or screenshotted.**
- Segments keep only raw inputs, so recalibrating a pair re-estimates its past dose. That's intended: the old numbers were the wrong ones.

## Phase 0: experiments on the phone (S; do first, they decide phase 3)
Uses a debug-only `static/audio/lab.html` and `Lab.kt`. Record the results in `docs/research/audio.md` under "Phone results".
1. **Session-0 gain:** `DynamicsProcessing(0,0,null)` at −20 dB while Spotify plays, on the speaker, wired and Bluetooth.
   - Record one of: works / throws / silently ignored / some outputs only.
   - Also try maximum priority, and check whether it survives a track change and a Bluetooth reconnect.
2. **Samsung sub-steps:** with SoundAssistant set to 150 steps, step the volume and capture the state each time:
   ```powershell
   adb shell dumpsys audio | Select-String -Pattern "STREAM_MUSIC|index|abs|A2DP" -Context 0,3
   adb shell settings list system | Select-String volume
   adb shell settings list global | Select-String -Pattern "volume|bluetooth"
   ```
   Log `getStreamVolume`, `getStreamMaxVolume` and `getStreamVolumeDb` alongside.
3. **`getStreamVolumeDb` on Bluetooth (A2DP), with absolute volume on and off** (Developer options). Does the headset's own volume move?
4. **Foreground service:** does it survive overnight with the battery mode set to "Unrestricted"?
5. **Playback callbacks:** do they show Spotify and YouTube as active media?

## Phase 1: read-only listening log (L)
- **Manifest:**
  - `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SPECIAL_USE`, `POST_NOTIFICATIONS`, `BLUETOOTH_CONNECT`
  - the service declared with `foregroundServiceType="specialUse"`, plus the `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` property.
  - Start it with `ServiceCompat.startForeground(…, SDK_INT >= 34 ? SPECIAL_USE : 0)`.
- **The service listens to:**
  - a ContentObserver on the volume settings
  - `AudioDeviceCallback`
  - `registerAudioPlaybackCallback`
  - `AUDIO_BECOMING_NOISY`.
  - It never polls.
- **`SegmentRecorder`:**
  - A segment opens on play.
  - It closes on any change of device, index, cut or play state, and also every 15 minutes, so a crash loses at most 15 minutes.
  - Each segment gets a UUID when it opens.
- **Plugin:**
  - `start` / `stop`
  - `getState` → `{running, device, index, max, stream_db, playing, abs_vol}`
  - `drain({after})` and `ack({upTo})`
  - `requestPermissions`
  - `openBatterySettings`
  - events `state` and `device`.
- **Web side:** on open, on resume and on new segments, it drains, then writes with `cortex.putEntries`, then acks.
  - It acks only after the write is saved, so nothing is lost.
  - Ids are stable, so draining again is harmless.
  - The server is never contacted natively, which keeps local-first.
- **UI tabs:**
  - **Now:** the current output and pair, the volume as "9/15" plus dB, a logging switch, and warning cards for missing permissions or battery mode.
  - **History:** time listened per day for 7 and 30 days, stacked by pair, plus totals per pair. A single point still renders.
  - **On the web:** History only, with "Logging runs in the Android app".
- **Tests:**
  - **Node:** splitting at midnight, merging, draining again without duplicates.
  - **UI:** the fake plugin emits segments, and a check fails if ack is called before the write.
  - **Kotlin (JVM):** `SegmentRecorderTest`.
  - **Phone:** overnight survival, the notification, the Bluetooth prompt, real headset names.
- **Risks:**
  - One UI killing the service.
  - LE Audio randomising the MAC (fall back to the product name).

## Phase 2: per-pair offsets and estimated weekly dose (M)
```js
L = pair.full_scale_dba + seg.stream_db + seg.cut_db   // full scale calibrated WITH music at max, so content loudness is folded in
// unknown pair -> default 100 dBA, flagged "uncalibrated"
dose = Σ_last 7 days dur_h × 10^((L − 80)/10) / 40      // 1.0 = 100 %
hoursLeft(L) = max(0, (1 − dose) × 40 / 10^((L − 80)/10))
```
- **Headphones screen:** the pairs seen, an edit sheet with ±1 dB steps, a "reference pair" toggle, and "sounds N dB louder than my reference".
- **Now:** adds the estimated level and a weekly dose ring (pink, red above 100%) labelled "estimate ±5–10 dB".
- **History:** adds daily dose bars.
- Confirm plus toast when saving an offset.
- **Tests (Node, known answers):**
  - 80 dBA for 40 h = 1.00
  - 83 dBA for 20 h = 1.00
  - 90 dBA for 4 h = 1.00
  - an 8-day-old segment counts 0
  - a segment crossing the 7-day edge counts partly
  - an unknown pair is flagged.

## Phase 3: fine dB slider, cut only (L, the riskiest)
- **The maths:**
  - For a target T, pick the smallest step i with `stream_db(i) ≥ T`.
  - Cut = `T − stream_db(i)`, which is always ≤ 0.
  - **Kotlin clamps the cut to [−max, 0] whatever JS sends** (positive values, NaN and Infinity all become 0).
- **Order, so it never overshoots:**
  - Going up: deepen the cut first, then raise the step.
  - Going down: lower the step first, then ease the cut.
  - Ramp the cut over about 50 ms.
- **Hardware volume keys:** reset the cut to 0, and the slider follows.
- **Gain backend, chosen by phase 0:**
  - (a) a global session-0 `DynamicsProcessing`, or
  - (b) one per player session via the broadcast (Spotify, YouTube Music, Samsung Music, VLC). Show "not available for this app" for YouTube and Chrome.
  - (c) the optional ADB `DUMP` grant.
- **UI:**
  - a big vertical slider in 0.5 dB steps
  - "estimated dBA" if the pair is calibrated, relative dB otherwise
  - the step and cut shown underneath
  - a "my usual" preset per pair.
- **Tests:**
  - Node: on a 0.1 dB grid, cut ≤ 0 and step + cut = T. No in-between state is louder than both the old and new levels.
  - Kotlin: the same, plus the malicious-input clamp.
- **Risks:**
  - One UI ignoring session 0.
  - Clashes with Samsung's or Dolby's own effects.
  - Absolute volume making dB labels meaningless (hide them then).

## Phase 4: safe calibration (M; can come before phase 3)
- **Signal:** Cortex plays its own pink noise through a native `AudioTrack` (its own session, so the gain is predictable) and takes exclusive audio focus, so Spotify pauses.
- **The cap is absolute and doesn't trust the offset being tested:** `stream_db + signal_dbfs + cut ≤ CAP_DB`, a Kotlin constant. A wrong offset can only change the number shown, never how loud it plays.
- **Steps:** at most +1 dB per tap, at least 300 ms apart.
- **Stop immediately on:**
  - a disconnect, or any device change
  - hardware volume up
  - the app going to the background
  - a 5-minute timeout.
- **Methods:**
  - by ear against the reference pair
  - with a phone sound-meter app on the earcup
  - from the spec sheet (wired only).
- **Saving:** a confirm, then a `_headphone` update plus a `_calibration` record.
- **Flow:**
  1. Pick a method.
  2. "Lower your volume" check.
  3. Start quiet.
  4. Louder / Quieter buttons.
  5. Done.
  - A Stop button is always visible.
- **Tests:**
  - Node: a random-sequence property test that the cap is never exceeded, the rate limit holds, and every stop trigger works.
  - Kotlin: the same cap test.
- **Risk:** a headset's own volume buttons bypass the phone's cap when Bluetooth absolute volume is on. Ask for the headset to be at a known level, or require absolute volume off.

## Order
1. Testing harness.
2. Android app.
3. Phase 0.
4. Phase 1.
5. Phase 2.
6. Phase 4.
7. Phase 3.

Phase 4 can come before phase 3, because calibration only needs gain on Cortex's own audio, which always works.

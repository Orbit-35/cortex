# Research: audio and ear care, Nov 2026

Research notes for the plan in IDEAS.md, "Audio and ear care". All of it needs the native Android app. The target is Android 13 without root.

## Finer volume than the system steps
- Approach: keep the system volume step (`AudioManager.setStreamVolume`) as a coarse ceiling, plus a digital **cut** (never a boost) of 0 to −4 dB with `DynamicsProcessing`. Because it can only turn sound down, a bug can't blast your ears.
- **Global (session 0) effect:** needs only `MODIFY_AUDIO_SETTINGS`. Deprecated but not removed, and whether it works depends on the phone maker.
  - **Unknown on One UI 5. First experiment:** `DynamicsProcessing(0, 0, null)`, set −20 dB, play Spotify, and listen.
- **Fallback, per player session:** players send `ACTION_OPEN_AUDIO_EFFECT_CONTROL_SESSION`, and the app needs a running service to receive it.
  - Senders include Spotify, YouTube Music, Samsung Music and VLC.
  - The YouTube app doesn't send it, and Chrome isn't covered.
  - An optional one-time ADB grant (`pm grant <pkg> android.permission.DUMP`) finds sessions from players that don't send it, as Wavelet does.
- **Impossible without root:** changing the system step count (`ro.config.media_vol_steps`).
- **Samsung SoundAssistant** can give up to 150 media steps. No public API reads those sub-steps; check with `adb shell dumpsys audio` and `settings list system`.
- **Bluetooth absolute volume** hands the level to the headset itself, which can confuse the step and dB maths. Test with it on and off (Developer options).

## Detecting headphones
- `AudioManager.registerAudioDeviceCallback`, filtered to `TYPE_BLUETOOTH_A2DP`, `TYPE_BLE_HEADSET` or `TYPE_WIRED_HEADPHONES`.
- `getProductName()` gives the name and `getAddress()` gives the MAC. The MAC is the more stable key.
- Bluetooth details need the `BLUETOOTH_CONNECT` runtime permission (API 31+).

## Sound dose
- **WHO/ITU-T H.870:** 80 dBA for 40 h/week = 100% (1.6 Pa²h over a rolling 7 days). Every +3 dB halves the allowed time.
  - Per interval: `dose += t × 10^((L−80)/10) / 40 h`.
- Android 14+ has a built-in version (CSD, IEC 62368-1), using levels from the audio hardware. It isn't on Android 13, and Google says it is inaccurate over Bluetooth.
- **Cortex can only estimate:** level ≈ the pair's full-volume SPL + `getStreamVolumeDb(index)` + Cortex cut + an assumed content loudness.
  - Expect ±5–10 dB absolute error. Relative stats ("3 dB louder than usual") are reliable.
- No database gives Bluetooth headphones' maximum loudness, so per-pair calibration (by ear, or with a phone sound-meter app) is the realistic way.

## Background logging
- A local Capacitor plugin in Kotlin starts an Android foreground service of type `specialUse`. Android 13 needs `POST_NOTIFICATIONS` for the service's notification.
- Log change segments instead of polling: start, end, volume index, device, cut. Triggers:
  - a ContentObserver on volume settings
  - `AudioDeviceCallback`
  - `registerAudioPlaybackCallback`
- The service stores samples natively, and the web layer pulls them into the outbox when the app opens. That keeps local-first.
- Set the app's battery mode to "Unrestricted" in One UI, or it may be killed.

## Suggested order
1. **Listening log, read-only:** time listened per day/week, per pair. No audio processing, so low risk.
2. **An offset per pair** (`metric=_headphone`) plus an estimated weekly dose.
3. **Fine dB slider:** first run the session-0 test on the phone; otherwise use per-session effects.
4. **Safe calibration mode:** raise in 1 dB steps with a hard cap.

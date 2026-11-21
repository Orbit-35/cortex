# Research: guitar songs and practice log, Nov 2026

Research notes for the plan in IDEAS.md, "Guitar". Decisions go into DESIGN.md when built.

## What other apps do
- **Lesson apps (Justin Guitar, Fender Play, Yousician):**
  - They centre on a song library.
  - Fender Play counts a **weekly** streak: at least 7 minutes, 3 times a week.
  - Yousician scores you by listening, and its detection is the most common complaint.
- **Tab apps (Ultimate Guitar, Songsterr):** favourites and playlists, plus per-song speed and loop tools. No learning status.
- **Practice journals:**
  - **Modacity:** the metronome is tied to the log, so it records the tempo you practised at.
  - **Andante:** timer, metronome and tuner during a session; you can also add a session by hand. Streak, daily goal, calendar and per-piece progress.
  - **Makes Progress:** a target tempo per piece.
  - **PracticeBird:** loops with the tempo going up each time.
- **Keeping songs fresh:**
  - **Arietta:** flags pieces that are starting to fade.
  - **iRepertoire:** spaced-repetition suggestions.
  - **OpusKeep:** a "Maintaining" status.
- **Common patterns:**
  - Statuses Want to learn → Learning → Can play.
  - Progress as stages or a **1–5 confidence** you set yourself, much more often than a percentage.
  - Target vs current BPM.
  - A timer with a manual-entry fallback.

## Streaks without guilt
- Streaks work mostly through fear of losing them. Breaking one triggers a "what the hell, I've failed" effect.
- Research (Lally, UCL) found missing one day doesn't materially affect forming a habit.
- A low bar works best: Duolingo saw 40% more people keep a 7-day streak when the bar dropped to one lesson.
- **Complaints:** guilt, nagging notifications, freezes you have to pay for.
- **For Cortex:**
  - A weekly count ("practised 4 of 7 days").
  - A small minimum (any logged session, or 5+ minutes).
  - A calendar of dots and lifetime totals, so a break never wipes visible progress.
  - No push notifications.

## Small features that fit
- **Song card:** status, tuning and capo label ("Drop D · Capo 2"), and "last played 12d ago".
- **Tap the tuning to open the tuner on it:** set the `guitar:tuning` pref, or `/guitar/?tuning=<id>`. A capo needs nothing in the tuner, since you tune the open strings anyway.
- **"Needs refresh" list:** songs you can play that haven't been played in X days.
  - X grows each time a song is still solid (7 → 14 → 30 → 60).
  - It resets when the song is rusty.
- **"Practice this" button** starts the timer with that song attached.
- **Tempo chart per song:** reuse the lifting chart, with a target line.
- **Later:** sections per song (each with its own BPM), and a metronome using the tuner's Web Audio code.

## Free song info
- **iTunes Search API:** no key, title, artist and cover in one call. About 20 calls/minute; cache the results.
- **MusicBrainz + Cover Art Archive:** no key, about 1 request/second. Needs an identifying User-Agent, so call it from the server.
- **Songsterr search:** unofficial and unsupported. Only good for making a "tabs" link.
- **Tuning:** no free source, so you enter it by hand (default Standard).
- **Spotify:** see IDEAS.md. Later.
- Plan: a server route (`/api/lookup/song?q=`) that queries iTunes, then MusicBrainz, and caches. Store only IDs and the cover URL.

## Proposed design
- **Tabs:** Tuner | Songs | Practice.
- **Songs list:** a filter (Learning / Can play / Want to learn), a "Needs refresh (n)" banner, search, and a + button.
- **Song detail:**
  - status chip
  - tuning row, which opens the tuner
  - confidence 1–5
  - target and current BPM with a chart
  - links, notes, last practised and total minutes
  - a "Practice this" button
- **Practice session:**
  - big timer (Start / Pause / Finish)
  - song chips, each with an optional BPM and confidence
  - notes
  - "Add past session"
  - Finish asks for confirmation, then a toast
  - the screen stays awake
- **Practice tab:** this week (days and minutes), the streak in weeks, totals, and the session list.

### Entries (`module=guitar`)
- **Song:**
  - `metric=_song`, id `song:<uuid>`
  - `data={title, artist, status:"want"|"learning"|"can_play", confidence:1-5, tuning:{id,name,notes}, capo, target_bpm, links:[{kind,url}], notes, cover_url, ext:{...}, review_interval_days, next_review}`
  - The tuning is kept as a snapshot, so it still shows if a custom tuning is deleted.
- **Session:**
  - `metric=_practice`, id `practice:<uuid>`
  - `value=minutes`, `unit=min`, `recorded_at`=start
  - `data={duration_s, songs:[{song, bpm?, confidence?, minutes?}], notes}`
- **Worked out from the data, never stored:**
  - last practised
  - streaks and totals
  - "needs refresh"
- **Code:** pure modules `songs.js` and `practice.js` with tests.

## First version, then later
- **First version:**
  1. Tabs.
  2. Song create/edit/delete, with status, confidence, tuning + capo with the tuner link, links and notes.
  3. Practice timer plus past sessions.
  4. History, weekly days/minutes and totals.
  5. Last played on cards.
- **Later:**
  1. Needs-refresh scheduling.
  2. BPM and the tempo chart.
  3. Song info lookup.
  4. Sections.
  5. Metronome.
  6. Spotify.
  7. Weekly goal setting.

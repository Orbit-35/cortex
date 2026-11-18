# Cortex

A personal software platform: one core (FastAPI + SQLite + login, later) with small modules plugged in. Lifting is the first module. Think "phone OS + apps".

**This repo is public.** Never commit personal data (stats, exports, `cortex.db`), personal details about the owner, secrets, or API keys. Personal context lives outside the repo.

## Design log
`DESIGN.md` records every significant design choice with its justification and trade-offs, plus an overview of how the system fits together. **Whenever a change makes or alters a design decision, update `DESIGN.md` in the same commit** (add a numbered entry; mark replaced ones Superseded rather than deleting them).

## Long-term vision
- Three shells, one codebase: standalone Android app (Capacitor), standalone Windows desktop app (Tauri), and a web app.
- Shared across all three: data model, sync and offline storage (`static/core/`). Separate layouts per platform: phone = quick logging, desktop/web = Notion-style dashboards.
- Native features (Android volume control, Windows clipboard) come later as Capacitor/Tauri plugins.
- Server: self-hosted on a Raspberry Pi behind Tailscale (not started; no hosting work yet).

## Architecture
- **Local-first (core goal).** Cortex must work fully offline on phone and PC: every write goes to local storage first and syncs to the server when online. The server is a sync hub and backup, not a requirement for using the app.
  - Client storage: IndexedDB (`entries`, `outbox`, `meta`). Every entry gets a client-generated UUID (`client_id`) and goes into the outbox until the server acknowledges it.
  - Sync: `POST /api/sync` takes a batch of outbox entries (idempotent upsert by `client_id`, last write wins on `updated_at`) and returns everything changed since the client's cursor. The cursor is a server-side revision counter (`rev`), not a clock, so device clock drift can't lose changes.
  - Deletes are soft (`deleted_at`) so they sync like any other change.
  - Pages never call `/api/entries` directly; they go through `static/core/cortex.js`. That module must stay free of page/DOM code and take a configurable server URL, so Capacitor and Tauri shells can reuse it unchanged.
  - Service worker (`static/sw.js`) caches the app shell; `static/manifest.json` makes it installable.
- Backend: Python, FastAPI, SQLite single file `cortex.db` (gitignored). Postgres later without design change.
- Frontend: static pages under `static/<module>/`, served by FastAPI, built toward a PWA.
- One generic `entries` table: `module, metric, value, unit, data (JSON), recorded_at (ISO-8601), source, external_id`, plus sync columns `client_id, updated_at, deleted_at, rev`, with `UNIQUE(source, external_id)` so re-imports never duplicate.
- New module = new page + conventions on `entries`, not new tables (unless truly needed).
- Lifting convention: `module=lifting`, `metric=<exercise_slug>` (e.g. `bench_press`), `value`=weight, `unit=kg`, `data={"reps": n, "set": n}`.
- Importers (later): each converts one app's export/API into entries; always set `source` + `external_id`; keep raw files under `raw/` (gitignored).

## Running
```powershell
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --host 0.0.0.0
```
API docs at http://localhost:8000/docs, lifting page at http://localhost:8000/lifting/.

## Target devices
- Phone: Android 13 is the ceiling (Chrome / Samsung Internet). Mobile-first: big tap targets, one-handed, fast logging between sets.
- PWA install needs HTTPS → Tailscale + `tailscale serve` (tailnet-only; never `funnel` until there's auth). Plain `http://<laptop-ip>:8000` works for same-Wi-Fi browser testing only.
- Native Android companion (later) targets API 33.
- Dev machine: Windows, VS Code, PowerShell.

## Git
- Commit after each working change with a short clear message ("Add lifting log form"). Push at end of session and before risky changes.
- Never commit `.venv`, `cortex.db`, `__pycache__`, data exports, secrets.

## Roadmap
Core (started) → Lifting (log + recent sets ✓, progress chart + past-date entry ✓, phone testing) → Body/food → Video challenge → Importers → Android companion (volume slider, sound-dose logger) → maybe PC clipboard companion → Guitar practice app.

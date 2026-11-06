# Cortex

A personal software platform: one core (FastAPI + SQLite + login, later) with small modules plugged in. Lifting is the first module. Think "phone OS + apps".

**This repo is public.** Never commit personal data (stats, exports, `cortex.db`), personal details about the owner, secrets, or API keys. Personal context lives outside the repo.

## Architecture
- Backend: Python, FastAPI, SQLite single file `cortex.db` (gitignored). Postgres later without design change.
- Frontend: static pages under `static/<module>/`, served by FastAPI, built toward a PWA.
- One generic `entries` table: `module, metric, value, unit, data (JSON), recorded_at (ISO-8601), source, external_id`, with `UNIQUE(source, external_id)` so re-imports never duplicate.
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
Core (started) → Lifting (log + recent sets ✓, phone testing, progress chart) → Body/food → Video challenge → Importers → Android companion (volume slider, sound-dose logger) → maybe PC clipboard companion → Guitar practice app.

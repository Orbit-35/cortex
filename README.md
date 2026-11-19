# Cortex

A personal, self-hosted platform for logging the things I track: one small core (FastAPI + SQLite) with modules plugged into it, like apps on a phone. **Lifting** is the first module.

It's **local-first**: every entry is saved on the device first, so the app works with no signal and syncs to the server when it can. The server is a sync hub and backup, not a requirement.

## What's here

- **Lifting:** log sets in a few taps between sets, enter past sessions or old PRs by date, and get a PR alert with a buzz when you beat your best. A progress chart shows estimated 1RM over time, next to a rep-records table.
- **Offline:** IndexedDB plus an outbox that syncs through `POST /api/sync`.
- **Installable:** a PWA with a manifest and a service worker that caches the app shell.

## Run it

You need Python 3.10+.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0
```

Then open:
- http://localhost:8000/lifting/ for the app
- http://localhost:8000/docs for the API docs

Your data lives in `cortex.db`, a single SQLite file. Back it up by copying it; set `CORTEX_DB` to use a different file.

Tests: `node tests/stats.test.mjs`

## On a phone

Installing as an app needs HTTPS. The easy, private route is [Tailscale](https://tailscale.com): run `tailscale serve --bg 8000` on the server and open the `https://….ts.net` address on a phone signed in to the same tailnet.

**Never expose this to the public internet** (`tailscale funnel`, port forwarding): there's no login yet.

## How it's built

The data model, the sync protocol and the reasons behind each choice are in [`DESIGN.md`](DESIGN.md).

In short, every module writes rows to one generic `entries` table (`module, metric, value, unit, data, recorded_at`). A new module is a new page plus a naming convention, not a schema change.

## Roadmap

1. Lifting: phone polish
2. Importers, starting with workout-app CSV exports
3. Body and food tracking
4. Android (Capacitor) and Windows (Tauri) shells over the same core
5. Self-hosting on a Raspberry Pi

## Privacy

This repo holds code only. Databases, exports and raw import files are gitignored and never committed.

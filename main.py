"""Cortex core: one generic `entries` table + a small API every module talks to.

Run:  .\\.venv\\Scripts\\uvicorn main:app --reload --host 0.0.0.0
Docs: http://localhost:8000/docs
"""

import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).parent
DB_PATH = BASE_DIR / "cortex.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    module      TEXT NOT NULL,
    metric      TEXT NOT NULL,
    value       REAL,
    unit        TEXT,
    data        TEXT NOT NULL DEFAULT '{}',
    recorded_at TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT,
    created_at  TEXT NOT NULL,
    UNIQUE (source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_entries_module_metric_time
    ON entries (module, metric, recorded_at);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@asynccontextmanager
async def lifespan(app: FastAPI):
    with connect() as conn:
        conn.executescript(SCHEMA)
    yield


app = FastAPI(title="Cortex", lifespan=lifespan)


class EntryIn(BaseModel):
    module: str = Field(examples=["lifting"])
    metric: str = Field(examples=["bench_press"])
    value: float | None = Field(default=None, examples=[80])
    unit: str | None = Field(default=None, examples=["kg"])
    data: dict[str, Any] = Field(default_factory=dict, examples=[{"reps": 5}])
    recorded_at: str | None = Field(default=None, description="ISO-8601; defaults to now")
    source: str = "manual"
    external_id: str | None = None


class Entry(EntryIn):
    id: int
    recorded_at: str
    created_at: str


def row_to_entry(row: sqlite3.Row) -> Entry:
    d = dict(row)
    d["data"] = json.loads(d["data"] or "{}")
    return Entry(**d)


@app.post("/api/entries", response_model=Entry, status_code=201)
def create_entry(entry: EntryIn):
    recorded_at = entry.recorded_at or now_iso()
    with connect() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO entries
                   (module, metric, value, unit, data, recorded_at, source, external_id, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (entry.module, entry.metric, entry.value, entry.unit,
                 json.dumps(entry.data), recorded_at, entry.source,
                 entry.external_id, now_iso()),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Entry with this source + external_id already exists")
        row = conn.execute("SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_entry(row)


@app.get("/api/entries", response_model=list[Entry])
def list_entries(
    module: str | None = None,
    metric: str | None = None,
    since: str | None = None,
    limit: int = Query(50, ge=1, le=5000),
):
    sql, params = "SELECT * FROM entries WHERE 1=1", []
    for col, val in (("module", module), ("metric", metric)):
        if val is not None:
            sql += f" AND {col} = ?"
            params.append(val)
    if since:
        sql += " AND recorded_at >= ?"
        params.append(since)
    sql += " ORDER BY recorded_at DESC, id DESC LIMIT ?"
    params.append(limit)
    with connect() as conn:
        return [row_to_entry(r) for r in conn.execute(sql, params)]


@app.delete("/api/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int):
    with connect() as conn:
        if conn.execute("DELETE FROM entries WHERE id = ?", (entry_id,)).rowcount == 0:
            raise HTTPException(404, "Entry not found")


@app.get("/api/metrics")
def list_metrics(module: str):
    """Distinct metrics a module has used, most recent first (e.g. exercises you've logged)."""
    with connect() as conn:
        rows = conn.execute(
            """SELECT metric, MAX(recorded_at) AS last FROM entries
               WHERE module = ? GROUP BY metric ORDER BY last DESC""",
            (module,),
        )
        return [r["metric"] for r in rows]


@app.get("/")
def home():
    return RedirectResponse("/lifting/")


app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")

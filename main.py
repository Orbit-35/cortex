"""Cortex core: one generic `entries` table + a small API every module talks to.

Run:  .\\.venv\\Scripts\\uvicorn main:app --reload --host 0.0.0.0
Docs: http://localhost:8000/docs

Cortex is local-first: clients save to their own storage and call POST /api/sync
to push their outbox and pull what changed. See CLAUDE.md > Architecture.
"""

import asyncio
import hashlib
import json
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, ValidationError, field_validator

BASE_DIR = Path(__file__).parent
# CORTEX_DB lets tests run against a throwaway database instead of the real one.
DB_PATH = Path(os.environ.get("CORTEX_DB", BASE_DIR / "cortex.db"))
BACKUP_DIR = Path(os.environ.get("CORTEX_BACKUPS", BASE_DIR / "backups"))
BACKUPS_KEPT = 30

TABLE = """
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
    client_id   TEXT,
    updated_at  TEXT,
    deleted_at  TEXT,
    rev         INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source, external_id)
);
"""

# Sync columns, added to databases created before sync existed.
SYNC_COLUMNS = {
    "client_id": "TEXT",                    # UUID chosen by whoever created the entry
    "updated_at": "TEXT",                   # when it was last edited (editor's clock)
    "deleted_at": "TEXT",                   # soft delete: set instead of removing the row
    "rev": "INTEGER NOT NULL DEFAULT 0",    # server change counter, see next_rev()
}

INDEXES = """
CREATE INDEX IF NOT EXISTS idx_entries_module_metric_time
    ON entries (module, metric, recorded_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_client_id ON entries (client_id);
CREATE INDEX IF NOT EXISTS idx_entries_rev ON entries (rev);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@contextmanager
def write_tx():
    """One write transaction. BEGIN IMMEDIATE takes the write lock up front, so
    revision numbers are handed out strictly one writer at a time."""
    conn = connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except BaseException:
        conn.rollback()
        raise
    finally:
        conn.close()


def now_iso() -> str:
    return to_utc_iso(datetime.now(timezone.utc))


def to_utc_iso(value: datetime | str) -> str:
    """Canonical timestamp: UTC, milliseconds, 'Z'. One format everywhere means
    timestamps can be compared and sorted as plain strings."""
    dt = datetime.fromisoformat(value) if isinstance(value, str) else value
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def next_rev(conn: sqlite3.Connection) -> int:
    """Every change gets the next number from one server-wide counter. Clients
    remember the highest number they've seen and ask for "everything after it".
    Rows are never hard-deleted, so MAX(rev) never goes backwards."""
    return conn.execute("SELECT COALESCE(MAX(rev), 0) + 1 FROM entries").fetchone()[0]


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(TABLE)
    have = {r["name"] for r in conn.execute("PRAGMA table_info(entries)")}
    for col, decl in SYNC_COLUMNS.items():
        if col not in have:
            conn.execute(f"ALTER TABLE entries ADD COLUMN {col} {decl}")
    # Backfill rows that predate sync so every row has an identity and a revision.
    rev = next_rev(conn)
    for row in conn.execute(
        "SELECT id, created_at FROM entries WHERE client_id IS NULL OR rev = 0 ORDER BY id"
    ).fetchall():
        conn.execute(
            """UPDATE entries SET client_id = COALESCE(client_id, ?),
                   updated_at = COALESCE(updated_at, ?), rev = ? WHERE id = ?""",
            (str(uuid.uuid4()), to_utc_iso(row["created_at"]), rev, row["id"]),
        )
        rev += 1
    conn.executescript(INDEXES)
    conn.commit()


def backup_today() -> Path | None:
    """Copy the database to backups/cortex-YYYY-MM-DD.db once per (local) day and
    keep the newest BACKUPS_KEPT copies. Uses SQLite's backup API, which takes a
    consistent snapshot even while the server is writing."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    target = BACKUP_DIR / f"cortex-{datetime.now().date().isoformat()}.db"
    if target.exists():
        return None
    tmp = target.with_suffix(".db.tmp")
    src, dst = connect(), sqlite3.connect(tmp)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()
    tmp.replace(target)  # only a complete copy ever gets the real name
    for old in sorted(BACKUP_DIR.glob("cortex-*.db"))[:-BACKUPS_KEPT]:
        old.unlink()
    return target


async def backup_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(backup_today)
        except Exception as exc:  # a failed backup must never take the server down
            print(f"Cortex backup failed: {exc}")
        await asyncio.sleep(3600)  # hourly check; at most one copy per day


@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = connect()
    try:
        migrate(conn)
    finally:
        conn.close()
    task = asyncio.create_task(backup_loop())
    yield
    task.cancel()


app = FastAPI(title="Cortex", lifespan=lifespan)


class EntryBase(BaseModel):
    module: str = Field(examples=["lifting"])
    metric: str = Field(examples=["bench_press"])
    value: float | None = Field(default=None, examples=[80])
    unit: str | None = Field(default=None, examples=["kg"])
    data: dict[str, Any] = Field(default_factory=dict, examples=[{"reps": 5}])
    source: str = "manual"
    external_id: str | None = None


class EntryIn(EntryBase):
    recorded_at: str | None = Field(default=None, description="ISO-8601; defaults to now")
    client_id: str | None = Field(
        default=None, min_length=8, max_length=64, description="UUID; generated if omitted"
    )

    @field_validator("recorded_at")
    @classmethod
    def _canonical_time(cls, v: str | None) -> str | None:
        return to_utc_iso(v) if v else None


class Entry(EntryBase):
    id: int
    client_id: str
    recorded_at: str
    created_at: str
    updated_at: str
    deleted_at: str | None = None


class SyncEntry(EntryBase):
    """An entry as a client holds it: full current state, not a diff."""
    client_id: str = Field(min_length=8, max_length=64)
    recorded_at: str
    updated_at: str
    deleted_at: str | None = None

    @field_validator("recorded_at", "updated_at", "deleted_at")
    @classmethod
    def _canonical_time(cls, v: str | None) -> str | None:
        # An empty string is not "no time": a blank updated_at used to be saved as NULL and
        # then broke every later pull (DESIGN D58). Only deleted_at may be absent (None).
        if v is None:
            return None
        if not v.strip():
            raise ValueError("empty time")
        return to_utc_iso(v)


def reject_reason(err: ValidationError) -> str:
    """A short, human reason for the first problem, e.g. 'recorded_at: bad date'."""
    first = err.errors()[0]
    field = ".".join(str(p) for p in first.get("loc", ())) or "entry"
    msg = first.get("msg", "invalid").removeprefix("Value error, ")
    if "isoformat" in msg.lower() or "invalid isoformat" in msg.lower():
        msg = "bad date"
    return f"{field}: {msg}"


class SyncIn(BaseModel):
    since: int = Field(default=0, ge=0, description="Cursor from the previous sync; 0 = send everything")
    # Checked one by one in sync(), so one bad entry is rejected alone instead of
    # failing the whole batch and blocking that device's sync forever (DESIGN D52).
    entries: list[dict[str, Any]] = Field(default_factory=list, max_length=2000)


class SyncOut(BaseModel):
    cursor: int
    entries: list[Entry]
    rejected: list[str] = Field(default_factory=list, description="client_ids the server refused")
    rejected_reasons: dict[str, str] = Field(
        default_factory=dict, description="client_id -> why it was refused (DESIGN D58)"
    )


def row_to_entry(row: sqlite3.Row) -> Entry:
    d = dict(row)
    d["data"] = json.loads(d["data"] or "{}")
    return Entry(**d)


@app.post("/api/sync", response_model=SyncOut)
def sync(body: SyncIn):
    """Push the client's outbox, pull everything changed since its cursor.

    Safe to retry: an entry is identified by client_id, so sending the same batch
    twice (e.g. the reply got lost) changes nothing the second time.
    """
    rejected: list[str] = []
    reasons: dict[str, str] = {}

    def refuse(cid: str, why: str) -> None:
        rejected.append(cid)
        reasons[cid] = why

    valid: list[SyncEntry] = []
    for raw in body.entries:
        try:
            valid.append(SyncEntry.model_validate(raw))
        except ValidationError as err:
            refuse(str(raw.get("client_id", "")), reject_reason(err))
    losers: list[str] = []  # older edits we ignored: the sender gets our version back
    with write_tx() as conn:
        rev = next_rev(conn)
        for e in valid:
            existing = conn.execute(
                "SELECT updated_at FROM entries WHERE client_id = ?", (e.client_id,)
            ).fetchone()
            if existing and existing["updated_at"] and e.updated_at <= existing["updated_at"]:
                # A retry (same time), or an older edit than ours: last write wins.
                if e.updated_at < existing["updated_at"]:
                    losers.append(e.client_id)
                continue
            fields = (e.module, e.metric, e.value, e.unit, json.dumps(e.data), e.recorded_at,
                      e.source, e.external_id, e.updated_at, e.deleted_at, rev)
            try:
                if existing:
                    conn.execute(
                        """UPDATE entries SET module = ?, metric = ?, value = ?, unit = ?,
                               data = ?, recorded_at = ?, source = ?, external_id = ?,
                               updated_at = ?, deleted_at = ?, rev = ?
                           WHERE client_id = ?""",
                        fields + (e.client_id,),
                    )
                else:
                    conn.execute(
                        """INSERT INTO entries
                           (module, metric, value, unit, data, recorded_at, source, external_id,
                            updated_at, deleted_at, rev, client_id, created_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        fields + (e.client_id, now_iso()),
                    )
                rev += 1
            except sqlite3.IntegrityError as err:
                # Usually UNIQUE(source, external_id): the same imported row under another id.
                dup = "UNIQUE" in str(err)
                refuse(e.client_id, "duplicate import (this source and external_id already exist)"
                       if dup else f"database refused it: {err}")
        cursor = rev - 1
        # A cursor ahead of ours means the server database was replaced: resend everything.
        since = body.since if body.since <= cursor else 0
        rows = conn.execute(
            "SELECT * FROM entries WHERE rev > ? ORDER BY rev", (since,)
        ).fetchall()
        sent = {r["client_id"] for r in rows}
        for cid in losers:
            if cid not in sent:
                rows.append(conn.execute("SELECT * FROM entries WHERE client_id = ?", (cid,)).fetchone())
                sent.add(cid)
    return SyncOut(cursor=cursor, entries=[row_to_entry(r) for r in rows],
                   rejected=rejected, rejected_reasons=reasons)


@app.post("/api/entries", response_model=Entry, status_code=201)
def create_entry(entry: EntryIn):
    now = now_iso()
    with write_tx() as conn:
        try:
            cur = conn.execute(
                """INSERT INTO entries
                   (module, metric, value, unit, data, recorded_at, source, external_id,
                    client_id, created_at, updated_at, rev)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (entry.module, entry.metric, entry.value, entry.unit,
                 json.dumps(entry.data), entry.recorded_at or now, entry.source,
                 entry.external_id, entry.client_id or str(uuid.uuid4()), now, now,
                 next_rev(conn)),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(409, "Entry with this client_id or source + external_id already exists")
        row = conn.execute("SELECT * FROM entries WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_entry(row)


@app.get("/api/entries", response_model=list[Entry])
def list_entries(
    module: str | None = None,
    metric: str | None = None,
    since: str | None = None,
    limit: int = Query(50, ge=1, le=5000),
):
    sql, params = "SELECT * FROM entries WHERE deleted_at IS NULL", []
    for col, val in (("module", module), ("metric", metric)):
        if val is not None:
            sql += f" AND {col} = ?"
            params.append(val)
    if since:
        sql += " AND recorded_at >= ?"
        params.append(since)
    sql += " ORDER BY recorded_at DESC, id DESC LIMIT ?"
    params.append(limit)
    conn = connect()
    try:
        return [row_to_entry(r) for r in conn.execute(sql, params)]
    finally:
        conn.close()


@app.delete("/api/entries/{entry_id}", status_code=204)
def delete_entry(entry_id: int):
    """Soft delete: the row stays, marked deleted, so the deletion syncs to other devices."""
    now = now_iso()
    with write_tx() as conn:
        done = conn.execute(
            """UPDATE entries SET deleted_at = ?, updated_at = ?, rev = ?
               WHERE id = ? AND deleted_at IS NULL""",
            (now, now, next_rev(conn), entry_id),
        ).rowcount
    if done == 0:
        raise HTTPException(404, "Entry not found")


@app.get("/api/metrics")
def list_metrics(module: str):
    """Distinct metrics a module has used, most recent first (e.g. exercises you've logged)."""
    conn = connect()
    try:
        rows = conn.execute(
            """SELECT metric, MAX(recorded_at) AS last FROM entries
               WHERE module = ? AND deleted_at IS NULL GROUP BY metric ORDER BY last DESC""",
            (module,),
        )
        return [r["metric"] for r in rows]
    finally:
        conn.close()


def app_version() -> str:
    """Fingerprint of every file under static/: changes whenever any app file changes."""
    h = hashlib.sha256()
    static = BASE_DIR / "static"
    for f in sorted(static.rglob("*")):
        if f.is_file() and f.name != "sw.js":
            h.update(f.relative_to(static).as_posix().encode())
            h.update(f.read_bytes())
    return h.hexdigest()[:12]


@app.get("/sw.js", include_in_schema=False)
def service_worker():
    """The service worker, stamped with the app version so phones notice every update."""
    text = (BASE_DIR / "static" / "sw.js").read_text(encoding="utf-8").replace("__VERSION__", app_version())
    return Response(text, media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/api/version")
def version():
    return {"version": app_version()}


app.mount("/", StaticFiles(directory=BASE_DIR / "static", html=True), name="static")

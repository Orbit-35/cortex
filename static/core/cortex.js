// Cortex client core: local storage + sync. Shared by every page and, later, by the
// Capacitor (Android) and Tauri (Windows) shells, so: no DOM/page code in here, and
// the server address is configurable.
//
// The model: IndexedDB on this device is the notebook you actually write in.
// The server is the filing cabinet at home. Every write lands in the notebook
// immediately and a copy goes into the outbox; sync() empties the outbox into the
// cabinet and brings back anything other devices filed since the last visit.

const DB_NAME = "cortex";
const DB_VERSION = 1;
const SYNC_TIMEOUT_MS = 10000;
const SYNC_BATCH = 500; // outbox entries per request (the server takes at most 2000)
const RETRY_MS = 20000;

let apiBase = ""; // "" = same origin. Native shells set a full URL via configure().
let dbPromise = null;
let syncing = null; // the in-flight sync promise, if any
let syncAgain = false; // something changed while a sync was in flight
let lastSyncOk = null; // null = not tried yet
let autoSync = false;
const listeners = new Set();

export function configure(options = {}) {
  if (options.apiBase !== undefined) apiBase = options.apiBase.replace(/\/$/, "");
}

// ---------- IndexedDB plumbing ----------

// Ask the browser to keep this site's storage (IndexedDB and localStorage) even when the
// phone runs low on space (D56). Installed apps are usually allowed; the browser decides.
function keepStorage() {
  try {
    navigator.storage?.persisted?.().then((yes) => yes || navigator.storage.persist()).catch(() => {});
  } catch {}
}

function openDb() {
  if (!dbPromise) {
    keepStorage();
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // entries: everything this device knows, keyed by the UUID it was born with.
        const entries = db.createObjectStore("entries", { keyPath: "client_id" });
        entries.createIndex("module", "module");
        // outbox: the latest state of each entry the server hasn't confirmed yet.
        db.createObjectStore("outbox", { keyPath: "client_id" });
        // meta: small key/value notes, e.g. the sync cursor.
        db.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// Run fn inside one transaction; resolves with fn's return value once it commits.
async function tx(stores, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("Transaction aborted"));
    result = fn(t);
  });
}

export function newId() { return uuid(); }

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // crypto.randomUUID needs HTTPS/localhost; plain http://<laptop-ip> lands here.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const nowIso = () => new Date().toISOString();
// An edit's time is always later than the version it replaces, even if this device's clock
// is behind the one that wrote it, so the edit wins last-write-wins (DESIGN D52).
const stamp = (prev) => {
  const now = Date.now(), before = prev ? Date.parse(prev) : NaN;
  return new Date(before >= now ? before + 1 : now).toISOString();
};

// ---------- Writes: local first, then outbox ----------

// Save locally and queue for the server in one transaction: either both happen or neither.
async function saveLocal(entry) {
  await tx(["entries", "outbox"], "readwrite", (t) => {
    t.objectStore("entries").put(entry);
    t.objectStore("outbox").put(entry);
  });
  changed();
  if (autoSync) sync();
  return entry;
}

export function addEntry({ module, metric, value = null, unit = null, data = {}, recorded_at }) {
  const now = nowIso();
  return saveLocal({
    client_id: uuid(), module, metric, value, unit, data,
    recorded_at: recorded_at || now, source: "manual", external_id: null,
    updated_at: now, deleted_at: null,
  });
}

// Save several entries (new or edited) in ONE transaction: all land or none do.
// Each item is an entry's full state; pass an existing client_id to edit that entry,
// and deleted_at to delete it. Used for saving a whole workout at once.
export async function putEntries(list) {
  const now = nowIso();
  const rows = list.map((e) => ({
    client_id: e.client_id || uuid(), module: e.module, metric: e.metric,
    value: e.value ?? null, unit: e.unit ?? null, data: e.data ?? {},
    recorded_at: e.recorded_at || now, source: e.source ?? "manual",
    external_id: e.external_id ?? null, deleted_at: e.deleted_at ?? null, updated_at: stamp(e.updated_at),
  }));
  if (!rows.length) return rows;
  await tx(["entries", "outbox"], "readwrite", (t) => {
    for (const r of rows) {
      t.objectStore("entries").put(r);
      t.objectStore("outbox").put(r);
    }
  });
  changed();
  if (autoSync) sync();
  return rows;
}

// Soft delete: keep a "deleted" marker so the deletion itself can be synced.
export async function deleteEntry(clientId) {
  const db = await openDb();
  const entry = await done(db.transaction("entries").objectStore("entries").get(clientId));
  if (!entry || entry.deleted_at) return;
  const now = stamp(entry.updated_at);
  await saveLocal({ ...entry, updated_at: now, deleted_at: now });
}

// ---------- Reads: always from local storage, so they work offline ----------

export async function listEntries({ module, metric, limit = 50 } = {}) {
  const db = await openDb();
  const store = db.transaction("entries").objectStore("entries");
  const all = await done(module ? store.index("module").getAll(module) : store.getAll());
  return all
    .filter((e) => !e.deleted_at && (!metric || e.metric === metric))
    .sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : a.recorded_at > b.recorded_at ? -1 : 0))
    .slice(0, limit);
}

// Distinct metrics a module has used, most recent first.
export async function listMetrics(module) {
  const entries = await listEntries({ module, limit: Infinity });
  return [...new Set(entries.map((e) => e.metric))];
}

// ---------- Sync ----------

export async function getStatus() {
  const db = await openDb();
  const pending = await done(db.transaction("outbox").objectStore("outbox").count());
  return { pending, online: lastSyncOk, syncing: !!syncing };
}

// Subscribe to "something changed" (local write or sync). Returns an unsubscribe function.
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed() {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error(err); }
  }
}

// Push the outbox, pull what changed. Never throws; resolves true if the server answered.
// Only one sync runs at a time; a call during a sync queues exactly one follow-up.
export function sync() {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = syncOnce()
    .then((more) => { if (more) syncAgain = true; return true; }, (err) => { console.debug("Cortex sync failed:", err.message); return false; })
    .then((ok) => {
      lastSyncOk = ok;
      syncing = null;
      changed();
      if (syncAgain) { syncAgain = false; if (ok) return sync(); }
      return ok;
    });
  changed();
  return syncing;
}

async function syncOnce() {
  const db = await openDb();
  const read = db.transaction(["outbox", "meta"]);
  const [queued, cursor] = await Promise.all([
    done(read.objectStore("outbox").getAll(null, SYNC_BATCH + 1)),
    done(read.objectStore("meta").get("cursor")),
  ]);

  // A big outbox goes up in parts; sync() runs again straight away for the rest.
  const batch = queued.slice(0, SYNC_BATCH), more = queued.length > SYNC_BATCH;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SYNC_TIMEOUT_MS);
  let reply;
  try {
    const res = await fetch(`${apiBase}/api/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since: cursor || 0, entries: batch }),
      signal: abort.signal,
    });
    if (!res.ok) throw new Error(`Server said ${res.status}`);
    reply = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (reply.rejected.length) console.warn("Cortex: server rejected entries", reply.rejected);

  // Apply the reply in one transaction, so a crash can't leave us half-synced.
  await tx(["entries", "outbox", "meta"], "readwrite", (t) => {
    const entries = t.objectStore("entries");
    const outbox = t.objectStore("outbox");
    outbox.getAll().onsuccess = (ev) => {
      const pending = new Map(ev.target.result.map((e) => [e.client_id, e]));
      // 1. The server has what we sent: clear it from the outbox, unless it was
      //    edited again while the request was in the air (then it stays queued).
      for (const sent of batch) {
        const now = pending.get(sent.client_id);
        if (now && now.updated_at === sent.updated_at) {
          outbox.delete(sent.client_id);
          pending.delete(sent.client_id);
          if (sent.deleted_at) entries.delete(sent.client_id); // marker has done its job
        }
      }
      // 2. Take the server's changes, except where we still have an unsent edit.
      for (const remote of reply.entries) {
        if (pending.has(remote.client_id)) continue;
        if (remote.deleted_at) entries.delete(remote.client_id);
        else entries.put(remote);
      }
      t.objectStore("meta").put(reply.cursor, "cursor");
    };
  });
  return more;
}

// Sync on start, when the connection returns, when the app comes back to the
// foreground, and keep retrying while anything is still waiting to upload.
export function startAutoSync() {
  if (autoSync) return;
  autoSync = true;
  addEventListener("online", () => sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sync();
  });
  setInterval(async () => {
    if (document.visibilityState !== "visible") return;
    const { pending } = await getStatus();
    if (pending > 0 || lastSyncOk === false) sync();
  }, RETRY_MS);
  sync();
}

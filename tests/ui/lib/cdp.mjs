// A tiny Chrome DevTools Protocol client over Node's built-in WebSocket, using flat sessions:
// one connection to the browser, and each page or service worker is a sessionId on it.
export class CDP {
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`can't connect to ${wsUrl}`)); });
    return new CDP(ws);
  }

  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Set();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else p.resolve(m.result);
        return;
      }
      for (const h of this.handlers) h(m);
    };
    ws.onclose = () => { for (const p of this.pending.values()) p.reject(new Error("browser connection closed")); this.pending.clear(); };
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  // Listen for an event, optionally only from one session. Returns an "off" function.
  on(method, fn, sessionId) {
    const h = (m) => { if (m.method === method && (!sessionId || m.sessionId === sessionId)) fn(m.params, m.sessionId); };
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  // Wait for one event (with a timeout).
  once(method, sessionId, ms = 15000) {
    return new Promise((res, rej) => {
      const t = setTimeout(() => { off(); rej(new Error(`timed out waiting for ${method}`)); }, ms);
      const off = this.on(method, (p) => { clearTimeout(t); off(); res(p); }, sessionId);
    });
  }

  close() { try { this.ws.close(); } catch {} }
}

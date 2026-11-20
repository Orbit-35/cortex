// Shared UI bits for every Cortex app: the confirm dialog (DESIGN D41) and a toast.
// Separate from cortex.js on purpose: that file must stay free of DOM code.
// Styling uses the page's colour tokens (--card, --line, --accent, --danger, --on-accent ...).

const CSS = `
.cx-ask { position: fixed; inset: 0; z-index: 40; background: rgb(0 0 0 / .6); display: flex; align-items: flex-end;
  justify-content: center; padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); }
.cx-ask[hidden] { display: none; }
.cx-ask-box { width: 100%; max-width: 420px; background: var(--card); border: 1px solid var(--line); border-radius: 18px;
  padding: 20px 16px 16px; box-shadow: 0 12px 32px rgb(0 0 0 / .5); }
.cx-ask-t { font-size: 19px; font-weight: 700; }
.cx-ask-box p { margin: 8px 0 0; color: var(--muted); font-size: 15px; line-height: 1.4; }
.cx-ask-btns { display: flex; gap: 10px; margin-top: 20px; }
.cx-ask-btns button { flex: 1; min-height: 52px; font: inherit; font-size: 16px; font-weight: 700; border-radius: 14px; cursor: pointer; }
.cx-no { background: var(--card); border: 1px solid var(--line); color: var(--text); }
.cx-yes { background: var(--accent); border: 0; color: var(--on-accent); }
.cx-yes.cx-danger { background: var(--danger); }
.cx-toast { position: fixed; left: 50%; transform: translateX(-50%); z-index: 45;
  bottom: calc(var(--toast-bottom, 24px) + env(safe-area-inset-bottom));
  background: var(--card2, var(--card)); border: 1px solid var(--line); border-radius: 12px; color: var(--text);
  padding: 10px 16px; font-size: 15px; max-width: calc(100% - 32px); text-align: center; box-shadow: 0 8px 24px rgb(0 0 0 / .4); }
.cx-toast[hidden] { display: none; }
`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let root = null, toastEl = null, done = null, toastTimer = 0;

function mount() {
  if (root) return;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.append(style);
  root = document.createElement("div");
  root.className = "cx-ask";
  root.hidden = true;
  root.addEventListener("click", (ev) => {
    if (!done) return;
    const b = ev.target.closest("[data-a]");
    if (b) done(b.dataset.a === "1");
    else if (ev.target === root) done(false); // tap outside = no
  });
  toastEl = document.createElement("div");
  toastEl.className = "cx-toast";
  toastEl.setAttribute("role", "status");
  toastEl.hidden = true;
  document.body.append(root, toastEl);
}

// Ask a yes/no question. Resolves true only on the right-hand (yes) button.
// danger: red yes-button. no: label for the safe button (say what it keeps, e.g. "Keep going").
export function ask(title, body = "", { yes = "OK", no = "Cancel", danger = false } = {}) {
  mount();
  done?.(false);
  root.innerHTML = `<div class="cx-ask-box" role="alertdialog" aria-modal="true" aria-labelledby="cx-ask-t">
    <div class="cx-ask-t" id="cx-ask-t">${esc(title)}</div>${body ? `<p>${esc(body)}</p>` : ""}
    <div class="cx-ask-btns"><button class="cx-no" data-a="0">${esc(no)}</button>
      <button class="cx-yes${danger ? " cx-danger" : ""}" data-a="1">${esc(yes)}</button></div></div>`;
  root.hidden = false;
  root.querySelector('[data-a="0"]').focus();
  return new Promise((res) => { done = (v) => { root.hidden = true; done = null; res(v); }; });
}

// Close an open question as "no" (e.g. on the back gesture). Returns true if one was open.
export function cancelAsk() {
  if (!done) return false;
  done(false);
  return true;
}

export function toast(text, ms = 3200) {
  mount();
  toastEl.textContent = text;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), ms);
}

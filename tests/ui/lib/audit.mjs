// A layout check run inside the page: tap targets under 44 px and anything wider than the
// screen. It checks the whole page, including controls below the fold (scroll is not needed). Returns a list of problems (empty = clean). Use with page.eval(AUDIT).
export const AUDIT = `(() => {
  const out = [];
  const shown = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !el.closest("[hidden]"); };
  const name = (el) => (el.getAttribute("aria-label") || el.innerText || el.placeholder || el.className || el.tagName).trim().replace(/\\s+/g, " ").slice(0, 30);
  for (const el of document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]")) {
    if (!shown(el) || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.height < 43.5 || r.width < 39.5) // half a pixel for sub-pixel layout
      out.push("small " + el.tagName.toLowerCase() + " '" + name(el) + "' " + Math.round(r.width) + "x" + Math.round(r.height));
  }
  if (document.documentElement.scrollWidth > innerWidth) out.push("page scrolls sideways: " + document.documentElement.scrollWidth + " > " + innerWidth);
  return [...new Set(out)];
})()`;

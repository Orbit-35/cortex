# Research: queued lifting UI changes, Nov 2026

How to build the "Lifting changes queued" list in CLAUDE.md. Line numbers refer to `static/lifting/app.js` as of commit c91e6aa.

## 1. Long-press and drag to reorder: hand-rolled Pointer Events
**Why not SortableJS** (MIT, about 15 KB gzipped):
- The editor re-renders with `innerHTML`, which fights a library that moves DOM nodes.
- Supersets need custom drop rules.
- The app already hand-rolls swipe-to-delete.
- There are fewer than 10 cards.
- No dependency to cache for offline use.

SortableJS stays the fallback, with `delay:400, delayOnTouchOnly, touchStartThreshold:5, forceFallback`.

**How it works:**
- **Start:** a 400 ms hold on `.ex` that isn't an input or set row. Moving more than 8 px before the timer cancels the hold, so normal scrolling still works.
- **Lift:** add a dashed pink drop slot where the card was, take the card out of the flow (`position:absolute`), add a shadow and scale 1.02, call `setPointerCapture`, and buzz briefly (`navigator.vibrate(12)`, or `@capacitor/haptics` in the app).
- **Move:** follow the finger with `translateY` and work out the target index from the card midpoints. The slot moves there, and the other cards reflow (FLIP for smooth sliding later). Auto-scroll within 80 px of the edges.
- **Scroll conflict:** a `touchmove` listener on `#editor` with `{passive:false}` calls `preventDefault()` only while dragging. `touch-action` can't change mid-gesture.
- **Drop:**
  - splice `editor.draft.exercises`
  - fix supersets: a moved card that's no longer next to its group leaves it, and a group of one is cleared
  - `changed()`, then `renderEditor()`
- **After the drop:** swallow the one click that follows release.
- **Clean-up:** call `preventDefault` on `contextmenu` except in inputs, and blur the focused input when the card lifts.
- **Optional:** collapse cards to their headers while reordering.
- **Remove:** Move up/down from the menus.
- About 90 lines, going after the swipe code at ~559.

## 2. No text selection on long-press
```css
body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
input, textarea, [contenteditable], .selectable { -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; }
img, a { -webkit-user-drag: none; }
```
- Also prevent `contextmenu` outside inputs.
- The Capacitor WebView is the same engine, so this works there unchanged.

## 3. The ••• popup menu
- **One shared `<div popover role="menu">`** outside the re-rendered body, with items Add note, Add cue, Superset with next, and Remove exercise (red). Keep superset so the feature isn't lost.
- **CSS anchor positioning:**
  - `position-area: block-end span-inline-start` puts it below the button, aligned to the right.
  - `position-try-fallbacks: flip-block` makes it open upwards near the bottom.
  - Supported in current Chrome and Android WebView.
  - Fallback: position it by hand from `getBoundingClientRect` when `CSS.supports("anchor-name: --a")` is false.
- **Back gesture:**
  - Push `{ui:"exmenu"}` on open.
  - On `toggle` → closed, call `history.back()` if that state is current.
  - In `popstate`, call `hidePopover()`.
  - The Capacitor back button may not reach the popover's own close handling, so the history approach covers both.
- **Accessibility:**
  - `aria-haspopup="menu"` and `aria-expanded` on •••.
  - Arrow keys between items, or drop `role=menu`.
- **Check on the phone:** whether a tap outside also clicks whatever is underneath.

## 4. Icons: Lucide
- **Licence:** ISC (Feather-derived icons are MIT). Fine for a public repo; keep the notice in a comment.
- **Style:** 24×24, stroke 2, round caps, the same style as the existing tab-bar icons.
- **Implementation:** a small `static/core/icons.js` with copied path data and `icon(name)` returning an inline `<svg class="ic">`.
- **CSS:**
  ```css
  .ic { width:1.15em; height:1.15em; fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; vertical-align:-.2em; }
  ```
- **Names:**

  | Use | Icon |
  |---|---|
  | PR | `trophy` |
  | Delete | `trash-2` |
  | Pin | `pin` |
  | More (•••) | `ellipsis` |
  | Drag handle | `grip-vertical` |
  | Note | `notebook-pen` |
  | Cue | `lightbulb` (or `pin`) |
  | Close | `x` |
  | Check | `check` |
  | Superset | `link-2` |
  | Move up / down | `chevron-up` / `chevron-down` |

- **Emojis to replace:** 🏆 📝 📌 ⛓ ✕ ↑↓ 🗑 ✓. The ✓ tick column and the tick-based PR toasts are being removed anyway.
- Icon-only buttons keep an `aria-label`.

## 5. Chart with one point
- **Where:** `drawChart()` (~907) replaces fewer than 2 points with a message.
- **Why it breaks with one point:** `x()` divides by zero, and the date labels overlap.
- **Fix:**
  - If there are no points, show the message.
  - `span = t.at(-1) - t[0]`. When the span is 0, place the point in the centre.
  - Draw one centred date label.
  - Draw the line `<path>` only when there are 2+ points.
  - Dots, crosshair and tooltip already work with one point.
  - Optional hint underneath: "Log another session to see a trend."

## DESIGN.md entries when building
- the reorder gesture
- Lucide and `icons.js`
- the popover menu
- D41 changed for set deletes (no confirm)
- the tick removal

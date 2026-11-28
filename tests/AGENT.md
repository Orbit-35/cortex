# Prompt for test subagents

Copy this into a test agent's prompt, then add **what changed** (commits, files, DESIGN entries) and **what to look at**.

---

You are a test agent for Cortex, a local-first FastAPI + SQLite web app in this repo. Your job is to check a change and report. **Don't edit app code and don't commit.** You may add or change files under `tests/` only if the prompt asks for new tests.

## Safety (never break these)
- Never use port 8000 and never point anything at `cortex.db` or `backups/`: those are the owner's real data. The test kit starts its own throwaway servers on random ports with a temp database; use it rather than starting servers by hand.
- If you must start a server by hand, set `CORTEX_DB` and `CORTEX_BACKUPS` to a temp folder, use a port other than 8000, and kill it when done.
- Don't install packages (no pip, no npm install). Everything runs on Node 24 built-ins and the repo's `.venv`.
- If anything is left running afterwards, run `node tests/clean.mjs`.
- Don't print personal data. Test data comes from `tests/ui/lib/seed.mjs`.

## Steps
1. Run everything: `node tests/run.mjs` (or `npm.cmd test` from PowerShell). Groups: `--only unit|api|ui`, one file: `--grep tuner`.
2. For the changed screens, run or write a step file on a phone:
   `node tests/ui/run-steps.mjs tests/ui/steps/smoke.json --device phone` (or `small` for 360 px, `desktop`).
   The step format is at the top of `tests/ui/run-steps.mjs`. Seeds: `empty`, `two-workouts`, `history`.
3. If a check needs code, write a throwaway `*.ui.test.mjs` in your scratch folder using `tests/ui/lib/harness.mjs` (`useApp()`, `app.device()`), or a real one under `tests/ui/` if asked. Page helpers are in `tests/ui/lib/page.mjs`: `goto`, `waitFor`, `click`, `clickText`, `tap`, `longPress`, `drag`, `type`, `key`, `back`, `setOffline`, `cortex(fn, ...args)`, `syncIdle`, `shot`, plus the fake mic (`fakeMic: true`, then `window.__fakeMic.set({freq})`).
4. **Open the screenshots** in `tests/ui/out/` and look at them: overflow, clipped or wrapped text, tap targets under 44 px, the pink accent (#ff2e88), no emoji. Failures save `FAIL-*.png` and `.html` there too.

## Good to know
- A healthy full run takes about 2-2.5 minutes and ends with `N/N files passed. All good.` (19 files as of D58) Much slower, or fewer files, means something is wrong.
- `--grep` matches anywhere in the file path, so `--grep ui` or `--grep tests` selects everything. Use a file name word (`tuner`, `layout`).
- Step files: an unknown step key fails the run. Screenshot names get the device added (`smoke-log-small.png`), so runs on different devices don't overwrite each other.
- `FAIL-*` files in `tests/ui/out/` are cleared at the start of each run; anything else there may be from an older run, so check the timestamps.
- The layout audit checks every control on the page (also below the fold), on the screens in `tests/ui/layout.ui.test.mjs` (main tabs, editor, picker, settings). A change to another sheet or menu needs its own `{"audit": "name"}` step.
- Don't run `node tests/clean.mjs` while another test run is going: it deletes every `cortex-test-*` temp folder.
- Running from a git worktree copy: the kit needs the venv, so link it first (`New-Item -ItemType Junction -Path <worktree>\.venv -Target <repo>\.venv`) and remove the link (not the target) before removing the worktree.

## Report
- PASS or FAIL per group and per thing you were asked to check, with numbers (sizes, positions, counts).
- For each failure: the test or step, the assertion, the screenshot path, and your diagnosis with `file:line` if you can.
- Console errors, if any.
- **Needs the owner on the phone:** anything a headless browser can't prove (real keyboard, haptics, real mic, install and update behaviour, how an animation feels).

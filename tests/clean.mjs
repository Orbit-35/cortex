// Kill test servers and test browsers left over from a crashed run, and delete their temp folders.
// Only touches Python and browser processes whose command line contains "cortex-test-" (the marker
// test servers and test browsers carry),
// so the real server on port 8000 and your own browser are never affected.
import { execFileSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let killed = 0;
if (process.platform === "win32") {
  const ps = `Get-CimInstance Win32_Process | Where-Object { @('python.exe','msedge.exe','chrome.exe') -contains $_.Name -and $_.CommandLine -match 'cortex-test-' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }`;
  try { killed = execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).split(/\s+/).filter(Boolean).length; } catch {}
} else {
  try { execFileSync("pkill", ["-f", "(python|msedge|chrome).*cortex-test-"]); killed = 1; } catch {}
}
let removed = 0;
for (const d of readdirSync(tmpdir())) {
  if (!d.startsWith("cortex-test-")) continue;
  try { rmSync(join(tmpdir(), d), { recursive: true, force: true }); removed++; } catch {}
}
console.log(`Stopped ${killed} process(es), removed ${removed} temp folder(s).`);

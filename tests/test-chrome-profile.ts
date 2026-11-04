/**
 * Chrome profile tests — temp dirs only, no real Chrome needed.
 * Run: bun scripts/test-chrome-profile.ts
 * Checks: list from Local State, resolve by directory/name/absolute
 * path, duplicate display name error, outside-path refusal, URL
 * validation, open with a FAKE chrome binary (logs args, exits 0).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { listChromeProfiles, resolveChromeProfile, validateOpenUrl, openChromeProfile } from "../src/daemon/chrome-profile";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) { pass++; console.log(`[PASS] ${name}`); }
  else { fail++; console.log(`[FAIL] ${name} ${extra}`); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "otter-chrome-test-"));
const userDir = path.join(tmp, "User Data");
fs.mkdirSync(path.join(userDir, "Default"), { recursive: true });
fs.mkdirSync(path.join(userDir, "Profile 1"), { recursive: true });
fs.mkdirSync(path.join(userDir, "Profile 2"), { recursive: true });
fs.writeFileSync(path.join(userDir, "Local State"), JSON.stringify({
  profile: { info_cache: {
    Default: { name: "Personal" },
    "Profile 1": { name: "Work" },
    "Profile 2": { name: "Work" },
  } },
}));

// List
const listed = listChromeProfiles(userDir);
check("list 3 profiles", listed.profiles.length === 3 && listed.profiles[0].directory === "Default");
check("list names", listed.profiles.find((p) => p.directory === "Profile 1")?.name === "Work");

// Resolve
check("resolve by directory", resolveChromeProfile("Profile 1", userDir).profile.directory === "Profile 1");
check("resolve by unique display name", resolveChromeProfile("Personal", userDir).profile.directory === "Default");
check("resolve by absolute path", resolveChromeProfile(path.join(userDir, "Profile 2"), userDir).profile.directory === "Profile 2");
check("resolve default when empty", resolveChromeProfile(undefined, userDir).profile.directory === "Default");
let dup = false;
try { resolveChromeProfile("Work", userDir); } catch (e: any) { dup = /trùng|Profile 1/.test(e.message); }
check("duplicate display name refused with hint", dup);
let outside = false;
try { resolveChromeProfile("/etc/passwd", userDir); } catch (e: any) { outside = /ngoài|outside/.test(e.message) || /user-data-dir/.test(e.message); }
check("absolute path outside user-data-dir refused", outside);
let missing = false;
try { resolveChromeProfile("Nope", userDir, false); } catch { missing = true; }
check("unknown profile refused", missing);
check("new Profile 9 willCreate", resolveChromeProfile("Profile 9", userDir, true).willCreate === true);

// URL validation
check("default url chatgpt", validateOpenUrl(undefined) === "https://chatgpt.com");
check("https ok", validateOpenUrl("https://example.com/x") === "https://example.com/x");
let badUrl = false;
try { validateOpenUrl("javascript:alert(1)"); } catch { badUrl = true; }
check("javascript url refused", badUrl);

// Open with fake chrome binary
const isWin = process.platform === "win32";
const fakeChrome = path.join(tmp, isWin ? "fake-chrome.cmd" : "fake-chrome.sh");
const argLog = path.join(tmp, "args.log");
if (isWin) {
  fs.writeFileSync(fakeChrome, `@echo %* > "${argLog}"\r\n`);
} else {
  fs.writeFileSync(fakeChrome, ["#!/bin/sh", `echo "$@" > "${argLog}"`, ""].join("\n"));
  fs.chmodSync(fakeChrome, 0o755);
}
process.env.DISPLAY = ":99"; // fake display so the no-display guard passes in test only
const opened = openChromeProfile({ profile: "Profile 1", url: "https://chatgpt.com", userDataDir: userDir, chromePathOverride: fakeChrome });
// Spawn detached + unref: tiến trình con chạy bất đồng bộ, phải đợi
// nó ghi log xong mới đọc, nếu không sẽ race và đọc file chưa có.
await new Promise((r) => setTimeout(r, 500));
const args = fs.readFileSync(argLog, "utf-8");
check("open launched with pid", opened.launched && opened.pid !== null);
check("open args contain profile-directory", args.includes("--profile-directory=Profile 1"));
check("open args contain url", args.includes("https://chatgpt.com"));
check("open args no shell injection (single url arg)", !args.includes(";"));

// No-display guard: unset DISPLAY, fake chrome should NOT run
delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY;
let noDisplay = false;
try { openChromeProfile({ profile: "Profile 1", userDataDir: userDir, chromePathOverride: fakeChrome }); } catch (e: any) { noDisplay = /DISPLAY/.test(e.message); }
check("no DISPLAY refused on linux", process.platform === "linux" ? noDisplay : true);

// Custom browser (GPM-style): user supplies executable path, no
// Chrome Local State lookup, profile passed straight through.
process.env.DISPLAY = ":99";
const customLog = path.join(tmp, "custom-args.log");
const fakeGpm = path.join(tmp, isWin ? "fake-gpm.cmd" : "fake-gpm.sh");
if (isWin) {
  fs.writeFileSync(fakeGpm, `@echo %* > "${customLog}"\r\n`);
} else {
  fs.writeFileSync(fakeGpm, ["#!/bin/sh", `echo "$@" > "${customLog}"`, ""].join("\n"));
  fs.chmodSync(fakeGpm, 0o755);
}
const customOpened = openChromeProfile({ browserPath: fakeGpm, profile: "Profile 1", url: "https://chatgpt.com" });
await new Promise((r) => setTimeout(r, 500));
const customArgs = fs.readFileSync(customLog, "utf-8");
check("custom browser launched kind=custom", customOpened.browserKind === "custom" && customOpened.browserPath === fakeGpm);
check("custom browser args contain profile + url", customArgs.includes("--profile-directory=Profile 1") && customArgs.includes("https://chatgpt.com"));
const customNoProfile = openChromeProfile({ browserPath: fakeGpm, url: "https://chatgpt.com" });
await new Promise((r) => setTimeout(r, 500));
check("custom browser without profile still opens url", fs.readFileSync(customLog, "utf-8").includes("https://chatgpt.com") && customNoProfile.browserKind === "custom");
let missingBrowser = false;
try { openChromeProfile({ browserPath: path.join(tmp, "no-such-browser") }); } catch (e: any) { missingBrowser = /Không tìm thấy file trình duyệt/.test(e.message); }
check("missing custom browser path refused", missingBrowser);
delete process.env.DISPLAY; delete process.env.WAYLAND_DISPLAY;

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nChrome profile tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

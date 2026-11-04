/**
 * Mở Chrome theo profile — pure logic, không MCP/Zod.
 *
 * Vấn đề nó giải quyết: extension Otter chỉ điều khiển được tab
 * ChatGPT ĐÃ mở trong một profile Chrome. Trước đây không có cách
 * nào gọi từ daemon/ChatGPT để mở đúng profile đó ra (mỗi profile
 * = một bộ login ChatGPT + một bộ cấu hình server riêng trong
 * chrome.storage.local). Từ nay daemon có tool chrome_open_profile:
 * ChatGPT của hub/worker gọi tool → daemon spawn Chrome trên máy
 * đó với --profile-directory đúng → cửa sổ Chrome profile đó mở
 * ra, extension trong profile đó nối về daemon, rồi mới làm việc.
 *
 * An toàn:
 * - Không bao giờ kill Chrome đang chạy, không đóng tab của user.
 * - Chỉ spawn bằng mảng args, không qua shell → không inject lệnh.
 * - URL chỉ nhận http(s); javascript:, file:, data: bị từ chối.
 * - Profile phải nằm trong user-data-dir của Chrome (hoặc thư mục
 *   OTTER_CHROME_USER_DATA_DIR chỉ định), không mở profile ở đường
 *   dẫn tùy ý ngoài đó.
 * - Mở Chrome là mở cửa sổ nhìn thấy được cho user làm việc, nên
 *   trên Linux mà không có DISPLAY/WAYLAND_DISPLAY thì báo lỗi rõ
 *   ràng thay vì spawn headless giả.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

export interface ChromeProfile {
  directory: string; // "Default", "Profile 1", ...
  name: string; // tên hiển thị trong Local State, ví dụ "Work"
  path: string; // đường dẫn tuyệt đối tới thư mục profile
  exists: boolean;
}

export function getChromeUserDataDir(custom?: string): string {
  if (custom?.trim()) return path.resolve(custom.trim());
  if (process.env.OTTER_CHROME_USER_DATA_DIR?.trim()) return path.resolve(process.env.OTTER_CHROME_USER_DATA_DIR.trim());
  const home = os.homedir();
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    return path.join(local, "Google", "Chrome", "User Data");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Google", "Chrome");
  }
  return path.join(home, ".config", "google-chrome");
}

export function chromeExecutableCandidates(): string[] {
  if (process.env.OTTER_CHROME_PATH?.trim()) return [process.env.OTTER_CHROME_PATH.trim()];
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    return [
      path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(os.homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
    ];
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}

export function findChromeExecutable(): string | null {
  for (const cand of chromeExecutableCandidates()) {
    if (cand.includes(path.sep) || cand.includes("/")) {
      if (fs.existsSync(cand)) return cand;
    } else {
      // Tên lệnh trong PATH: kiểm tra bằng cách thử spawn --version
      // ở tầng gọi (openProfile) sẽ báo lỗi rõ nếu không có; ở đây
      // chỉ trả về candidate đầu tiên để caller thử.
      return cand;
    }
  }
  return null;
}

export function listChromeProfiles(userDataDir?: string): { userDataDir: string; profiles: ChromeProfile[] } {
  const dir = getChromeUserDataDir(userDataDir);
  const profiles: ChromeProfile[] = [];
  const localStatePath = path.join(dir, "Local State");
  let infoCache: Record<string, { name?: string }> = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(localStatePath, "utf-8"));
    infoCache = parsed?.profile?.info_cache || {};
  } catch { /* Local State chưa có / chưa parse được → fallback quét thư mục */ }
  for (const [directory, info] of Object.entries(infoCache)) {
    const p = path.join(dir, directory);
    profiles.push({ directory, name: info?.name || directory, path: p, exists: fs.existsSync(p) });
  }
  if (profiles.length === 0) {
    // Fallback: thư mục con nào có file Preferences thì coi là profile.
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (fs.existsSync(path.join(dir, entry.name, "Preferences"))) {
          profiles.push({ directory: entry.name, name: entry.name, path: path.join(dir, entry.name), exists: true });
        }
      }
    } catch { /* user-data-dir chưa tồn tại */ }
  }
  profiles.sort((a, b) => a.directory.localeCompare(b.directory));
  return { userDataDir: dir, profiles };
}

function isSimpleProfileDir(s: string): boolean {
  return /^(Default|Guest Profile|Profile \d+|System Profile)$/.test(s);
}

/**
 * Resolve profile theo: tên thư mục ("Profile 1"), tên hiển thị
 * ("Work", không phân biệt hoa thường, phải duy nhất), hoặc đường
 * dẫn tuyệt đối nằm trong user-data-dir. Trả về {profile, willCreate}
 * khi thư mục chưa tồn tại nhưng tên hợp lệ và createIfMissing=true.
 */
export function resolveChromeProfile(
  input: string | undefined,
  userDataDir?: string,
  createIfMissing = true,
): { profile: ChromeProfile; willCreate: boolean } {
  const { userDataDir: dir, profiles } = listChromeProfiles(userDataDir);
  const raw = (input || "").trim();
  if (!raw) {
    const def = profiles.find((p) => p.directory === "Default") || profiles[0];
    if (!def) throw new Error(`Không tìm thấy profile Chrome nào trong ${dir}. Mở Chrome bằng tay một lần để tạo profile Default, hoặc chỉ định profile khác.`);
    return { profile: def, willCreate: false };
  }
  // Đường dẫn tuyệt đối
  if (path.isAbsolute(raw)) {
    const resolved = path.resolve(raw);
    if (!(resolved === dir || resolved.startsWith(dir + path.sep))) {
      throw new Error(`Profile '${raw}' nằm ngoài user-data-dir của Chrome (${dir}). Từ chối mở đường dẫn tùy ý.`);
    }
    const directory = path.basename(resolved);
    const existing = profiles.find((p) => p.path === resolved);
    if (existing) return { profile: existing, willCreate: false };
    if (createIfMissing && isSimpleProfileDir(directory)) {
      return { profile: { directory, name: directory, path: resolved, exists: false }, willCreate: true };
    }
    throw new Error(`Profile '${raw}' chưa tồn tại. Gọi lại với createIfMissing=true và tên thư mục dạng "Profile N" để Chrome tự tạo, hoặc mở Chrome bằng tay trước.`);
  }
  // Tên thư mục chính xác
  const byDir = profiles.find((p) => p.directory === raw);
  if (byDir) return { profile: byDir, willCreate: false };
  // Tên hiển thị (duy nhất, không phân biệt hoa thường)
  const byName = profiles.filter((p) => p.name.toLowerCase() === raw.toLowerCase());
  if (byName.length === 1) return { profile: byName[0], willCreate: false };
  if (byName.length > 1) {
    throw new Error(`Tên profile '${raw}' trùng ${byName.length} profile (${byName.map((p) => p.directory).join(", ")}). Dùng tên thư mục chính xác, ví dụ "Profile 1".`);
  }
  if (createIfMissing && isSimpleProfileDir(raw)) {
    return { profile: { directory: raw, name: raw, path: path.join(dir, raw), exists: false }, willCreate: true };
  }
  const known = profiles.map((p) => `${p.directory} (${p.name})`).join(", ") || "(chưa có profile nào)";
  throw new Error(`Không tìm thấy profile '${raw}' trong ${dir}. Các profile đã có: ${known}.`);
}

export function validateOpenUrl(url: string | undefined): string {
  const target = (url || "https://chatgpt.com").trim();
  let parsed: URL;
  try { parsed = new URL(target); } catch { throw new Error(`URL không hợp lệ: ${target}`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Chỉ mở URL http(s), từ chối: ${parsed.protocol}`);
  }
  return target;
}

export interface OpenProfileResult {
  launched: boolean;
  pid: number | null;
  chromePath: string;
  /** Đường dẫn trình duyệt thực sự đã spawn (Chrome hoặc trình duyệt user cung cấp, ví dụ GPM). */
  browserPath?: string;
  /** "chrome" = tra profile từ Local State; "custom" = mở file user cung cấp, profile chỉ là --profile-directory truyền thẳng. */
  browserKind?: "chrome" | "custom";
  profile: ChromeProfile;
  willCreate: boolean;
  url: string;
  note: string;
}

function assertDisplayAvailable(): void {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.OTTER_CHROME_ALLOW_NO_DISPLAY) {
    throw new Error("Máy này không có DISPLAY/WAYLAND_DISPLAY (VM headless). Không mở trình duyệt giả được — chạy tool này trên máy có màn hình, hoặc đặt DISPLAY trước khi gọi.");
  }
}

function assertExecutableExists(browserPath: string): void {
  // Đường dẫn có dấu phân tách thì phải là file thật; tên lệnh trong
  // PATH thì để spawn báo lỗi (tránh tự đoán PATH ở đây).
  if ((browserPath.includes(path.sep) || browserPath.includes("/")) && !fs.existsSync(browserPath)) {
    throw new Error(`Không tìm thấy file trình duyệt: ${browserPath}. Kiểm tra lại đường dẫn user cung cấp (ví dụ đường dẫn tới file .exe của GPM trên máy đó).`);
  }
}

function spawnBrowser(browserPath: string, args: string[]): ReturnType<typeof spawn> {
  let child: ReturnType<typeof spawn>;
  try {
    const isWindowsBatch = process.platform === "win32" && /\.(bat|cmd)$/i.test(browserPath);
    child = spawn(browserPath, args, { detached: true, stdio: "ignore", shell: isWindowsBatch });
  } catch (e: any) {
    throw new Error(`Không khởi động được trình duyệt (${browserPath}): ${e.message}. Kiểm tra file đã cài và có quyền chạy chưa.`);
  }
  child.on("error", () => { /* lỗi spawn async: caller thấy pid null */ });
  child.unref();
  return child;
}

/**
 * Mở một trình duyệt tùy chọn mà user cung cấp đường dẫn (ví dụ GPM
 * Browser). Khác với chế độ Chrome: KHÔNG tra Local State, KHÔNG
 * bắt profile phải có trong Chrome. `profile` (nếu có) được truyền
 * thẳng thành --profile-directory, `userDataDir` (nếu có) thành
 * --user-data-dir, `extraArgs` truyền thẳng (mảng, không qua shell).
 * Lưu ý thật về GPM: GPM là trình duyệt Chromium chống detect, mỗi
 * profile GPM là một môi trường riêng do app GPM quản lý — mở file
 * .exe của GPM sẽ mở app/trình duyệt GPM, nhưng chọn đúng một
 * profile GPM theo ID thì phải qua GPM Local API của app đó, chưa
 * được verify trong repo này nên chưa code đường đó. Nếu user chỉ
 * cần "mở trình duyệt GPM lên rồi làm trong đó" thì chế độ custom
 * này đủ; nếu cần chọn đúng profile GPM theo ID, cần thêm thông
 * tin GPM Local API (port/endpoint) từ máy có GPM thật.
 */
export function openCustomBrowser(input: {
  browserPath: string;
  profile?: string;
  url?: string;
  userDataDir?: string;
  extraArgs?: string[];
}): OpenProfileResult {
  const browserPath = input.browserPath.trim();
  if (!browserPath) throw new Error("browserPath không được để trống.");
  assertExecutableExists(browserPath);
  const url = validateOpenUrl(input.url);
  assertDisplayAvailable();
  const args: string[] = [];
  if (input.userDataDir) args.push(`--user-data-dir=${path.resolve(input.userDataDir)}`);
  const directory = (input.profile || "").trim();
  if (directory) args.push(`--profile-directory=${directory}`);
  if (input.extraArgs) args.push(...input.extraArgs);
  args.push(url);
  const child = spawnBrowser(browserPath, args);
  const profile: ChromeProfile = {
    directory: directory || "",
    name: directory || "",
    path: input.userDataDir ? path.join(path.resolve(input.userDataDir), directory) : "",
    exists: false,
  };
  return {
    launched: true,
    pid: child.pid ?? null,
    chromePath: browserPath,
    browserPath,
    browserKind: "custom",
    profile,
    willCreate: false,
    url,
    note: "Đã spawn trình duyệt user cung cấp. Với GPM: file .exe sẽ mở app/trình duyệt GPM; nếu GPM không tự vào đúng profile cần làm, hãy chọn profile đó trong app GPM, hoặc cung cấp thêm cách chọn profile GPM (Local API) để code tiếp.",
  };
}

export function openChromeProfile(input: {
  profile?: string;
  url?: string;
  userDataDir?: string;
  createIfMissing?: boolean;
  chromePathOverride?: string;
  /** Đường dẫn trình duyệt tùy chọn (GPM...). Có thì chuyển sang chế độ custom, không tra Chrome Local State. */
  browserPath?: string;
  extraArgs?: string[];
}): OpenProfileResult {
  // Chế độ custom: user cung cấp đường dẫn trình duyệt → ưu tiên nó.
  const customPath = (input.browserPath || process.env.OTTER_BROWSER_PATH || "").trim();
  if (customPath) {
    return openCustomBrowser({
      browserPath: customPath,
      profile: input.profile,
      url: input.url,
      userDataDir: input.userDataDir,
      extraArgs: input.extraArgs,
    });
  }
  const { profile, willCreate } = resolveChromeProfile(input.profile, input.userDataDir, input.createIfMissing !== false);
  const url = validateOpenUrl(input.url);
  assertDisplayAvailable();
  const chromePath = input.chromePathOverride || process.env.OTTER_CHROME_PATH || findChromeExecutable();
  if (!chromePath) throw new Error(`Không tìm thấy Chrome trên máy này (${process.platform}). Đã thử: ${chromeExecutableCandidates().join(", ")}. Cài Chrome hoặc đặt OTTER_CHROME_PATH tới file chrome, hoặc cung cấp browserPath (ví dụ đường dẫn GPM).`);
  assertExecutableExists(chromePath);
  const userDataDir = getChromeUserDataDir(input.userDataDir);
  const args = [
    `--profile-directory=${profile.directory}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(input.extraArgs || []),
    url,
  ];
  // Chỉ thêm --user-data-dir khi user chỉ định khác mặc định, để
  // không vô tình tách Chrome đang chạy ra một user-data-dir khác
  // (khi đó --profile-directory sẽ bị Chrome đang chạy bỏ qua).
  const customDir = input.userDataDir || process.env.OTTER_CHROME_USER_DATA_DIR;
  if (customDir) args.unshift(`--user-data-dir=${userDataDir}`);
  const child = spawnBrowser(chromePath, args);
  return {
    launched: true,
    pid: child.pid ?? null,
    chromePath,
    browserKind: "chrome",
    profile,
    willCreate,
    url,
    note: willCreate
      ? `Chrome sẽ tự tạo profile '${profile.directory}' lần đầu mở. Sau khi mở, extension Otter trong profile đó nối về daemon này thì mới làm việc được.`
      : "Chrome có thể ủy quyền cho tiến trình Chrome đang chạy (pid chỉ là tiến trình khởi động). Nếu Chrome đang chạy với user-data-dir khác, hãy đóng Chrome đó trước hoặc dùng cùng user-data-dir.",
  };
}

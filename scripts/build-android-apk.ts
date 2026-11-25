/**
 * Biên dịch & ký số ứng dụng Android "Otter Phone" (tools/phone-cloud/android)
 * Xuất file thành phẩm vào deploy/otter-phone.apk và dọn sạch bộ nhớ đệm Gradle
 * để không làm phình dung lượng gói tools.tar.gz hay kho Git.
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync, execSync } from "node:child_process";

const rootDir = process.cwd();
const androidDir = path.join(rootDir, "tools", "phone-cloud", "android");
const deployDir = path.join(rootDir, "deploy");
const outApkPath = path.join(deployDir, "otter-phone.apk");
const forceBuild = process.argv.includes("--force");

function exists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function newestMtimeMs(dir: string): number {
  let latest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".gradle" || entry.name === "build" || entry.name === "local.properties") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = newestMtimeMs(full);
      if (sub > latest) latest = sub;
    } else {
      const st = fs.statSync(full);
      if (st.mtimeMs > latest) latest = st.mtimeMs;
    }
  }
  return latest;
}

if (!forceBuild && exists(outApkPath) && exists(androidDir)) {
  const apkMtime = fs.statSync(outApkPath).mtimeMs;
  const srcMtime = newestMtimeMs(androidDir);
  if (apkMtime >= srcMtime) {
    const stat = fs.statSync(outApkPath);
    console.log(
      `[+] Gói APK đã ở bản mới nhất: ${outApkPath} (${(stat.size / (1024 * 1024)).toFixed(2)} MB) — bỏ qua biên dịch lại Gradle.`
    );
    process.exit(0);
  }
}

function findJdk17(): string | null {
  const envJava = process.env.OTTER_JAVA_HOME || process.env.JAVA_HOME;
  if (envJava && exists(path.join(envJava, "bin", process.platform === "win32" ? "java.exe" : "java"))) {
    return envJava;
  }
  if (process.platform === "win32") {
    const roots = ["C:\\Program Files\\Eclipse Adoptium", "C:\\Program Files\\Java", "C:\\Program Files\\Microsoft"];
    for (const r of roots) {
      if (!exists(r)) continue;
      const dirs = fs
        .readdirSync(r)
        .filter((d) => d.toLowerCase().includes("jdk-17") || d.toLowerCase().includes("jdk-21"))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const d of dirs) {
        const candidate = path.join(r, d);
        if (exists(path.join(candidate, "bin", "java.exe"))) return candidate;
      }
    }
  }
  return null;
}

function findAndroidSdk(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    "C:\\Android",
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Android", "Sdk"),
    path.join(os.homedir(), "Android", "Sdk"),
    path.join(os.homedir(), "Library", "Android", "sdk"),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (exists(path.join(c, "platforms"))) return c;
  }
  return null;
}

function findGradleBin(): string | null {
  const isWin = process.platform === "win32";
  const binName = isWin ? "gradle.bat" : "gradle";
  const wrapper = path.join(androidDir, isWin ? "gradlew.bat" : "gradlew");
  if (exists(wrapper)) return wrapper;

  const distsRoot = path.join(os.homedir(), ".gradle", "wrapper", "dists");
  if (exists(distsRoot)) {
    const distDirs = fs
      .readdirSync(distsRoot)
      .filter((d) => d.startsWith("gradle-8."))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const distName of distDirs) {
      const distPath = path.join(distsRoot, distName);
      for (const hashDir of fs.readdirSync(distPath)) {
        const hashPath = path.join(distPath, hashDir);
        if (!fs.statSync(hashPath).isDirectory()) continue;
        for (const inner of fs.readdirSync(hashPath)) {
          const candidate = path.join(hashPath, inner, "bin", binName);
          if (exists(candidate)) return candidate;
        }
      }
    }
  }
  return null;
}

async function cleanupAndroidBuildArtifacts() {
  const targets = [
    path.join(androidDir, ".gradle"),
    path.join(androidDir, "build"),
    path.join(androidDir, "app", "build"),
    path.join(androidDir, "local.properties"),
  ];
  for (const t of targets) {
    await fsp.rm(t, { recursive: true, force: true }).catch(() => {});
  }
}

const javaHome = findJdk17();
const androidSdk = findAndroidSdk();
const gradleBin = findGradleBin();

if (!javaHome || !androidSdk || !gradleBin) {
  console.warn(
    `[!] Thiếu công cụ build Android APK (JDK=${javaHome || "missing"}, SDK=${androidSdk || "missing"}, Gradle=${gradleBin || "missing"}).`
  );
  if (exists(outApkPath)) {
    console.log(`[+] Giữ nguyên gói APK hiện có tại: ${outApkPath}`);
    process.exit(0);
  }
  process.exit(1);
}

console.log(`[*] Build Otter Phone APK:`);
console.log(`    - JAVA_HOME   : ${javaHome}`);
console.log(`    - ANDROID_SDK : ${androidSdk}`);
console.log(`    - GRADLE      : ${gradleBin}`);

await fsp.mkdir(deployDir, { recursive: true });

// Đảm bảo keystore ký phát hành luôn sẵn sàng tại ~/.otter/otter-phone-release.jks
const otterDotDir = path.join(os.homedir(), ".otter");
const keystorePath = path.join(otterDotDir, "otter-phone-release.jks");
if (!exists(keystorePath)) {
  await fsp.mkdir(otterDotDir, { recursive: true });
  const keytool = path.join(javaHome, "bin", process.platform === "win32" ? "keytool.exe" : "keytool");
  execFileSync(
    keytool,
    [
      "-genkeypair",
      "-v",
      "-keystore",
      keystorePath,
      "-alias",
      "otterphone",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-storepass",
      "otter2026release",
      "-keypass",
      "otter2026release",
      "-dname",
      "CN=Otter Phone, OU=Otter AI, O=PTN, L=HCMC, S=VN, C=VN",
    ],
    { stdio: "inherit" }
  );
}

// Ghi local.properties trỏ tới Android SDK (dùng dấu / để Java Properties đọc chuẩn trên Windows)
const sdkNormalized = androidSdk.replace(/\\/g, "/");
await fsp.writeFile(path.join(androidDir, "local.properties"), `sdk.dir=${sdkNormalized}\n`, "utf8");

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdk,
  ANDROID_SDK_ROOT: androidSdk,
  OTTER_ANDROID_KEYSTORE: keystorePath,
  PATH: `${path.join(javaHome, "bin")}${path.delimiter}${process.env.PATH || ""}`,
};

try {
  execSync(`"${gradleBin}" assembleRelease --no-daemon`, {
    cwd: androidDir,
    env,
    stdio: "inherit",
  });

  const builtApk = path.join(androidDir, "app", "build", "outputs", "apk", "release", "app-release.apk");
  if (!exists(builtApk)) {
    throw new Error(`Không tìm thấy file APK đầu ra tại ${builtApk}`);
  }

  await fsp.copyFile(builtApk, outApkPath);
  const stat = await fsp.stat(outApkPath);
  console.log(`[+] Đã xuất gói APK đã ký số: ${outApkPath} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
} finally {
  await cleanupAndroidBuildArtifacts();
}

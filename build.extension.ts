import * as fs from "node:fs/promises";
import * as path from "node:path";

console.log("[*] Compiling & Bundling Otter Extension with TypeScript (Bun.build)...");

const extDir = path.resolve("extension");
const distDir = path.resolve("extension/dist");

await fs.mkdir(distDir, { recursive: true });

// 1. Bundle TypeScript Entrypoints
const buildResult = await Bun.build({
  entrypoints: [
    path.join(extDir, "src/background/background.ts"),
    path.join(extDir, "src/content/content.ts"),
    path.join(extDir, "src/options/options.ts"),
    path.join(extDir, "src/sidepanel/sidepanel.ts")
  ],
  outdir: distDir,
  target: "browser",
  minify: !process.argv.includes("--dev"),
  naming: "[name].[ext]"
});

if (!buildResult.success) {
  console.error("[-] Bun build failed:");
  for (const log of buildResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

// 2. Helper copy folder recursive
async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

// 3. Sao chép tài nguyên tĩnh sang dist
const staticFiles = ["manifest.json", "options.html", "theme.css", "plan-overlay.css", "sidepanel.html", "sidepanel.css"];
for (const file of staticFiles) {
  const src = path.join(extDir, file);
  const dest = path.join(distDir, file);
  try {
    await fs.copyFile(src, dest);
  } catch (err) {
    console.warn(`[!] Skipping missing static file: ${file}`);
  }
}

// Sao chép _locales (Chrome i18n) — bắt buộc để default_locale và __MSG__ hoạt động khi load dist/
await copyDir(path.join(extDir, "_locales"), path.join(distDir, "_locales"));

// Sao chép thư mục vendor và icons
await copyDir(path.join(extDir, "vendor"), path.join(distDir, "vendor"));
if (await fs.stat(path.join(extDir, "icons")).then(() => true).catch(() => false)) {
  await copyDir(path.join(extDir, "icons"), path.join(distDir, "icons"));
}

// Sao chép các tệp js đã bundle ra thư mục extension/ gốc để người dùng có thể load cả 2 thư mục
await fs.copyFile(path.join(distDir, "background.js"), path.join(extDir, "background.js"));
await fs.copyFile(path.join(distDir, "content.js"), path.join(extDir, "content.js"));
await fs.copyFile(path.join(distDir, "options.js"), path.join(extDir, "options.js"));
await fs.copyFile(path.join(distDir, "sidepanel.js"), path.join(extDir, "sidepanel.js"));

console.log("[+] Build completed successfully!");
console.log(`[+] Output in: ${distDir}`);
console.log("[+] Load either 'extension/' (after build) or 'extension/dist/' into chrome://extensions");

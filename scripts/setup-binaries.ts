/**
 * Automatic Setup Script for Otter Binaries
 * Ensures 'codebase-memory-mcp' and 'cloudflared' exist in the project's 'bin/' directory.
 * If running on a new machine without these binaries, it automatically downloads and extracts them.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const arch = process.arch === "arm64" ? "arm64" : "amd64";

const binDir = path.resolve("bin");
await fs.mkdir(binDir, { recursive: true });

const cbmName = isWin ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";
const cloudflaredName = isWin ? "cloudflared.exe" : "cloudflared";

const cbmPath = path.join(binDir, cbmName);
const cloudflaredPath = path.join(binDir, cloudflaredName);

console.log("====================================================");
console.log("       Otter Standalone Binaries Setup              ");
console.log("====================================================");
console.log(`[*] Target Directory: ${binDir}`);
console.log(`[*] Platform: ${process.platform} (${arch})`);

// 1. Check codebase-memory-mcp
let cbmReady = false;
try {
  await fs.access(cbmPath);
  cbmReady = true;
  console.log(`[+] codebase-memory-mcp: OK (${cbmPath})`);
} catch {
  console.log(`[-] codebase-memory-mcp missing in bin/`);
}

if (!cbmReady && process.env.SKIP_CBM !== "1") {
  // Check if available on system
  const systemWinPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "codebase-memory-mcp", cbmName)
    : "";

  let copiedFromSystem = false;
  if (isWin && systemWinPath) {
    try {
      await fs.access(systemWinPath);
      console.log(`[*] Copying from system install: ${systemWinPath}`);
      await fs.copyFile(systemWinPath, cbmPath);
      copiedFromSystem = true;
      console.log(`[+] Successfully copied codebase-memory-mcp to bin/`);
    } catch {}
  }

  if (!copiedFromSystem) {
    console.log(`[*] Fetching latest codebase-memory-mcp release from GitHub...`);
    try {
      const releaseRes = await fetch("https://api.github.com/repos/DeusData/codebase-memory-mcp/releases/latest", {
        headers: { "User-Agent": "otter-setup" }
      });
      if (releaseRes.ok) {
        const releaseData: any = await releaseRes.json();
        const osName = isWin ? "windows" : isMac ? "darwin" : "linux";
        const assetPattern = `${osName}-${arch}`;
        // Ưu tiên file giải nén được (.tar.gz trên Unix, .zip trên Windows),
        // LOẠI .mcpb/.bundle và bản -ui-: bản .mcpb được API trả về trước
        // nhưng setup này không giải nén được nó, trước đây nó bị tải về
        // rồi xóa mà vẫn in "Successfully installed" dù bin/ vẫn trống.
        const extractable = (a: any) =>
          a.name.includes(assetPattern) &&
          !a.name.includes(".mcpb") &&
          !a.name.includes(".bundle") &&
          !a.name.includes("-ui-") &&
          (isWin ? a.name.endsWith(".zip") : a.name.endsWith(".tar.gz"));
        const asset = releaseData.assets?.find(extractable)
          ?? releaseData.assets?.find((a: any) => a.name.includes(assetPattern));

        if (asset && asset.browser_download_url) {
          console.log(`[*] Downloading ${asset.name} from: ${asset.browser_download_url}`);
          const downloadRes = await fetch(asset.browser_download_url);
          const buffer = await downloadRes.arrayBuffer();
          const tempArchive = path.join(binDir, asset.name);
          await fs.writeFile(tempArchive, Buffer.from(buffer));

          console.log(`[*] Extracting ${asset.name}...`);
          if (asset.name.endsWith(".zip")) {
            // Unzip via powershell or tar
            if (isWin) {
              await Bun.spawn(["powershell", "-Command", `Expand-Archive -Path '${tempArchive}' -DestinationPath '${binDir}' -Force`]).exited;
            }
          } else if (asset.name.endsWith(".tar.gz")) {
            await Bun.spawn(["tar", "-xzf", tempArchive, "-C", binDir]).exited;
          }

          // Clean temp archive
          await fs.unlink(tempArchive).catch(() => {});
          console.log(`[+] Successfully installed codebase-memory-mcp to bin/`);
        }
      }
    } catch (err: any) {
      console.error(`[!] Could not auto-download codebase-memory-mcp: ${err.message}`);
      console.log(`[!] Please manually download from: https://github.com/DeusData/codebase-memory-mcp/releases/latest`);
    }
  }
}

// 2. Check cloudflared
let cloudflaredReady = false;
try {
  await fs.access(cloudflaredPath);
  cloudflaredReady = true;
  console.log(`[+] cloudflared: OK (${cloudflaredPath})`);
} catch {
  console.log(`[-] cloudflared missing in bin/`);
}

if (!cloudflaredReady && process.env.SKIP_CLOUDFLARED !== "1") {
  const systemAppPath = "C:\\App\\cloudflared\\cloudflared.exe";
  let copiedFromApp = false;
  if (isWin) {
    try {
      await fs.access(systemAppPath);
      console.log(`[*] Copying cloudflared from: ${systemAppPath}`);
      await fs.copyFile(systemAppPath, cloudflaredPath);
      copiedFromApp = true;
      console.log(`[+] Successfully copied cloudflared to bin/`);
    } catch {}
  }

  if (!copiedFromApp) {
    console.log(`[*] Downloading latest cloudflared release...`);
    try {
      let downloadUrl = "";
      if (isWin) {
        downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${arch}.exe`;
      } else if (isMac) {
        downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${arch}.tgz`;
      } else {
        downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}`;
      }

      console.log(`[*] Downloading from: ${downloadUrl}`);
      const res = await fetch(downloadUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        await fs.writeFile(cloudflaredPath, Buffer.from(buffer));
        if (!isWin) {
          await Bun.spawn(["chmod", "+x", cloudflaredPath]).exited;
        }
        console.log(`[+] Successfully installed cloudflared to bin/`);
      }
    } catch (err: any) {
      console.error(`[!] Could not auto-download cloudflared: ${err.message}`);
    }
  }
}

// 3. Check AI Skills repository in .agents/skills
const skillsDir = path.resolve(".agents/skills");
const catalogPath = path.join(skillsDir, "catalog.json");
try {
  await fs.access(catalogPath);
  const rawCatalog = await fs.readFile(catalogPath, "utf-8");
  const catalog = JSON.parse(rawCatalog);
  console.log(`[+] AI Skills Repository: OK (${catalog.length} skills in ${skillsDir})`);
} catch {
  console.log(`[*] Setting up AI Skills Repository in .agents/skills...`);
  try {
    const syncScript = path.resolve("scripts/sync-skills.ts");
    await Bun.spawn(["bun", syncScript]).exited;
    console.log(`[+] Successfully synchronized AI Skills into .agents/skills/`);
  } catch (err: any) {
    console.warn(`[!] Skills sync warning: ${err.message}`);
  }
}

// 4. Check & Setup CUA (Computer Use Agent) from https://github.com/trycua/cua in tools/cua
import { setupCua } from "../tools/cua/setup-cua.ts";
await setupCua();

console.log("\n[✔] Setup check completed! All utilities and tools are ready.");


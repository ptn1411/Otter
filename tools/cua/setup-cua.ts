/**
 * Setup script for CUA (Computer-Use Agent from https://github.com/trycua/cua)
 * Downloads and sets up the latest Cua Driver & CUA SDK into tools/cua/
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export async function setupCua(): Promise<boolean> {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const ext = isMac ? "dylib" : (isWin ? "dll" : "so");
  const driverName = isWin ? "cua-driver.exe" : "cua-driver";
  const sdkName = `cua_driver_sdk.${ext}`;

  const cuaDir = path.resolve("tools/cua");
  await fs.mkdir(cuaDir, { recursive: true });

  const driverPath = path.join(cuaDir, driverName);
  const sdkPath = path.join(cuaDir, sdkName);

  // 1. Kiểm tra đã có sẵn trong tools/cua chưa
  let hasDriver = false;
  let hasSdk = false;
  try {
    await fs.access(driverPath);
    hasDriver = true;
  } catch {}
  try {
    await fs.access(sdkPath);
    hasSdk = true;
  } catch {}

  if (hasDriver && hasSdk) {
    console.log(`[+] CUA (Computer Use Agent) Runtime: OK (${cuaDir})`);
    return true;
  }

  // 2. Kiểm tra nếu đã có trong hệ thống Windows / Unix
  const systemCandidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Cua", "cua-driver", "bin") : "",
    path.join(os.homedir(), ".cua-driver", "packages", "current"),
  ].filter(Boolean);

  for (const sysDir of systemCandidates) {
    try {
      const sysDriver = path.join(sysDir, driverName);
      const sysSdk = path.join(sysDir, sdkName);
      await fs.access(sysDriver);
      await fs.access(sysSdk);
      console.log(`[*] Copying CUA driver from system installation: ${sysDir}`);
      await fs.copyFile(sysDriver, driverPath);
      await fs.copyFile(sysSdk, sdkPath);
      console.log(`[+] CUA Runtime successfully copied to ${cuaDir}`);
      return true;
    } catch {}
  }

  // 3. Tải từ GitHub Releases (https://github.com/trycua/cua)
  console.log(`[*] Fetching latest CUA Driver from https://github.com/trycua/cua ...`);
  try {
    const res = await fetch("https://api.github.com/repos/trycua/cua/releases?per_page=15", {
      headers: { "User-Agent": "otter-cua-setup" }
    });
    if (!res.ok) throw new Error(`GitHub API returned status ${res.status}`);
    const releases = await res.json();
    if (!Array.isArray(releases)) throw new Error("Invalid response from GitHub Releases");

    // Tìm release nightly-cua-driver-rs mới nhất
    const driverRel = releases.find((r: any) => r.tag_name?.includes("nightly-cua-driver-rs") || r.tag_name?.includes("cua-driver"));
    if (!driverRel) throw new Error("Could not find CUA driver release tag");

    // Xác định asset tương ứng với nền tảng
    let targetPattern = "";
    if (isWin) {
      targetPattern = "windows-x86_64";
    } else if (isMac) {
      targetPattern = process.arch === "arm64" ? "darwin-arm64" : "darwin-universal";
    } else {
      targetPattern = process.arch === "arm64" ? "linux-arm64" : "linux-x86_64";
    }

    const asset = driverRel.assets?.find((a: any) =>
      a.name.includes(targetPattern) &&
      (a.name.endsWith(".zip") || a.name.endsWith(".tar.gz"))
    );

    if (!asset) {
      throw new Error(`No matching asset for ${targetPattern} in release ${driverRel.tag_name}`);
    }

    console.log(`[*] Downloading ${asset.name} (${(asset.size / (1024 * 1024)).toFixed(1)} MB)...`);
    const dlRes = await fetch(asset.browser_download_url);
    if (!dlRes.ok) throw new Error(`Failed to download ${asset.browser_download_url}`);
    const buf = await dlRes.arrayBuffer();
    const tempFile = path.join(cuaDir, asset.name);
    await fs.writeFile(tempFile, Buffer.from(buf));

    console.log(`[*] Extracting ${asset.name} into ${cuaDir} ...`);
    if (asset.name.endsWith(".zip")) {
      if (isWin) {
        await Bun.spawn(["powershell", "-Command", `Expand-Archive -Path '${tempFile}' -DestinationPath '${cuaDir}' -Force`]).exited;
      }
    } else if (asset.name.endsWith(".tar.gz")) {
      await Bun.spawn(["tar", "-xzf", tempFile, "-C", cuaDir]).exited;
    }
    await fs.unlink(tempFile).catch(() => {});

    console.log(`[+] CUA (Computer Use Agent) successfully installed in ${cuaDir}!`);
    return true;
  } catch (err: any) {
    console.warn(`[!] Auto-setup of CUA failed: ${err.message}`);
    console.log(`[*] To manually install CUA driver, visit: https://github.com/trycua/cua`);
    if (isWin) {
      console.log(`    Or run in PowerShell: irm https://cua.ai/driver/install.ps1 | iex`);
    }
    return false;
  }
}

if (import.meta.main) {
  await setupCua();
}


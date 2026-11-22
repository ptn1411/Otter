/**
 * Minimal setup helper for agent-desktop (github.com/vercel-labs/agent-desktop)
 */
import { executeCommand } from "../../src/daemon/terminal";
import { findAgentDesktopCommand } from "../../src/daemon/agent-desktop";

export async function setupAgentDesktop(): Promise<boolean> {
  console.log("[*] Checking agent-desktop installation...");
  const cmd = findAgentDesktopCommand();

  if (cmd) {
    const res = await executeCommand(`"${cmd}" --version`);
    const version = res.stdout?.trim() || "unknown";
    console.log(`[+] agent-desktop is installed at: ${cmd} (${version})`);
    return true;
  }

  console.log("[!] agent-desktop is not found on PATH.");
  console.log("[*] Attempting global install: npm install -g agent-desktop ...");
  try {
    const res = await executeCommand("npm install -g agent-desktop");
    if (res.exitCode === 0) {
      console.log("[+] Successfully installed agent-desktop globally via npm!");
      return true;
    }
    console.warn(`[!] npm install returned exit code ${res.exitCode}: ${res.stderr || res.stdout}`);
  } catch (err: any) {
    console.warn(`[!] Auto-install failed: ${err.message}`);
  }

  console.log("[*] Manual install command: npm install -g agent-desktop");
  return false;
}

if (import.meta.main) {
  await setupAgentDesktop();
}

/**
 * Legacy Shared Folder Adapter (Phase 2 Migration Helper)
 * 
 * Bridges /home/nam/muse-shared/inbox/<bot>/ files into Otter's A2A SQLite inbox.
 * Any legacy script or bot dropping files into the shared folder during transition
 * is automatically migrated to Otter DB so nothing is lost or stalled.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { sendInboxMessage } from "./a2a-inbox";
import { getDatabase } from "./db";

type DbLike = ReturnType<typeof getDatabase>;

export interface FolderMigrationResult {
  scanned: number;
  migrated: number;
  errors: string[];
}

export function getSharedFolderPath(): string {
  return process.env.MUSE_SHARED_DIR || (process.platform === "win32" ? "C:\\Users\\NAM\\muse-shared" : "/home/nam/muse-shared");
}

/**
 * Scans the shared folder inbox directory and ingests tasks into Otter A2A.
 */
export async function scanAndMigrateLegacyFolder(
  baseDir: string = getSharedFolderPath(),
  db: DbLike = getDatabase()
): Promise<FolderMigrationResult> {
  const result: FolderMigrationResult = { scanned: 0, migrated: 0, errors: [] };
  const inboxDir = path.join(baseDir, "inbox");

  try {
    const stat = await fs.stat(inboxDir);
    if (!stat.isDirectory()) return result;
  } catch {
    // Shared folder does not exist on this machine; gracefully return
    return result;
  }

  try {
    const botFolders = await fs.readdir(inboxDir);
    for (const botName of botFolders) {
      const botInboxPath = path.join(inboxDir, botName);
      const bStat = await fs.stat(botInboxPath).catch(() => null);
      if (!bStat || !bStat.isDirectory()) continue;

      const files = await fs.readdir(botInboxPath).catch(() => []);
      for (const file of files) {
        if (file.startsWith(".") || file.endsWith(".migrated") || file.endsWith(".bak")) continue;
        const filePath = path.join(botInboxPath, file);
        result.scanned++;

        try {
          const content = await fs.readFile(filePath, "utf8");
          const recipientId = botName.startsWith("ai_") || botName.startsWith("user_") ? botName : `ai_${botName}`;

          // Parse first line as goal, rest as details
          const lines = content.split("\n");
          const goal = lines[0]?.replace(/^[#\s*\-]+/, "").trim() || `Task from ${file}`;
          const details = lines.slice(1).join("\n").trim() || undefined;

          // Dispatch to Otter A2A Store-and-Forward Inbox
          const msg = await sendInboxMessage({
            senderId: "legacy_folder",
            recipientId,
            goal,
            details,
            payload: { legacyFile: file, legacyPath: filePath },
          }, db);

          // Mark file as migrated / archived
          const archiveDir = path.join(baseDir, "archive", botName);
          await fs.mkdir(archiveDir, { recursive: true }).catch(() => {});
          const archivePath = path.join(archiveDir, `${Date.now()}_${file}.migrated`);
          await fs.rename(filePath, archivePath).catch(async () => {
            // Fallback: write .migrated marker in place
            await fs.rename(filePath, `${filePath}.migrated`);
          });

          result.migrated++;
          console.log(`[FolderAdapter] 📦 Migrated legacy file ${file} -> A2A #${msg.id} for @${recipientId}`);
        } catch (fileErr: any) {
          result.errors.push(`Error migrating ${file}: ${fileErr.message}`);
        }
      }
    }
  } catch (err: any) {
    result.errors.push(`Scan error: ${err.message}`);
  }

  return result;
}

let watcherTimer: NodeJS.Timeout | null = null;

export function startLegacyFolderWatcher(intervalMs: number = 30_000): void {
  if (watcherTimer) return;
  watcherTimer = setInterval(async () => {
    try {
      await scanAndMigrateLegacyFolder();
    } catch {}
  }, intervalMs);
}

export function stopLegacyFolderWatcher(): void {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
}

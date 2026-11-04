import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

export interface SkillItem {
  name: string;
  description: string;
  path: string;
  skillMdPath: string;
  hasScripts: boolean;
  hasReferences: boolean;
}

export function getSkillSearchDirs(): string[] {
  const home = os.homedir();
  const dirs = [
    path.resolve(".agents/skills"),
    path.join(home, ".gemini", "config", "skills"),
    path.join(home, ".gemini", "antigravity", "builtin", "skills")
  ];
  return dirs;
}

function parseSkillDescription(content: string, fallbackName: string): string {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (match) {
    const descMatch = match[1].match(/description:\s*(?:>-\s*|>\s*|"?)(.*?)(?:\n[a-zA-Z0-9_\-]+:|$)/s);
    if (descMatch) {
      return descMatch[1].replace(/\r?\n\s*/g, " ").replace(/^["']|["']$/g, "").trim();
    }
  }
  const lines = content.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const firstParagraph = lines.find(l => !l.startsWith("#") && !l.startsWith("---"));
  return firstParagraph ? firstParagraph.slice(0, 200) : `Skill ${fallbackName}`;
}

let cachedSkills: SkillItem[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 15000;

export async function getAllSkills(forceRefresh = false): Promise<SkillItem[]> {
  const now = Date.now();
  if (!forceRefresh && cachedSkills && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedSkills;
  }

  const searchDirs = getSkillSearchDirs();
  const skillsMap = new Map<string, SkillItem>();

  for (const baseDir of searchDirs) {
    try {
      const entries = await fs.readdir(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillName = entry.name;
        if (skillsMap.has(skillName)) continue; // giữ skill ưu tiên trước

        const skillDir = path.join(baseDir, skillName);
        const skillMd = path.join(skillDir, "SKILL.md");

        try {
          const content = await fs.readFile(skillMd, "utf-8");
          const desc = parseSkillDescription(content, skillName);

          let hasScripts = false;
          let hasReferences = false;
          try {
            const subs = await fs.readdir(skillDir);
            hasScripts = subs.includes("scripts");
            hasReferences = subs.includes("references") || subs.includes("resources");
          } catch {}

          skillsMap.set(skillName, {
            name: skillName,
            description: desc,
            path: skillDir,
            skillMdPath: skillMd,
            hasScripts,
            hasReferences
          });
        } catch {
          // Bỏ qua thư mục không có SKILL.md
        }
      }
    } catch {
      // Bỏ qua thư mục không tồn tại
    }
  }

  const result = Array.from(skillsMap.values());
  cachedSkills = result;
  cacheTimestamp = now;
  return result;
}

export async function findSkillMarkdown(skillName: string): Promise<string | null> {
  // Chống Path Traversal: Khử khuẩn tên skill, chỉ nhận ký tự an toàn
  const sanitizedName = path.basename(skillName).replace(/[^a-zA-Z0-9_\-]/g, "");
  if (!sanitizedName) return null;

  const searchDirs = getSkillSearchDirs();
  for (const baseDir of searchDirs) {
    const candidate = path.join(baseDir, sanitizedName, "SKILL.md");
    try {
      const content = await fs.readFile(candidate, "utf-8");
      return content;
    } catch {}
  }
  return null;
}


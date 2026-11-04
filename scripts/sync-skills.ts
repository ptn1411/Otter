/**
 * Script đồng bộ và tinh gọn kho lưu trữ Skill vào .agents/skills
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const ALLOWED_SKILLS = ["remotion-video-creator", "video-shotcraft"];

async function main() {
  const projectRoot = path.resolve(".");
  const targetSkillsDir = path.join(projectRoot, ".agents", "skills");

  await fs.mkdir(targetSkillsDir, { recursive: true });

  const homeDir = os.homedir();
  const sourceSkillsDir = path.join(homeDir, ".gemini", "config", "skills");

  console.log("====================================================");
  console.log(`      Otter Video Skill Setup (${ALLOWED_SKILLS.join(", ")})    `);
  console.log("====================================================");

  // 1. Tự động giữ lại các skill đã cài đặt (có chứa SKILL.md)
  const existingDirs = await fs.readdir(targetSkillsDir, { withFileTypes: true });
  const activeSkills = new Set(ALLOWED_SKILLS);
  for (const item of existingDirs) {
    if (item.isDirectory()) {
      try {
        await fs.access(path.join(targetSkillsDir, item.name, "SKILL.md"));
        activeSkills.add(item.name);
      } catch {}
    }
  }

  interface SkillMetadata {
    name: string;
    description: string;
    path: string;
    skillMdPath: string;
    hasScripts: boolean;
    hasReferences: boolean;
  }

  const catalog: SkillMetadata[] = [];
  const allSkillsList = Array.from(activeSkills);

  for (const skillName of allSkillsList) {
    const destSkillPath = path.join(targetSkillsDir, skillName);
    const srcSkillPath = path.join(sourceSkillsDir, skillName);

    // Nếu chưa có trong target, copy từ nguồn
    let exists = false;
    try {
      await fs.access(destSkillPath);
      exists = true;
    } catch {}

    if (!exists) {
      try {
        console.log(`[*] Copy ${skillName} từ nguồn...`);
        await fs.cp(srcSkillPath, destSkillPath, { recursive: true, force: true });
      } catch (err: any) {
        console.warn(`[!] Không tìm thấy skill nguồn: ${err.message}`);
      }
    }

    // Đọc metadata
    const skillMdFile = path.join(destSkillPath, "SKILL.md");
    let description = "Tự động hóa tạo video và âm thanh theo lập trình bằng Remotion, React và Bun/Node.";
    try {
      const content = await fs.readFile(skillMdFile, "utf-8");
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (match) {
        const descMatch = match[1].match(/description:\s*(?:>-\s*|>\s*|"?)(.*?)(?:\n\w|$)/s);
        if (descMatch) {
          description = descMatch[1].replace(/\r?\n\s*/g, " ").replace(/^["']|["']$/g, "").trim();
        }
      }
    } catch {}

    let hasScripts = false;
    let hasReferences = false;
    try {
      const subItems = await fs.readdir(destSkillPath);
      hasScripts = subItems.includes("scripts");
      hasReferences = subItems.includes("references") || subItems.includes("resources");
    } catch {}

    catalog.push({
      name: skillName,
      description,
      path: `.agents/skills/${skillName}`,
      skillMdPath: `.agents/skills/${skillName}/SKILL.md`,
      hasScripts,
      hasReferences
    });
  }

  // Ghi catalog.json
  const catalogPath = path.join(targetSkillsDir, "catalog.json");
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
  console.log(`[+] Đã cập nhật catalog.json: ${catalogPath}`);

  console.log("====================================================");
  console.log(`[✔] Đã tinh gọn hoàn tất: Quản lý [${allSkillsList.join(", ")}] trong .agents/skills/`);
  console.log("====================================================");
}

main().catch(console.error);

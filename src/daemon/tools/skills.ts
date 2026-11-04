import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getAllSkills, findSkillMarkdown } from "../skills-catalog";

export function registerSkillTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool 14: Liệt kê danh mục các AI Skills có sẵn trong kho local & global
  mcp.tool(
    "skills_list",
    {
      category: z.string().optional().describe("Bộ lọc tùy chọn (ví dụ: 'video', 'pentest', 'debug', 'web', 'plan', 'git')")
    },
    async ({ category }) => {
      try {
        let list = await getAllSkills();

        if (category) {
          const filter = category.toLowerCase();
          list = list.filter(item => 
            item.name.toLowerCase().includes(filter) || 
            item.description.toLowerCase().includes(filter)
          );
        }

        onActivity?.({ type: "skill_action", action: "list", count: list.length });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(list.map(s => ({
              name: s.name,
              description: s.description,
              path: s.path,
              hasScripts: s.hasScripts
            })), null, 2)
          }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading skills: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 15: Đọc chi tiết quy trình và hướng dẫn thực hiện của một Skill (SKILL.md)
  mcp.tool(
    "skills_get",
    {
      skill_name: z.string().describe("Tên chính xác của skill (ví dụ: 'writing-plans', 'brainstorming', 'ponytail', 'test-driven-development', 'remotion-video-creator')")
    },
    async ({ skill_name }) => {
      try {
        const content = await findSkillMarkdown(skill_name);
        if (!content) {
          return {
            content: [{ type: "text", text: `Error: Skill '${skill_name}' not found. Please use skills_list to see available skills on this machine.` }],
            isError: true
          };
        }

        onActivity?.({ type: "skill_action", action: "get", skill: skill_name });

        return {
          content: [{ type: "text", text: content }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading skill '${skill_name}': ${err.message}. Please use skills_list to see available skills.` }],
          isError: true
        };
      }
    }
  );

  // Tool 16: Tìm kiếm skill phù hợp nhất với yêu cầu hiện tại của người dùng
  mcp.tool(
    "skills_search",
    {
      query: z.string().describe("Nhu cầu hoặc từ khóa nghiệp vụ (ví dụ: 'lên plan', 'specs', 'tạo video', 'reverse engineer', 'pentest web', 'debug')")
    },
    async ({ query }) => {
      try {
        const list = await getAllSkills();
        const q = query.toLowerCase();

        const matches = list.filter(item => 
          item.name.toLowerCase().includes(q) || 
          item.description.toLowerCase().includes(q)
        );

        onActivity?.({ type: "skill_action", action: "search", query, found: matches.length });

        if (matches.length === 0) {
          return {
            content: [{ type: "text", text: `Không tìm thấy skill nào khớp với "${query}". Dùng skills_list để xem tất cả.` }]
          };
        }

        const formatted = matches.map(m => `• **${m.name}**\n  Mô tả: ${m.description}\n  Tệp: ${m.skillMdPath}`).join("\n\n");

        return {
          content: [{ type: "text", text: `Tìm thấy ${matches.length} skill phù hợp với "${query}":\n\n${formatted}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error searching skills: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 17: Tự động cài đặt và tích hợp một AI Skill mới từ GitHub Repository
  mcp.tool(
    "skills_install",
    {
      repo_url: z.string().describe("URL GitHub repository của skill (ví dụ: 'https://github.com/user/repo')"),
      skill_name: z.string().optional().describe("Tên định danh tùy chỉnh của skill (mặc định lấy theo tên repo)")
    },
    async ({ repo_url, skill_name }) => {
      // 1. Kiểm tra URL hợp lệ chống option injection và giao thức lạ
      const trimmedUrl = repo_url.trim();
      if (!/^https?:\/\/[a-zA-Z0-9_\-\.\/:]+(\.git)?$/i.test(trimmedUrl) && !/^git@[a-zA-Z0-9_\-\.]+:[a-zA-Z0-9_\-\.\/]+(\.git)?$/i.test(trimmedUrl)) {
        return {
          content: [{ type: "text", text: `Lỗi: URL repository không hợp lệ. Chỉ chấp nhận URL http(s):// hoặc git@: ${repo_url}` }],
          isError: true
        };
      }

      // 2. Khử khuẩn tên skill chống path traversal (chỉ cho phép ký tự an toàn)
      const rawName = (skill_name || trimmedUrl.split("/").pop()?.replace(/\.git$/, "") || "custom-skill").trim();
      const name = rawName.replace(/[^a-zA-Z0-9_\-]/g, "").toLowerCase() || "custom-skill";

      const targetDir = path.resolve(".agents/skills", name);
      const tempDir = path.resolve(`temp-${name}-${Date.now()}`);

      try {
        onActivity?.({ type: "skill_action", action: "install_start", skill: name, repo_url: trimmedUrl });

        // 3. Clone shallow --depth 1 trực tiếp bằng Bun.spawn an toàn, tránh shell injection
        const proc = Bun.spawn(["git", "clone", "--depth", "1", trimmedUrl, tempDir], {
          stdout: "pipe",
          stderr: "pipe"
        });
        const stderr = await new Response(proc.stderr).text();
        const code = await proc.exited;
        if (code !== 0) {
          throw new Error(`Git clone thất bại: ${stderr.trim()}`);
        }

        // 2. Xóa sạch thư mục .git để không làm phình repo
        await fs.rm(path.join(tempDir, ".git"), { recursive: true, force: true });

        // 3. Sao chép vào .agents/skills
        await fs.mkdir(path.dirname(targetDir), { recursive: true });
        await fs.cp(tempDir, targetDir, { recursive: true, force: true });
        await fs.rm(tempDir, { recursive: true, force: true });

        // 4. Trích xuất mô tả từ SKILL.md hoặc README.md
        let description = `Skill ${name}`;
        const skillMd = path.join(targetDir, "SKILL.md");
        let hasScripts = false;
        let hasReferences = false;

        try {
          const subItems = await fs.readdir(targetDir);
          hasScripts = subItems.includes("scripts");
          hasReferences = subItems.includes("references") || subItems.includes("resources");
        } catch {}

        try {
          const content = await fs.readFile(skillMd, "utf-8");
          const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
          if (match) {
            const descMatch = match[1].match(/description:\s*(?:>-\s*|>\s*|"?)(.*?)(?:\n\w|$)/s);
            if (descMatch) {
              description = descMatch[1].replace(/\r?\n\s*/g, " ").replace(/^["']|["']$/g, "").trim();
            }
          }
        } catch {
          try {
            const readme = await fs.readFile(path.join(targetDir, "README.md"), "utf-8");
            const firstLine = readme.split("\n").find(l => l.trim() && !l.startsWith("#"));
            if (firstLine) description = firstLine.trim().slice(0, 200);
          } catch {}
        }

        // 5. Cập nhật catalog.json
        const catalogPath = path.resolve(".agents/skills/catalog.json");
        let list: any[] = [];
        try {
          list = JSON.parse(await fs.readFile(catalogPath, "utf-8"));
        } catch {}

        list = list.filter(item => item.name !== name);
        list.push({
          name,
          description,
          path: `.agents/skills/${name}`,
          skillMdPath: `.agents/skills/${name}/SKILL.md`,
          hasScripts,
          hasReferences
        });

        await fs.writeFile(catalogPath, JSON.stringify(list, null, 2), "utf-8");

        onActivity?.({ type: "skill_action", action: "install_done", skill: name });

        return {
          content: [{
            type: "text",
            text: `[✔] Đã cài đặt thành công skill '${name}' từ ${repo_url}!\nĐã cập nhật catalog và sẵn sàng sử dụng ngay qua 'skills_get' hoặc 'skill show ${name}'.`
          }]
        };
      } catch (err: any) {
        try { await fs.rm(tempDir, { recursive: true, force: true }); } catch {}
        return {
          content: [{ type: "text", text: `Lỗi cài đặt skill: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}

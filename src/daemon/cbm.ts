/**
 * Codebase Memory (CBM) Bridge for Otter Daemon
 * Connects ChatGPT Web to codebase-memory-mcp persistent knowledge graph.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

let cachedBinaryPath: string | null = null;
let lastActiveProject: string = process.env.CBM_PROJECT || "otter";

export async function getCbmBinaryPath(): Promise<string> {
  if (cachedBinaryPath) return cachedBinaryPath;

  const isWin = process.platform === "win32";
  const exeName = isWin ? "codebase-memory-mcp.exe" : "codebase-memory-mcp";

  // Danh sách các vị trí ưu tiên tìm kiếm
  const candidatePaths = [
    // 1. Thư mục bin/ cục bộ trong dự án
    path.resolve("bin", exeName),
    path.join(__dirname, "..", "..", "bin", exeName),

    // 2. Biến môi trường tùy biến nếu có
    process.env.CBM_BINARY_PATH || "",

    // 3. Cài đặt hệ thống trên Windows (%LOCALAPPDATA%/Programs/...)
    isWin && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Programs", "codebase-memory-mcp", exeName)
      : "",

    // 4. Cài đặt chuẩn trên macOS (Homebrew, Cargo) và Unix/Linux
    "/opt/homebrew/bin/codebase-memory-mcp",
    "/usr/local/bin/codebase-memory-mcp",
    path.join(os.homedir(), ".cargo", "bin", exeName),
    path.join(os.homedir(), ".local", "bin", exeName),
    path.join(os.homedir(), "bin", exeName)
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    try {
      await fs.access(candidate);
      cachedBinaryPath = candidate;
      console.log(`[Codebase Memory] Using binary at: ${candidate}`);
      return candidate;
    } catch {
      // Tiếp tục tìm vị trí kế tiếp
    }
  }

  // 5. Thử gọi trực tiếp từ biến môi trường PATH
  cachedBinaryPath = exeName;
  return cachedBinaryPath;
}

export function getLastActiveProject(): string {
  return lastActiveProject;
}

export function setLastActiveProject(project: string) {
  if (project) {
    lastActiveProject = project;
  }
}

export async function invokeCbm(
  toolName: string,
  args: Record<string, any> = {}
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  const binaryPath = await getCbmBinaryPath();

  // If a tool requires project and none is provided, inject last active project
  if (!args.project && ["search_graph", "trace_path", "get_code_snippet", "get_architecture", "manage_adr", "search_code"].includes(toolName)) {
    args.project = lastActiveProject;
  }

  const jsonArgs = JSON.stringify(args);

  try {
    const proc = Bun.spawn([binaryPath, "cli", "--quiet", "--json", toolName, jsonArgs], {
      stdout: "pipe",
      stderr: "pipe"
    });

    const [stdoutText, stderrText] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text()
    ]);

    const exitCode = await proc.exited;

    if (stdoutText.trim()) {
      try {
        const parsed = JSON.parse(stdoutText);
        if (parsed.content) {
          // If indexing, update lastActiveProject
          if (toolName === "index_repository" && parsed.structuredContent?.project) {
            setLastActiveProject(parsed.structuredContent.project);
          }
          const textItems: Array<{ type: "text"; text: string }> = (parsed.content || []).map((item: any) => ({
            type: "text" as const,
            text: typeof item.text === "string" ? item.text : JSON.stringify(item)
          }));

          return {
            content: textItems,
            isError: Boolean(parsed.isError)
          };
        }
      } catch {
        // Output was not JSON envelope, wrap plain text
        return {
          content: [{ type: "text" as const, text: stdoutText }],
          isError: exitCode !== 0
        };
      }
    }

    if (exitCode !== 0) {
      return {
        content: [{ type: "text" as const, text: `codebase-memory error (exit ${exitCode}):\n${stderrText || stdoutText}` }],
        isError: true
      };
    }

    return {
      content: [{ type: "text" as const, text: stdoutText || "Operation completed successfully." }],
      isError: false
    };
  } catch (err: any) {
    return {
      content: [{ type: "text" as const, text: `Failed to execute codebase-memory-mcp: ${err.message}` }],
      isError: true
    };
  }
}

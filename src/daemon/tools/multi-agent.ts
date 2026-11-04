import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import { spawn } from "bun";

export async function findCliBinary(name: "claude" | "gemini" | "codex"): Promise<string | null> {
  const home = os.homedir();
  const isWin = process.platform === "win32";

  const candidates: Record<string, string[]> = {
    claude: [
      path.join(home, ".local", "bin", isWin ? "claude.exe" : "claude"),
      isWin ? "claude.exe" : "claude"
    ],
    gemini: [
      path.join(home, ".gemini", "bin", isWin ? "agy.exe" : "agy"),
      isWin ? "agy.exe" : "agy",
      isWin ? "gemini.exe" : "gemini"
    ],
    codex: [
      path.join(home, ".codex", ".sandbox-bin", isWin ? "codex.exe" : "codex"),
      path.join(home, ".local", "bin", isWin ? "codex.exe" : "codex"),
      isWin ? "codex.exe" : "codex"
    ]
  };

  for (const candidate of candidates[name] || []) {
    try {
      if (path.isAbsolute(candidate)) {
        await fs.access(candidate);
        return candidate;
      } else {
        const checkCmd = isWin ? ["where.exe", candidate] : ["which", candidate];
        const proc = spawn({ cmd: checkCmd, stdout: "pipe", stderr: "pipe" });
        const out = await new Response(proc.stdout).text();
        const code = await proc.exited;
        if (code === 0 && out.trim()) {
          return out.split(/\r?\n/)[0].trim();
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Tinh lọc đầu ra của CLI: loại bỏ mã ANSI, chuẩn hóa xuống dòng và xóa các banner rác
 */
export function cleanCliOutput(text: string): string {
  if (!text) return "";
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/^Reading additional input from stdin\.\.\.\s*$/gm, "")
    .replace(/^Warning: no stdin data received in \d+s[^\n]*\n?/gm, "")
    .trim();
}

interface RunCliOptions {
  cmd: string[];
  cwd?: string;
  timeoutMs?: number;
}

async function runCliProcess({ cmd, cwd, timeoutMs = 180000 }: RunCliOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const targetCwd = cwd ? path.resolve(cwd) : process.cwd();
  try {
    const stat = await fs.stat(targetCwd);
    if (!stat.isDirectory()) {
      throw new Error(`Target cwd is not a valid directory: ${targetCwd}`);
    }
  } catch (err: any) {
    throw new Error(`Invalid working directory: ${err.message}`);
  }

  const proc = spawn({
    cmd,
    cwd: targetCwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe"
  });

  proc.stdin?.end();

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try { proc.kill(); } catch {}
  }, timeoutMs);

  try {
    const [rawStdout, rawStderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ]);

    const stdout = cleanCliOutput(rawStdout);
    const stderr = cleanCliOutput(rawStderr);

    if (timedOut) {
      return {
        stdout,
        stderr: `${stderr}\n[TIMEOUT] Process was terminated after exceeding ${timeoutMs / 1000}s limit.`.trim(),
        exitCode: 124
      };
    }

    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hàm thực thi nhiệm vụ của 1 agent cụ thể (dùng chung cho cả tool đơn lẻ và pipeline)
 */
export async function executeAgentTask({
  agent,
  prompt,
  cwd,
  model,
  effort,
  mode = "auto",
  sandbox,
  timeoutSec = 180,
  dangerouslySkipPermissions = true
}: {
  agent: "claude" | "gemini" | "codex";
  prompt: string;
  cwd?: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "max";
  mode?: "auto" | "accept-edits" | "plan";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  timeoutSec?: number;
  dangerouslySkipPermissions?: boolean;
}): Promise<{ output: string; exitCode: number; stdout: string; stderr: string }> {
  const bin = await findCliBinary(agent);
  if (!bin) {
    throw new Error(`Không tìm thấy binary cho ${agent}. Vui lòng kiểm tra cài đặt CLI.`);
  }

  let args: string[] = [];

  if (agent === "claude") {
    args = [bin, "-p", prompt];
    if (dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
    if (model) args.push("--model", model);
  } else if (agent === "gemini") {
    args = [bin, "-p", prompt, "--mode", mode];
    if (dangerouslySkipPermissions) args.push("--dangerously-skip-permissions");
    if (model) args.push("--model", model);
    if (effort) args.push("--effort", effort);
  } else if (agent === "codex") {
    args = [bin, "exec", prompt, "--skip-git-repo-check", "--ephemeral"];
    if (dangerouslySkipPermissions) args.push("--dangerously-bypass-approvals-and-sandbox");
    if (cwd) args.push("-C", path.resolve(cwd));
    if (model) args.push("-m", model);
    if (sandbox) args.push("-s", sandbox);
  }

  const { stdout, stderr, exitCode } = await runCliProcess({
    cmd: args,
    cwd,
    timeoutMs: timeoutSec * 1000
  });

  const outputParts: string[] = [];
  if (stdout) outputParts.push(stdout);
  if (stderr && exitCode !== 0) outputParts.push(`[STDERR]\n${stderr}`);

  return {
    output: outputParts.join("\n\n") || `(Exit code: ${exitCode})`,
    exitCode,
    stdout,
    stderr
  };
}

export function registerMultiAgentTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool 1: Kiểm tra trạng thái và đường dẫn các AI CLI cục bộ
  mcp.tool(
    "agent_cli_status",
    "Kiểm tra xem máy tính đã cài đặt các CLI của Claude Code, Gemini (Antigravity), và OpenAI Codex chưa.",
    {},
    async () => {
      const claudeBin = await findCliBinary("claude");
      const geminiBin = await findCliBinary("gemini");
      const codexBin = await findCliBinary("codex");

      onActivity?.({
        type: "multi_agent_status",
        claude: !!claudeBin,
        gemini: !!geminiBin,
        codex: !!codexBin
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                claude: {
                  installed: !!claudeBin,
                  path: claudeBin,
                  engine: "Claude Code CLI",
                  capabilities: "Coding, Refactoring, Unit Testing, Multi-file edits"
                },
                gemini: {
                  installed: !!geminiBin,
                  path: geminiBin,
                  engine: "Antigravity CLI (agy)",
                  capabilities: "Large Context Reasoning, Security Auditing, Test Running"
                },
                codex: {
                  installed: !!codexBin,
                  path: codexBin,
                  engine: "OpenAI Codex CLI (codex-cli)",
                  capabilities: "Fast Scaffolding, Architecture Planning, Execution"
                }
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  // Tool 2: Điều khiển Claude Code CLI
  mcp.tool(
    "agent_run_claude",
    "Sai bảo Claude Code CLI trên máy tính thực thi nhiệm vụ lập trình, phân tích mã nguồn hoặc refactor.",
    {
      prompt: z.string().describe("Yêu cầu/nhiệm vụ cần giao cho Claude Code"),
      cwd: z.string().optional().describe("Thư mục thực thi lệnh (mặc định là thư mục dự án)"),
      model: z.string().optional().describe("Tùy chọn model Claude (ví dụ: 'claude-3-7-sonnet', 'claude-3-5-haiku')"),
      timeoutSec: z.number().int().min(10).max(600).default(180).describe("Thời gian chờ tối đa (giây, mặc định 180s)"),
      dangerouslySkipPermissions: z.boolean().default(true).describe("Tự động duyệt quyền truy cập file/lệnh để chạy ngầm")
    },
    async ({ prompt, cwd, model, timeoutSec, dangerouslySkipPermissions }) => {
      onActivity?.({
        type: "multi_agent_claude_start",
        prompt: prompt.slice(0, 100),
        cwd
      });

      try {
        const res = await executeAgentTask({
          agent: "claude",
          prompt,
          cwd,
          model,
          timeoutSec,
          dangerouslySkipPermissions
        });

        onActivity?.({
          type: "multi_agent_claude_done",
          exitCode: res.exitCode,
          outputLength: res.output.length
        });

        return {
          content: [{ type: "text", text: res.output }],
          isError: res.exitCode !== 0
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error executing Claude Code: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 3: Điều khiển Gemini / Antigravity CLI
  mcp.tool(
    "agent_run_gemini",
    "Sai bảo Gemini / Antigravity CLI (agy) trên máy tính thực thi kiểm thử, review mã nguồn hoặc phân tích logic.",
    {
      prompt: z.string().describe("Yêu cầu/nhiệm vụ cần giao cho Gemini"),
      cwd: z.string().optional().describe("Thư mục thực thi lệnh"),
      mode: z.enum(["auto", "accept-edits", "plan"]).default("auto").describe("Chế độ agent (auto, accept-edits, plan)"),
      model: z.string().optional().describe("Mô hình chỉ định"),
      effort: z.enum(["low", "medium", "high", "max"]).optional().describe("Mức độ suy luận (effort)"),
      timeoutSec: z.number().int().min(10).max(600).default(180).describe("Thời gian chờ tối đa (giây, mặc định 180s)"),
      dangerouslySkipPermissions: z.boolean().default(true).describe("Tự động duyệt quyền công cụ")
    },
    async ({ prompt, cwd, mode, model, effort, timeoutSec, dangerouslySkipPermissions }) => {
      onActivity?.({
        type: "multi_agent_gemini_start",
        prompt: prompt.slice(0, 100),
        cwd
      });

      try {
        const res = await executeAgentTask({
          agent: "gemini",
          prompt,
          cwd,
          mode,
          model,
          effort,
          timeoutSec,
          dangerouslySkipPermissions
        });

        onActivity?.({
          type: "multi_agent_gemini_done",
          exitCode: res.exitCode,
          outputLength: res.output.length
        });

        return {
          content: [{ type: "text", text: res.output }],
          isError: res.exitCode !== 0
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error executing Gemini CLI: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 4: Điều khiển OpenAI Codex CLI (codex-cli)
  mcp.tool(
    "agent_run_codex",
    "Sai bảo OpenAI Codex CLI trên máy tính phân tích mã nguồn, lập kế hoạch hoặc sinh mã.",
    {
      prompt: z.string().describe("Yêu cầu/nhiệm vụ cần giao cho Codex"),
      cwd: z.string().optional().describe("Thư mục thực thi lệnh"),
      model: z.string().optional().describe("Mô hình chỉ định (ví dụ: o3, o1, gpt-4o, gpt-6-astra)"),
      sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional().describe("Chính sách Sandbox"),
      timeoutSec: z.number().int().min(10).max(600).default(180).describe("Thời gian chờ tối đa (giây, mặc định 180s)"),
      dangerouslyBypassApprovals: z.boolean().default(true).describe("Tự động duyệt quyền để chạy ngầm không gián đoạn")
    },
    async ({ prompt, cwd, model, sandbox, timeoutSec, dangerouslyBypassApprovals }) => {
      onActivity?.({
        type: "multi_agent_codex_start",
        prompt: prompt.slice(0, 100),
        cwd
      });

      try {
        const res = await executeAgentTask({
          agent: "codex",
          prompt,
          cwd,
          model,
          sandbox,
          timeoutSec,
          dangerouslySkipPermissions: dangerouslyBypassApprovals
        });

        onActivity?.({
          type: "multi_agent_codex_done",
          exitCode: res.exitCode,
          outputLength: res.output.length
        });

        return {
          content: [{ type: "text", text: res.output }],
          isError: res.exitCode !== 0
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error executing Codex: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 5: Phối hợp quy trình liên hoàn đa AI (Multi-Agent Pipeline)
  mcp.tool(
    "agent_orchestrate_pipeline",
    "Chạy quy trình liên hoàn nhiều AI theo thứ tự (ví dụ: Codex lên spec -> Claude viết code -> Gemini review & kiểm thử). Tự động truyền output của bước trước làm ngữ cảnh cho bước sau.",
    {
      steps: z.array(
        z.object({
          agent: z.enum(["claude", "gemini", "codex"]).describe("AI phụ trách bước này"),
          task: z.string().describe("Nội dung nhiệm vụ cụ thể"),
          passPreviousOutput: z.boolean().default(true).describe("Có gắn kèm kết quả từ bước trước vào prompt không")
        })
      ).min(1).describe("Danh sách các bước thực hiện tuần tự"),
      cwd: z.string().optional().describe("Thư mục dự án"),
      stopOnError: z.boolean().default(true).describe("Dừng lại ngay nếu một bước gặp lỗi exit code != 0")
    },
    async ({ steps, cwd, stopOnError }) => {
      const stepResults: Array<{
        step: number;
        agent: string;
        task: string;
        exitCode: number;
        durationMs: number;
        output: string;
      }> = [];

      let lastOutput = "";

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepNum = i + 1;
        const startTime = Date.now();

        let finalPrompt = step.task;
        if (step.passPreviousOutput && lastOutput.trim()) {
          finalPrompt = `${step.task}\n\n[DỮ LIỆU TỪ BƯỚC TRƯỚC - ${steps[i - 1].agent.toUpperCase()}]:\n${lastOutput}`;
        }

        onActivity?.({
          type: "pipeline_step_start",
          step: stepNum,
          total: steps.length,
          agent: step.agent,
          task: step.task
        });

        try {
          const res = await executeAgentTask({
            agent: step.agent,
            prompt: finalPrompt,
            cwd
          });

          const durationMs = Date.now() - startTime;
          lastOutput = res.output;

          stepResults.push({
            step: stepNum,
            agent: step.agent,
            task: step.task,
            exitCode: res.exitCode,
            durationMs,
            output: res.output
          });

          onActivity?.({
            type: "pipeline_step_done",
            step: stepNum,
            agent: step.agent,
            exitCode: res.exitCode,
            durationMs
          });

          if (res.exitCode !== 0 && stopOnError) {
            break;
          }
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          stepResults.push({
            step: stepNum,
            agent: step.agent,
            task: step.task,
            exitCode: 1,
            durationMs,
            output: `Lỗi thực thi bước ${stepNum}: ${err.message}`
          });
          if (stopOnError) break;
        }
      }

      // Xây dựng báo cáo tổng hợp Markdown
      const summaryLines: string[] = [
        `# Báo Cáo Thực Thi Quy Trình Liên Hoàn Đa AI (${stepResults.length}/${steps.length} Bước)\n`
      ];

      for (const r of stepResults) {
        const statusIcon = r.exitCode === 0 ? "✅ Thành công" : "❌ Thất bại";
        summaryLines.push(`### Bước ${r.step} [${r.agent.toUpperCase()}]: ${statusIcon} (${r.durationMs}ms)`);
        summaryLines.push(`**Nhiệm vụ**: ${r.task}`);
        summaryLines.push(`**Kết quả**:\n${r.output}\n`);
        summaryLines.push(`---\n`);
      }

      const allSuccess = stepResults.every(r => r.exitCode === 0);

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        isError: !allSuccess
      };
    }
  );
}

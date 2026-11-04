import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { executeCommand } from "../terminal";
import { assertSafePath } from "../security";

export function registerTerminalAndFileTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool 1: Thực thi lệnh console
  mcp.tool(
    "execute_terminal_command",
    {
      command: z.string().describe("Lệnh console PowerShell hoặc CMD để thực thi"),
      cwd: z.string().optional().describe("Thư mục thực thi lệnh")
    },
    async ({ command, cwd }) => {
      try {
        const res = await executeCommand(command, cwd);
        onActivity?.({
          type: "terminal_output",
          output: res.stdout || res.stderr,
          exitCode: res.exitCode
        });

        const output = [
          res.stdout ? `[STDOUT]\n${res.stdout}` : "",
          res.stderr ? `[STDERR]\n${res.stderr}` : "",
          `Exit code: ${res.exitCode}`
        ].filter(Boolean).join("\n\n");

        return {
          content: [{ type: "text", text: output }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error executing command: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 2: Đọc file với hỗ trợ phân đoạn theo dòng và bảo vệ chống Path Traversal
  mcp.tool(
    "read_file",
    "Đọc nội dung tệp tin. Hỗ trợ đọc toàn bộ hoặc đọc chính xác từ dòng startLine đến dòng endLine (1-indexed).",
    {
      filePath: z.string().describe("Đường dẫn tuyệt đối hoặc tương đối của tệp"),
      startLine: z.number().int().min(1).optional().describe("Dòng bắt đầu đọc (1-indexed). Để trống để đọc từ đầu tệp."),
      endLine: z.number().int().min(1).optional().describe("Dòng kết thúc đọc (1-indexed). Để trống để đọc đến hết tệp."),
      withLineNumbers: z.boolean().default(true).describe("Đính kèm số dòng (ví dụ: '  42: const x = 1;') để dễ định vị vị trí")
    },
    async ({ filePath, startLine, endLine, withLineNumbers }) => {
      try {
        const fullPath = assertSafePath(filePath);
        const content = await fs.readFile(fullPath, "utf-8");
        const allLines = content.split(/\r?\n/);
        const totalLines = allLines.length;

        let resultText = "";
        if (startLine !== undefined || endLine !== undefined) {
          const start = Math.max(1, startLine || 1);
          const end = Math.min(totalLines, endLine || totalLines);

          if (start > totalLines) {
            return {
              content: [{ type: "text", text: `[Tệp ${path.basename(fullPath)} có tổng cộng ${totalLines} dòng. Dòng bắt đầu ${start} vượt quá độ dài tệp]` }]
            };
          }

          const sliced = allLines.slice(start - 1, end);
          resultText = sliced.map((line, idx) => {
            const lineNum = start + idx;
            return withLineNumbers ? `${lineNum.toString().padStart(4, " ")}: ${line}` : line;
          }).join("\n");

          resultText = `[Đang xem dòng ${start} - ${end} / Tổng số ${totalLines} dòng của ${path.basename(fullPath)}]\n\n` + resultText;
        } else {
          if (withLineNumbers && totalLines <= 1000) {
            resultText = allLines.map((line, idx) => `${(idx + 1).toString().padStart(4, " ")}: ${line}`).join("\n");
          } else {
            resultText = content;
          }
        }

        onActivity?.({
          type: "file_action",
          action: "read",
          path: fullPath,
          lines: totalLines
        });

        return {
          content: [{ type: "text", text: resultText }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading file: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 3: Ghi file đè toàn bộ với bảo vệ chống Path Traversal
  mcp.tool(
    "write_file",
    "Ghi hoặc tạo mới tệp tin với toàn bộ nội dung được chỉ định.",
    {
      filePath: z.string().describe("Đường dẫn tệp cần ghi"),
      content: z.string().describe("Nội dung tệp")
    },
    async ({ filePath, content }) => {
      try {
        const fullPath = assertSafePath(filePath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, "utf-8");
        onActivity?.({
          type: "file_action",
          action: "write",
          path: fullPath
        });

        return {
          content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${fullPath}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error writing file: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 3.1: Chỉnh sửa chính xác một đoạn mã trong tệp (Surgical Edit)
  mcp.tool(
    "edit_file",
    "Chỉnh sửa chính xác một đoạn mã trong tệp mà không làm mất nội dung còn lại. Tìm đoạn mã 'target' và thay thế bằng 'replacement'.",
    {
      filePath: z.string().describe("Đường dẫn tệp cần chỉnh sửa"),
      target: z.string().describe("Đoạn mã gốc chính xác cần thay thế (Exact match, bao gồm cả khoảng trắng/thụt lề tab)"),
      replacement: z.string().describe("Đoạn mã mới thay thế vào vị trí target (để chuỗi rỗng '' nếu muốn xóa đoạn target)"),
      replaceAll: z.boolean().default(false).describe("Thay thế tất cả các vị trí trùng khớp hay chỉ vị trí đầu tiên")
    },
    async ({ filePath, target, replacement, replaceAll }) => {
      try {
        const fullPath = assertSafePath(filePath);
        const content = await fs.readFile(fullPath, "utf-8");

        if (!content.includes(target)) {
          return {
            content: [
              {
                type: "text",
                text: `Lỗi: Không tìm thấy đoạn mã target trong '${filePath}'. Hãy dùng 'read_file' với startLine/endLine để đọc và copy chính xác ký tự thụt lề (indentation).`
              }
            ],
            isError: true
          };
        }

        const matchCount = content.split(target).length - 1;
        const updated = replaceAll ? content.replaceAll(target, replacement) : content.replace(target, replacement);
        await fs.writeFile(fullPath, updated, "utf-8");

        onActivity?.({
          type: "file_action",
          action: "edit",
          path: fullPath
        });

        return {
          content: [
            {
              type: "text",
              text: `[✔] Đã thay thế thành công đoạn mã trong '${fullPath}' (${replaceAll ? `đã đổi ${matchCount} vị trí` : "đã đổi 1 vị trí"}).`
            }
          ]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error editing file: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 4: Tạo giọng đọc AI (Text-To-Speech)
  mcp.tool(
    "generate_speech_audio",
    {
      text: z.string().describe("Nội dung văn bản cần chuyển thành giọng nói"),
      outputFile: z.string().describe("Đường dẫn tệp âm thanh đầu ra (.mp3)"),
      voice: z.string().default("vi-VN-NamMinhNeural").describe("Giọng đọc (Mặc định: vi-VN-NamMinhNeural hoặc vi-VN-HoaiMyNeural)")
    },
    async ({ text, outputFile, voice }) => {
      try {
        const resolvedOut = path.resolve(outputFile);
        await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
        const cmd = `uv run --with edge-tts edge-tts --voice ${voice} --text "${text.replace(/"/g, '\\"')}" --write-media "${resolvedOut}"`;
        const res = await executeCommand(cmd);

        onActivity?.({
          type: "speech_action",
          output: resolvedOut
        });

        if (res.exitCode !== 0) {
          return {
            content: [{ type: "text", text: `TTS generation failed: ${res.stderr || res.stdout}` }],
            isError: true
          };
        }

        return {
          content: [{ type: "text", text: `Successfully generated audio speech to: ${resolvedOut}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error generating speech: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 5: Tạo và Render Video bằng Remotion
  mcp.tool(
    "render_remotion_video",
    {
      projectDir: z.string().describe("Đường dẫn thư mục dự án Remotion"),
      compositionId: z.string().default("Main").describe("ID của Composition cần render (mặc định: Main)"),
      outputFile: z.string().default("out.mp4").describe("Tên hoặc đường dẫn file video đầu ra (.mp4)")
    },
    async ({ projectDir, compositionId, outputFile }) => {
      try {
        const resolvedDir = path.resolve(projectDir);
        const resolvedOut = path.resolve(resolvedDir, outputFile);
        const localBin = path.join(resolvedDir, "node_modules", ".bin", process.platform === "win32" ? "remotion.cmd" : "remotion");
        const cmd = fs.existsSync(localBin)
          ? `"${localBin}" render src/index.ts ${compositionId} "${resolvedOut}"`
          : `bunx @remotion/cli render src/index.ts ${compositionId} "${resolvedOut}"`;

        const res = await executeCommand(cmd, resolvedDir);
        onActivity?.({
          type: "render_action",
          output: resolvedOut
        });

        if (res.exitCode !== 0) {
          return {
            content: [{ type: "text", text: `Render failed:\n${res.stderr || res.stdout}` }],
            isError: true
          };
        }

        return {
          content: [{ type: "text", text: `Successfully rendered video to: ${resolvedOut}\n${res.stdout}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error rendering video: ${err.message}` }],
          isError: true
        };
      }
    }
  );

  // Tool 6: Tổng hợp nhạc nền (BGM) & SFX bằng thuật toán DSP thuần túy (NumPy + FFmpeg)
  mcp.tool(
    "synthesize_bgm_or_sfx",
    {
      style: z.enum(["cyber", "anime", "acoustic", "sfx", "all"]).describe("Phong cách BGM hoặc SFX: cyber (công nghệ/EDM), anime (rock hành động), acoustic (dân gian ấm áp), sfx (tiếng pop, ding, whoosh), all (tạo tất cả)"),
      outputDir: z.string().default("public").describe("Thư mục lưu file âm thanh đầu ra"),
      duration: z.number().default(30.0).describe("Thời lượng nhạc nền (giây)")
    },
    async ({ style, outputDir, duration }) => {
      try {
        const resolvedOut = path.resolve(outputDir);
        await fs.mkdir(resolvedOut, { recursive: true });
        const scriptPath = path.resolve("src/daemon/synth_audio.py");
        const cmd = `uv run --with numpy python "${scriptPath}" --style ${style} --duration ${duration} --output "${resolvedOut}"`;

        const res = await executeCommand(cmd);
        onActivity?.({
          type: "audio_synthesis",
          style,
          output: resolvedOut
        });

        if (res.exitCode !== 0) {
          return {
            content: [{ type: "text", text: `Audio synthesis failed:\n${res.stderr || res.stdout}` }],
            isError: true
          };
        }

        return {
          content: [{ type: "text", text: `Successfully synthesized audio [${style}] into: ${resolvedOut}\n${res.stdout}` }]
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error synthesizing audio: ${err.message}` }],
          isError: true
        };
      }
    }
  );
}

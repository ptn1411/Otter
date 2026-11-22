import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { COMMAND_MAX_CHARS, COMMAND_TIMEOUT_MS, executeCommand } from "../terminal";
import { assertSafePath } from "../security";

const MAX_TEXT_BYTES = 1_000_000;
const MAX_BASE64_BYTES = 2_000_000;
const MAX_UNSCOPED_LINES = 1000;
const MAX_RANGE_SCAN_BYTES = 32_000_000;

function formatNumberedLines(lines: string[], start: number, withLineNumbers: boolean): string {
  return lines.map((line, idx) => {
    if (!withLineNumbers) return line;
    return `${(start + idx).toString().padStart(4, " ")}: ${line}`;
  }).join("\n");
}

function unscopedCutFooter(shown: number, detail: string): string {
  return `\n\n[Đã cắt còn ${shown} dòng đầu / ${detail}. Dùng startLine và endLine để đọc tiếp.]`;
}

type StreamedLines = {
  lines: string[];
  start: number;
  lineCount: number;
  exhausted: boolean;
};

async function streamTextLines(
  fullPath: string,
  opts: { start?: number; end?: number; stopAfterLines?: number; maxBytes: number }
): Promise<StreamedLines> {
  const fh = await fs.open(fullPath, "r");
  const buf = Buffer.alloc(64 * 1024);
  const decoder = new TextDecoder("utf-8");
  let pending = "";
  let position = 0;
  let bytes = 0;
  let lineCount = 0;
  let exhausted = true;
  let stop = false;
  const start = Math.max(1, opts.start ?? 1);
  const collected: string[] = [];

  const consider = (line: string) => {
    lineCount++;
    if (opts.stopAfterLines !== undefined && lineCount > opts.stopAfterLines) {
      stop = true;
      exhausted = false;
      return;
    }
    const inWindow = lineCount >= start && (opts.end === undefined || lineCount <= opts.end);
    if (inWindow) collected.push(line);
  };

  try {
    while (!stop) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      bytes += bytesRead;
      if (bytes > opts.maxBytes) {
        exhausted = false;
        break;
      }
      pending += decoder.decode(buf.subarray(0, bytesRead), { stream: true });
      if (pending.length > opts.maxBytes) {
        consider(pending.slice(0, opts.maxBytes));
        exhausted = false;
        stop = true;
        break;
      }
      let nl = pending.indexOf("\n");
      while (nl !== -1 && !stop) {
        let line = pending.slice(0, nl);
        pending = pending.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        consider(line);
        nl = pending.indexOf("\n");
      }
    }
    if (!stop && exhausted) {
      pending += decoder.decode();
      if (pending.length > 0) {
        if (pending.endsWith("\r")) pending = pending.slice(0, -1);
        consider(pending);
      } else if (lineCount === 0 || bytes > 0) {
        consider("");
      }
    }
  } finally {
    await fh.close();
  }

  return { lines: collected, start, lineCount, exhausted };
}

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
        const res = await executeCommand(command, cwd, { timeoutMs: COMMAND_TIMEOUT_MS, maxChars: COMMAND_MAX_CHARS });
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

  // Tool 2: Đọc file với hỗ trợ phân đoạn theo dòng, đọc nhị phân Base64 và bảo vệ chống Path Traversal
  mcp.tool(
    "read_file",
    "Đọc nội dung tệp tin. Không có startLine/endLine thì tối đa 1000 dòng và 1MB; tệp lớn hơn phải chỉ định khoảng dòng. Ảnh, zip, pdf đọc base64 khi còn dưới 2MB.",
    {
      filePath: z.string().describe("Đường dẫn tuyệt đối hoặc tương đối của tệp"),
      startLine: z.number().int().min(1).optional().describe("Dòng bắt đầu đọc (1-indexed). Để trống để đọc từ đầu tệp."),
      endLine: z.number().int().min(1).optional().describe("Dòng kết thúc đọc (1-indexed). Để trống để đọc đến hết tệp."),
      withLineNumbers: z.boolean().default(true).describe("Đính kèm số dòng (ví dụ: '  42: const x = 1;') để dễ định vị vị trí"),
      encoding: z.enum(["utf8", "base64", "auto"]).optional().describe("Chế độ mã hóa: 'utf8' (mặc định cho code/text), 'base64' (cho ảnh/nhị phân), hoặc 'auto' (tự phát hiện file nhị phân)")
    },
    async ({ filePath, startLine, endLine, withLineNumbers, encoding }) => {
      try {
        const fullPath = assertSafePath(filePath);
        const stat = await fs.stat(fullPath);
        if (!stat.isFile()) throw new Error("Not a file");
        const ext = path.extname(fullPath).toLowerCase();
        const binaryExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".bmp", ".pdf", ".zip", ".gz", ".tar", ".mp4", ".mp3", ".wav", ".webm", ".exe", ".dll", ".sqlite", ".db"]);
        const ranged = startLine !== undefined || endLine !== undefined;
        const peek = Buffer.alloc(Math.min(4096, stat.size));
        if (peek.length > 0 && encoding !== "utf8") {
          const fh = await fs.open(fullPath, "r");
          try { await fh.read(peek, 0, peek.length, 0); }
          finally { await fh.close(); }
        }
        const useBase64 = encoding === "base64" || (encoding === "auto" && (binaryExts.has(ext) || peek.includes(0)));

        if (useBase64) {
          if (stat.size > MAX_BASE64_BYTES) {
            return {
              content: [{ type: "text", text: `File quá lớn để đọc base64 (${stat.size} byte, trần ${MAX_BASE64_BYTES}).` }],
              isError: true
            };
          }
          const rawBuf = await fs.readFile(fullPath);
          onActivity?.({
            type: "file_action",
            action: "read_base64",
            path: fullPath,
            byteLength: rawBuf.length
          });
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                filePath: fullPath,
                encoding: "base64",
                byteLength: rawBuf.length,
                content: rawBuf.toString("base64")
              })
            }]
          };
        }

        let resultText = "";
        let reportedLines = 0;
        if (stat.size <= MAX_TEXT_BYTES) {
          const content = await fs.readFile(fullPath, "utf-8");
          const allLines = content.split(/\r?\n/);
          const totalLines = allLines.length;
          reportedLines = totalLines;
          if (ranged) {
            const start = Math.max(1, startLine || 1);
            const end = Math.min(totalLines, endLine || totalLines);
            if (start > totalLines) {
              return {
                content: [{ type: "text", text: `[Tệp ${path.basename(fullPath)} có tổng cộng ${totalLines} dòng. Dòng bắt đầu ${start} vượt quá độ dài tệp]` }]
              };
            }
            resultText = `[Đang xem dòng ${start} - ${end} / Tổng số ${totalLines} dòng của ${path.basename(fullPath)}]\n\n` + formatNumberedLines(allLines.slice(start - 1, end), start, withLineNumbers);
          } else if (totalLines > MAX_UNSCOPED_LINES) {
            resultText = formatNumberedLines(allLines.slice(0, MAX_UNSCOPED_LINES), 1, withLineNumbers) + unscopedCutFooter(MAX_UNSCOPED_LINES, `tổng ${totalLines} dòng`);
          } else if (withLineNumbers) {
            resultText = formatNumberedLines(allLines, 1, true);
          } else {
            resultText = content;
          }
        } else {
          const streamed = await streamTextLines(fullPath, {
            start: ranged ? Math.max(1, startLine || 1) : 1,
            end: ranged ? endLine : undefined,
            stopAfterLines: ranged ? undefined : MAX_UNSCOPED_LINES,
            maxBytes: ranged ? MAX_RANGE_SCAN_BYTES : MAX_TEXT_BYTES
          });
          reportedLines = streamed.lineCount;
          const base = path.basename(fullPath);
          if (ranged) {
            const start = streamed.start;
            if (streamed.exhausted && start > streamed.lineCount) {
              return {
                content: [{ type: "text", text: `[Tệp ${base} có tổng cộng ${streamed.lineCount} dòng. Dòng bắt đầu ${start} vượt quá độ dài tệp]` }]
              };
            }
            const endShown = streamed.lines.length === 0 ? start : start + streamed.lines.length - 1;
            const totalLabel = streamed.exhausted ? String(streamed.lineCount) : `ít nhất ${streamed.lineCount}`;
            resultText = `[Đang xem dòng ${start} - ${endShown} / Tổng số ${totalLabel} dòng của ${base}]\n\n` + formatNumberedLines(streamed.lines, start, withLineNumbers);
          } else {
            const detail = streamed.exhausted ? `tổng ${streamed.lineCount} dòng` : `tệp ${stat.size} byte, chưa đọc hết`;
            resultText = formatNumberedLines(streamed.lines, 1, withLineNumbers) + unscopedCutFooter(streamed.lines.length, detail);
          }
        }

        onActivity?.({
          type: "file_action",
          action: "read",
          path: fullPath,
          lines: reportedLines
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
        const cmd = existsSync(localBin)
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

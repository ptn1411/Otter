/**
 * MCP tool wrappers cho DB manager (Python) — xem tools/db-manager/.
 *
 * Lớp mỏng thôi: wrapper này CHỈ spawn Python CLI `dbm` và trả stdout
 * về, không có đường truy vấn riêng nào. Mọi logic an toàn (phân loại
 * câu lệnh, chỉ đọc mặc định, profile không lưu password, SSH tunnel
 * key-only) nằm ở Python CLI và được giữ nguyên.
 *
 * AN TOÀN — ĐỌC TRƯỚC KHI DÙNG db_query:
 * - Mặc định db_query CHỈ ĐỌC. Câu viết (INSERT/UPDATE/DELETE/DROP/...)
 *   bị CLI từ chối ở chế độ safe, không cần hỏi thêm.
 * - Chỉ khi caller truyền CẢ HAI cờ allowWrite=true VÀ confirmWrite=true
 *   thì wrapper mới thêm `--write --yes` cho CLI. Hai cờ này chỉ được
 *   đặt khi NGƯỜI DÙNG đã duyệt rõ ràng câu lệnh đó — không bao giờ
 *   tự suy ra từ ngữ cảnh hay đặt mặc định true.
 * - Wrapper không bao giờ in, log hay echo password hay connection
 *   string. Profile vẫn tự lấy password từ biến môi trường (tên biến
 *   ghi trong profile) hoặc getpass như CLI vốn làm; TypeScript ở đây
 *   không xử lý password.
 * - Profiles dùng chung với CLI standalone qua DBM_HOME: wrapper truyền
 *   nguyên môi trường của daemon sang CLI, không đặt lại DBM_HOME và
 *   không tạo thêm nơi lưu profile nào khác. Nếu DBM_HOME không đặt,
 *   CLI dùng mặc định của nó (~/.config/dbm/).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export const DBM_DEFAULT_TIMEOUT_SECS = 30;
export const DBM_MAX_TIMEOUT_SECS = 120;
export const DBM_DEFAULT_LIMIT = 100;

/** Tìm CLI Python: ưu tiên DBM_CLI_PATH, rồi đường dẫn từ cwd (daemon chạy từ repo root), rồi đường dẫn tương đối từ file này. */
export function resolveDbmCli(): string {
  const override = process.env.DBM_CLI_PATH;
  if (override) return override;
  const fromCwd = path.resolve("tools/db-manager/bin/dbm");
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromHere = path.resolve(import.meta.dir, "../../../tools/db-manager/bin/dbm");
  if (fs.existsSync(fromHere)) return fromHere;
  throw new Error(
    "Không tìm thấy Python DB manager (tools/db-manager/bin/dbm). " +
      "Chạy daemon từ thư mục gốc của repo chatmcp, hoặc đặt DBM_CLI_PATH.",
  );
}

function clampTimeout(timeoutSecs?: number): number {
  if (timeoutSecs === undefined) return DBM_DEFAULT_TIMEOUT_SECS;
  if (!Number.isFinite(timeoutSecs)) return DBM_DEFAULT_TIMEOUT_SECS;
  return Math.max(1, Math.min(DBM_MAX_TIMEOUT_SECS, Math.floor(timeoutSecs)));
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DBM_DEFAULT_LIMIT;
  if (!Number.isFinite(limit)) return DBM_DEFAULT_LIMIT;
  return Math.max(0, Math.floor(limit));
}

/**
 * Chạy CLI dbm và trả stdout (chuỗi). Lỗi -> throw Error với stderr của
 * CLI (đã cắt ngắn), không dump stack trace thô. Môi trường của tiến
 * trình hiện tại được truyền nguyên vẹn, nên DBM_HOME (nơi lưu profile)
 * dùng chung giữa daemon và CLI standalone.
 */
export function runDbm(argv: string[], timeoutSecs?: number): string {
  const cli = resolveDbmCli();
  const timeout = clampTimeout(timeoutSecs);
  const pythonBin = process.platform === "win32" ? "python" : "python3";
  const res = spawnSync(pythonBin, [cli, ...argv], {
    encoding: "utf-8",
    timeout: timeout * 1000,
    env: process.env,
  });
  if (res.error) {
    const code = (res.error as NodeJS.ErrnoException).code;
    if (code === "ETIMEDOUT") {
      throw new Error(`dbm timed out sau ${timeout}s (giới hạn tối đa ${DBM_MAX_TIMEOUT_SECS}s)`);
    }
    throw new Error(`Không chạy được dbm: ${res.error.message}`);
  }
  if (res.signal) {
    throw new Error(`dbm bị dừng bởi signal ${res.signal}`);
  }
  if (res.status !== 0) {
    const detail = String(res.stderr || res.stdout || "").trim().slice(0, 2000);
    throw new Error(detail ? `dbm lỗi (exit ${res.status}): ${detail}` : `dbm lỗi (exit ${res.status})`);
  }
  return String(res.stdout ?? "");
}

/** Cờ global của CLI phải đứng TRƯỚC subcommand (argparse). */
function globalFlags(profile: string, limit?: number, timeoutSecs?: number): string[] {
  return [
    "--profile",
    profile,
    "--json",
    "--limit",
    String(clampLimit(limit)),
    "--timeout",
    String(clampTimeout(timeoutSecs)),
  ];
}

function text(value: string): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: value }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

const SHARED_PROFILES_NOTE =
  "Profiles dùng chung với CLI standalone qua DBM_HOME (daemon truyền nguyên môi trường sang CLI; không đặt DBM_HOME thì CLI dùng ~/.config/dbm/).";
const PASSWORD_NOTE =
  "Không bao giờ truyền password qua tool này: profile chỉ lưu TÊN biến môi trường chứa password, CLI tự đọc biến đó hoặc hỏi getpass.";

const WRITE_WARNING =
  "Chế độ mặc định là CHỈ ĐỌC: câu viết bị từ chối. Chỉ đặt allowWrite=true VÀ confirmWrite=true khi người dùng đã duyệt rõ ràng câu lệnh đó; hai cờ này không bao giờ được suy ra tự động.";

export function registerDbTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "db_profile_add",
    `Thêm một connection profile cho DB manager (lưu vào store dùng chung với CLI standalone). ${SHARED_PROFILES_NOTE} ${PASSWORD_NOTE}`,
    {
      name: z.string().describe("Tên profile (duy nhất)"),
      type: z
        .enum(["sqlite", "postgres", "mysql", "mongodb", "redis", "sqlserver"])
        .describe("Loại database"),
      host: z.string().optional(),
      port: z.number().int().optional(),
      user: z.string().optional(),
      database: z.string().describe("Tên database (với sqlite: đường dẫn file)"),
      passwordEnv: z
        .string()
        .optional()
        .describe("TÊN biến môi trường chứa password (không phải password). Bỏ trống thì CLI hỏi getpass khi chạy terminal."),
      sshHost: z.string().optional().describe("Bastion SSH host (nếu qua tunnel)"),
      sshUser: z.string().optional(),
      sshPort: z.number().int().optional(),
      sshKey: z.string().optional().describe("Đường dẫn SSH private key (key-only, không password SSH)"),
    },
    async (args) => {
      try {
        const argv: string[] = ["profile", "add", "--name", args.name, "--type", args.type];
        if (args.host) argv.push("--host", args.host);
        if (args.port !== undefined) argv.push("--port", String(args.port));
        if (args.user) argv.push("--user", args.user);
        if (args.database) argv.push("--database", args.database);
        if (args.passwordEnv) argv.push("--password-env", args.passwordEnv);
        if (args.sshHost) argv.push("--ssh-host", args.sshHost);
        if (args.sshUser) argv.push("--ssh-user", args.sshUser);
        if (args.sshPort !== undefined) argv.push("--ssh-port", String(args.sshPort));
        if (args.sshKey) argv.push("--ssh-key", args.sshKey);
        const out = runDbm(argv);
        onActivity?.({ type: "db", action: "profile_add", profile: args.name });
        return text(out.trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_profile_list",
    `Liệt kê các connection profile. ${SHARED_PROFILES_NOTE}`,
    {},
    async () => {
      try {
        return text(runDbm(["--json", "profile", "list"]).trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_profile_show",
    `Xem một connection profile (profile không bao giờ chứa password). ${SHARED_PROFILES_NOTE}`,
    { name: z.string() },
    async ({ name }) => {
      try {
        return text(runDbm(["--json", "profile", "show", name]).trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_profile_remove",
    "Xóa một connection profile. Chỉ xóa khi confirmRemove=true (tương đương --yes của CLI, vì MCP không có stdin tương tác để gõ YES).",
    {
      name: z.string(),
      confirmRemove: z.boolean().describe("Bắt buộc true mới xóa (không có cờ này thì từ chối, không spawn CLI)"),
    },
    async ({ name, confirmRemove }) => {
      try {
        if (!confirmRemove) {
          throw new Error("Từ chối xóa profile: cần confirmRemove=true (tương đương xác nhận YES của CLI).");
        }
        const out = runDbm(["profile", "remove", name, "--yes"]);
        onActivity?.({ type: "db", action: "profile_remove", profile: name });
        return text(out.trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_test",
    `Kiểm tra kết nối tới một profile và xem thông tin server (không chạy truy vấn). ${SHARED_PROFILES_NOTE} ${PASSWORD_NOTE}`,
    {
      profile: z.string(),
      timeoutSecs: z.number().int().min(1).max(DBM_MAX_TIMEOUT_SECS).optional().describe("Timeout giây (mặc định 30, tối đa 120)"),
    },
    async ({ profile, timeoutSecs }) => {
      try {
        return text(runDbm([...globalFlags(profile, undefined, timeoutSecs), "test"]).trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_list_databases",
    `Liệt kê các database trên một profile (chỉ đọc). ${SHARED_PROFILES_NOTE}`,
    {
      profile: z.string(),
      timeoutSecs: z.number().int().min(1).max(DBM_MAX_TIMEOUT_SECS).optional(),
    },
    async ({ profile, timeoutSecs }) => {
      try {
        return text(runDbm([...globalFlags(profile, undefined, timeoutSecs), "dbs"]).trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_list_tables",
    `Liệt kê các bảng (collection/namespace với MongoDB/Redis) trên một profile (chỉ đọc). ${SHARED_PROFILES_NOTE}`,
    {
      profile: z.string(),
      timeoutSecs: z.number().int().min(1).max(DBM_MAX_TIMEOUT_SECS).optional(),
    },
    async ({ profile, timeoutSecs }) => {
      try {
        return text(runDbm([...globalFlags(profile, undefined, timeoutSecs), "tables"]).trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_describe_table",
    `Mô tả cấu trúc một bảng (cột/kiểu) trên một profile (chỉ đọc). ${SHARED_PROFILES_NOTE}`,
    {
      profile: z.string(),
      table: z.string(),
      timeoutSecs: z.number().int().min(1).max(DBM_MAX_TIMEOUT_SECS).optional(),
    },
    async ({ profile, table, timeoutSecs }) => {
      try {
        return text(runDbm([...globalFlags(profile, undefined, timeoutSecs), "describe", table]).trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_query",
    `Chạy một câu lệnh trên một profile. ${WRITE_WARNING} MongoDB dùng JSON document command ({"op": "find", ...}), Redis dùng key command (GET/KEYS/...). ${SHARED_PROFILES_NOTE} ${PASSWORD_NOTE}`,
    {
      profile: z.string(),
      statement: z.string().describe("Câu lệnh (SQL hoặc JSON/key command tùy engine)"),
      limit: z.number().int().min(0).optional().describe("Số dòng tối đa (mặc định 100, 0 = không giới hạn, phải đặt rõ)"),
      timeoutSecs: z.number().int().min(1).max(DBM_MAX_TIMEOUT_SECS).optional().describe("Timeout giây (mặc định 30, tối đa 120)"),
      allowWrite: z.boolean().optional().describe("Mặc định false. Chỉ true khi người dùng đã duyệt câu viết này."),
      confirmWrite: z.boolean().optional().describe("Mặc định false. Phải true cùng với allowWrite thì CLI mới nhận --write --yes."),
      dryRun: z.boolean().optional().describe("Chỉ in trước câu lệnh sẽ chạy, không thực thi (an toàn, dùng để xem trước câu viết)."),
    },
    async ({ profile, statement, limit, timeoutSecs, allowWrite, confirmWrite, dryRun }) => {
      try {
        const wantWrite = allowWrite === true || confirmWrite === true;
        if (wantWrite && !(allowWrite === true && confirmWrite === true)) {
          throw new Error(
            "Từ chối câu viết: cần CẢ HAI allowWrite=true VÀ confirmWrite=true (người dùng phải duyệt rõ ràng). Chỉ một cờ thì không đủ, không spawn CLI.",
          );
        }
        const argv = [...globalFlags(profile, limit, timeoutSecs), "query", statement];
        if (dryRun) argv.push("--dry-run");
        if (allowWrite === true && confirmWrite === true) argv.push("--write", "--yes");
        const out = runDbm(argv, timeoutSecs);
        onActivity?.({ type: "db", action: "query", profile, write: allowWrite === true && confirmWrite === true });
        return text(out.trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );

  mcp.tool(
    "db_export",
    `Export toàn bộ một bảng (chỉ đọc, theo cùng luật an toàn như query). Không hỗ trợ export nguyên bảng cho MongoDB/Redis (dùng db_query với find/KEYS + --json thay thế). ${SHARED_PROFILES_NOTE}`,
    {
      profile: z.string(),
      table: z.string(),
      format: z.enum(["csv", "json"]).optional().describe("Định dạng export (mặc định csv)"),
      output: z.string().optional().describe("Đường dẫn file ghi kết quả; bỏ trống thì trả nội dung về trực tiếp"),
      limit: z.number().int().min(0).optional().describe("Số dòng tối đa (mặc định 100, 0 = không giới hạn, phải đặt rõ)"),
      timeoutSecs: z.number().int().min(1).max(DBM_MAX_TIMEOUT_SECS).optional(),
    },
    async ({ profile, table, format, output, limit, timeoutSecs }) => {
      try {
        const argv = [...globalFlags(profile, limit, timeoutSecs), "export", table, "--format", format ?? "csv"];
        if (output) argv.push("--output", output);
        const out = runDbm(argv, timeoutSecs);
        onActivity?.({ type: "db", action: "export", profile, table });
        return text(out.trim());
      } catch (e: any) {
        return err(e.message);
      }
    },
  );
}

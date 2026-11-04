#!/usr/bin/env bun
/**
 * DB Manager MCP wrapper test — wrapper mỏng spawn Python CLI, không cần
 * DB server thật (chỉ SQLite file tạm) và không cần thêm dependency npm
 * nào ngoài những gì repo đã cài (zod + MCP SDK, dùng bởi db-tools.ts
 * giống mọi file tools/* khác; đường spawn Python thì không cần npm).
 *
 * Dùng DBM_HOME tạm nên không chạm tới profiles thật của người dùng.
 * Kiểm tra:
 *  1. CLI đã copy chạy được ngay từ cây chatmcp (tools/db-manager/bin/dbm),
 *  2. profile add/list/show qua wrapper (runDbm) — profiles dùng chung
 *     qua DBM_HOME,
 *  3. tables/describe/query qua wrapper trả đúng dòng (kể cả UTF-8),
 *  4. DROP qua handler db_query KHÔNG có allowWrite+confirmWrite bị từ
 *     chối và bảng vẫn còn (safe mode giữ nguyên end-to-end),
 *  5. DROP qua handler db_query CÓ CẢ HAI cờ thì thực thi thật trên
 *     DB tạm (chứng minh đường write là cố ý, không phải đường chết),
 *  6. db_profile_remove không có confirmRemove bị từ chối, có cờ thì xóa,
 *  7. cả 10 tool db_* đăng ký được trên mock MCP server.
 *
 * Run: bun scripts/test-db-tools.ts  (chạy từ thư mục gốc chatmcp)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { registerDbTools, resolveDbmCli, runDbm } from "../src/daemon/tools/db-tools";

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, extra?: string): void {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// --- Fixture: DBM_HOME tạm + SQLite file tạm (tạo bằng python3, không cần node sqlite) ---
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "dbm-test-"));
const dbPath = path.join(tmpHome, "demo.db");
process.env.DBM_HOME = tmpHome;
const mk = spawnSync(
  process.platform === "win32" ? "python" : "python3",
  [
    "-c",
    "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); " +
      "c.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)'); " +
      "c.execute(\"INSERT INTO users VALUES (1, 'An'), (2, 'Bình')\"); c.commit()",
    dbPath,
  ],
  { encoding: "utf-8" },
);
if (mk.status !== 0) throw new Error(`Không tạo được fixture SQLite: ${mk.stderr}`);

// 1. CLI đã copy chạy được từ cây chatmcp
const cliPath = resolveDbmCli();
check("resolveDbmCli trỏ vào tools/db-manager/bin/dbm", cliPath.replace(/\\/g, "/").endsWith("tools/db-manager/bin/dbm") && fs.existsSync(cliPath), cliPath);
const help = spawnSync("python3", ["tools/db-manager/bin/dbm", "--help"], { encoding: "utf-8", cwd: process.cwd() });
check("python3 tools/db-manager/bin/dbm --help chạy từ repo root", help.status === 0 && String(help.stdout).includes("read-only by default"));
const info = runDbm(["info"]);
check("runDbm(['info']) liệt kê sqlite", info.includes("sqlite"));

// 2. Profile round-trip qua wrapper
const added = runDbm(["profile", "add", "--name", "t", "--type", "sqlite", "--database", dbPath]);
check("profile add qua wrapper", added.includes("profile 't' added"));
const list = JSON.parse(runDbm(["--json", "profile", "list"])) as { profiles: Record<string, { type: string }> };
check("profile list thấy profile vừa thêm", list.profiles.t?.type === "sqlite");
const shown = JSON.parse(runDbm(["--json", "profile", "show", "t"])) as { profile: { type: string; database: string } };
check("profile show đúng type + database", shown.profile.type === "sqlite" && shown.profile.database === dbPath);

// 3. tables/describe/query qua wrapper
const tables = JSON.parse(runDbm(["--profile", "t", "--json", "--limit", "100", "--timeout", "30", "tables"])) as unknown;
check("tables trả về users", JSON.stringify(tables).includes("users"), JSON.stringify(tables).slice(0, 200));
const desc = JSON.parse(runDbm(["--profile", "t", "--json", "describe", "users"])) as unknown;
check("describe users có cột id + name", JSON.stringify(desc).includes("id") && JSON.stringify(desc).includes("name"));
const q = JSON.parse(runDbm(["--profile", "t", "--json", "query", "SELECT * FROM users ORDER BY id"])) as {
  columns: string[];
  rows: unknown[][];
};
check(
  "query trả 2 dòng, gồm tên UTF-8",
  q.columns.includes("id") && q.columns.includes("name") && q.rows.length === 2 && JSON.stringify(q.rows).includes("Bình"),
  JSON.stringify(q).slice(0, 200),
);

// 7 (đăng ký trước để dùng handler cho 4/5/6). Mock MCP server: chỉ cần phương thức tool().
const registered = new Map<string, (args: any) => Promise<any>>();
const fakeMcp = {
  tool: (name: string, _desc: string, _shape: unknown, handler: (args: any) => Promise<any>) => {
    registered.set(name, handler);
  },
};
registerDbTools(fakeMcp as any);
const expectedTools = [
  "db_profile_add",
  "db_profile_list",
  "db_profile_show",
  "db_profile_remove",
  "db_test",
  "db_list_databases",
  "db_list_tables",
  "db_describe_table",
  "db_query",
  "db_export",
];
check(
  "đủ 10 tool db_* đăng ký trên mock MCP server",
  expectedTools.every((n) => registered.has(n)),
  `thiếu: ${expectedTools.filter((n) => !registered.has(n)).join(", ")}`,
);
const dbQuery = registered.get("db_query")!;
const dbRemove = registered.get("db_profile_remove")!;

// 4. DROP không đủ cờ -> từ chối, bảng vẫn còn
const refused = await dbQuery({ profile: "t", statement: "DROP TABLE users" });
check("db_query DROP không cờ -> isError", refused.isError === true, JSON.stringify(refused).slice(0, 200));
const stillThere = JSON.parse(runDbm(["--profile", "t", "--json", "tables"])) as unknown;
check("bảng users vẫn còn sau lần DROP bị từ chối", JSON.stringify(stillThere).includes("users"));
const halfRefused = await dbQuery({ profile: "t", statement: "DROP TABLE users", allowWrite: true });
check("db_query DROP chỉ có allowWrite (thiếu confirmWrite) -> isError", halfRefused.isError === true);

// 5. DROP có cả hai cờ -> thực thi thật
const dropped = await dbQuery({ profile: "t", statement: "DROP TABLE users", allowWrite: true, confirmWrite: true });
check("db_query DROP có cả hai cờ -> không lỗi", dropped.isError !== true, JSON.stringify(dropped).slice(0, 200));
const gone = JSON.parse(runDbm(["--profile", "t", "--json", "tables"])) as unknown;
check("bảng users đã mất sau DROP có đủ cờ", !JSON.stringify(gone).includes("users"), JSON.stringify(gone).slice(0, 200));

// 6. profile remove: không cờ -> từ chối; có cờ -> xóa
const rmRefused = await dbRemove({ name: "t", confirmRemove: false });
check("db_profile_remove không cờ -> isError", rmRefused.isError === true);
const rmOk = await dbRemove({ name: "t", confirmRemove: true });
check("db_profile_remove có cờ -> không lỗi", rmOk.isError !== true, JSON.stringify(rmOk).slice(0, 200));
const listAfter = JSON.parse(runDbm(["--json", "profile", "list"])) as { profiles: Record<string, unknown> };
check("profile t đã mất sau khi xóa", !("t" in listAfter.profiles));

fs.rmSync(tmpHome, { recursive: true, force: true });
console.log(`\n${failed === 0 ? "All db-tools checks passed." : `${failed} db-tools check(s) FAILED.`} (${passed} passed, ${failed} failed)`);
if (failed > 0) process.exit(1);

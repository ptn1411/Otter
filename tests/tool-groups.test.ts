import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// Dùng OTTER_HOME tạm để không đụng cấu hình thật của người dùng.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "otter-tool-groups-"));
process.env.OTTER_HOME = tmpHome;

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/daemon/mcp";
import {
  TOOL_GROUPS,
  getToolGroupsState,
  setToolGroupsEnabled,
  isGroupEnabled,
  resetToolGroupConfig,
} from "../src/daemon/tool-groups";

async function connectClient() {
  const server = createMcpServer(() => {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientTransport);
  return { server, client };
}

describe("tool-groups", () => {
  beforeAll(() => {
    resetToolGroupConfig();
    setToolGroupsEnabled(Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, true])));
  });

  afterAll(() => {
    setToolGroupsEnabled(Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, true])));
    resetToolGroupConfig();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  test("mặc định bật tất cả các nhóm", () => {
    const state = getToolGroupsState();
    expect(state.groups.every((g) => g.enabled)).toBe(true);
    expect(state.enabledTools).toBe(state.totalTools);
    expect(state.totalTools).toBeGreaterThan(200);
  });

  test("tools/list chứa tool fb khi nhóm fb đang bật", async () => {
    const { client } = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("fb_post_start");
    expect(names).toContain("execute_terminal_command");
    expect(names).toContain("meta_cli_exec");
    await client.close();
  });

  test("tắt nhóm fb thì tool fb biến mất khỏi tools/list, nhóm khác còn nguyên", async () => {
    const { client } = await connectClient();
    const before = (await client.listTools()).tools.map((t) => t.name);
    expect(before).toContain("fb_post_start");

    setToolGroupsEnabled({ fb: false });
    expect(isGroupEnabled("fb")).toBe(false);

    const after = (await client.listTools()).tools.map((t) => t.name);
    expect(after).not.toContain("fb_post_start");
    expect(after).not.toContain("fb_reply_start");
    expect(after).toContain("execute_terminal_command");
    expect(after).toContain("meta_cli_exec");
    expect(after.length).toBeLessThan(before.length);

    // Bật lại thì tool quay lại ngay trên cùng phiên.
    setToolGroupsEnabled({ fb: true });
    const restored = (await client.listTools()).tools.map((t) => t.name);
    expect(restored).toContain("fb_post_start");
    await client.close();
  });

  test("cấu hình được lưu xuống ~/.otter/tool-groups.json", () => {
    setToolGroupsEnabled({ vps: false, db: false });
    const raw = fs.readFileSync(path.join(tmpHome, "tool-groups.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.disabledGroups).toContain("vps");
    expect(parsed.disabledGroups).toContain("db");
    setToolGroupsEnabled({ vps: true, db: true });
  });

  test("nhóm không tồn tại bị bỏ qua khi set", () => {
    const state = setToolGroupsEnabled({ "nhom-khong-ton-tai": false } as any);
    expect(state.groups.every((g) => g.enabled)).toBe(true);
  });

  test("AI tự bật/tắt qua MCP tool tool_groups_list/set", async () => {
    const { client } = await connectClient();

    const listRes: any = await client.callTool({ name: "tool_groups_list", arguments: {} });
    const state = JSON.parse(listRes.content[0].text);
    expect(state.groups.find((g: any) => g.id === "fb").enabled).toBe(true);

    // Tắt nhóm fb bằng tool, kiểm tra tools/list mất tool fb ngay.
    await client.callTool({ name: "tool_groups_set", arguments: { group: "fb", enabled: false } });
    let names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("fb_post_start");
    expect(names).toContain("tool_groups_set");

    // Tắt luôn core — tool_groups_set vẫn phải gọi được (luôn bật).
    await client.callTool({ name: "tool_groups_set", arguments: { group: "core", enabled: false } });
    names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain("execute_terminal_command");
    expect(names).toContain("tool_groups_set");

    // Preset code: bật core+code+agents+skills, tắt phần còn lại.
    await client.callTool({ name: "tool_groups_set", arguments: { preset: "code" } });
    names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("execute_terminal_command");
    expect(names).toContain("code_search_text");
    expect(names).not.toContain("fb_post_start");
    expect(names).not.toContain("vps_ssh_execute");

    // Trả về trạng thái bật tất cả cho các test khác / dọn dẹp.
    await client.callTool({ name: "tool_groups_set", arguments: { preset: "all" } });
    names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("fb_post_start");
    await client.close();
  });
});

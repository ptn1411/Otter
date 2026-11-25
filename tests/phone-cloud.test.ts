import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { io as createSocketClient, type Socket as ClientSocket } from "socket.io-client";

const prevOtterHome = process.env.OTTER_HOME;
const prevDbPath = process.env.OTTER_DB_PATH;
const tempDir = mkdtempSync(path.join(tmpdir(), "otter-phonecloud-test-"));

describe("PhoneCloud Integrated Relay, SQLite Store & 20 MCP Tools", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let baseUrl = "";
  let closeSharedDatabaseFn: (() => void) | null = null;
  let shutdownPhoneCloudFn: (() => void) | null = null;

  beforeAll(async () => {
    process.env.OTTER_HOME = tempDir;
    process.env.OTTER_DB_PATH = path.join(tempDir, "phonecloud-test.sqlite");

    const dbMod = await import("../src/daemon/db");
    closeSharedDatabaseFn = dbMod.closeSharedDatabase;
    closeSharedDatabaseFn();
    const db = dbMod.getDatabase();

    const pcMod = await import("../src/daemon/phone-cloud");
    shutdownPhoneCloudFn = pcMod.shutdownPhoneCloud;
    const { handlePhoneCloudRoutes } = await import("../src/daemon/routes/phone-cloud-routes");
    const { handleMcpRoutes } = await import("../src/daemon/routes/mcp-routes");
    const { handleToolGroupsRoutes } = await import("../src/daemon/routes/tool-groups-routes");

    server = Bun.serve<any>({
      port: 0,
      async fetch(req, srv) {
        const url = new URL(req.url);
        const wsUpgrade = pcMod.tryUpgradePhoneSocketIo(req, url, srv);
        if (wsUpgrade !== null) return wsUpgrade;

        const pcRes = await handlePhoneCloudRoutes(req, url, db, srv.requestIP(req)?.address);
        if (pcRes) return pcRes;

        const mcpRes = await handleMcpRoutes(req, url, () => {});
        if (mcpRes) return mcpRes;

        const tgRes = await handleToolGroupsRoutes(req, url);
        if (tgRes) return tgRes;

        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open(ws) {
          if (ws.data?.kind === "phonecloud") {
            pcMod.onPhoneWsOpen(ws);
          }
        },
        message(ws, msg) {
          if (ws.data?.kind === "phonecloud") {
            pcMod.onPhoneWsMessage(ws, msg);
          }
        },
        close(ws) {
          if (ws.data?.kind === "phonecloud") {
            pcMod.onPhoneWsClose(ws);
          }
        },
      },
    });

    baseUrl = `http://127.0.0.1:${server.port}`;
  });

  afterAll(() => {
    try {
      shutdownPhoneCloudFn?.();
    } catch {}
    try {
      server?.stop(true);
    } catch {}
    try {
      closeSharedDatabaseFn?.();
    } catch {}
    if (prevOtterHome === undefined) delete process.env.OTTER_HOME;
    else process.env.OTTER_HOME = prevOtterHome;
    if (prevDbPath === undefined) delete process.env.OTTER_DB_PATH;
    else process.env.OTTER_DB_PATH = prevDbPath;
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("registers, lists (without leaking secrets), renames, rotates password, and deletes devices in SQLite", async () => {
    const regRes = await fetch(`${baseUrl}/api/device/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Samsung S24 Ultra" }),
    });
    expect(regRes.status).toBe(200);
    const reg = await regRes.json();
    expect(reg.status).toBe(true);
    expect(reg.device_id).toMatch(/^\d{8}$/);
    expect(reg.password).toMatch(/^\d{6}$/);
    expect(reg.key.length).toBeGreaterThan(20);
    expect(reg.ws_path).toBe("/socket.io");

    // Public list must NEVER expose password or key
    const pubList = await fetch(`${baseUrl}/api/devices`).then((r) => r.json());
    expect(pubList.status).toBe(true);
    const pubRow = pubList.devices.find((d: any) => d.device_id === reg.device_id);
    expect(pubRow).toBeDefined();
    expect(pubRow.name).toBe("Samsung S24 Ultra");
    expect("password" in pubRow).toBe(false);
    expect("key" in pubRow).toBe(false);
    expect("device_key" in pubRow).toBe(false);

    // Admin list includes password for Dashboard owner, still hides raw device_key
    const adminList = await fetch(`${baseUrl}/api/phone-cloud/devices`).then((r) => r.json());
    expect(adminList.ok).toBe(true);
    const adminRow = adminList.devices.find((d: any) => d.device_id === reg.device_id);
    expect(adminRow.password).toBe(reg.password);

    // Rename device
    const renameRes = await fetch(`${baseUrl}/api/phone-cloud/devices/${reg.device_id}/rename`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Máy Chính Zalo" }),
    }).then((r) => r.json());
    expect(renameRes.ok).toBe(true);
    expect(renameRes.device.name).toBe("Máy Chính Zalo");

    // Rotate password
    const rotRes = await fetch(`${baseUrl}/api/phone-cloud/devices/${reg.device_id}/rotate-password`, {
      method: "POST",
    }).then((r) => r.json());
    expect(rotRes.ok).toBe(true);
    expect(rotRes.password).toMatch(/^\d{6}$/);
    expect(rotRes.password).not.toBe(reg.password);

    // Old password rejected, new password accepted on /api/control/connect
    const badConn = await fetch(`${baseUrl}/api/control/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: reg.device_id, passwd: reg.password }),
    });
    expect(badConn.status).toBe(401);

    const okConn = await fetch(`${baseUrl}/api/control/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_id: reg.device_id, passwd: rotRes.password }),
    });
    expect(okConn.status).toBe(200);

    // Delete device
    const delRes = await fetch(`${baseUrl}/api/phone-cloud/devices/${reg.device_id}`, {
      method: "DELETE",
    }).then((r) => r.json());
    expect(delRes.ok).toBe(true);
  });

  it("relays Socket.IO v4 (both polling+upgrade and pure websocket), caches keyframes, and executes all 20 phone_* MCP tools", async () => {
    // 1. Register simulated Android phone
    const reg = await fetch(`${baseUrl}/api/device/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Pixel 8 Pro" }),
    }).then((r) => r.json());

    const seenCommands: any[] = [];
    let clipboardText = "otp-889900";
    let receivedSettings: any = null;

    // 2. Connect simulated Android phone using polling + websocket upgrade (just like Android io.socket:socket.io-client:2.1.0!)
    const phoneSocket: ClientSocket = createSocketClient(baseUrl, {
      path: "/socket.io",
      transports: ["polling", "websocket"],
      timeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Phone join timeout")), 6000);
      phoneSocket.on("connect_error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      phoneSocket.on("connect", () => {
        phoneSocket.emit("join_room", { key: reg.key, width: 1080, height: 2400 });
      });
      phoneSocket.on("joined", (d: any) => {
        clearTimeout(timer);
        if (d?.status) resolve();
        else reject(new Error(d?.msg || "Phone join rejected"));
      });
    });

    phoneSocket.on("settings", (s: any) => {
      receivedSettings = s;
    });

    phoneSocket.on("command", (cmd: any) => {
      seenCommands.push(cmd);
      switch (cmd.action) {
        case "findElements": {
          const xp = String(cmd.xpath || "");
          if (xp.includes("KhôngTồnTại")) {
            phoneSocket.emit("result", { taskId: cmd.taskId, status: true, data: [] });
          } else {
            phoneSocket.emit("result", {
              taskId: cmd.taskId,
              status: true,
              data: [
                {
                  text: "Đăng nhập",
                  contentDesc: "Nút đăng nhập chính",
                  resourceId: "vn.app:id/btn_login",
                  className: "android.widget.Button",
                  bounds: [100, 400, 500, 520],
                  clickable: true,
                  enabled: true,
                  checked: false,
                  focused: false,
                },
                {
                  text: "",
                  contentDesc: "Ô nhập số điện thoại",
                  resourceId: "vn.app:id/edt_phone",
                  className: "android.widget.EditText",
                  bounds: [80, 200, 1000, 320],
                  clickable: true,
                  enabled: true,
                  checked: false,
                  focused: true,
                },
              ],
            });
          }
          break;
        }
        case "clickElement": {
          // Simulate wrapper non-clickable fallback case when xpath contains NonClickableWrap
          if (String(cmd.xpath || "").includes("NonClickableWrap")) {
            phoneSocket.emit("result", { taskId: cmd.taskId, status: false, msg: "không tìm thấy phần tử" });
          } else {
            phoneSocket.emit("result", { taskId: cmd.taskId, status: true, data: { done: true } });
          }
          break;
        }
        case "setTextElement":
          phoneSocket.emit("result", { taskId: cmd.taskId, status: true, data: { done: true } });
          break;
        case "appEvent":
          phoneSocket.emit("result", {
            taskId: cmd.taskId,
            status: true,
            data: { done: true, command: cmd.command, packageName: cmd.packageName },
          });
          break;
        case "clipboard":
          if (cmd.command === "set") {
            clipboardText = String(cmd.text || "");
            phoneSocket.emit("result", { taskId: cmd.taskId, status: true, data: { done: true } });
          } else {
            phoneSocket.emit("result", { taskId: cmd.taskId, status: true, data: { text: clipboardText } });
          }
          break;
        case "screenshot":
          // Valid 1x1 PNG base64
          phoneSocket.emit("result", {
            taskId: cmd.taskId,
            status: true,
            data: {
              pngBase64:
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            },
          });
          break;
        case "timeSync":
          phoneSocket.emit("result", { taskId: cmd.taskId, status: true, data: { time: Date.now() } });
          break;
      }
    });

    // 3. Emit video_meta + binary keyframe from phone BEFORE viewer joins (tests instant keyframe replay cache!)
    const fakeKeyframe = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0x03, 0xe8, 0, 0, 0, 1, 0x65, 0xaa, 0xbb, 0xcc]);
    phoneSocket.emit("video_meta", {
      width: 720,
      height: 1600,
      sps: "Z2QAHqwsaoLA",
      pps: "aO48sA==",
      screenWidth: 1080,
      screenHeight: 2400,
    });
    phoneSocket.emit("screen", fakeKeyframe);
    await Bun.sleep(120);

    // 4. Connect web viewer via pure WebSocket and verify cached video_meta + binary keyframe arrive immediately!
    let gotMeta: any = null;
    let gotFrame: Uint8Array | null = null;
    const viewerSocket: ClientSocket = createSocketClient(baseUrl, {
      path: "/socket.io",
      transports: ["websocket"],
      timeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Viewer cached frame timeout")), 6000);
      viewerSocket.on("video_meta", (m: any) => {
        gotMeta = m;
        if (gotMeta && gotFrame) {
          clearTimeout(timer);
          resolve();
        }
      });
      viewerSocket.on("screen", (buf: ArrayBuffer | Uint8Array) => {
        gotFrame = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
        if (gotMeta && gotFrame) {
          clearTimeout(timer);
          resolve();
        }
      });
      viewerSocket.on("connect", () => {
        viewerSocket.emit("join_room", { device_id: reg.device_id, passwd: reg.password });
      });
    });

    expect(gotMeta.screenWidth).toBe(1080);
    expect(Buffer.from(gotFrame!)).toEqual(fakeKeyframe);

    // 5. Verify all 20 phone_* tools & Tool Group registration
    const { executePhoneTool, PHONE_TOOL_DEFS } = await import("../src/daemon/tools/phone-tools");
    const { getToolGroupsState } = await import("../src/daemon/tool-groups");

    expect(PHONE_TOOL_DEFS.length).toBe(20);
    const tgState = getToolGroupsState();
    const phoneGroup = tgState.groups.find((g) => g.id === "phone");
    expect(phoneGroup).toBeDefined();
    expect(phoneGroup!.toolCount).toBe(20);

    // 5a. Discovery endpoint /api/mcp/servers includes phone_* tools & /api/mcp/ext/otter_core/phone_list_devices works
    const serversRes = await fetch(`${baseUrl}/api/mcp/servers`).then((r) => r.json());
    const otterCore = serversRes.servers.find((s: any) => s.name === "otter_core");
    expect(otterCore.tools.some((t: any) => t.name === "phone_get_ui_tree")).toBe(true);

    const extCallRes = await fetch(`${baseUrl}/api/mcp/ext/otter_core/phone_list_devices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    expect(extCallRes.ok).toBe(true);
    expect(extCallRes.devices.some((d: any) => d.device_id === reg.device_id && d.online === true)).toBe(true);

    // 5b. Direct zero-password in-process MCP tool calls!
    const connInfo: any = await executePhoneTool("phone_connect", { device_id: reg.device_id });
    expect(connInfo.online).toBe(true);
    expect(connInfo.screenWidth).toBe(1080);

    const devInfo: any = await executePhoneTool("phone_device_info", {});
    expect(devInfo.deviceId).toBe(reg.device_id);

    const uiTree: any = await executePhoneTool("phone_get_ui_tree", { maxResults: 10 });
    expect(String(uiTree)).toContain('text="Đăng nhập"');
    expect(String(uiTree)).toContain("center=(300,460)");
    expect(String(uiTree)).toContain("FOCUSED");

    const found: any = await executePhoneTool("phone_find_element", { text: "Đăng nhập" });
    expect(String(found)).toContain("vn.app:id/btn_login");

    const clicked: any = await executePhoneTool("phone_click_element", { text: "Đăng nhập" });
    expect(clicked.done).toBe(true);

    const waited: any = await executePhoneTool("phone_wait_for_element", { id: "edt_phone", timeoutMs: 2000 });
    expect(waited.found).toBe(true);

    const focused: any = await executePhoneTool("phone_get_focused", {});
    expect(Array.isArray(focused)).toBe(true);
    expect(focused[0].resourceId).toBe("vn.app:id/edt_phone");

    await executePhoneTool("phone_tap", { x: 300, y: 460 });
    await executePhoneTool("phone_long_press", { x: 300, y: 460, durationMs: 220 });
    await executePhoneTool("phone_swipe", { x1: 500, y1: 1800, x2: 500, y2: 600, durationMs: 250 });
    // Auto-center scroll without x,y!
    const scrollRes: any = await executePhoneTool("phone_scroll", { direction: "down", amount: 500 });
    expect(scrollRes.x).toBe(540);
    expect(scrollRes.y).toBe(1200);

    await executePhoneTool("phone_type_text", { text: "0909123456" });
    await executePhoneTool("phone_set_text", { text: "hello@otter.vn" });
    await executePhoneTool("phone_press_key", { key: "home" });
    await executePhoneTool("phone_press_key", { key: "power" });

    const appRes: any = await executePhoneTool("phone_open_app", { packageName: "com.zing.zalo", command: "start" });
    expect(appRes.packageName).toBe("com.zing.zalo");

    const clipGet1: any = await executePhoneTool("phone_clipboard", { command: "get" });
    expect(clipGet1.text).toBe("otp-889900");
    await executePhoneTool("phone_clipboard", { command: "set", text: "copied-from-otter" });
    const clipGet2: any = await executePhoneTool("phone_clipboard", { command: "get" });
    expect(clipGet2.text).toBe("copied-from-otter");

    const shotRes: any = await executePhoneTool("phone_screenshot", {});
    expect(shotRes.pngBase64).toBeTruthy();

    const qualRes: any = await executePhoneTool("phone_set_quality", { quality: 480, fps: 24 });
    expect(qualRes.quality).toBe(480);
    expect(qualRes.fps).toBe(24);
    await Bun.sleep(80);
    expect(receivedSettings).toEqual({ quality: 480, fps: 24 });

    expect(seenCommands.some((c) => c.action === "touchEvent" && c.x === 300 && c.y === 460)).toBe(true);
    expect(seenCommands.some((c) => c.action === "wheelEvent" && c.x === 540 && c.y === 1200 && c.deltaY === 500)).toBe(true);
    expect(seenCommands.some((c) => c.action === "keyEvent" && c.keyName === "HOME")).toBe(true);
    expect(seenCommands.some((c) => c.action === "power")).toBe(true);

    const discRes: any = await executePhoneTool("phone_disconnect", {});
    expect(discRes.disconnected).toBe(true);

    viewerSocket.disconnect();
    phoneSocket.disconnect();
  });
});

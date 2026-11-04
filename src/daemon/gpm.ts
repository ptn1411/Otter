import * as path from "node:path";

export const GPM_LOGIN_API_BASE = process.env.GPM_API_BASE || "http://127.0.0.1:9495/api/v1";
export const GPM_AUTOMATE_MCP_URL = process.env.GPM_AUTOMATE_MCP_URL || "http://127.0.0.1:19977/mcp";

export interface GpmProfileItem {
  id: string;
  name: string;
  group_id?: string;
  raw_proxy?: string;
  browser?: { name?: string; version?: string };
  is_running?: boolean;
  remote_debugging_port?: number;
}

export interface GscriptActionParams {
  actionType: number;
  xpath?: string;
  rawInput?: Record<string, string>;
  comment?: string;
  delay?: string;
  continueOnError?: boolean;
}

/**
 * Kiểm tra trạng thái hoạt động của GPM Login API (9495) và GPM Automate MCP (19977)
 */
export async function getGpmHealth(): Promise<{
  gpmLogin: boolean;
  gpmAutomate: boolean;
  loginPort: number;
  automatePort: number;
  error?: string;
}> {
  let gpmLogin = false;
  let gpmAutomate = false;

  try {
    const res = await fetch(`${GPM_LOGIN_API_BASE}/profiles?page=1&page_size=1`, {
      signal: AbortSignal.timeout(1500)
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.success) gpmLogin = true;
    }
  } catch {}

  try {
    const res = await fetch(GPM_AUTOMATE_MCP_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal: AbortSignal.timeout(1500)
    });
    if (res.status === 200 || res.status === 400 || res.status === 406) {
      gpmAutomate = true;
    }
  } catch {}

  return {
    gpmLogin,
    gpmAutomate,
    loginPort: 9495,
    automatePort: 19977
  };
}

/**
 * Liệt kê danh sách Profile từ GPM Login Local API
 */
export async function listGpmProfiles(page = 1, pageSize = 50, search = ""): Promise<{
  success: boolean;
  total: number;
  profiles: GpmProfileItem[];
  message?: string;
}> {
  const query = new URLSearchParams({
    page: String(page),
    page_size: String(pageSize),
    ...(search ? { search } : {})
  });

  try {
    const res = await fetch(`${GPM_LOGIN_API_BASE}/profiles?${query.toString()}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      return { success: false, total: 0, profiles: [], message: `HTTP ${res.status}: ${res.statusText}` };
    }
    const data = await res.json();
    if (!data.success) {
      return { success: false, total: 0, profiles: [], message: data.message || "Failed to load profiles" };
    }

    const rawList = data.data?.data || data.data || [];
    const profiles: GpmProfileItem[] = rawList.map((p: any) => ({
      id: p.id,
      name: p.name,
      group_id: p.group_id,
      raw_proxy: p.raw_proxy,
      browser: p.browser,
      is_running: Boolean(p.remote_debugging_port || p.websocket_debugging_url),
      remote_debugging_port: p.remote_debugging_port
    }));

    return {
      success: true,
      total: data.data?.total || profiles.length,
      profiles
    };
  } catch (err: any) {
    return { success: false, total: 0, profiles: [], message: err.message };
  }
}

/**
 * Khởi động profile GPM Login kèm cổng CDP và nạp extension Otter
 */
export async function startGpmProfile(
  id: string,
  options?: {
    additionArgs?: string;
    loadOtterExtension?: boolean;
    skipProxyCheck?: boolean;
  }
): Promise<{
  success: boolean;
  port?: number;
  wsUrl?: string;
  driverPath?: string;
  message?: string;
}> {
  const query = new URLSearchParams();
  if (options?.skipProxyCheck !== false) {
    query.set("skip_proxy_check", "true");
  }

  let additionArgs = options?.additionArgs || "";
  if (options?.loadOtterExtension !== false) {
    const extDist = path.resolve("extension/dist");
    const loadArg = `--load-extension="${extDist}"`;
    additionArgs = additionArgs ? `${additionArgs} ${loadArg}` : loadArg;
  }
  if (additionArgs) {
    query.set("addition_args", additionArgs);
  }

  try {
    const url = `${GPM_LOGIN_API_BASE}/profiles/start/${encodeURIComponent(id)}?${query.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json();

    if (!data.success) {
      return { success: false, message: data.message || "Không thể khởi động profile" };
    }

    const port = data.data?.remote_debugging_port ? Number(data.data.remote_debugging_port) : undefined;
    const wsUrl = data.data?.websocket_debugging_url;
    const driverPath = data.data?.driver_path;

    return {
      success: true,
      port,
      wsUrl,
      driverPath,
      message: "Khởi động profile thành công"
    };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Dừng profile GPM Login
 */
export async function stopGpmProfile(id: string): Promise<{ success: boolean; message?: string }> {
  try {
    const res = await fetch(`${GPM_LOGIN_API_BASE}/profiles/stop/${encodeURIComponent(id)}`, {
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    return {
      success: Boolean(data.success),
      message: data.message || (data.success ? "Đã dừng profile" : "Không thể dừng profile")
    };
  } catch (err: any) {
    return { success: false, message: err.message };
  }
}

/**
 * Sinh UUID v4 chuẩn RFC
 */
export function generateGuid(): string {
  return crypto.randomUUID();
}

/**
 * Tạo một ActionNode chuẩn GPM Automate V3 (JSON .NET format)
 */
export function generateGscriptActionNode(params: GscriptActionParams): any {
  const rawInputPairs: Array<{ Key: string; Value: string }> = [];
  if (params.rawInput) {
    for (const [key, val] of Object.entries(params.rawInput)) {
      rawInputPairs.push({ Key: key, Value: String(val) });
    }
  }

  return {
    $type: "GPMAutomateEditor.Models.ActionNode, GPMAutomateEditor.Models",
    type: params.actionType,
    element_xpath: params.xpath || null,
    output_variable_name: null,
    delay: params.delay || "$delay",
    continue_on_error: Boolean(params.continueOnError),
    id: generateGuid(),
    display_text: null,
    raw_input: JSON.stringify(rawInputPairs),
    comment: params.comment || ""
  };
}

/**
 * Đóng gói mảng ActionNode thành NormalBlockNode (paste-ready clipboard)
 */
export function generateGscriptBlock(nodes: any[], displayText = "Otter Automation Block"): any {
  return {
    $type: "GPMAutomateEditor.Models.NormalBlockNode, GPMAutomateEditor.Models",
    nodes,
    expanded: true,
    id: generateGuid(),
    display_text: displayText,
    comment: "Tự động sinh bởi Otter GPM Studio"
  };
}

/**
 * Chuẩn hóa biểu thức điều kiện GPM Automate V3: hasElement(...) hoặc !hasElement(...)
 */
export function formatGpmCondition(xpath: string, negate = false): string {
  const cleanXpath = xpath.trim();
  return negate ? `!hasElement(${cleanXpath})` : `hasElement(${cleanXpath})`;
}

/**
 * Kiểm tra cú pháp biểu thức XPath cơ bản
 */
export function validateXPathExpression(xpath: string): { valid: boolean; error?: string } {
  if (!xpath || typeof xpath !== "string" || !xpath.trim()) {
    return { valid: false, error: "XPath không được để trống" };
  }
  const trimmed = xpath.trim();
  // Kiểm tra cơ bản dấu ngoặc vuông và slash
  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/\]/g) || []).length;
  if (openBrackets !== closeBrackets) {
    return { valid: false, error: "Số lượng ngoặc vuông '[' và ']' không khớp nhau" };
  }
  if (!trimmed.startsWith("/") && !trimmed.startsWith("./") && !trimmed.startsWith("(")) {
    return { valid: false, error: "XPath nên bắt đầu bằng '/', './' hoặc '('" };
  }
  return { valid: true };
}


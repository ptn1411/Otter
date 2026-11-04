/**
 * Motion MCP (free) — đọc tài nguyên motion:// từ server hosted của Motion.
 *
 * Server free ở https://mcp.motion.dev chỉ có 2 tool (search-motion-docs,
 * insert-motion-component) và 2 tool đó đã được gateway nạp tự động qua
 * mcp_config.json (thành motion_search-motion-docs /
 * motion_insert-motion-component). Cái gateway chưa làm được là đọc
 * resource_links mà search trả về (docs/examples), vì gateway chỉ proxy
 * tools, không proxy resources/read. File này bù đúng phần thiếu đó.
 *
 * Không cần API key cho server free. Server Motion+ (mcp.motion.dev/plus)
 * KHÔNG nối ở đây: nó cần đăng nhập Motion+ (trả phí), và skill motion
 * đã dặn không được tự suy ra source/methodology bị khóa từ mô tả.
 *
 * Giới hạn an toàn: chỉ chấp nhận URI bắt đầu bằng "motion://" (server
 * này chỉ phục vụ scheme đó); URL server lấy từ env OTTER_MOTION_MCP_URL
 * nếu có, mặc định là server free chính thức. Timeout 20s, output cắt ở
 * 20.000 ký tự để không nổ context.
 */

const DEFAULT_URL = "https://mcp.motion.dev";
const MAX_CHARS = 20000;
const TIMEOUT_MS = 20000;

export function getMotionMcpUrl(): string {
  return process.env.OTTER_MOTION_MCP_URL || DEFAULT_URL;
}

export function isMotionUri(uri: string): boolean {
  return typeof uri === "string" && uri.startsWith("motion://");
}

export async function readMotionResource(uri: string): Promise<string> {
  if (!isMotionUri(uri)) {
    throw new Error(
      `Chỉ đọc được URI motion:// từ Motion MCP, nhận được: ${uri.slice(0, 100)}`
    );
  }
  const url = getMotionMcpUrl();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "resources/read",
        params: { uri },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Motion MCP HTTP ${res.status} ${res.statusText}`);
    }
    const data: any = await res.json();
    if (data.error) {
      throw new Error(`Motion MCP error ${data.error.code}: ${data.error.message}`);
    }
    const contents = data.result?.contents;
    if (!Array.isArray(contents) || contents.length === 0) {
      throw new Error(`Motion MCP không trả nội dung cho ${uri}`);
    }
    const text = contents
      .map((c: any) => c.text ?? "")
      .filter(Boolean)
      .join("\n");
    if (!text) throw new Error(`Motion MCP trả nội dung rỗng cho ${uri}`);
    if (text.length > MAX_CHARS) {
      return (
        text.slice(0, MAX_CHARS) +
        `\n\n[Đã cắt ở ${MAX_CHARS} ký tự, tổng ${text.length} ký tự — đọc lại với URI cụ thể hơn nếu cần đoạn sau.]`
      );
    }
    return text;
  } catch (err: any) {
    if (err?.name === "AbortError") {
      throw new Error(`Motion MCP timeout sau ${TIMEOUT_MS}ms cho ${uri}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

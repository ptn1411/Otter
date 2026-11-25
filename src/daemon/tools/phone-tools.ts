import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildPhoneSelector,
  formatPhoneElements,
  listPhoneDevicesPublic,
  phoneConnect,
  phoneDisconnect,
  phoneFireCommand,
  phoneGetDeviceInfo,
  phoneRequestCommand,
  resolvePhoneSelector,
  setRemoteOrLocalQuality,
} from "../phone-cloud";

export interface PhoneToolMeta {
  name: string;
  title: string;
  description: string;
}

export const PHONE_TOOL_DEFS: PhoneToolMeta[] = [
  {
    name: "phone_list_devices",
    title: "Danh sách điện thoại Android (PhoneCloud)",
    description: "Liệt kê các điện thoại Android đã đăng ký trên Otter PhoneCloud (hoặc Relay ngoài), trạng thái online, độ phân giải và chất lượng luồng.",
  },
  {
    name: "phone_connect",
    title: "Kết nối / Chọn điện thoại Android",
    description: "Chọn thiết bị Android cần điều khiển theo device_id (không cần mật khẩu khi máy nối trực tiếp vào Otter; hỗ trợ cả api + password cho Relay ngoài).",
  },
  {
    name: "phone_disconnect",
    title: "Ngắt phiên điều khiển điện thoại",
    description: "Bỏ chọn thiết bị hiện tại hoặc ngắt kết nối khỏi Relay PhoneCloud từ xa.",
  },
  {
    name: "phone_device_info",
    title: "Thông tin chi tiết điện thoại đang chọn",
    description: "Xem ID, tên máy, trạng thái online, độ phân giải màn hình thật, hướng xoay, quality và fps.",
  },
  {
    name: "phone_get_ui_tree",
    title: "Đọc cây giao diện Accessibility Android",
    description: "Đọc toàn bộ cây giao diện đang hiển thị trên màn hình điện thoại kèm tọa độ tâm center=(x,y). Rẻ token và chính xác hơn chụp ảnh.",
  },
  {
    name: "phone_find_element",
    title: "Tìm phần tử giao diện Android",
    description: "Tìm phần tử trên màn hình điện thoại theo xpath hoặc tiêu chí ngữ nghĩa (text, id, className, contentDescription).",
  },
  {
    name: "phone_click_element",
    title: "Bấm phần tử giao diện Android",
    description: "Tìm và bấm phần tử khớp xpath hoặc tiêu chí ngữ nghĩa (tự fallback chạm tọa độ tâm nếu thẻ bọc không gắn cờ clickable).",
  },
  {
    name: "phone_wait_for_element",
    title: "Chờ phần tử xuất hiện trên màn hình Android",
    description: "Chờ tới khi phần tử khớp xpath/tiêu chí xuất hiện trên màn hình điện thoại hoặc hết timeoutMs.",
  },
  {
    name: "phone_get_focused",
    title: "Lấy ô nhập liệu đang focus trên Android",
    description: "Trả về danh sách phần tử đang được focus trong cây giao diện Android.",
  },
  {
    name: "phone_tap",
    title: "Chạm tọa độ màn hình Android",
    description: "Chạm một điểm (x, y) theo hệ tọa độ màn hình thật của điện thoại.",
  },
  {
    name: "phone_long_press",
    title: "Nhấn giữ tọa độ trên màn hình Android",
    description: "Nhấn giữ tại điểm (x, y) trong durationMs mili-giây (pointer down/up chuẩn 1.2 hoặc swipe tại chỗ khi legacy=true).",
  },
  {
    name: "phone_swipe",
    title: "Vuốt màn hình Android",
    description: "Vuốt từ điểm (x1, y1) sang (x2, y2) trong khoảng thời gian durationMs.",
  },
  {
    name: "phone_scroll",
    title: "Cuộn màn hình Android",
    description: "Cuộn lên (up) hoặc xuống (down) tại (x, y); nếu bỏ trống x, y sẽ tự cuộn tại chính giữa màn hình.",
  },
  {
    name: "phone_type_text",
    title: "Gõ chữ vào ô đang focus trên Android",
    description: "Gõ chuỗi văn bản Unicode/tiếng Việt vào ô đang focus qua PhoneCloud Keyboard / Accessibility.",
  },
  {
    name: "phone_set_text",
    title: "Điền/thay thế chữ vào phần tử Android",
    description: "Ghi đè nội dung chữ vào phần tử khớp xpath/id/className/contentDescription (bỏ trống selector sẽ tự điền vào ô đang focus).",
  },
  {
    name: "phone_press_key",
    title: "Bấm phím điều hướng / hệ thống Android",
    description: "Bấm phím hệ thống: BACK, HOME, RECENTS, NOTIFICATIONS, POWER, LOCK, ENTER, DEL, SPACE, TAB, ESCAPE.",
  },
  {
    name: "phone_open_app",
    title: "Mở / Đóng / Quản lý ứng dụng Android",
    description: "Điều khiển ứng dụng theo packageName (command: start, stop, clear, uninstall, openInfo).",
  },
  {
    name: "phone_clipboard",
    title: "Đọc / Ghi Clipboard điện thoại Android",
    description: "Lấy nội dung clipboard hiện tại (command='get') hoặc chép văn bản mới vào clipboard điện thoại (command='set').",
  },
  {
    name: "phone_screenshot",
    title: "Chụp ảnh màn hình gốc PNG từ Android",
    description: "Chụp màn hình trực tiếp từ Android Accessibility (Android 11+) và trả về ảnh PNG sắc nét.",
  },
  {
    name: "phone_set_quality",
    title: "Đổi độ phân giải & FPS luồng hình Android",
    description: "Cập nhật độ phân giải (360/480/720/1080) và tốc độ khung hình (15/24/30 fps) của luồng H.264.",
  },
];

/**
 * Thực thi thống nhất mọi công cụ `phone_*` (dùng chung cho MCP Server, REST Gateway `/api/mcp/ext/otter_core/*` và `/api/activity/v1/phone/*`).
 */
export async function executePhoneTool(
  toolName: string,
  args: Record<string, any> = {},
  onActivity?: (event: any) => void
): Promise<any> {
  const deviceId = args.device_id ? String(args.device_id) : undefined;
  onActivity?.({ type: "phone_action", tool: toolName, deviceId: deviceId || null });

  switch (toolName) {
    case "phone_list_devices": {
      const extApi = (args.api || "").trim().replace(/\/$/, "");
      if (extApi) {
        const r = await fetch(`${extApi}/api/devices`);
        const j: any = await r.json();
        return { ok: Boolean(j.status), mode: "remote", api: extApi, devices: j.devices || [] };
      }
      const devices = listPhoneDevicesPublic();
      return { ok: true, mode: "local", count: devices.length, devices };
    }

    case "phone_connect": {
      if (!args.device_id) throw new Error("Thiếu tham số 'device_id'");
      return phoneConnect({
        api: args.api,
        deviceId: String(args.device_id),
        password: args.password ? String(args.password) : undefined,
      });
    }

    case "phone_disconnect":
      return phoneDisconnect();

    case "phone_device_info":
      return phoneGetDeviceInfo(deviceId);

    case "phone_get_ui_tree": {
      const list = await phoneRequestCommand("findElements", { xpath: "//*" }, 12_000, deviceId);
      const maxResults = Math.max(1, Math.min(Number(args.maxResults) || 100, 300));
      const arr = Array.isArray(list) ? list.slice(0, maxResults) : [];
      return formatPhoneElements(arr);
    }

    case "phone_find_element": {
      const xpath = resolvePhoneSelector(args);
      const list = await phoneRequestCommand("findElements", { xpath }, 8_000, deviceId);
      return formatPhoneElements(list);
    }

    case "phone_click_element": {
      const xpath = resolvePhoneSelector(args);
      try {
        return await phoneRequestCommand("clickElement", { xpath }, 8_000, deviceId);
      } catch (err: any) {
        // Nâng cấp thực chiến: nhiều View trên Android (TextView con bên trong ViewGroup)
        // không gắn clickable=true nên Accessibility ACTION_CLICK trả false -> tự tìm bounds và chạm tâm!
        const list = await phoneRequestCommand("findElements", { xpath }, 6_000, deviceId).catch(() => null);
        if (Array.isArray(list) && list.length > 0 && Array.isArray(list[0].bounds) && list[0].bounds.length >= 4) {
          const b = list[0].bounds;
          const cx = Math.round((b[0] + b[2]) / 2);
          const cy = Math.round((b[1] + b[3]) / 2);
          phoneFireCommand("touchEvent", { x: cx, y: cy }, deviceId);
          return { done: true, fallback: "tap_center", x: cx, y: cy };
        }
        throw err;
      }
    }

    case "phone_wait_for_element": {
      const xpath = resolvePhoneSelector(args);
      const deadline = Date.now() + Math.max(500, Math.min(Number(args.timeoutMs) || 8_000, 30_000));
      let last: any[] = [];
      while (Date.now() < deadline) {
        const found = await phoneRequestCommand("findElements", { xpath }, 4_000, deviceId);
        last = Array.isArray(found) ? found : [];
        if (last.length > 0) return { found: true, count: last.length, elements: last };
        await Bun.sleep(400);
      }
      return { found: false, count: 0, elements: last };
    }

    case "phone_get_focused": {
      const all = await phoneRequestCommand("findElements", { xpath: "//*" }, 12_000, deviceId);
      const list = Array.isArray(all) ? all : [];
      return list.filter((el: any) => el && el.focused);
    }

    case "phone_tap": {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Tọa độ x, y không hợp lệ");
      return phoneFireCommand("touchEvent", { x, y }, deviceId);
    }

    case "phone_long_press": {
      const x = Math.round(Number(args.x));
      const y = Math.round(Number(args.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Tọa độ x, y không hợp lệ");
      const ms = Math.max(200, Math.min(Number(args.durationMs) || 600, 4_000));
      if (args.legacy) {
        phoneFireCommand("swipeEvent", { start_x: x, start_y: y, end_x: x, end_y: y, duration: ms }, deviceId);
        return { sent: true, durationMs: ms, via: "swipeEvent" };
      }
      phoneFireCommand("pointerEvent", { phase: "down", x, y }, deviceId);
      await Bun.sleep(ms);
      phoneFireCommand("pointerEvent", { phase: "up", x, y }, deviceId);
      return { sent: true, durationMs: ms, via: "pointerEvent" };
    }

    case "phone_swipe": {
      const x1 = Math.round(Number(args.x1));
      const y1 = Math.round(Number(args.y1));
      const x2 = Math.round(Number(args.x2));
      const y2 = Math.round(Number(args.y2));
      const duration = Math.max(50, Math.min(Number(args.durationMs) || 280, 5_000));
      phoneFireCommand("swipeEvent", { start_x: x1, start_y: y1, end_x: x2, end_y: y2, duration }, deviceId);
      return { sent: true, durationMs: duration };
    }

    case "phone_scroll": {
      let x = args.x !== undefined ? Math.round(Number(args.x)) : NaN;
      let y = args.y !== undefined ? Math.round(Number(args.y)) : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const info = phoneGetDeviceInfo(deviceId);
        x = Math.round((info.screenWidth || 1080) / 2);
        y = Math.round((info.screenHeight || 2400) / 2);
      }
      const amount = Math.abs(Number(args.amount) || 400);
      const deltaY = args.direction === "up" ? -amount : amount;
      phoneFireCommand("wheelEvent", { x, y, deltaY }, deviceId);
      return { sent: true, x, y, deltaY };
    }

    case "phone_type_text": {
      if (args.text === undefined) throw new Error("Thiếu tham số 'text'");
      phoneFireCommand("setTextEvent", { text: String(args.text) }, deviceId);
      return { sent: true };
    }

    case "phone_set_text": {
      if (args.text === undefined) throw new Error("Thiếu tham số 'text'");
      let xpath = args.xpath ? String(args.xpath).trim() : "";
      if (!xpath && (args.id || args.className || args.contentDescription)) {
        xpath = buildPhoneSelector({
          id: args.id,
          className: args.className,
          contentDescription: args.contentDescription,
        });
      }
      if (!xpath) {
        const focused = await phoneRequestCommand("findElements", { xpath: '//*[@focused="true"]' }, 6_000, deviceId);
        if (!Array.isArray(focused) || focused.length === 0) {
          throw new Error("Không có ô nhập liệu nào đang focus trên màn hình.");
        }
        const el = focused[0];
        xpath = el.resourceId ? `//*[@resource-id="${el.resourceId}"]` : `//${el.className || "*"}[@focused="true"]`;
      }
      return phoneRequestCommand("setTextElement", { xpath, text: String(args.text) }, 8_000, deviceId);
    }

    case "phone_press_key": {
      const k = String(args.key || "").trim().toUpperCase();
      if (!k) throw new Error("Thiếu tham số 'key'");
      if (k === "POWER") phoneFireCommand("power", {}, deviceId);
      else phoneFireCommand("keyEvent", { keyName: k }, deviceId);
      return { sent: true, key: k };
    }

    case "phone_open_app": {
      const pkg = String(args.packageName || "").trim();
      if (!pkg) throw new Error("Thiếu tham số 'packageName'");
      const command = args.command || "start";
      return phoneRequestCommand("appEvent", { command, packageName: pkg }, 10_000, deviceId);
    }

    case "phone_clipboard": {
      const command = args.command === "set" ? "set" : "get";
      return phoneRequestCommand(
        "clipboard",
        command === "set" ? { command: "set", text: String(args.text ?? "") } : { command: "get" },
        8_000,
        deviceId
      );
    }

    case "phone_screenshot": {
      const d = await phoneRequestCommand("screenshot", {}, 15_000, deviceId);
      return d;
    }

    case "phone_set_quality": {
      const quality = Number(args.quality);
      const fps = Number(args.fps);
      return setRemoteOrLocalQuality(quality, fps, deviceId);
    }

    default:
      throw new Error(`Công cụ PhoneCloud không tồn tại: ${toolName}`);
  }
}

const criteriaShape = {
  device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn nếu đã chọn qua phone_connect hoặc chỉ có 1 máy online)"),
  xpath: z.string().optional().describe('Selector kiểu XPath rút gọn, vd //*[@text="OK"] (ưu tiên nếu có)'),
  text: z.string().optional().describe("Chữ hiển thị trên phần tử (khớp một phần)"),
  id: z.string().optional().describe("Resource ID của phần tử Android (khớp một phần)"),
  className: z.string().optional().describe("Tên lớp Android, vd android.widget.Button"),
  contentDescription: z.string().optional().describe("Mô tả trợ năng (content-desc)"),
};

function wrapMcp(toolName: string, onActivity?: (event: any) => void) {
  return async (args: any) => {
    try {
      const res = await executePhoneTool(toolName, args || {}, onActivity);
      return {
        content: [
          {
            type: "text" as const,
            text: typeof res === "string" ? res : JSON.stringify(res, null, 2),
          },
        ],
      };
    } catch (err: any) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: err?.message || String(err) }],
      };
    }
  };
}

export function registerPhoneTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "phone_list_devices",
    "Liệt kê các điện thoại Android đã đăng ký trên Otter PhoneCloud (hoặc truyền api để hỏi Relay ngoài).",
    {
      api: z.string().optional().describe("URL Relay ngoài (bỏ trống để lấy danh sách ngay trên Otter)"),
    },
    wrapMcp("phone_list_devices", onActivity)
  );

  mcp.tool(
    "phone_connect",
    "Chọn hoặc kết nối tới một điện thoại Android. Không cần password nếu máy đã đăng ký trực tiếp trên Otter.",
    {
      device_id: z.string().describe("ID thiết bị 8 chữ số"),
      password: z.string().optional().describe("Mật khẩu 6 chữ số (chỉ bắt buộc khi nối qua Relay ngoài 'api')"),
      api: z.string().optional().describe("Địa chỉ Relay ngoài (bỏ trống để điều khiển trực tiếp qua Otter)"),
    },
    wrapMcp("phone_connect", onActivity)
  );

  mcp.tool(
    "phone_disconnect",
    "Ngắt phiên điều khiển điện thoại hiện tại.",
    {},
    wrapMcp("phone_disconnect", onActivity)
  );

  mcp.tool(
    "phone_device_info",
    "Xem thông tin phiên điện thoại: ID, tên máy, online, độ phân giải, hướng xoay, quality và fps.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
    },
    wrapMcp("phone_device_info", onActivity)
  );

  mcp.tool(
    "phone_get_ui_tree",
    "Đọc cây giao diện Accessibility đang hiển thị trên điện thoại kèm tọa độ tâm center=(x,y). Ưu tiên dùng trước khi chạm vì rất nhẹ token.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      maxResults: z.number().optional().describe("Số phần tử tối đa trả về (mặc định 100)"),
    },
    wrapMcp("phone_get_ui_tree", onActivity)
  );

  mcp.tool(
    "phone_find_element",
    "Tìm phần tử trên màn hình Android theo xpath hoặc tiêu chí ngữ nghĩa (text, id, className, contentDescription).",
    criteriaShape,
    wrapMcp("phone_find_element", onActivity)
  );

  mcp.tool(
    "phone_click_element",
    "Tìm và bấm phần tử đầu tiên khớp xpath hoặc tiêu chí ngữ nghĩa (tự chạm tâm nếu phần tử bọc ngoài không gắn clickable).",
    criteriaShape,
    wrapMcp("phone_click_element", onActivity)
  );

  mcp.tool(
    "phone_wait_for_element",
    "Đợi tới khi phần tử khớp xpath/tiêu chí xuất hiện trên màn hình điện thoại, hoặc hết thời gian timeoutMs.",
    {
      ...criteriaShape,
      timeoutMs: z.number().optional().describe("Thời gian chờ tối đa bằng mili-giây (mặc định 8000)"),
    },
    wrapMcp("phone_wait_for_element", onActivity)
  );

  mcp.tool(
    "phone_get_focused",
    "Trả về các phần tử đang được focus trong cây giao diện Android.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
    },
    wrapMcp("phone_get_focused", onActivity)
  );

  mcp.tool(
    "phone_tap",
    "Chạm một điểm (x, y) theo tọa độ màn hình thật của điện thoại.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      x: z.number().describe("Tọa độ ngang X"),
      y: z.number().describe("Tọa độ dọc Y"),
    },
    wrapMcp("phone_tap", onActivity)
  );

  mcp.tool(
    "phone_long_press",
    "Nhấn giữ tại (x, y) trong durationMs mili-giây.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      x: z.number(),
      y: z.number(),
      durationMs: z.number().optional().describe("Thời lượng giữ ms (200..4000, mặc định 600)"),
      legacy: z.boolean().optional().describe("Dùng swipeEvent tại chỗ cho app cũ"),
    },
    wrapMcp("phone_long_press", onActivity)
  );

  mcp.tool(
    "phone_swipe",
    "Vuốt màn hình điện thoại từ (x1, y1) tới (x2, y2).",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
      durationMs: z.number().optional().describe("Thời gian vuốt ms (mặc định 280)"),
    },
    wrapMcp("phone_swipe", onActivity)
  );

  mcp.tool(
    "phone_scroll",
    "Cuộn màn hình điện thoại lên (up) hoặc xuống (down); bỏ trống x, y sẽ tự cuộn ở giữa màn hình.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      direction: z.enum(["up", "down"]).describe("Hướng cuộn nội dung (down = cuộn xuống xem bên dưới, up = cuộn lên)"),
      amount: z.number().optional().describe("Biên độ cuộn (mặc định 400)"),
      x: z.number().optional().describe("Tọa độ X (mặc định giữa màn hình)"),
      y: z.number().optional().describe("Tọa độ Y (mặc định giữa màn hình)"),
    },
    wrapMcp("phone_scroll", onActivity)
  );

  mcp.tool(
    "phone_type_text",
    "Gõ chữ vào ô đang focus trên điện thoại Android.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      text: z.string().describe("Nội dung chữ cần gõ"),
    },
    wrapMcp("phone_type_text", onActivity)
  );

  mcp.tool(
    "phone_set_text",
    "Điền (thay thế) chữ vào phần tử khớp xpath/id/className/contentDescription; bỏ trống selector sẽ ghi vào ô đang focus.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      xpath: z.string().optional(),
      id: z.string().optional(),
      className: z.string().optional(),
      contentDescription: z.string().optional(),
      text: z.string().describe("Nội dung cần điền vào ô"),
    },
    wrapMcp("phone_set_text", onActivity)
  );

  mcp.tool(
    "phone_press_key",
    "Bấm phím hệ thống Android: BACK, HOME, RECENTS, NOTIFICATIONS, POWER, LOCK, ENTER, DEL, SPACE, TAB, ESCAPE.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      key: z.string().describe("Tên phím cần bấm"),
    },
    wrapMcp("phone_press_key", onActivity)
  );

  mcp.tool(
    "phone_open_app",
    "Mở hoặc quản lý ứng dụng Android theo packageName (start, stop, clear, uninstall, openInfo).",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      packageName: z.string().describe("Tên gói ứng dụng, vd com.android.chrome, com.zing.zalo"),
      command: z.enum(["start", "stop", "clear", "uninstall", "openInfo"]).optional().describe("Mặc định 'start'"),
    },
    wrapMcp("phone_open_app", onActivity)
  );

  mcp.tool(
    "phone_clipboard",
    "Đọc hoặc ghi Clipboard trên điện thoại Android.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      command: z.enum(["get", "set"]).describe("'get' để đọc clipboard, 'set' để ghi clipboard"),
      text: z.string().optional().describe("Nội dung cần chép vào clipboard khi command='set'"),
    },
    wrapMcp("phone_clipboard", onActivity)
  );

  mcp.tool(
    "phone_screenshot",
    "Chụp màn hình điện thoại Android trả về ảnh PNG (chỉ dùng khi cần nhìn hình; ưu tiên phone_get_ui_tree trước).",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
    },
    async (args: any) => {
      try {
        const d = await executePhoneTool("phone_screenshot", args || {}, onActivity);
        if (d?.pngBase64) {
          return {
            content: [
              { type: "image" as const, data: d.pngBase64, mimeType: "image/png" },
              { type: "text" as const, text: "Ảnh chụp màn hình gốc từ điện thoại Android." },
            ],
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(d) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: err?.message || String(err) }],
        };
      }
    }
  );

  mcp.tool(
    "phone_set_quality",
    "Đổi độ phân giải (360/480/720/1080) và tốc độ khung hình (15/24/30 fps) của luồng H.264 từ điện thoại.",
    {
      device_id: z.string().optional().describe("ID thiết bị 8 chữ số (tùy chọn)"),
      quality: z.number().describe("360, 480, 720 hoặc 1080"),
      fps: z.number().describe("15, 24 hoặc 30"),
    },
    wrapMcp("phone_set_quality", onActivity)
  );
}

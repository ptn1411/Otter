/**
 * GPM Automate V3 & GPM Login Local API MCP tools.
 * 
 * Tools (6):
 * 1. gpm_status: Kiểm tra trạng thái GPM Login (9495) và GPM Automate MCP (19977).
 * 2. gpm_list_profiles: Liệt kê các profile GPM kèm proxy và trạng thái chạy.
 * 3. gpm_start_profile: Khởi động profile GPM kèm cổng CDP và nạp extension Otter.
 * 4. gpm_stop_profile: Đóng profile GPM.
 * 5. gpm_test_xpath: Kiểm tra tính hợp lệ và cấu trúc điều kiện hasElement() của XPath.
 * 6. gpm_generate_script: Sinh kịch bản JSON .NET chuẩn paste-ready cho GPM Automate V3.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getGpmHealth,
  listGpmProfiles,
  startGpmProfile,
  stopGpmProfile,
  generateGscriptActionNode,
  generateGscriptBlock,
  formatGpmCondition,
  validateXPathExpression
} from "../gpm";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerGpmTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 1. Kiểm tra trạng thái
  mcp.tool(
    "gpm_status",
    "Kiểm tra trạng thái kết nối tới GPM Login Local API (Port 9495) và GPM Automate MCP (Port 19977)",
    {},
    async () => {
      try {
        const health = await getGpmHealth();
        onActivity?.({ type: "gpm_status", health });
        return text(health);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // 2. Danh sách profile
  mcp.tool(
    "gpm_list_profiles",
    "Liệt kê danh sách các profile trình duyệt trong GPM Login (Port 9495)",
    {
      page: z.number().optional().describe("Trang (mặc định 1)"),
      pageSize: z.number().optional().describe("Số lượng trên trang (mặc định 30)"),
      search: z.string().optional().describe("Từ khóa tìm kiếm tên profile")
    },
    async ({ page, pageSize, search }) => {
      try {
        const res = await listGpmProfiles(page, pageSize, search);
        onActivity?.({ type: "gpm_list_profiles", count: res.profiles.length, total: res.total });
        return text(res);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // 3. Khởi động profile
  mcp.tool(
    "gpm_start_profile",
    "Khởi động một profile GPM Login, tự động nạp tiện ích mở rộng Otter và lấy cổng kết nối CDP",
    {
      profileId: z.string().describe("ID của profile GPM Login cần mở"),
      additionArgs: z.string().optional().describe("Tham số bổ sung cho Chromium"),
      loadOtterExtension: z.boolean().optional().describe("Nạp tiện ích Otter vào trình duyệt (mặc định true)")
    },
    async ({ profileId, additionArgs, loadOtterExtension }) => {
      try {
        const res = await startGpmProfile(profileId, {
          additionArgs,
          loadOtterExtension: loadOtterExtension !== false
        });
        onActivity?.({ type: "gpm_start_profile", profileId, res });
        return text(res);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // 4. Dừng profile
  mcp.tool(
    "gpm_stop_profile",
    "Dừng (đóng) một profile GPM Login đang chạy",
    {
      profileId: z.string().describe("ID của profile GPM Login cần đóng")
    },
    async ({ profileId }) => {
      try {
        const res = await stopGpmProfile(profileId);
        onActivity?.({ type: "gpm_stop_profile", profileId, res });
        return text(res);
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // 5. Kiểm tra XPath
  mcp.tool(
    "gpm_test_xpath",
    "Kiểm tra cú pháp XPath và tạo điều kiện chuẩn hasElement() cho kịch bản GPM Automate V3",
    {
      xpath: z.string().describe("Biểu thức XPath cần kiểm tra (Ví dụ: //button[@id='submit'])"),
      negate: z.boolean().optional().describe("Nếu true, tạo điều kiện phủ định !hasElement(...)")
    },
    async ({ xpath, negate }) => {
      try {
        const validation = validateXPathExpression(xpath);
        const condition = formatGpmCondition(xpath, Boolean(negate));
        return text({
          xpath,
          isValid: validation.valid,
          error: validation.error || null,
          hasElementCondition: condition,
          note: "Theo chuẩn GPM Automate V3, XPath trong hasElement() không bọc dấu ngoặc kép."
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // 6. Sinh kịch bản paste-ready
  mcp.tool(
    "gpm_generate_script",
    "Tạo mã JSON .NET paste-ready (sao chép dán trực tiếp vào GPM Automate Editor bằng Ctrl+V)",
    {
      actionType: z.number().describe("Mã hành động GPM (48: Click, 49: Move, 50: Type, 53: Scroll, 68: JS, 118: Wait element, 11: Go to URL)"),
      xpath: z.string().optional().describe("Biểu thức XPath phần tử tương tác (nếu có)"),
      rawInput: z.record(z.string()).optional().describe("Các tham số raw_input (Ví dụ: { XPATH: '//btn', CLICK_TYPE: '0' })"),
      comment: z.string().optional().describe("Ghi chú của node"),
      delay: z.string().optional().describe("Thời gian delay (Ví dụ: '1000,2000' hoặc '$delay')"),
      wrapInBlock: z.boolean().optional().describe("Bọc trong NormalBlockNode để dán cả block (mặc định true)")
    },
    async ({ actionType, xpath, rawInput, comment, delay, wrapInBlock }) => {
      try {
        const actionNode = generateGscriptActionNode({
          actionType,
          xpath,
          rawInput,
          comment,
          delay
        });

        const output = wrapInBlock !== false
          ? generateGscriptBlock([actionNode], comment || "Otter Action")
          : [actionNode];

        const jsonString = JSON.stringify(wrapInBlock !== false ? [output] : output, null, 2);

        return text({
          success: true,
          actionType,
          format: "GPM Automate V3 (.NET JSON)",
          instructions: "Sao chép toàn bộ chuỗi 'pasteReadyJson' dưới đây và bấm Ctrl+V trong GPM Automate Editor.",
          pasteReadyJson: jsonString
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );
}


import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readMotionResource } from "../motion-mcp";

/**
 * Tool đọc tài nguyên Motion. Hai tool tìm kiếm/chèn của Motion đã có
 * sẵn qua gateway (motion_search-motion-docs, motion_insert-motion-component
 * từ mcp_config.json); tool này là phần còn thiếu để đọc được các
 * resource_links mà search trả về.
 *
 * Luồng dùng đúng: motion_search-motion-docs -> lấy resource_link
 * (motion://docs/... hoặc motion://examples/...) -> motion_read_doc
 * với đúng URI đó -> viết code theo source thật, không tự bịa.
 * Ví dụ Motion+ trong kết quả search chỉ là metadata (title, mô tả,
 * MotionScore, link demo) — không có source để đọc, và không được suy
 * ra source từ mô tả.
 */
export function registerMotionTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "motion_read_doc",
    {
      uri: z
        .string()
        .describe(
          "URI motion:// đầy đủ từ kết quả motion_search-motion-docs, ví dụ 'motion://examples/react/accordion' hoặc 'motion://docs/react/react-layout-group'. Chỉ chấp nhận scheme motion://."
        ),
    },
    async ({ uri }) => {
      try {
        const text = await readMotionResource(uri);
        onActivity?.({ type: "motion_read_doc", uri, chars: text.length });
        return { content: [{ type: "text", text }] };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error reading Motion resource '${uri}': ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}

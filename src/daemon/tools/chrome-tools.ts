/**
 * Chrome profile MCP tools.
 *
 * Tools (2): chrome_list_profiles, chrome_open_profile.
 * Chạy trên daemon của máy đó (local): hub không mở Chrome hộ
 * worker được — worker phải tự mở trên máy của nó. Luồng fleet B2:
 * dispatch tới worker → ChatGPT của worker gọi chrome_open_profile
 * với profile của worker → tab ChatGPT của worker mở ra, extension
 * nối về daemon worker → worker mới chạy loop. Xem fleet.ts prompt.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { listChromeProfiles, openChromeProfile, getChromeUserDataDir } from "../chrome-profile";

function text(value: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
function err(message: string): { content: [{ type: "text"; text: string }]; isError: boolean } {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerChromeTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  mcp.tool(
    "chrome_list_profiles",
    "Liệt kê các profile Chrome trên máy này (từ Local State trong user-data-dir): tên thư mục (Default, Profile 1...), tên hiển thị, đường dẫn. Dùng trước chrome_open_profile để chọn đúng profile.",
    { userDataDir: z.string().optional().describe("User-data-dir tùy chọn; mặc định theo OS, hoặc OTTER_CHROME_USER_DATA_DIR") },
    async ({ userDataDir }) => {
      try {
        const res = listChromeProfiles(userDataDir);
        return text(res);
      } catch (e: any) { return err(e.message); }
    },
  );

  mcp.tool(
    "chrome_open_profile",
    "Mở Chrome với đúng profile chỉ định trên máy này, mặc định mở https://chatgpt.com để extension Otter trong profile đó làm việc. Không kill Chrome đang chạy, không đóng tab của user. Profile có thể là tên thư mục (Profile 1), tên hiển thị (Work, phải duy nhất), hoặc đường dẫn tuyệt đối trong user-data-dir. Trên máy headless không có DISPLAY thì báo lỗi rõ, không mở giả. Nếu cung cấp browserPath (ví dụ đường dẫn file .exe của GPM Browser), tool chuyển sang chế độ custom: mở đúng file đó, profile (nếu có) truyền thẳng thành --profile-directory, không tra Chrome Local State — phù hợp khi user nói 'mở bằng GPM, mình cung cấp đường dẫn'.",
    {
      profile: z.string().optional().describe("Profile cần mở; để trống = Default (hoặc profile đầu tiên). Ở chế độ custom (có browserPath), profile này truyền thẳng thành --profile-directory."),
      url: z.string().optional().describe("URL mở kèm, mặc định https://chatgpt.com; chỉ nhận http(s)"),
      userDataDir: z.string().optional().describe("User-data-dir tùy chọn"),
      createIfMissing: z.boolean().optional().describe("Cho phép Chrome tự tạo profile mới khi tên thư mục dạng Profile N chưa có (mặc định true; chỉ áp dụng chế độ Chrome)"),
      browserPath: z.string().optional().describe("Đường dẫn tới file trình duyệt tùy chọn, ví dụ đường dẫn GPM. Có thì mở file đó thay vì tìm Chrome."),
      extraArgs: z.array(z.string()).optional().describe("Tham số dòng lệnh thêm, truyền thẳng dạng mảng, không qua shell"),
    },
    async ({ profile, url, userDataDir, createIfMissing, browserPath, extraArgs }) => {
      try {
        const res = openChromeProfile({ profile, url, userDataDir, createIfMissing, browserPath, extraArgs });
        onActivity?.({ type: "chrome_open_profile", profile: res.profile.directory, url: res.url, pid: res.pid });
        return text(res);
      } catch (e: any) { return err(e.message); }
    },
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "node:path";
import { invokeCbm } from "../cbm";

export function registerCodebaseTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool 7: Liệt kê các dự án đã lập chỉ mục bộ nhớ tri thức (Codebase Memory)
  mcp.tool(
    "codebase_list_projects",
    {
      detail: z.enum(["identity", "stats"]).default("identity").describe("Mức độ chi tiết: identity (nhanh) hoặc stats (kèm số lượng nodes/edges/kích thước database)")
    },
    async ({ detail }) => {
      onActivity?.({ type: "codebase_memory", action: "list_projects" });
      return await invokeCbm("list_projects", { detail });
    }
  );

  // Tool 8: Lập chỉ mục kiến trúc và đồ thị tri thức cho một repository codebase
  mcp.tool(
    "codebase_index_repository",
    {
      repo_path: z.string().describe("Đường dẫn thư mục dự án cần lập bộ nhớ tri thức (ví dụ: './' hoặc 'D:/projects/my-app')"),
      mode: z.enum(["fast", "moderate", "full"]).default("fast").describe("Chế độ lập chỉ mục: fast (nhanh qua AST), moderate (lọc + ngữ nghĩa), full (toàn diện)")
    },
    async ({ repo_path, mode }) => {
      const resolvedPath = path.resolve(repo_path);
      onActivity?.({ type: "codebase_memory", action: "index_repository", path: resolvedPath });
      return await invokeCbm("index_repository", { repo_path: resolvedPath, mode });
    }
  );

  // Tool 9: Tìm kiếm hàm, lớp, biến, API route trong đồ thị bộ nhớ codebase
  mcp.tool(
    "codebase_search_graph",
    {
      name_pattern: z.string().optional().describe("Tên hàm, class, route hoặc biểu thức chính quy regex (ví dụ: '.*Terminal.*', 'handleLogin')"),
      label: z.string().optional().describe("Lọc theo loại: Function, Class, Route, Interface, Struct, Variable..."),
      project: z.string().optional().describe("Tên project (để trống sẽ tự động lấy project vừa index hoặc active)"),
      limit: z.number().default(50).describe("Số lượng kết quả tối đa (mặc định 50)")
    },
    async ({ name_pattern, label, project, limit }) => {
      onActivity?.({ type: "codebase_memory", action: "search_graph", query: name_pattern });
      const args: Record<string, any> = { limit };
      if (name_pattern) args.name_pattern = name_pattern;
      if (label) args.label = label;
      if (project) args.project = project;
      return await invokeCbm("search_graph", args);
    }
  );

  // Tool 10: Lần vết luồng gọi hàm đa tầng (Call graph: ai gọi hàm này, hàm này gọi ai)
  mcp.tool(
    "codebase_trace_path",
    {
      function_name: z.string().describe("Tên hàm cần lần vết (ví dụ: 'createTerminalSession')"),
      direction: z.enum(["inbound", "outbound", "both"]).default("both").describe("Hướng lần vết: inbound (ai gọi hàm này), outbound (hàm này gọi ai), both (cả hai chiều)"),
      depth: z.number().default(3).describe("Độ sâu duyệt đồ thị (1 đến 15, mặc định 3)"),
      project: z.string().optional().describe("Tên project (để trống sẽ dùng project active)")
    },
    async ({ function_name, direction, depth, project }) => {
      onActivity?.({ type: "codebase_memory", action: "trace_path", function_name, direction });
      const args: Record<string, any> = { function_name, direction, depth };
      if (project) args.project = project;
      return await invokeCbm("trace_path", args);
    }
  );

  // Tool 11: Đọc chính xác đoạn code định nghĩa hàm hoặc lớp mà không cần mở toàn bộ file
  mcp.tool(
    "codebase_get_snippet",
    {
      qualified_name: z.string().describe("Tên định danh đầy đủ của hàm/lớp (lấy từ codebase_search_graph) hoặc tên ngắn"),
      project: z.string().optional().describe("Tên project (để trống sẽ dùng project active)")
    },
    async ({ qualified_name, project }) => {
      onActivity?.({ type: "codebase_memory", action: "get_code_snippet", qualified_name });
      const args: Record<string, any> = { qualified_name };
      if (project) args.project = project;
      return await invokeCbm("get_code_snippet", args);
    }
  );

  // Tool 12: Xem kiến trúc tổng quan của dự án (ngôn ngữ, packages, entry points, dependencies)
  mcp.tool(
    "codebase_get_architecture",
    {
      project: z.string().optional().describe("Tên project (để trống sẽ dùng project active)"),
      aspects: z.array(z.string()).default(["overview"]).describe("Các khía cạnh kiến trúc: overview, structure, dependencies, routes, hotspots, entry_points, all")
    },
    async ({ project, aspects }) => {
      onActivity?.({ type: "codebase_memory", action: "get_architecture", project });
      const args: Record<string, any> = { aspects };
      if (project) args.project = project;
      return await invokeCbm("get_architecture", args);
    }
  );

  // Tool 13: Quản lý và tra cứu các quyết định kiến trúc dài hạn (ADR - Architecture Decision Records)
  mcp.tool(
    "codebase_manage_adr",
    {
      action: z.enum(["list", "get", "create", "decide"]).default("list").describe("Thao tác: list (xem danh sách), get (xem chi tiết), create (tạo mới), decide (cập nhật quyết định)"),
      title: z.string().optional().describe("Tiêu đề quyết định kiến trúc"),
      decision: z.string().optional().describe("Nội dung quyết định thiết kế/kiến trúc"),
      project: z.string().optional().describe("Tên project (để trống sẽ dùng project active)")
    },
    async ({ action, title, decision, project }) => {
      onActivity?.({ type: "codebase_memory", action: "manage_adr", subAction: action });
      const args: Record<string, any> = { action };
      if (title) args.title = title;
      if (decision) args.decision = decision;
      if (project) args.project = project;
      return await invokeCbm("manage_adr", args);
    }
  );
}

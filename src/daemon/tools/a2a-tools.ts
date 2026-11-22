/**
 * A2A Coordination Tools (Agent-to-Agent Messaging & Task Exchange)
 * 
 * Part of Otter A2A Coordination (Phase 1).
 * Exposes MCP tools for bot-to-bot task exchange, pull/ack workflow, and bot registry.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  sendInboxMessage,
  pullInbox,
  ackInboxMessage,
  cancelInboxMessage,
  getInboxMessage,
  listInboxMessages,
  getInboxStats,
  listBots,
  getBot,
  registerBot,
  updateBotPresence,
  type A2aMessageType,
  type BotPresenceStatus,
} from "../a2a-inbox";

export function registerA2aTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // 1. Tool gửi tin nhắn / task (a2a_send_message)
  mcp.tool(
    "a2a_send_message",
    "Gửi nhiệm vụ (task) hoặc tin nhắn A2A đến một bot đích. Được lưu trữ bền vững trong SQLite (Store-and-Forward) nên bot đích offline vẫn nhận an toàn khi online.",
    {
      senderId: z.string().describe("ID của bot người gửi (ví dụ: ai_sunny, ai_antigravity, ai_muse002, user_pham)"),
      recipientId: z.string().describe("ID của bot người nhận (ví dụ: ai_antigravity, ai_sunny, ai_muse003)"),
      goal: z.string().describe("Mục tiêu hoặc nội dung chính của nhiệm vụ"),
      details: z.string().optional().describe("Chi tiết kỹ thuật, hướng dẫn hoặc yêu cầu bổ sung"),
      messageType: z.enum(["task", "message", "query", "ack"]).optional().default("task").describe("Loại tin nhắn (mặc định: task)"),
      priority: z.number().optional().default(0).describe("Mức độ ưu tiên (số càng cao càng ưu tiên, mặc định: 0)"),
      payload: z.record(z.any()).optional().describe("Dữ liệu cấu trúc đính kèm dạng JSON (parameters, hints, context)"),
      artifacts: z.array(z.object({
        name: z.string().optional(),
        mimeType: z.string().optional(),
        uri: z.string().optional(),
        bytes: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      })).optional().describe("Danh sách artifacts / files đính kèm"),
    },
    async (params) => {
      try {
        const msg = await sendInboxMessage({
          senderId: params.senderId,
          recipientId: params.recipientId,
          goal: params.goal,
          details: params.details,
          messageType: params.messageType as A2aMessageType,
          priority: params.priority,
          payload: params.payload,
          artifacts: params.artifacts,
        });

        onActivity?.({
          type: "a2a_message_sent",
          id: msg.id,
          senderId: msg.senderId,
          recipientId: msg.recipientId,
          goal: msg.goal,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              messageId: msg.id,
              status: msg.status,
              recipientId: msg.recipientId,
              goal: msg.goal,
              priority: msg.priority,
              createdAt: new Date(msg.createdAt).toISOString(),
              message: `Đã gửi thành công nhiệm vụ [${msg.id}] vào hàng đợi của @${msg.recipientId}`,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, error: err.message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // 2. Tool rút task từ hàng đợi (a2a_pull_inbox)
  mcp.tool(
    "a2a_pull_inbox",
    "Rút (pull) các nhiệm vụ hoặc tin nhắn đang chờ xử lý từ hàng đợi A2A của bot. Tự động cấp khóa thuê (lease lock) để tránh xử lý trùng.",
    {
      botId: z.string().describe("ID của bot muốn rút hộp thư (ví dụ: ai_antigravity, ai_muse002, ai_sunny)"),
      workerId: z.string().optional().describe("ID định danh của worker hoặc máy thực thi (mặc định trùng với botId)"),
      limit: z.number().optional().default(1).describe("Số lượng task tối đa muốn lấy (mặc định: 1)"),
      leaseSeconds: z.number().optional().default(300).describe("Thời gian giữ khóa thuê tính bằng giây trước khi tự nhả lại nếu worker bị crash (mặc định: 300s = 5 phút)"),
    },
    async (params) => {
      try {
        const messages = pullInbox({
          recipientId: params.botId,
          workerId: params.workerId,
          limit: params.limit,
          leaseMs: (params.leaseSeconds || 300) * 1000,
        });

        onActivity?.({
          type: "a2a_inbox_pulled",
          botId: params.botId,
          count: messages.length,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              count: messages.length,
              botId: params.botId,
              tasks: messages.map((m) => ({
                id: m.id,
                senderId: m.senderId,
                goal: m.goal,
                details: m.details,
                priority: m.priority,
                attemptCount: m.attemptCount,
                leaseUntil: m.leaseUntil ? new Date(m.leaseUntil).toISOString() : null,
                payload: m.payload,
                artifacts: m.artifacts,
                createdAt: new Date(m.createdAt).toISOString(),
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, error: err.message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // 3. Tool báo cáo hoàn thành hoặc thất bại (a2a_ack_message)
  mcp.tool(
    "a2a_ack_message",
    "Báo cáo kết quả hoàn tất (acked) hoặc thất bại (failed) của một nhiệm vụ A2A kèm tóm tắt và dữ liệu thành phẩm.",
    {
      messageId: z.string().describe("Mã messageId cần xác nhận"),
      workerId: z.string().optional().describe("ID của worker hoàn thành task"),
      status: z.enum(["acked", "failed"]).describe("Trạng thái kết quả: acked (thành công) hoặc failed (thất bại)"),
      resultSummary: z.string().describe("Tóm tắt kết quả thực hiện"),
      result: z.record(z.any()).optional().describe("Dữ liệu chi tiết thành phẩm dạng JSON"),
      artifacts: z.array(z.object({
        name: z.string().optional(),
        mimeType: z.string().optional(),
        uri: z.string().optional(),
        bytes: z.string().optional(),
        metadata: z.record(z.any()).optional(),
      })).optional().describe("Danh sách artifacts / files kết quả"),
    },
    async (params) => {
      try {
        const res = ackInboxMessage({
          messageId: params.messageId,
          workerId: params.workerId,
          status: params.status,
          resultSummary: params.resultSummary,
          result: params.result,
          artifacts: params.artifacts,
        });

        onActivity?.({
          type: "a2a_message_acked",
          messageId: params.messageId,
          status: params.status,
          summary: params.resultSummary,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify(res, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, error: err.message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // 4. Tool tra cứu trạng thái hộp thư / task (a2a_inbox_status)
  mcp.tool(
    "a2a_inbox_status",
    "Tra cứu số liệu thống kê hàng đợi A2A hoặc kiểm tra trạng thái chi tiết của một nhiệm vụ cụ thể.",
    {
      messageId: z.string().optional().describe("Mã messageId cụ thể cần tra cứu (để trống để lấy thống kê chung và danh sách gần đây)"),
      botId: z.string().optional().describe("Lọc theo botId người nhận"),
      status: z.enum(["queued", "in_flight", "acked", "failed", "cancelled"]).optional().describe("Lọc theo trạng thái"),
      limit: z.number().optional().default(10).describe("Số lượng bản ghi tối đa (mặc định: 10)"),
    },
    async (params) => {
      try {
        if (params.messageId) {
          const msg = getInboxMessage(params.messageId);
          if (!msg) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({ ok: false, error: `Không tìm thấy message [${params.messageId}]` }, null, 2),
              }],
              isError: true,
            };
          }
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ ok: true, message: msg }, null, 2),
            }],
          };
        }

        const stats = getInboxStats();
        const messages = listInboxMessages({
          recipientId: params.botId,
          status: params.status,
          limit: params.limit,
        });

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              stats,
              messages: messages.map((m) => ({
                id: m.id,
                senderId: m.senderId,
                recipientId: m.recipientId,
                goal: m.goal,
                status: m.status,
                priority: m.priority,
                attemptCount: m.attemptCount,
                resultSummary: m.resultSummary,
                createdAt: new Date(m.createdAt).toISOString(),
                updatedAt: new Date(m.updatedAt).toISOString(),
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, error: err.message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );

  // 5. Tool danh sách bot & cập nhật hiện diện (a2a_list_bots)
  mcp.tool(
    "a2a_list_bots",
    "Liệt kê danh sách các Bot Persona trong mạng lưới A2A, khả năng kỹ thuật (capabilities), nút máy tính ưu tiên, và trạng thái hiện diện.",
    {
      updatePresenceBotId: z.string().optional().describe("Nếu muốn cập nhật trạng thái online/idle/busy cho bot"),
      presenceStatus: z.enum(["online", "busy", "idle", "offline"]).optional().describe("Trạng thái hiện diện mới"),
    },
    async (params) => {
      try {
        if (params.updatePresenceBotId && params.presenceStatus) {
          updateBotPresence(params.updatePresenceBotId, params.presenceStatus as BotPresenceStatus);
        }

        const bots = listBots();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              total: bots.length,
              bots: bots.map((b) => ({
                botId: b.botId,
                name: b.name,
                description: b.description,
                capabilities: b.capabilities,
                preferredNode: b.preferredNode,
                status: b.status,
                lastSeenAt: b.lastSeenAt ? new Date(b.lastSeenAt).toISOString() : null,
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ ok: false, error: err.message }, null, 2),
          }],
          isError: true,
        };
      }
    }
  );
}

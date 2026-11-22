import { useCallback, useEffect, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { TextInput } from "@astryxdesign/core/TextInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  apiDelete,
  apiGet,
  apiPost,
  type A2aBotItem,
  type A2aMessageItem,
  type A2aStats,
} from "../api";

const SYSTEM_BOT_IDS = new Set(["user_pham", "ai_sunny", "ai_antigravity"]);

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

export default function A2aCoordinationTab({ busy, act }: Props) {
  const [stats, setStats] = useState<A2aStats>({ queued: 0, inFlight: 0, acked: 0, failed: 0, total: 0 });
  const [bots, setBots] = useState<A2aBotItem[]>([]);
  const [messages, setMessages] = useState<A2aMessageItem[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterBot, setFilterBot] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form dispatch task
  const [showDispatchForm, setShowDispatchForm] = useState(false);
  const [senderId, setSenderId] = useState("ai_sunny");
  const [recipientId, setRecipientId] = useState("ai_antigravity");
  const [goal, setGoal] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("0");

  // Form tạo Bot mới
  const [showCreateBotForm, setShowCreateBotForm] = useState(false);
  const [newBotId, setNewBotId] = useState("");
  const [newBotName, setNewBotName] = useState("");
  const [newBotDescription, setNewBotDescription] = useState("");
  const [newBotCapabilities, setNewBotCapabilities] = useState("");
  const [newBotPreferredNode, setNewBotPreferredNode] = useState("");
  const [newBotStatus, setNewBotStatus] = useState<"online" | "busy" | "offline" | "paused">("online");

  const loadData = useCallback(async () => {
    const [statsRes, botsRes, msgsRes] = await Promise.all([
      apiGet<{ ok: boolean; stats: A2aStats }>("/api/a2a/stats").catch(() => null),
      apiGet<{ ok: boolean; bots: A2aBotItem[] }>("/api/a2a/bots").catch(() => null),
      apiGet<{ ok: boolean; count: number; messages: A2aMessageItem[] }>("/api/a2a/messages?limit=50").catch(() => null),
    ]);

    if (statsRes?.stats) setStats(statsRes.stats);
    if (botsRes?.bots) setBots(botsRes.bots);
    if (msgsRes?.messages) setMessages(msgsRes.messages);
  }, []);

  useEffect(() => {
    void loadData();
    const timer = setInterval(() => void loadData(), 5000);
    return () => clearInterval(timer);
  }, [loadData]);

  const handleSendTask = async () => {
    if (!goal.trim()) return;
    await act(
      "dispatch_a2a_task",
      async () => {
        const res = await apiPost<{ ok: boolean; message: A2aMessageItem }>("/api/a2a/send", {
          senderId,
          recipientId,
          goal: goal.trim(),
          details: details.trim() || undefined,
          priority: Number(priority) || 0,
        });
        if (res.ok) {
          setGoal("");
          setDetails("");
          setShowDispatchForm(false);
          await loadData();
        }
      },
      `Đã chuyển task đến @${recipientId}`
    );
  };

  const handleCancelTask = async (messageId: string) => {
    await act(
      `cancel_task_${messageId}`,
      async () => {
        await apiPost(`/api/a2a/cancel`, { messageId, reason: "Hủy từ Dashboard" });
        await loadData();
      },
      "Đã hủy task thành công"
    );
  };

  const handleCreateBot = async () => {
    const trimmedId = newBotId.trim().toLowerCase().replace(/\s+/g, "_");
    const trimmedName = newBotName.trim();
    if (!trimmedId || !trimmedName) return;

    await act(
      "create_a2a_bot",
      async () => {
        const caps = newBotCapabilities
          .split(",")
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean);

        const res = await apiPost<{ ok: boolean; bot: A2aBotItem }>("/api/a2a/bots", {
          botId: trimmedId,
          name: trimmedName,
          description: newBotDescription.trim() || undefined,
          capabilities: caps,
          preferredNode: newBotPreferredNode.trim() || undefined,
          status: newBotStatus,
        });

        if (res.ok) {
          setNewBotId("");
          setNewBotName("");
          setNewBotDescription("");
          setNewBotCapabilities("");
          setNewBotPreferredNode("");
          setNewBotStatus("online");
          setShowCreateBotForm(false);
          await loadData();
        }
      },
      `Đã tạo Bot Persona @${trimmedId} thành công!`
    );
  };

  const handleDeleteBot = async (botId: string) => {
    if (!confirm(`Bạn có chắc muốn xóa Bot Persona @${botId} không?`)) return;
    await act(
      `delete_bot_${botId}`,
      async () => {
        await apiDelete(`/api/a2a/bots/${encodeURIComponent(botId)}`);
        await loadData();
      },
      `Đã xóa Bot Persona @${botId}`
    );
  };

  const filteredMessages = messages.filter((m) => {
    if (filterStatus !== "all" && m.status !== filterStatus) return false;
    if (filterBot !== "all" && m.recipientId !== filterBot && m.senderId !== filterBot) return false;
    return true;
  });

  return (
    <VStack gap={6}>
      <PageHeader
        title="Điều phối Bot & Hộp thư A2A"
        description="Hệ thống Store-and-Forward bền vững thay thế shared folder và đồng bộ trực tiếp với Group 503 MXH"
        actions={
          <HStack gap={3}>
            <Button
              label="Làm mới"
              variant="secondary"
              size="sm"
              onClick={() => void loadData()}
              isDisabled={busy !== null}
            />
            <Button
              label={showCreateBotForm ? "Đóng form Bot" : "🤖 Tạo Bot mới"}
              variant={showCreateBotForm ? "secondary" : "secondary"}
              size="sm"
              onClick={() => {
                setShowCreateBotForm(!showCreateBotForm);
                if (!showCreateBotForm) setShowDispatchForm(false);
              }}
            />
            <Button
              label={showDispatchForm ? "Đóng form việc" : "➕ Giao việc A2A"}
              variant="primary"
              size="sm"
              onClick={() => {
                setShowDispatchForm(!showDispatchForm);
                if (!showDispatchForm) setShowCreateBotForm(false);
              }}
            />
          </HStack>
        }
      />

      {/* KPI Stats */}
      <HStack gap={4} style={{ flexWrap: "wrap" }}>
        <Card padding={4} style={{ flex: "1 1 200px" }}>
          <VStack gap={1}>
            <Text type="supporting">ĐANG CHỜ (QUEUED)</Text>
            <Heading level={2}>{stats.queued}</Heading>
            <Text type="supporting">Chờ worker rút xử lý</Text>
          </VStack>
        </Card>
        <Card padding={4} style={{ flex: "1 1 200px" }}>
          <VStack gap={1}>
            <Text type="supporting">ĐANG CHẠY (IN-FLIGHT)</Text>
            <Heading level={2}>{stats.inFlight}</Heading>
            <Text type="supporting">Đang giữ khóa lease lock</Text>
          </VStack>
        </Card>
        <Card padding={4} style={{ flex: "1 1 200px" }}>
          <VStack gap={1}>
            <Text type="supporting">HOÀN TẤT (ACKED)</Text>
            <Heading level={2}>{stats.acked}</Heading>
            <Text type="supporting">Đã nghiệm thu kết quả</Text>
          </VStack>
        </Card>
        <Card padding={4} style={{ flex: "1 1 200px" }}>
          <VStack gap={1}>
            <Text type="supporting">TỔNG LƯỢT A2A</Text>
            <Heading level={2}>{stats.total}</Heading>
            <Text type="supporting">{stats.failed} thất bại</Text>
          </VStack>
        </Card>
      </HStack>

      {/* Form Giao việc A2A */}
      {showDispatchForm && (
        <Card padding={5}>
          <VStack gap={4}>
            <Heading level={3}>Giao nhiệm vụ A2A mới vào Hàng đợi Store-and-Forward</Heading>
            <HStack gap={3} style={{ flexWrap: "wrap" }}>
              <VStack gap={1} style={{ flex: "1 1 200px" }}>
                <Text type="supporting">Người gửi (Sender)</Text>
                <select
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #444)",
                    background: "var(--card-bg, #222)",
                    color: "inherit",
                  }}
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                >
                  {bots.map((b) => (
                    <option key={b.botId} value={b.botId}>{b.name} (@{b.botId})</option>
                  ))}
                </select>
              </VStack>
              <VStack gap={1} style={{ flex: "1 1 200px" }}>
                <Text type="supporting">Bot nhận (Recipient)</Text>
                <select
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #444)",
                    background: "var(--card-bg, #222)",
                    color: "inherit",
                  }}
                  value={recipientId}
                  onChange={(e) => setRecipientId(e.target.value)}
                >
                  {bots.map((b) => (
                    <option key={b.botId} value={b.botId}>{b.name} (@{b.botId})</option>
                  ))}
                </select>
              </VStack>
              <VStack gap={1} style={{ width: "120px" }}>
                <TextInput
                  label="Ưu tiên (0-10)"
                  value={priority}
                  onChange={setPriority}
                  placeholder="0"
                />
              </VStack>
            </HStack>

            <VStack gap={1}>
              <TextInput
                label="Mục tiêu công việc (Goal) *"
                value={goal}
                onChange={setGoal}
                placeholder="Ví dụ: Kiểm tra tiến trình build v2.3.6 và cập nhật tài liệu..."
                isRequired
              />
            </VStack>

            <VStack gap={1}>
              <Text type="supporting">Chi tiết / Hướng dẫn thêm (Tùy chọn)</Text>
              <textarea
                style={{
                  width: "100%",
                  minHeight: "70px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color, #444)",
                  background: "var(--card-bg, #222)",
                  color: "inherit",
                  fontFamily: "inherit",
                }}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Nêu rõ các ràng buộc, path file hoặc lệnh verify cần chạy..."
              />
            </VStack>

            <HStack gap={3} justify="end">
              <Button label="Hủy" variant="ghost" size="sm" onClick={() => setShowDispatchForm(false)} />
              <Button
                label={`Gửi vào hộp thư @${recipientId}`}
                variant="primary"
                size="sm"
                onClick={() => void handleSendTask()}
                isDisabled={!goal.trim() || busy !== null}
              />
            </HStack>
          </VStack>
        </Card>
      )}

      {/* Form Tạo Bot mới */}
      {showCreateBotForm && (
        <Card padding={5}>
          <VStack gap={4}>
            <Heading level={3}>Thêm Bot Persona Mới vào Mạng Lưới A2A</Heading>
            <HStack gap={3} style={{ flexWrap: "wrap" }}>
              <VStack gap={1} style={{ flex: "1 1 200px" }}>
                <TextInput
                  label="Mã định danh (Bot ID) *"
                  value={newBotId}
                  onChange={setNewBotId}
                  placeholder="Ví dụ: ai_reviewer, bot_telegram..."
                  isRequired
                />
                <Text type="supporting" style={{ fontSize: "11px" }}>
                  Chữ thường, không dấu, gạch dưới (VD: ai_writer)
                </Text>
              </VStack>

              <VStack gap={1} style={{ flex: "1 1 220px" }}>
                <TextInput
                  label="Tên hiển thị (Name) *"
                  value={newBotName}
                  onChange={setNewBotName}
                  placeholder="Ví dụ: Code Reviewer, Bot Dịch thuật..."
                  isRequired
                />
              </VStack>

              <VStack gap={1} style={{ flex: "1 1 160px" }}>
                <TextInput
                  label="Node ưu tiên (Tùy chọn)"
                  value={newBotPreferredNode}
                  onChange={setNewBotPreferredNode}
                  placeholder="Ví dụ: nam-windows"
                />
              </VStack>

              <VStack gap={1} style={{ width: "150px" }}>
                <Text type="supporting">Trạng thái ban đầu</Text>
                <select
                  style={{
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color, #444)",
                    background: "var(--card-bg, #222)",
                    color: "inherit",
                  }}
                  value={newBotStatus}
                  onChange={(e) => setNewBotStatus(e.target.value as any)}
                >
                  <option value="online">Online (Trực tuyến)</option>
                  <option value="busy">Busy (Đang bận)</option>
                  <option value="paused">Paused (Tạm dừng)</option>
                  <option value="offline">Offline (Ngoại tuyến)</option>
                </select>
              </VStack>
            </HStack>

            <VStack gap={1}>
              <TextInput
                label="Kỹ năng / Capabilities (cách nhau bởi dấu phẩy)"
                value={newBotCapabilities}
                onChange={setNewBotCapabilities}
                placeholder="Ví dụ: code, review, cdp, media, translation, audit"
              />
            </VStack>

            <VStack gap={1}>
              <Text type="supporting">Mô tả vai trò / Nhiệm vụ của Bot</Text>
              <textarea
                style={{
                  width: "100%",
                  minHeight: "65px",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color, #444)",
                  background: "var(--card-bg, #222)",
                  color: "inherit",
                  fontFamily: "inherit",
                }}
                value={newBotDescription}
                onChange={(e) => setNewBotDescription(e.target.value)}
                placeholder="Mô tả tóm tắt năng lực và phạm vi công việc của bot này..."
              />
            </VStack>

            <HStack gap={3} justify="end">
              <Button label="Hủy" variant="ghost" size="sm" onClick={() => setShowCreateBotForm(false)} />
              <Button
                label="Lưu & Kích hoạt Bot"
                variant="primary"
                size="sm"
                onClick={() => void handleCreateBot()}
                isDisabled={!newBotId.trim() || !newBotName.trim() || busy !== null}
              />
            </HStack>
          </VStack>
        </Card>
      )}

      {/* Danh sách Bot Personas */}
      <VStack gap={3}>
        <HStack justify="between" align="center">
          <Heading level={3}>Mạng lưới Bot Persona & Hiện diện ({bots.length})</Heading>
          <Button
            label={showCreateBotForm ? "Đóng form Bot" : "➕ Thêm Bot mới"}
            variant="secondary"
            size="sm"
            onClick={() => {
              setShowCreateBotForm(!showCreateBotForm);
              if (!showCreateBotForm) setShowDispatchForm(false);
            }}
          />
        </HStack>
        <HStack gap={3} style={{ flexWrap: "wrap" }}>
          {bots.map((b) => (
            <Card key={b.botId} padding={4} style={{ flex: "1 1 260px" }}>
              <VStack gap={2}>
                <HStack justify="between">
                  <Heading level={4}>{b.name}</Heading>
                  <Badge
                    variant={b.status === "online" ? "success" : b.status === "busy" ? "warning" : "neutral"}
                    label={b.status.toUpperCase()}
                  />
                </HStack>
                <Text type="supporting">@{b.botId} • Nút: {b.preferredNode || "Bất kỳ"}</Text>
                <Text>{b.description}</Text>
                <HStack gap={1} style={{ flexWrap: "wrap" }}>
                  {b.capabilities.map((c) => (
                    <Badge key={c} variant="neutral" label={c} />
                  ))}
                </HStack>
                <HStack justify="between" align="center" style={{ marginTop: "4px", paddingTop: "8px", borderTop: "1px solid var(--border-color, rgba(255,255,255,0.06))" }}>
                  <Button
                    label="Giao việc"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setRecipientId(b.botId);
                      setShowDispatchForm(true);
                      setShowCreateBotForm(false);
                    }}
                  />
                  {!SYSTEM_BOT_IDS.has(b.botId) && (
                    <Button
                      label="Xóa"
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleDeleteBot(b.botId)}
                      isDisabled={busy !== null}
                    />
                  )}
                </HStack>
              </VStack>
            </Card>
          ))}
        </HStack>
      </VStack>

      {/* Bảng Hộp thư / Tasks */}
      <VStack gap={3}>
        <HStack justify="between" align="center">
          <Heading level={3}>Nhật ký Hộp thư & Nhiệm vụ A2A ({filteredMessages.length})</Heading>
          <HStack gap={2}>
            <select
              style={{
                padding: "6px 10px",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #444)",
                background: "var(--card-bg, #222)",
                color: "inherit",
                fontSize: "13px",
              }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">Tất cả trạng thái</option>
              <option value="queued">Đang chờ (Queued)</option>
              <option value="in_flight">Đang chạy (In-Flight)</option>
              <option value="acked">Đã hoàn tất (Acked)</option>
              <option value="failed">Thất bại (Failed)</option>
              <option value="cancelled">Đã hủy (Cancelled)</option>
            </select>

            <select
              style={{
                padding: "6px 10px",
                borderRadius: "4px",
                border: "1px solid var(--border-color, #444)",
                background: "var(--card-bg, #222)",
                color: "inherit",
                fontSize: "13px",
              }}
              value={filterBot}
              onChange={(e) => setFilterBot(e.target.value)}
            >
              <option value="all">Tất cả Bot</option>
              {bots.map((b) => (
                <option key={b.botId} value={b.botId}>@{b.botId}</option>
              ))}
            </select>
          </HStack>
        </HStack>

        {filteredMessages.length === 0 ? (
          <Card padding={4}>
            <EmptyState
              title="Chưa có tin nhắn hoặc nhiệm vụ nào"
              description="Bấm 'Giao việc A2A mới' ở trên hoặc gửi lệnh /a2a từ MXH Group 503."
            />
          </Card>
        ) : (
          <VStack gap={2}>
            {filteredMessages.map((m) => {
              const isExpanded = expandedId === m.id;
              const statusVariant =
                m.status === "acked"
                  ? "success"
                  : m.status === "in_flight"
                  ? "warning"
                  : m.status === "failed"
                  ? "error"
                  : "neutral";

              return (
                <Card key={m.id} padding={4}>
                  <VStack gap={2}>
                    <HStack justify="between" align="start">
                      <VStack gap={1} style={{ flex: 1 }}>
                        <HStack gap={2} align="center">
                          <Badge variant={statusVariant} label={m.status.toUpperCase()} />
                          {m.priority > 0 && <Badge variant="warning" label={`P${m.priority}`} />}
                          <Text type="supporting">
                            #{m.id.slice(-8)} • {new Date(m.createdAt).toLocaleTimeString()} {new Date(m.createdAt).toLocaleDateString()}
                          </Text>
                        </HStack>
                        <Text weight="semibold">{m.goal}</Text>
                        <Text type="supporting">
                          Từ: <b>@{m.senderId}</b> ➔ Đến: <b>@{m.recipientId}</b>
                          {m.leaseOwner && ` (Worker: ${m.leaseOwner})`}
                          {m.attemptCount > 1 && ` [Lần thử: ${m.attemptCount}/${m.maxAttempts}]`}
                        </Text>
                      </VStack>

                      <HStack gap={2}>
                        <Button
                          label={isExpanded ? "Thu gọn" : "Chi tiết"}
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedId(isExpanded ? null : m.id)}
                        />
                        {(m.status === "queued" || m.status === "in_flight") && (
                          <Button
                            label="Hủy"
                            variant="secondary"
                            size="sm"
                            onClick={() => void handleCancelTask(m.id)}
                            isDisabled={busy !== null}
                          />
                        )}
                      </HStack>
                    </HStack>

                    {/* Chi tiết mở rộng */}
                    {isExpanded && (
                      <VStack gap={2} style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--border-color, #333)" }}>
                        {m.details && (
                          <VStack gap={1}>
                            <Text weight="semibold">Hướng dẫn / Yêu cầu chi tiết:</Text>
                            <Card padding={3} style={{ background: "rgba(0,0,0,0.2)" }}>
                              <Text style={{ whiteSpace: "pre-wrap" }}>{m.details}</Text>
                            </Card>
                          </VStack>
                        )}
                        {m.resultSummary && (
                          <VStack gap={1}>
                            <Text weight="semibold">Kết quả báo cáo (Result Summary):</Text>
                            <Card padding={3} style={{ background: "rgba(0,0,0,0.2)" }}>
                              <Text style={{ whiteSpace: "pre-wrap" }}>{m.resultSummary}</Text>
                            </Card>
                          </VStack>
                        )}
                        {m.payload && (
                          <VStack gap={1}>
                            <Text weight="semibold">Dữ liệu Payload:</Text>
                            <pre style={{ fontSize: "12px", padding: "8px", background: "#111", borderRadius: "4px", overflowX: "auto" }}>
                              {JSON.stringify(m.payload, null, 2)}
                            </pre>
                          </VStack>
                        )}
                      </VStack>
                    )}
                  </VStack>
                </Card>
              );
            })}
          </VStack>
        )}
      </VStack>
    </VStack>
  );
}

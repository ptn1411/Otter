import { useCallback, useEffect, useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { apiDelete, apiGet, apiPost, fmtDate, type ScheduledTaskItem } from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

const REPEAT_OPTIONS = [
  { value: "0", label: "Chạy 1 lần duy nhất" },
  { value: "30", label: "Lặp mỗi 30 phút" },
  { value: "60", label: "Lặp mỗi 1 giờ" },
  { value: "360", label: "Lặp mỗi 6 giờ" },
  { value: "1440", label: "Lặp mỗi ngày (24 giờ)" },
];

function toLocalInputValue(offsetMinutes = 0): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() + offsetMinutes);
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export default function ScheduledTasksTab({ busy, act }: Props) {
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduledAt, setScheduledAt] = useState(() => toLocalInputValue(0));
  const [repeatMinutes, setRepeatMinutes] = useState("0");
  const [selectedTask, setSelectedTask] = useState<ScheduledTaskItem | null>(null);

  const loadTasks = useCallback(async () => {
    const res = await apiGet<{ success?: boolean; tasks?: ScheduledTaskItem[] }>("/api/tasks").catch(
      () => null
    );
    if (res?.tasks) setTasks(res.tasks);
  }, []);

  useEffect(() => {
    const boot = setTimeout(() => void loadTasks(), 0);
    const id = setInterval(() => {
      if (!document.hidden) void loadTasks();
    }, 5000);
    return () => {
      clearTimeout(boot);
      clearInterval(id);
    };
  }, [loadTasks]);

  const counts = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
  };

  return (
    <VStack gap={6}>
      <PageHeader
        title="Tác vụ hẹn giờ (Scheduled Tasks)"
        description="Lên lịch gửi prompt tự động theo giờ hoặc lặp lại định kỳ, kèm lưu kết quả và ảnh xác minh."
        actions={
          <>
            <Badge variant="neutral" label={`Tổng: ${counts.total}`} />
            <Badge variant="warning" label={`Chờ: ${counts.pending}`} />
            <Badge variant="info" label={`Đang chạy: ${counts.running}`} />
            <Badge variant="success" label={`Xong: ${counts.completed}`} />
            <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadTasks()} />
          </>
        }
      />

      <Grid columns={{ minWidth: 320, max: 2 }} gap={5} align="start">
        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Lên lịch tác vụ mới</Text>
            <TextInput
              label="Tiêu đề tác vụ"
              placeholder="Tóm tắt tin công nghệ buổi sáng"
              value={title}
              onChange={setTitle}
              isRequired
            />
            <TextArea
              label="Câu lệnh Prompt gửi tới AI"
              placeholder="Mở trang tin tức, tổng hợp 5 tin nổi bật rồi gửi báo cáo..."
              value={prompt}
              onChange={setPrompt}
            />
            <VStack gap={1.5}>
              <Text type="supporting">Thời gian thực thi</Text>
              <input
                type="datetime-local"
                className="dash-datetime"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
              <HStack gap={2} wrap="wrap">
                {[
                  { label: "Ngay bây giờ", min: 0 },
                  { label: "+15 phút", min: 15 },
                  { label: "+1 giờ", min: 60 },
                ].map((q) => (
                  <Button
                    key={q.min}
                    label={q.label}
                    size="sm"
                    variant="ghost"
                    onClick={() => setScheduledAt(toLocalInputValue(q.min))}
                  />
                ))}
              </HStack>
            </VStack>
            <Selector
              label="Chu kỳ lặp lại"
              options={REPEAT_OPTIONS}
              value={repeatMinutes}
              onChange={setRepeatMinutes}
              presentation="adaptive"
              width="100%"
            />
            <HStack>
              <Button
                label="Lên lịch tác vụ"
                variant="primary"
                size="sm"
                isDisabled={!title.trim() || !prompt.trim()}
                isLoading={busy === "task-create"}
                onClick={() =>
                  act(
                    "task-create",
                    async () => {
                      await apiPost("/api/tasks", {
                        title: title.trim(),
                        prompt: prompt.trim(),
                        scheduledAt: scheduledAt ? new Date(scheduledAt).getTime() : Date.now(),
                        repeatMinutes: Number(repeatMinutes) || 0,
                      });
                      setTitle("");
                      setPrompt("");
                      setScheduledAt(toLocalInputValue(0));
                      await loadTasks();
                    },
                    "Đã lên lịch tác vụ mới."
                  )
                }
              />
            </HStack>
          </VStack>
        </Card>

        <VStack gap={3}>
          {tasks.length === 0 ? (
            <Card padding={4}>
              <EmptyState
                title="Chưa có tác vụ nào được lên lịch"
                description="Tạo tác vụ ở cột bên trái để Otter tự động chạy đúng thời gian hẹn."
              />
            </Card>
          ) : (
            tasks.map((t) => {
              const isRunning = t.status === "running";
              const variant =
                t.status === "completed"
                  ? "success"
                  : t.status === "failed"
                    ? "error"
                    : t.status === "running"
                      ? "info"
                      : "warning";
              return (
                <Card key={t.id} padding={4}>
                  <VStack gap={3}>
                    <HStack justify="between" align="center" gap={2} wrap="wrap">
                      <Text weight="semibold">{t.title}</Text>
                      <Badge variant={variant} label={t.status} />
                    </HStack>
                    <Text type="supporting">{t.prompt}</Text>
                    <Text type="supporting">
                      Hẹn lúc: <span className="dash-mono">{fmtDate(t.scheduled_at)}</span>
                      {t.repeat_minutes && t.repeat_minutes > 0
                        ? ` · Lặp mỗi ${t.repeat_minutes} phút`
                        : ""}
                      {t.completed_at ? ` · Xong: ${fmtDate(t.completed_at)}` : ""}
                    </Text>
                    {t.error_message && <Text type="supporting">Lỗi: {t.error_message}</Text>}
                    <HStack gap={2} wrap="wrap">
                      {t.chat_url && (
                        <Button
                          label="Mở Chat gốc"
                          size="sm"
                          variant="ghost"
                          onClick={() => window.open(t.chat_url!, "_blank", "noopener")}
                        />
                      )}
                      {(t.response_text || t.screenshot_path) && (
                        <Button
                          label="Xem kết quả"
                          size="sm"
                          variant="secondary"
                          onClick={() => setSelectedTask(t)}
                        />
                      )}
                      {!isRunning && (
                        <Button
                          label="Chạy ngay"
                          size="sm"
                          variant="primary"
                          isLoading={busy === `task-run-${t.id}`}
                          onClick={() =>
                            act(
                              `task-run-${t.id}`,
                              async () => {
                                await apiPost(`/api/tasks/${t.id}/run`);
                                await loadTasks();
                              },
                              `Đã kích hoạt chạy tác vụ "${t.title}".`
                            )
                          }
                        />
                      )}
                      <Button
                        label="Xóa"
                        size="sm"
                        variant="destructive"
                        isLoading={busy === `task-del-${t.id}`}
                        onClick={() =>
                          act(
                            `task-del-${t.id}`,
                            async () => {
                              await apiDelete(`/api/tasks/${t.id}`);
                              if (selectedTask?.id === t.id) setSelectedTask(null);
                              await loadTasks();
                            },
                            "Đã xóa tác vụ."
                          )
                        }
                      />
                    </HStack>
                  </VStack>
                </Card>
              );
            })
          )}
        </VStack>
      </Grid>

      {selectedTask && (
        <Card padding={5}>
          <VStack gap={4}>
            <HStack justify="between" align="center" gap={2}>
              <Heading level={2}>Kết quả tác vụ: {selectedTask.title}</Heading>
              <Button label="Đóng" size="sm" variant="ghost" onClick={() => setSelectedTask(null)} />
            </HStack>
            <Divider />
            {selectedTask.response_text && (
              <VStack gap={1.5}>
                <Text weight="semibold">Phản hồi từ AI</Text>
                <pre className="dash-pre">{selectedTask.response_text}</pre>
              </VStack>
            )}
            {selectedTask.screenshot_path && (
              <VStack gap={1.5}>
                <Text weight="semibold">Ảnh chụp màn hình xác minh</Text>
                <a
                  href={`/${selectedTask.screenshot_path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <img
                    src={`/${selectedTask.screenshot_path}`}
                    alt={`Ảnh chụp của ${selectedTask.title}`}
                    className="dash-img-preview"
                  />
                </a>
              </VStack>
            )}
          </VStack>
        </Card>
      )}
    </VStack>
  );
}

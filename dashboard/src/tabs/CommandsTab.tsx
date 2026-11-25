import { useCallback, useEffect, useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { List, ListItem } from "@astryxdesign/core/List";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { apiDelete, apiGet, apiPost, type CustomCommandItem } from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

export default function CommandsTab({ busy, act }: Props) {
  const [commands, setCommands] = useState<CustomCommandItem[]>([]);
  const [slash, setSlash] = useState("");
  const [title, setTitle] = useState("");
  const [promptTemplate, setPromptTemplate] = useState("");

  const loadCommands = useCallback(async () => {
    const res = await apiGet<{ items?: CustomCommandItem[] }>("/api/commands").catch(() => null);
    if (res) setCommands(res.items || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadCommands(), 0);
    return () => clearTimeout(t);
  }, [loadCommands]);

  return (
    <VStack gap={6}>
      <PageHeader
        title="Lệnh tùy chỉnh (Custom Slash Commands)"
        description="Lưu các mẫu prompt thường dùng dưới dạng lệnh slash để gọi nhanh cùng AI."
        actions={<Badge variant="neutral" label={`${commands.length} lệnh`} />}
      />

      <Grid columns={{ minWidth: 320, max: 2 }} gap={5} align="start">
        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Tạo lệnh mới</Text>
            <TextInput
              label="Lệnh slash"
              placeholder="/review"
              value={slash}
              onChange={setSlash}
              isRequired
            />
            <TextInput
              label="Tiêu đề"
              placeholder="Review mã nguồn nhanh"
              value={title}
              onChange={setTitle}
              isRequired
            />
            <TextArea
              label="Mẫu prompt (Prompt Template)"
              placeholder="Kiểm tra git diff và liệt kê rủi ro tiềm ẩn..."
              value={promptTemplate}
              onChange={setPromptTemplate}
            />
            <HStack>
              <Button
                label="Lưu lệnh mới"
                variant="primary"
                size="sm"
                isDisabled={!slash.trim() || !title.trim() || !promptTemplate.trim()}
                isLoading={busy === "cmd-add"}
                onClick={() =>
                  act(
                    "cmd-add",
                    async () => {
                      await apiPost("/api/commands", {
                        slash: slash.trim(),
                        title: title.trim(),
                        promptTemplate: promptTemplate.trim(),
                        isPinned: true,
                      });
                      setSlash("");
                      setTitle("");
                      setPromptTemplate("");
                      await loadCommands();
                    },
                    "Đã tạo lệnh tùy chỉnh mới."
                  )
                }
              />
            </HStack>
          </VStack>
        </Card>

        {commands.length === 0 ? (
          <Card padding={4}>
            <EmptyState
              title="Chưa có lệnh tùy chỉnh nào"
              description="Điền biểu mẫu bên trái để lưu câu lệnh slash đầu tiên."
            />
          </Card>
        ) : (
          <Card padding={0}>
            <List hasDividers edge="bleed">
              {commands.map((cmd) => (
                <ListItem
                  key={cmd.id}
                  label={`${cmd.slash} — ${cmd.title}`}
                  description={
                    <Text type="supporting">{cmd.description || cmd.promptTemplate}</Text>
                  }
                  endContent={
                    <HStack gap={2}>
                      <Button
                        label={cmd.isPinned ? "Bỏ ghim" : "Ghim"}
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          act(`cmd-pin-${cmd.id}`, async () => {
                            await apiPost(`/api/commands/${cmd.id}/pin`, {
                              pinned: !cmd.isPinned,
                            });
                            await loadCommands();
                          })
                        }
                      />
                      <Button
                        label="Xóa"
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          act(
                            `cmd-del-${cmd.id}`,
                            async () => {
                              await apiDelete(`/api/commands/${cmd.id}`);
                              await loadCommands();
                            },
                            `Đã xóa lệnh ${cmd.slash}.`
                          )
                        }
                      />
                    </HStack>
                  }
                />
              ))}
            </List>
          </Card>
        )}
      </Grid>
    </VStack>
  );
}

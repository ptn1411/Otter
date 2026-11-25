import { useCallback, useEffect, useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { TextInput } from "@astryxdesign/core/TextInput";
import { TextArea } from "@astryxdesign/core/TextArea";
import { Selector } from "@astryxdesign/core/Selector";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  apiGet,
  apiPost,
  type FbListenerStatus,
  type FbSalesCommentCat,
  type FbSalesIntent,
  type FbSalesStage,
} from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

const STAGE_OPTIONS = [
  { value: "greeting", label: "greeting — Chào hỏi" },
  { value: "discovery", label: "discovery — Khai thác nhu cầu" },
  { value: "pitch", label: "pitch — Giới thiệu giải pháp" },
  { value: "objection", label: "objection — Xử lý từ chối" },
  { value: "closing", label: "closing — Chốt đơn" },
  { value: "support", label: "support — Chăm sóc sau bán" },
  { value: "done", label: "done — Hoàn tất" },
];

export default function FbSalesTab({ busy, act }: Props) {
  const [subView, setSubView] = useState("stages");
  const [listener, setListener] = useState<FbListenerStatus | null>(null);
  const [stages, setStages] = useState<FbSalesStage[]>([]);
  const [intents, setIntents] = useState<FbSalesIntent[]>([]);
  const [comments, setComments] = useState<FbSalesCommentCat[]>([]);
  const [loaded, setLoaded] = useState(false);

  const loadAll = useCallback(async () => {
    const [lst, pb] = await Promise.all([
      apiGet<FbListenerStatus>("/api/activity/v1/browser/messenger/listen/status").catch(() => null),
      apiGet<{
        ok?: boolean;
        stages?: FbSalesStage[];
        intents?: FbSalesIntent[];
        commentCategories?: FbSalesCommentCat[];
      }>("/api/activity/v1/browser/messenger/playbook").catch(() => null),
    ]);
    if (lst) setListener(lst);
    if (pb?.ok) {
      setStages(pb.stages || []);
      setIntents(pb.intents || []);
      setComments(pb.commentCategories || []);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  return (
    <VStack gap={6}>
      <PageHeader
        title="Kịch bản FB Sales & Messenger"
        description="Cấu hình giai đoạn tư vấn, phản xạ từ khóa ý định và mẫu bình luận tự động."
        actions={
          <>
            <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadAll()} />
            <Button
              label="Khôi phục kịch bản gốc"
              size="sm"
              variant="destructive"
              isLoading={busy === "fb-reset"}
              onClick={() =>
                act(
                  "fb-reset",
                  async () => {
                    await apiPost("/api/activity/v1/browser/messenger/playbook/reset");
                    await loadAll();
                  },
                  "Đã khôi phục kịch bản mặc định."
                )
              }
            />
          </>
        }
      />

      {/* Listener status + Sub-view switcher */}
      <Card padding={4}>
        <HStack justify="between" align="center" wrap="wrap" gap={3}>
          <HStack gap={3} wrap="wrap" align="center">
            <Badge
              variant={listener?.active ? "success" : "neutral"}
              label={listener?.active ? "Auto-Listener: Đang chạy" : "Auto-Listener: Đang dừng"}
            />
            <Badge variant="neutral" label={`Đã trả lời: ${listener?.replyCount ?? 0}`} />
            <Text type="supporting">
              Khách gần nhất: <strong>{listener?.lastRepliedTo || "Chưa có"}</strong>
            </Text>
          </HStack>

          <SegmentedControl label="Mục kịch bản" value={subView} onChange={setSubView}>
            <SegmentedControlItem value="stages" label={`Giai đoạn (${stages.length})`} />
            <SegmentedControlItem value="intents" label={`Ý định (${intents.length})`} />
            <SegmentedControlItem value="comments" label={`Bình luận (${comments.length})`} />
          </SegmentedControl>
        </HStack>
      </Card>

      {/* Stages */}
      {subView === "stages" &&
        (loaded && stages.length === 0 ? (
          <Card padding={4}>
            <EmptyState title="Chưa có dữ liệu giai đoạn" description="Kiểm tra kết nối tới daemon." />
          </Card>
        ) : (
          <VStack gap={3}>
            {stages.map((st, idx) => (
              <Card key={st.stage} padding={4}>
                <VStack gap={3}>
                  <HStack justify="between" align="center" gap={2} wrap="wrap">
                    <HStack gap={2} align="center">
                      <Badge variant="info" label={st.stage.toUpperCase()} />
                      <Text weight="semibold">{st.name}</Text>
                    </HStack>
                    <Button
                      label="Lưu giai đoạn"
                      size="sm"
                      variant="primary"
                      isLoading={busy === `stage-${st.stage}`}
                      onClick={() =>
                        act(
                          `stage-${st.stage}`,
                          async () => {
                            await apiPost("/api/activity/v1/browser/messenger/playbook/stage", {
                              stage: st.stage,
                              name: st.name.trim(),
                              goal: st.goal.trim(),
                              templates: st.templates.map((x) => x.trim()).filter(Boolean),
                            });
                          },
                          `Đã lưu giai đoạn "${st.stage}".`
                        )
                      }
                    />
                  </HStack>
                  <Grid columns={{ minWidth: 240, max: 2 }} gap={3}>
                    <TextInput
                      label="Tên giai đoạn"
                      value={st.name}
                      onChange={(val) =>
                        setStages((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, name: val } : item))
                        )
                      }
                    />
                    <TextInput
                      label="Mục tiêu chuyển đổi"
                      value={st.goal}
                      onChange={(val) =>
                        setStages((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, goal: val } : item))
                        )
                      }
                    />
                  </Grid>
                  <TextArea
                    label="Câu thoại mẫu (mỗi dòng 1 câu, dùng {name} chèn tên khách)"
                    value={st.templates.join("\n")}
                    onChange={(val) =>
                      setStages((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, templates: val.split("\n") } : item
                        )
                      )
                    }
                  />
                </VStack>
              </Card>
            ))}
          </VStack>
        ))}

      {/* Intents */}
      {subView === "intents" && (
        <VStack gap={3}>
          {intents.map((it, idx) => (
            <Card key={it.intentKey} padding={4}>
              <VStack gap={3}>
                <HStack justify="between" align="center" gap={2} wrap="wrap">
                  <HStack gap={2} align="center" wrap="wrap">
                    <Badge variant="warning" label={it.intentKey} />
                    <Text weight="semibold">{it.name}</Text>
                    {it.description && <Text type="supporting">({it.description})</Text>}
                  </HStack>
                  <Button
                    label="Lưu ý định"
                    size="sm"
                    variant="primary"
                    isLoading={busy === `intent-${it.intentKey}`}
                    onClick={() =>
                      act(
                        `intent-${it.intentKey}`,
                        async () => {
                          await apiPost("/api/activity/v1/browser/messenger/playbook/intent", {
                            intentKey: it.intentKey,
                            keywords: it.keywords.map((k) => k.trim()).filter(Boolean),
                            replyTemplate: it.replyTemplate,
                            nextStage: it.nextStage,
                          });
                        },
                        `Đã lưu ý định "${it.intentKey}".`
                      )
                    }
                  />
                </HStack>
                <Grid columns={{ minWidth: 240, max: 2 }} gap={3}>
                  <TextInput
                    label="Từ khóa kích hoạt (cách nhau bằng dấu phẩy)"
                    value={it.keywords.join(", ")}
                    onChange={(val) =>
                      setIntents((prev) =>
                        prev.map((item, i) =>
                          i === idx ? { ...item, keywords: val.split(",") } : item
                        )
                      )
                    }
                  />
                  <Selector
                    label="Chuyển sang giai đoạn"
                    options={STAGE_OPTIONS}
                    value={it.nextStage}
                    onChange={(val) =>
                      setIntents((prev) =>
                        prev.map((item, i) => (i === idx ? { ...item, nextStage: val } : item))
                      )
                    }
                    presentation="adaptive"
                    width="100%"
                  />
                </Grid>
                <TextArea
                  label="Câu trả lời mẫu (dùng {name})"
                  value={it.replyTemplate}
                  onChange={(val) =>
                    setIntents((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, replyTemplate: val } : item
                      )
                    )
                  }
                />
              </VStack>
            </Card>
          ))}
        </VStack>
      )}

      {/* Comments */}
      {subView === "comments" && (
        <VStack gap={3}>
          {comments.map((cat, idx) => (
            <Card key={cat.category} padding={4}>
              <VStack gap={3}>
                <HStack justify="between" align="center" gap={2} wrap="wrap">
                  <HStack gap={2} align="center">
                    <Badge variant="info" label={cat.category} />
                    <Text weight="semibold">{cat.name}</Text>
                  </HStack>
                  <Button
                    label="Lưu bình luận"
                    size="sm"
                    variant="primary"
                    isLoading={busy === `cat-${cat.category}`}
                    onClick={() =>
                      act(
                        `cat-${cat.category}`,
                        async () => {
                          await apiPost("/api/activity/v1/browser/messenger/playbook/comments", {
                            category: cat.category,
                            templates: cat.templates.map((x) => x.trim()).filter(Boolean),
                          });
                        },
                        `Đã lưu mẫu bình luận "${cat.category}".`
                      )
                    }
                  />
                </HStack>
                <TextArea
                  label="Danh sách câu bình luận mẫu (mỗi dòng 1 câu, dùng {author})"
                  value={cat.templates.join("\n")}
                  onChange={(val) =>
                    setComments((prev) =>
                      prev.map((item, i) =>
                        i === idx ? { ...item, templates: val.split("\n") } : item
                      )
                    )
                  }
                />
              </VStack>
            </Card>
          ))}
        </VStack>
      )}
    </VStack>
  );
}

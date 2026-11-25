import { useCallback, useEffect, useMemo, useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { List, ListItem } from "@astryxdesign/core/List";
import { TextInput } from "@astryxdesign/core/TextInput";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  apiGet,
  apiPost,
  copyText,
  type FleetDispatchItem,
  type FleetNodeItem,
  type PageLoopItem,
  type PlanDetail,
  type PlanSummary,
  type SkillItem,
} from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

export default function PlansFleetTab({ busy, act }: Props) {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [queueInfo, setQueueInfo] = useState<{ queued?: number; running?: number } | null>(null);
  const [expandedPlan, setExpandedPlan] = useState<Record<string, PlanDetail>>({});

  const [loops, setLoops] = useState<PageLoopItem[]>([]);
  const [loopGoal, setLoopGoal] = useState("");
  const [loopPlanId, setLoopPlanId] = useState("");
  const [loopMode, setLoopMode] = useState("auto");

  const [nodes, setNodes] = useState<FleetNodeItem[]>([]);
  const [dispatches, setDispatches] = useState<FleetDispatchItem[]>([]);

  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [skillSearch, setSkillSearch] = useState("");

  const loadAll = useCallback(async () => {
    const [pData, lData, nData, dData, sData] = await Promise.all([
      apiGet<{ plans?: PlanSummary[]; queue?: { queued?: number; running?: number } }>("/api/plans").catch(() => null),
      apiGet<{ loops?: PageLoopItem[] }>("/api/page-loops").catch(() => null),
      apiGet<{ nodes?: FleetNodeItem[] }>("/api/fleet/nodes").catch(() => null),
      apiGet<{ dispatches?: FleetDispatchItem[] }>("/api/fleet/dispatches").catch(() => null),
      apiGet<{ skills?: SkillItem[] }>("/api/skills").catch(() => null),
    ]);
    if (pData) {
      setPlans(pData.plans || []);
      setQueueInfo(pData.queue || null);
    }
    if (lData) setLoops(lData.loops || []);
    if (nData) setNodes(nData.nodes || []);
    if (dData) setDispatches(dData.dispatches || []);
    if (sData) setSkills(sData.skills || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.description || "").toLowerCase().includes(q)
    );
  }, [skills, skillSearch]);

  async function togglePlanDetail(id: string) {
    if (expandedPlan[id]) {
      setExpandedPlan((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const detail = await apiGet<PlanDetail>(`/api/plans/${encodeURIComponent(id)}`);
    setExpandedPlan((prev) => ({ ...prev, [id]: detail }));
  }

  return (
    <VStack gap={6}>
      <PageHeader
        title="Kế hoạch, Page Loops & Fleet"
        description="Theo dõi tiến độ kế hoạch tự động, điều khiển vòng lặp ChatGPT Web, máy trạm Fleet và kỹ năng."
        actions={
          <>
            <Badge
              variant="neutral"
              label={`Hàng đợi: chờ ${queueInfo?.queued ?? 0} · chạy ${queueInfo?.running ?? 0}`}
            />
            <Button
              label="Mở Plan Dashboard"
              size="sm"
              variant="secondary"
              onClick={() => window.open("/plan-dashboard", "_blank", "noopener")}
            />
            <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadAll()} />
          </>
        }
      />

      {/* Kế hoạch (Plans) */}
      <VStack gap={3}>
        <Heading level={2}>Kế hoạch (Plans & Outbox)</Heading>
        {plans.length === 0 ? (
          <Card padding={4}>
            <EmptyState
              title="Chưa có kế hoạch nào"
              description="Tạo kế hoạch từ AI bằng công cụ plan_create để theo dõi tiến độ tại đây."
            />
          </Card>
        ) : (
          <VStack gap={3}>
            {plans.map((p) => {
              const total = p.taskTotal || 0;
              const done = (p.taskCounts?.success || 0) + (p.taskCounts?.skipped || 0);
              const pct = total ? Math.round((done / total) * 100) : 0;
              const detail = expandedPlan[p.id];
              return (
                <Card key={p.id} padding={4}>
                  <VStack gap={3}>
                    <HStack justify="between" align="center" wrap="wrap" gap={2}>
                      <Text weight="semibold">{p.goal}</Text>
                      <HStack gap={2} align="center">
                        <Badge variant="neutral" label={p.id} />
                        <Badge
                          variant={
                            p.status === "done"
                              ? "success"
                              : (p.taskCounts?.blocked || 0) > 0
                                ? "error"
                                : "info"
                          }
                          label={p.status}
                        />
                      </HStack>
                    </HStack>

                    <ProgressBar label={`Tiến độ ${p.id}`} value={pct} max={100} />

                    <Text type="supporting">
                      {`${done}/${total} task xong (${pct}%) · Thành công: ${p.taskCounts?.success || 0} · Lỗi: ${p.taskCounts?.failed || 0} · Blocked: ${p.taskCounts?.blocked || 0} · Chờ: ${p.taskCounts?.pending || 0}`}
                    </Text>

                    <HStack gap={2} wrap="wrap">
                      <Button
                        label="Chạy tiếp"
                        size="sm"
                        variant="primary"
                        isLoading={busy === `plan-resume-${p.id}`}
                        onClick={() =>
                          act(`plan-resume-${p.id}`, async () => {
                            await apiPost(`/api/plans/${encodeURIComponent(p.id)}/resume`);
                            await loadAll();
                          })
                        }
                      />
                      <Button
                        label="Tạm dừng"
                        size="sm"
                        variant="secondary"
                        isLoading={busy === `plan-pause-${p.id}`}
                        onClick={() =>
                          act(`plan-pause-${p.id}`, async () => {
                            await apiPost(`/api/plans/${encodeURIComponent(p.id)}/pause`);
                            await loadAll();
                          })
                        }
                      />
                      <Button
                        label={detail ? "Ẩn chi tiết" : "Chi tiết & Outbox"}
                        size="sm"
                        variant="secondary"
                        onClick={() => void togglePlanDetail(p.id)}
                      />
                      <Button
                        label="Copy Resume Prompt"
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          act(
                            `plan-prompt-${p.id}`,
                            async () => {
                              const r = await apiGet<{ prompt?: string }>(
                                `/api/plans/${encodeURIComponent(p.id)}/resume-prompt`
                              );
                              await copyText(r.prompt || "");
                            },
                            "Đã sao chép resume prompt."
                          )
                        }
                      />
                      <Button
                        label="Hủy"
                        size="sm"
                        variant="destructive"
                        isLoading={busy === `plan-cancel-${p.id}`}
                        onClick={() =>
                          act(`plan-cancel-${p.id}`, async () => {
                            await apiPost(`/api/plans/${encodeURIComponent(p.id)}/cancel`);
                            await loadAll();
                          })
                        }
                      />
                    </HStack>

                    {detail && (
                      <>
                        <Divider />
                        <VStack gap={2}>
                          <Text type="supporting">
                            Hiện tại: <strong>{detail.currentTask?.goal || "—"}</strong> · Tiếp
                            theo: <strong>{detail.nextTask?.goal || "—"}</strong>
                          </Text>
                          {(detail.tasks || []).map((t, idx) => (
                            <Text key={idx} type="supporting">
                              • {t.goal} — <span className="dash-mono">{t.status}</span> (
                              {t.attemptCount}/{t.maxAttempts})
                            </Text>
                          ))}
                          {(detail.outbox || []).length > 0 && (
                            <VStack gap={1}>
                              <Text weight="semibold">Outbox</Text>
                              {(detail.outbox || []).map((o, idx) => (
                                <Text key={idx} type="supporting">
                                  {o.textPreview} (lần thử: {o.attemptCount})
                                </Text>
                              ))}
                            </VStack>
                          )}
                        </VStack>
                      </>
                    )}
                  </VStack>
                </Card>
              );
            })}
          </VStack>
        )}
      </VStack>

      {/* Page Loops */}
      <VStack gap={3}>
        <Heading level={2}>Vòng lặp tự động (Page Loops)</Heading>
        <Grid columns={{ minWidth: 320, max: 2 }} gap={4} align="start">
          <Card padding={4}>
            <VStack gap={3}>
              <Text weight="semibold">Khởi chạy Page Loop mới</Text>
              <TextInput
                label="Mục tiêu (Goal)"
                placeholder="Hoàn thành test và sửa toàn bộ lỗi build..."
                value={loopGoal}
                onChange={setLoopGoal}
                isRequired
              />
              <TextInput
                label="Plan ID (tùy chọn)"
                placeholder="plan_..."
                value={loopPlanId}
                onChange={setLoopPlanId}
              />
              <SegmentedControl label="Chế độ chạy" value={loopMode} onChange={setLoopMode}>
                <SegmentedControlItem value="auto" label="Auto" />
                <SegmentedControlItem value="zero_risk" label="Zero Risk" />
              </SegmentedControl>
              <HStack>
                <Button
                  label="Bắt đầu Loop"
                  variant="primary"
                  size="sm"
                  isDisabled={!loopGoal.trim()}
                  isLoading={busy === "loop-create"}
                  onClick={() =>
                    act(
                      "loop-create",
                      async () => {
                        await apiPost("/api/page-loops", {
                          goal: loopGoal.trim(),
                          planId: loopPlanId.trim() || undefined,
                          mode: loopMode,
                        });
                        setLoopGoal("");
                        setLoopPlanId("");
                        await loadAll();
                      },
                      "Đã tạo Page Loop."
                    )
                  }
                />
              </HStack>
            </VStack>
          </Card>

          <Card padding={loops.length === 0 ? 4 : 0}>
            {loops.length === 0 ? (
              <EmptyState title="Chưa có Page Loop nào" />
            ) : (
              <List hasDividers edge="bleed">
                {loops.slice(0, 10).map((l) => (
                  <ListItem
                    key={l.id}
                    label={`${l.id} · ${l.status} (${l.mode})`}
                    description={
                      <Text type="supporting">
                        {`Lượt ${l.turnCount}/${l.maxTurns} · ${l.goal.slice(0, 120)}`}
                        {l.blockedReason ? ` · Blocked: ${l.blockedReason}` : ""}
                      </Text>
                    }
                    endContent={
                      <HStack gap={2}>
                        <Button
                          label="Tiếp tục"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            act(`loop-resume-${l.id}`, async () => {
                              await apiPost(`/api/page-loops/${l.id}/resume`, {});
                              await loadAll();
                            })
                          }
                        />
                        <Button
                          label="Dừng"
                          size="sm"
                          variant="destructive"
                          onClick={() =>
                            act(`loop-stop-${l.id}`, async () => {
                              await apiPost(`/api/page-loops/${l.id}/stop`, {});
                              await loadAll();
                            })
                          }
                        />
                      </HStack>
                    }
                  />
                ))}
              </List>
            )}
          </Card>
        </Grid>
      </VStack>

      {/* Fleet & Skills */}
      <Grid columns={{ minWidth: 320, max: 2 }} gap={5} align="start">
        <VStack gap={3}>
          <Heading level={2}>Fleet Workers & Dispatches</Heading>
          <Card padding={nodes.length === 0 && dispatches.length === 0 ? 4 : 0}>
            {nodes.length === 0 && dispatches.length === 0 ? (
              <EmptyState
                title="Chưa có Fleet node nào"
                description="Đăng ký máy trạm phụ qua công cụ fleet_register."
              />
            ) : (
              <List hasDividers edge="bleed">
                {nodes.map((n) => (
                  <ListItem
                    key={n.nodeId}
                    label={`${n.name} (${n.nodeId})`}
                    description={
                      <Text type="supporting">
                        {`${n.apiBase} · Dự án: ${(n.projects || []).join(", ") || "—"}`}
                      </Text>
                    }
                    endContent={
                      <Badge
                        variant={n.status === "online" ? "success" : "neutral"}
                        label={n.status}
                      />
                    }
                  />
                ))}
                {dispatches.slice(0, 8).map((d) => (
                  <ListItem
                    key={d.dispatchId}
                    label={`${d.dispatchId} → ${d.nodeId}`}
                    description={<Text type="supporting">{d.goal.slice(0, 120)}</Text>}
                    endContent={<Badge variant="info" label={d.status} />}
                  />
                ))}
              </List>
            )}
          </Card>
        </VStack>

        <VStack gap={3}>
          <HStack justify="between" align="center" gap={2}>
            <Heading level={2}>Kỹ năng đã cài (Skills)</Heading>
            <Badge variant="neutral" label={`${skills.length} skills`} />
          </HStack>
          <TextInput
            label="Tìm kỹ năng"
            placeholder="Lọc theo tên hoặc mô tả..."
            value={skillSearch}
            onChange={setSkillSearch}
            isLabelHidden
          />
          <Card padding={filteredSkills.length === 0 ? 4 : 0}>
            {filteredSkills.length === 0 ? (
              <EmptyState title="Không thấy kỹ năng phù hợp" />
            ) : (
              <List hasDividers edge="bleed">
                {filteredSkills.slice(0, 20).map((s) => (
                  <ListItem
                    key={s.name}
                    label={s.name}
                    description={<Text type="supporting">{(s.description || "").slice(0, 160)}</Text>}
                  />
                ))}
              </List>
            )}
          </Card>
        </VStack>
      </Grid>
    </VStack>
  );
}

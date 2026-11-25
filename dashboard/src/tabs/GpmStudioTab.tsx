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
import { Switch } from "@astryxdesign/core/Switch";
import { Selector } from "@astryxdesign/core/Selector";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost, copyText, type GpmProfileItem, type GpmStatusInfo } from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

const GPM_ACTIONS = [
  { value: "48", label: "Click Element (48)" },
  { value: "50", label: "Type Text (50)" },
  { value: "11", label: "Open URL (11)" },
  { value: "53", label: "Scroll (53)" },
  { value: "68", label: "Execute JS (68)" },
  { value: "118", label: "Wait Element (118)" },
];

export default function GpmStudioTab({ busy, act }: Props) {
  const [gpmStatus, setGpmStatus] = useState<GpmStatusInfo | null>(null);
  const [gpmSearch, setGpmSearch] = useState("");
  const [gpmProfiles, setGpmProfiles] = useState<GpmProfileItem[]>([]);

  const [xpathExpr, setXpathExpr] = useState("");
  const [xpathNegate, setXpathNegate] = useState(false);
  const [xpathLive, setXpathLive] = useState(true);
  const [xpathResult, setXpathResult] = useState<{
    ok: boolean;
    condition: string;
    detail: string;
  } | null>(null);

  const [actionType, setActionType] = useState("48");
  const [scriptXpath, setScriptXpath] = useState("");
  const [scriptVal, setScriptVal] = useState("");
  const [scriptDelay, setScriptDelay] = useState("$delay");
  const [scriptComment, setScriptComment] = useState("Thực hiện hành động");
  const [generatedJson, setGeneratedJson] = useState("");

  const loadAll = useCallback(async (search = "") => {
    const [gStat, gProf] = await Promise.all([
      apiGet<GpmStatusInfo>("/api/activity/v1/gpm/status").catch(() => null),
      apiGet<{ profiles?: GpmProfileItem[] }>(
        `/api/activity/v1/gpm/profiles${search ? `?search=${encodeURIComponent(search)}` : ""}`
      ).catch(() => null),
    ]);
    if (gStat) setGpmStatus(gStat);
    if (gProf) setGpmProfiles(gProf.profiles || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
  }, [loadAll]);

  return (
    <VStack gap={6}>
      <PageHeader
        title="GPM Studio"
        description="Quản lý hồ sơ GPM Login, kiểm thử XPath trực tiếp và sinh block JSON GPM Automate V3."
        actions={
          <>
            <Badge
              variant={gpmStatus?.gpmLogin ? "success" : "neutral"}
              label={`GPM Login: ${gpmStatus?.gpmLogin ? "Online" : "Offline"}`}
            />
            <Badge
              variant={gpmStatus?.gpmAutomate ? "success" : "neutral"}
              label={`GPM Automate: ${gpmStatus?.gpmAutomate ? "Online" : "Offline"}`}
            />
            <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadAll(gpmSearch)} />
          </>
        }
      />

      {/* GPM Profiles */}
      <Card padding={4}>
        <VStack gap={3}>
          <HStack justify="between" align="end" gap={3} wrap="wrap">
            <TextInput
              label="Tìm GPM Profile"
              placeholder="Nhập tên profile..."
              value={gpmSearch}
              onChange={setGpmSearch}
            />
            <Button
              label="Tìm kiếm"
              size="sm"
              variant="secondary"
              onClick={() => void loadAll(gpmSearch)}
            />
          </HStack>

          {gpmProfiles.length === 0 ? (
            <EmptyState
              title="Chưa có GPM Profile nào"
              description="Khởi chạy GPM Login tại cổng 9495 rồi nhấn Làm mới để đồng bộ danh sách."
            />
          ) : (
            <List hasDividers edge="bleed">
              {gpmProfiles.map((p) => {
                const running = Boolean(p.is_running || p.remote_debugging_port);
                return (
                  <ListItem
                    key={p.id}
                    label={p.name}
                    description={
                      <Text type="supporting">
                        <span className="dash-mono">{p.id}</span> ·{" "}
                        {p.raw_proxy || "Không dùng proxy"}
                        {p.remote_debugging_port ? ` · CDP :${p.remote_debugging_port}` : ""}
                      </Text>
                    }
                    endContent={
                      <HStack gap={2} align="center">
                        <Badge
                          variant={running ? "success" : "neutral"}
                          label={running ? "Đang chạy" : "Đã đóng"}
                        />
                        {running ? (
                          <Button
                            label="Đóng"
                            size="sm"
                            variant="destructive"
                            isLoading={busy === `gpm-stop-${p.id}`}
                            onClick={() =>
                              act(`gpm-stop-${p.id}`, async () => {
                                await apiPost("/api/activity/v1/gpm/profiles/stop", {
                                  profileId: p.id,
                                });
                                await loadAll(gpmSearch);
                              })
                            }
                          />
                        ) : (
                          <Button
                            label="Mở"
                            size="sm"
                            variant="primary"
                            isLoading={busy === `gpm-start-${p.id}`}
                            onClick={() =>
                              act(`gpm-start-${p.id}`, async () => {
                                await apiPost("/api/activity/v1/gpm/profiles/start", {
                                  profileId: p.id,
                                });
                                await loadAll(gpmSearch);
                              })
                            }
                          />
                        )}
                      </HStack>
                    }
                  />
                );
              })}
            </List>
          )}
        </VStack>
      </Card>

      {/* XPath Tester & GPM Script Generator */}
      <Grid columns={{ minWidth: 320, max: 2 }} gap={4} align="start">
        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Kiểm thử XPath (GPM Automate V3)</Text>
            <TextInput
              label="Biểu thức XPath"
              placeholder="//button[contains(., 'Gửi')]"
              value={xpathExpr}
              onChange={setXpathExpr}
            />
            <HStack gap={4} wrap="wrap">
              <Switch
                label="Phủ định (!has_element)"
                size="sm"
                value={xpathNegate}
                onChange={setXpathNegate}
              />
              <Switch
                label="Kiểm tra trên DOM tab đang mở"
                size="sm"
                value={xpathLive}
                onChange={setXpathLive}
              />
            </HStack>
            <HStack gap={2} wrap="wrap">
              <Button
                label="Thử nghiệm XPath"
                variant="primary"
                size="sm"
                isDisabled={!xpathExpr.trim()}
                isLoading={busy === "gpm-xpath"}
                onClick={() =>
                  act("gpm-xpath", async () => {
                    const res = await apiPost<any>("/api/activity/v1/gpm/xpath/test", {
                      xpath: xpathExpr.trim(),
                      negate: xpathNegate,
                      liveTest: xpathLive,
                    });
                    if (!res.isValid) {
                      setXpathResult({
                        ok: false,
                        condition: `XPath không hợp lệ: ${res.error}`,
                        detail: "",
                      });
                    } else {
                      let detail = "Cú pháp hợp lệ chuẩn GPM Automate V3.";
                      if (res.liveEvaluation) {
                        detail = res.liveEvaluation.error
                          ? `Lỗi DOM live: ${res.liveEvaluation.error}`
                          : `Tìm thấy ${res.liveEvaluation.count || 0} phần tử. Mẫu: [${(
                              res.liveEvaluation.sampleTexts || []
                            ).join(" | ")}]`;
                      }
                      setXpathResult({
                        ok: true,
                        condition: res.hasElementCondition || "",
                        detail,
                      });
                    }
                  })
                }
              />
              {xpathResult?.ok && (
                <Button
                  label="Sao chép điều kiện"
                  size="sm"
                  variant="secondary"
                  onClick={() => copyText(xpathResult.condition)}
                />
              )}
            </HStack>
            {xpathResult && (
              <Card padding={3}>
                <VStack gap={1.5}>
                  <Text weight="semibold">
                    <span className="dash-mono">{xpathResult.condition}</span>
                  </Text>
                  {xpathResult.detail && <Text type="supporting">{xpathResult.detail}</Text>}
                </VStack>
              </Card>
            )}
          </VStack>
        </Card>

        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Sinh Block JSON GPM Automate V3</Text>
            <Selector
              label="Loại hành động (Action Type)"
              options={GPM_ACTIONS}
              value={actionType}
              onChange={setActionType}
              presentation="adaptive"
              width="100%"
            />
            <TextInput
              label="XPath mục tiêu (tùy chọn)"
              placeholder="//textarea[@name='q']"
              value={scriptXpath}
              onChange={setScriptXpath}
            />
            <TextInput
              label="Giá trị (Text / URL / JS / Timeout)"
              placeholder="Nội dung nhập hoặc URL..."
              value={scriptVal}
              onChange={setScriptVal}
            />
            <Grid columns={{ minWidth: 140, max: 2 }} gap={3}>
              <TextInput label="Delay" value={scriptDelay} onChange={setScriptDelay} />
              <TextInput label="Ghi chú" value={scriptComment} onChange={setScriptComment} />
            </Grid>
            <HStack>
              <Button
                label="Sinh JSON .NET"
                variant="primary"
                size="sm"
                isLoading={busy === "gpm-gen"}
                onClick={() =>
                  act("gpm-gen", async () => {
                    const code = Number(actionType) || 48;
                    const rawInput: Record<string, string> = {};
                    if (scriptXpath.trim()) rawInput.XPATH = scriptXpath.trim();
                    if (code === 48) rawInput.CLICK_TYPE = "0";
                    if (code === 50) rawInput.TEXT = scriptVal;
                    if (code === 11) rawInput.URL = scriptVal;
                    if (code === 53) rawInput.SCROLL_NUM = scriptVal || "1";
                    if (code === 68) rawInput.JS_CODE = scriptVal || "return true;";
                    if (code === 118) rawInput.TIMEOUT = scriptVal || "10";
                    const res = await apiPost<{ success: boolean; pasteReadyJson?: string }>(
                      "/api/activity/v1/gpm/script/generate",
                      {
                        actionType: code,
                        xpath: scriptXpath.trim() || undefined,
                        rawInput,
                        comment: scriptComment.trim() || "Thực hiện hành động",
                        delay: scriptDelay.trim() || "$delay",
                        wrapInBlock: true,
                      }
                    );
                    if (res.success && res.pasteReadyJson) {
                      setGeneratedJson(res.pasteReadyJson);
                    }
                  })
                }
              />
            </HStack>
            {generatedJson && (
              <CodeBlock
                code={generatedJson}
                language="json"
                title="Paste-ready GPM Editor JSON"
              />
            )}
          </VStack>
        </Card>
      </Grid>
    </VStack>
  );
}

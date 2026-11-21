import { useCallback, useEffect, useState } from "react";
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
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Banner } from "@astryxdesign/core/Banner";
import { Switch } from "@astryxdesign/core/Switch";
import { Divider } from "@astryxdesign/core/Divider";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost, type BrowserEngineInfo, type ChromeProfileItem } from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

export default function BrowserTab({ busy, act }: Props) {
  const [engine, setEngine] = useState<BrowserEngineInfo | null>(null);
  const [engineMode, setEngineMode] = useState<string>("cdp");
  const [headless, setHeadless] = useState<boolean>(false);
  const [hud, setHud] = useState<boolean>(true);
  const [cdpPort, setCdpPort] = useState<string>("9222");
  const [benchmarkText, setBenchmarkText] = useState<string | null>(null);
  const [chromeProfiles, setChromeProfiles] = useState<ChromeProfileItem[]>([]);
  const [customBrowserPath, setCustomBrowserPath] = useState("");
  const [customProfile, setCustomProfile] = useState("");
  const [customUrl, setCustomUrl] = useState("https://chatgpt.com");

  const loadAll = useCallback(async () => {
    const [eng, prof] = await Promise.all([
      apiGet<BrowserEngineInfo>("/api/activity/v1/browser/engine").catch(() => null),
      apiGet<{ profiles?: ChromeProfileItem[] }>("/api/chrome/profiles").catch(() => null),
    ]);
    if (eng) {
      setEngine(eng);
      if (eng.mode) setEngineMode(eng.mode);
      if (typeof eng.headless === "boolean") setHeadless(eng.headless);
      if (typeof eng.hud === "boolean") setHud(eng.hud);
      if (eng.port) setCdpPort(String(eng.port));
    }
    if (prof) setChromeProfiles(prof.profiles || []);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <VStack gap={6}>
      <PageHeader
        title="Trình duyệt & CDP"
        description="Quản lý động cơ điều khiển trình duyệt (CDP mặc định / Extension phụ) và mở nhanh Chrome Profiles."
        actions={
          <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadAll()} />
        }
      />

      <Banner
        status="info"
        title="Kết nối trực tiếp Chrome mặc định (Chrome 144+, không cần Extension)"
        description={
          <Text type="supporting">
            1) Mở <span className="dash-mono">chrome://inspect/#remote-debugging</span> trên Chrome đang đăng nhập sẵn tài khoản (Facebook, ChatGPT…) → bật <strong>ON</strong> mục <em>Allow remote debugging for this browser</em>. 2) Khi Otter kết nối lần đầu, bấm <strong>Allow</strong> 1 lần duy nhất (Otter tự đọc <span className="dash-mono">DevToolsActivePort</span> và giữ 1 phiên kết nối bền vững).
          </Text>
        }
        endContent={
          <Button
            label="Sao chép link"
            size="sm"
            variant="secondary"
            onClick={() =>
              void act(
                "copy-inspect-url",
                async () => {
                  await navigator.clipboard.writeText("chrome://inspect/#remote-debugging");
                },
                "Đã sao chép chrome://inspect/#remote-debugging — hãy dán vào thanh địa chỉ Chrome."
              )
            }
          />
        }
      />

      {/* Dual-Engine Control */}
      <Grid columns={{ minWidth: 300, max: 2 }} gap={4} align="start">
        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Trạng thái kết nối</Text>
            <List hasDividers edge="bleed">
              <ListItem
                label="Chrome CDP (Engine chính)"
                description={<Text type="supporting">{`Cổng ${engine?.cdp?.port || 9222}`}</Text>}
                endContent={
                  <Badge
                    variant={engine?.cdp?.available ? "success" : "warning"}
                    label={engine?.cdp?.available ? "Sẵn sàng" : "Chưa mở"}
                  />
                }
              />
              <ListItem
                label="Chrome Extension (Tùy chọn phụ)"
                description={
                  <Text type="supporting">
                    {`${engine?.extension?.socketsCount || 0} tab/socket đang nối`}
                  </Text>
                }
                endContent={
                  <Badge
                    variant={engine?.extension?.connected ? "success" : "neutral"}
                    label={engine?.extension?.connected ? "Đã kết nối" : "Chưa kết nối"}
                  />
                }
              />
            </List>
            <HStack gap={2} wrap="wrap">
              <Button
                label="Khởi chạy Chrome CDP :9222"
                variant="primary"
                size="sm"
                isLoading={busy === "launch-cdp"}
                onClick={() =>
                  act(
                    "launch-cdp",
                    async () => {
                      await apiPost("/api/chrome/open", {
                        userDataDir: "cdp-profile",
                        extraArgs: ["--remote-debugging-port=9222"],
                        url: "https://chatgpt.com",
                      });
                      setTimeout(() => void loadAll(), 2000);
                    },
                    "Đã yêu cầu khởi chạy Chrome kèm CDP Port 9222."
                  )
                }
              />
              <Button
                label="Đo Benchmark tốc độ"
                variant="secondary"
                size="sm"
                isLoading={busy === "bench-engine"}
                onClick={() =>
                  act("bench-engine", async () => {
                    const data = await apiPost<BrowserEngineInfo>(
                      "/api/activity/v1/browser/engine",
                      { benchmark: true }
                    );
                    const b = data?.benchmark;
                    if (b) {
                      const extMs =
                        b.extension && b.extension.latencyMs >= 0
                          ? `${b.extension.latencyMs}ms`
                          : "N/A";
                      const cdpMs =
                        b.cdp && b.cdp.latencyMs >= 0 ? `${b.cdp.latencyMs}ms` : "N/A";
                      setBenchmarkText(
                        `CDP: ${cdpMs} | Extension: ${extMs}${b.recommendation ? ` — ${b.recommendation}` : ""}`
                      );
                    }
                  })
                }
              />
            </HStack>
            {benchmarkText && (
              <Text type="supporting">
                <span className="dash-mono">{benchmarkText}</span>
              </Text>
            )}
          </VStack>
        </Card>

        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Chế độ ưu tiên Engine</Text>
            <Text type="supporting">
              CDP chạy độc lập không cần tiện ích Chrome. Chế độ Auto ưu tiên CDP trước rồi dự phòng Extension.
            </Text>
            <SegmentedControl label="Chế độ engine" value={engineMode} onChange={setEngineMode}>
              <SegmentedControlItem value="cdp" label="CDP (Mặc định)" />
              <SegmentedControlItem value="auto" label="Auto" />
              <SegmentedControlItem value="extension" label="Extension" />
            </SegmentedControl>

            <Divider />

            <VStack gap={3}>
              <Text weight="semibold">Tùy chọn Chrome CDP (Environment)</Text>
              <HStack justify="between" align="center" gap={3}>
                <VStack gap={0.5}>
                  <Text weight="medium">Chạy ngầm (Headless Mode)</Text>
                  <Text type="supporting">OTTER_CDP_HEADLESS=1 — Không tự bung cửa sổ Chrome lên màn hình khi AI điều khiển.</Text>
                </VStack>
                <Switch
                  label="Headless Mode"
                  isLabelHidden
                  value={headless}
                  onChange={setHeadless}
                />
              </HStack>

              <HStack justify="between" align="center" gap={3}>
                <VStack gap={0.5}>
                  <Text weight="medium">Thanh HUD & Viền xanh</Text>
                  <Text type="supporting">OTTER_CDP_HUD=1 — Hiển thị thanh trạng thái Otter CDP Core và khung viền xanh.</Text>
                </VStack>
                <Switch
                  label="Thanh HUD"
                  isLabelHidden
                  value={hud}
                  onChange={setHud}
                />
              </HStack>

              <HStack gap={2} align="center">
                <Text style={{ minWidth: 120 }}>Cổng CDP Port:</Text>
                <TextInput
                  label="CDP Port"
                  isLabelHidden
                  value={cdpPort}
                  onChange={setCdpPort}
                  placeholder="9222"
                />
              </HStack>
            </VStack>

            <HStack>
              <Button
                label="Lưu cấu hình CDP & Engine"
                variant="primary"
                size="sm"
                isLoading={busy === "save-engine"}
                onClick={() =>
                  act(
                    "save-engine",
                    async () => {
                      await apiPost("/api/activity/v1/browser/engine", {
                        mode: engineMode,
                        headless,
                        hud,
                        port: Number(cdpPort) || 9222,
                      });
                      await loadAll();
                    },
                    `Đã lưu cấu hình trình duyệt: Engine ${engineMode.toUpperCase()}, Headless: ${headless ? "Bật" : "Tắt"}, HUD: ${hud ? "Bật" : "Tắt"}, Port: ${cdpPort}.`
                  )
                }
              />
            </HStack>
          </VStack>
        </Card>
      </Grid>

      {/* Chrome Profiles & Custom Browser */}
      <VStack gap={3}>
        <Heading level={2}>Chrome Profiles & Trình duyệt tùy chỉnh</Heading>
        <Grid columns={{ minWidth: 320, max: 2 }} gap={4} align="start">
          <Card padding={chromeProfiles.length === 0 ? 4 : 0}>
            {chromeProfiles.length === 0 ? (
              <EmptyState
                title="Không thấy Chrome Profile"
                description="Daemon chưa phát hiện thư mục profile Chrome trên máy này."
              />
            ) : (
              <List hasDividers edge="bleed">
                {chromeProfiles.map((p) => (
                  <ListItem
                    key={p.directory}
                    label={p.name}
                    description={
                      <Text type="supporting">
                        <span className="dash-mono">{p.directory}</span>
                      </Text>
                    }
                    endContent={
                      <Button
                        label="Mở ChatGPT"
                        size="sm"
                        variant="secondary"
                        isLoading={busy === `chrome-${p.directory}`}
                        onClick={() =>
                          act(
                            `chrome-${p.directory}`,
                            async () => {
                              await apiPost("/api/chrome/open", {
                                profile: p.directory,
                                url: "https://chatgpt.com",
                              });
                            },
                            `Đã mở profile ${p.name}.`
                          )
                        }
                      />
                    }
                  />
                ))}
              </List>
            )}
          </Card>

          <Card padding={4}>
            <VStack gap={3}>
              <Text weight="semibold">Mở trình duyệt theo đường dẫn riêng</Text>
              <TextInput
                label="Đường dẫn file thực thi trình duyệt"
                placeholder="C:\Program Files\BraveSoftware\...\brave.exe"
                value={customBrowserPath}
                onChange={setCustomBrowserPath}
              />
              <TextInput
                label="Tên profile (tùy chọn)"
                placeholder="Default"
                value={customProfile}
                onChange={setCustomProfile}
              />
              <TextInput label="URL mở sẵn" value={customUrl} onChange={setCustomUrl} />
              <HStack>
                <Button
                  label="Mở trình duyệt"
                  variant="secondary"
                  size="sm"
                  isDisabled={!customBrowserPath.trim()}
                  isLoading={busy === "open-custom-browser"}
                  onClick={() =>
                    act(
                      "open-custom-browser",
                      async () => {
                        await apiPost("/api/chrome/open", {
                          browserPath: customBrowserPath.trim(),
                          profile: customProfile.trim() || undefined,
                          url: customUrl.trim() || "https://chatgpt.com",
                        });
                      },
                      "Đã mở trình duyệt tùy chỉnh."
                    )
                  }
                />
              </HStack>
            </VStack>
          </Card>
        </Grid>
      </VStack>
    </VStack>
  );
}

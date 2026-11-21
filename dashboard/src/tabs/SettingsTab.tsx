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
import { Switch } from "@astryxdesign/core/Switch";
import { Divider } from "@astryxdesign/core/Divider";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Banner } from "@astryxdesign/core/Banner";
import { PageHeader } from "../components/PageHeader";
import { apiGet, apiPost, type OtterSettings } from "../api";

interface Props {
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

export default function SettingsTab({ busy, act }: Props) {
  const [, setSettings] = useState<OtterSettings | null>(null);

  // Form states
  const [browserEngine, setBrowserEngine] = useState<"cdp" | "auto" | "extension">("cdp");
  const [cdpHeadless, setCdpHeadless] = useState<boolean>(false);
  const [cdpHud, setCdpHud] = useState<boolean>(true);
  const [cdpPort, setCdpPort] = useState<string>("9222");
  const [browserPath, setBrowserPath] = useState<string>("");
  const [userDataDir, setUserDataDir] = useState<string>("");

  const [fullAccess, setFullAccessState] = useState<boolean>(false);
  const [strictWorkspace, setStrictWorkspace] = useState<boolean>(false);
  const [autoTunnel, setAutoTunnel] = useState<boolean>(true);
  const [apiKey, setApiKey] = useState<string>("");

  const [gpmApiPort, setGpmApiPort] = useState<string>("9495");
  const [antigravityBin, setAntigravityBin] = useState<string>("");

  const loadSettings = useCallback(async () => {
    try {
      const data = await apiGet<OtterSettings>("/api/system/settings");
      if (data) {
        setSettings(data);
        setBrowserEngine(data.browserEngine || "cdp");
        setCdpHeadless(Boolean(data.cdpHeadless));
        setCdpHud(data.cdpHud !== false);
        setCdpPort(String(data.cdpPort || 9222));
        setBrowserPath(data.browserPath || "");
        setUserDataDir(data.userDataDir || "");

        setFullAccessState(Boolean(data.fullAccess));
        setStrictWorkspace(Boolean(data.strictWorkspace));
        setAutoTunnel(data.autoTunnel !== false);
        setApiKey(data.apiKey || "");

        setGpmApiPort(String(data.gpmApiPort || 9495));
        setAntigravityBin(data.antigravityBin || "");
      }
    } catch (err) {
      console.warn("Không thể tải cài đặt:", err);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const handleSaveAll = () => {
    return act(
      "save-settings",
      async () => {
        const payload: Partial<OtterSettings> = {
          browserEngine,
          cdpHeadless,
          cdpHud,
          cdpPort: Number(cdpPort) || 9222,
          browserPath: browserPath.trim(),
          userDataDir: userDataDir.trim(),
          fullAccess,
          strictWorkspace,
          autoTunnel,
          apiKey: apiKey.trim(),
          gpmApiPort: Number(gpmApiPort) || 9495,
          antigravityBin: antigravityBin.trim(),
        };
        const res = await apiPost<{ success: boolean; settings: OtterSettings }>(
          "/api/system/settings",
          payload
        );
        if (res?.settings) {
          setSettings(res.settings);
        }
      },
      "Đã lưu toàn bộ cấu hình hệ thống & biến môi trường thành công."
    );
  };

  return (
    <VStack gap={6}>
      <PageHeader
        title="Cấu hình Hệ thống & Biến môi trường"
        description="Quản trị trực quan toàn bộ các biến môi trường (Environment Variables) và thiết lập hoạt động của Otter."
        actions={
          <HStack gap={2}>
            <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadSettings()} />
            <Button
              label="Lưu thay đổi"
              size="sm"
              variant="primary"
              isLoading={busy === "save-settings"}
              onClick={() => void handleSaveAll()}
            />
          </HStack>
        }
      />

      <Banner
        status="info"
        title="Đồng bộ tự động & Lưu trữ bền vững"
        description="Mọi thay đổi trên Dashboard được lưu tự động vào ~/.otter/settings.json và có hiệu lực ngay lập tức với các tiến trình chạy ngầm mà không cần khởi động lại máy."
      />

      <Grid columns={{ minWidth: 320, max: 2 }} gap={5} align="start">
        {/* 1. Trình duyệt & CDP */}
        <Card padding={5}>
          <VStack gap={4}>
            <HStack justify="between" align="center">
              <Heading level={2}>🌐 Trình duyệt & CDP Core</Heading>
              <Badge variant="info" label="CDP Engine" />
            </HStack>
            <Text type="supporting">
              Cấu hình các biến môi trường điều khiển Google Chrome và Chrome DevTools Protocol.
            </Text>
            <Divider />

            <VStack gap={1.5}>
              <Text weight="medium">Chế độ Engine (OTTER_BROWSER_ENGINE)</Text>
              <SegmentedControl label="Engine" value={browserEngine} onChange={(v) => setBrowserEngine(v as any)}>
                <SegmentedControlItem value="cdp" label="CDP (Khuyên dùng)" />
                <SegmentedControlItem value="auto" label="Auto" />
                <SegmentedControlItem value="extension" label="Extension" />
              </SegmentedControl>
            </VStack>

            <HStack justify="between" align="center" gap={3}>
              <VStack gap={0.5}>
                <Text weight="medium">Chạy ngầm Chrome (OTTER_CDP_HEADLESS)</Text>
                <Text type="supporting">Không tự bung cửa sổ Chrome lên màn hình khi AI thực thi tác vụ.</Text>
              </VStack>
              <Switch
                label="Headless"
                isLabelHidden
                value={cdpHeadless}
                onChange={setCdpHeadless}
              />
            </HStack>

            <HStack justify="between" align="center" gap={3}>
              <VStack gap={0.5}>
                <Text weight="medium">Thanh HUD & Viền xanh (OTTER_CDP_HUD)</Text>
                <Text type="supporting">Hiển thị thanh badge "Otter CDP Core · Đang điều khiển" trên tab web.</Text>
              </VStack>
              <Switch
                label="HUD"
                isLabelHidden
                value={cdpHud}
                onChange={setCdpHud}
              />
            </HStack>

            <VStack gap={1}>
              <Text weight="medium">Cổng CDP (OTTER_CDP_PORT)</Text>
              <TextInput
                label="CDP Port"
                isLabelHidden
                value={cdpPort}
                onChange={setCdpPort}
                placeholder="9222"
              />
            </VStack>

            <VStack gap={1}>
              <Text weight="medium">Đường dẫn trình duyệt (OTTER_BROWSER_PATH)</Text>
              <TextInput
                label="Browser Path"
                isLabelHidden
                value={browserPath}
                onChange={setBrowserPath}
                placeholder="Để trống để tự động quét Chrome mặc định"
              />
            </VStack>

            <VStack gap={1}>
              <Text weight="medium">Thư mục User Data Profile (OTTER_CHROME_USER_DATA_DIR)</Text>
              <TextInput
                label="User Data Dir"
                isLabelHidden
                value={userDataDir}
                onChange={setUserDataDir}
                placeholder="Để trống để dùng ~/.otter/cdp-profile"
              />
            </VStack>
          </VStack>
        </Card>

        {/* 2. Bảo mật & Mạng */}
        <VStack gap={5}>
          <Card padding={5}>
            <VStack gap={4}>
              <HStack justify="between" align="center">
                <Heading level={2}>🛡️ Bảo mật & Quyền hạn</Heading>
                <Badge variant={fullAccess ? "warning" : "success"} label={fullAccess ? "Full Access" : "Sandbox"} />
              </HStack>
              <Text type="supporting">
                Kiểm soát phạm vi truy cập hệ thống tập tin và lệnh dòng lệnh của AI Agent.
              </Text>
              <Divider />

              <HStack justify="between" align="center" gap={3}>
                <VStack gap={0.5}>
                  <Text weight="medium">Chế độ Full Access (OTTER_FULL_ACCESS)</Text>
                  <Text type="supporting">Cho phép AI đọc/ghi toàn bộ ổ đĩa và chạy lệnh không qua xác nhận.</Text>
                </VStack>
                <Switch
                  label="Full Access"
                  isLabelHidden
                  value={fullAccess}
                  onChange={setFullAccessState}
                />
              </HStack>

              <HStack justify="between" align="center" gap={3}>
                <VStack gap={0.5}>
                  <Text weight="medium">Khóa thư mục nghiêm ngặt (OTTER_STRICT_WORKSPACE)</Text>
                  <Text type="supporting">Chỉ cho phép AI thao tác trong workspace hiện tại.</Text>
                </VStack>
                <Switch
                  label="Strict Workspace"
                  isLabelHidden
                  value={strictWorkspace}
                  onChange={setStrictWorkspace}
                />
              </HStack>

              <VStack gap={1}>
                <Text weight="medium">Khóa API xác thực (OTTER_API_KEY)</Text>
                <TextInput
                  label="API Key"
                  isLabelHidden
                  value={apiKey}
                  onChange={setApiKey}
                  placeholder="Để trống nếu chỉ truy cập mạng nội bộ localhost/LAN"
                />
              </VStack>
            </VStack>
          </Card>

          <Card padding={5}>
            <VStack gap={4}>
              <HStack justify="between" align="center">
                <Heading level={2}>🔌 Mạng & Công cụ liên kết</Heading>
              </HStack>
              <Divider />

              <HStack justify="between" align="center" gap={3}>
                <VStack gap={0.5}>
                  <Text weight="medium">Tự động kết nối Cloudflare Tunnel</Text>
                  <Text type="supporting">Mở cổng HTTPS công khai để ChatGPT Web và Mobile kết nối từ xa.</Text>
                </VStack>
                <Switch
                  label="Auto Tunnel"
                  isLabelHidden
                  value={autoTunnel}
                  onChange={setAutoTunnel}
                />
              </HStack>

              <VStack gap={1}>
                <Text weight="medium">Cổng GPM Login Local API (OTTER_GPM_PORT)</Text>
                <TextInput
                  label="GPM Port"
                  isLabelHidden
                  value={gpmApiPort}
                  onChange={setGpmApiPort}
                  placeholder="9495"
                />
              </VStack>

              <VStack gap={1}>
                <Text weight="medium">Đường dẫn Antigravity IDE (ANTIGRAVITY_BIN)</Text>
                <TextInput
                  label="Antigravity Path"
                  isLabelHidden
                  value={antigravityBin}
                  onChange={setAntigravityBin}
                  placeholder="Đường dẫn file .exe / binary của Antigravity"
                />
              </VStack>
            </VStack>
          </Card>
        </VStack>
      </Grid>
    </VStack>
  );
}

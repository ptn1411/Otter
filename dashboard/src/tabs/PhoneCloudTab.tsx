import { useCallback, useEffect, useRef, useState } from "react";
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
import { Switch } from "@astryxdesign/core/Switch";
import { Selector } from "@astryxdesign/core/Selector";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  apiDelete,
  apiGet,
  apiPost,
  copyText,
  fmtDate,
  type HealthInfo,
  type PhoneDeviceAdminItem,
  type PhoneRelayHealth,
  type TunnelInfo,
} from "../api";
import {
  PhoneCloudBrowserClient,
  type PhoneStreamStats,
  type PhoneUiNode,
} from "../lib/phonecloud-client";

interface Props {
  health: HealthInfo | null;
  tunnel: TunnelInfo | null;
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
}

const QUALITY_OPTIONS = [
  { value: "360", label: "360p (Tiết kiệm 4G)" },
  { value: "480", label: "480p (Mượt nhẹ)" },
  { value: "720", label: "720p HD (Chuẩn)" },
  { value: "1080", label: "1080p Full HD" },
];

const FPS_OPTIONS = [
  { value: "15", label: "15 FPS" },
  { value: "24", label: "24 FPS" },
  { value: "30", label: "30 FPS" },
];

const DEFAULT_SCRIPT = `key HOME
wait 400
find //*[@clickable="true"]
shot`;

function buildXpathForNode(el: PhoneUiNode): string {
  const clean = (s: string) => s.replace(/["']/g, "");
  if (el.text) return `//*[@text="${clean(el.text)}"]`;
  if (el.resourceId) return `//*[@resource-id="${clean(el.resourceId)}"]`;
  if (el.contentDesc) return `//*[@content-desc="${clean(el.contentDesc)}"]`;
  if (el.className) return `//${el.className}`;
  return "//*";
}

export default function PhoneCloudTab({ health, tunnel, busy, act }: Props) {
  const [relayHealth, setRelayHealth] = useState<PhoneRelayHealth | null>(null);
  const [devices, setDevices] = useState<PhoneDeviceAdminItem[]>([]);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [revealPass, setRevealPass] = useState<Record<string, boolean>>({});
  const [editingName, setEditingName] = useState<Record<string, string>>({});

  // Live Studio State
  const [activeDevice, setActiveDevice] = useState<PhoneDeviceAdminItem | null>(null);
  const [streamConnected, setStreamConnected] = useState(false);
  const [landscapeView, setLandscapeView] = useState(false);
  const [quality, setQuality] = useState("720");
  const [fps, setFps] = useState("30");
  const [liveStats, setLiveStats] = useState<PhoneStreamStats | null>(null);

  // Controls & Inspector
  const [quickText, setQuickText] = useState("");
  const [xpathInput, setXpathInput] = useState("");
  const [pkgInput, setPkgInput] = useState("com.android.chrome");
  const [clipInput, setClipInput] = useState("");
  const [uiNodes, setUiNodes] = useState<PhoneUiNode[]>([]);
  const [shotDataUrl, setShotDataUrl] = useState<string | null>(null);
  const [macroScript, setMacroScript] = useState(DEFAULT_SCRIPT);
  const [macroRunning, setMacroRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<PhoneCloudBrowserClient | null>(null);
  const stopMacroRef = useRef(false);

  const appendLog = useCallback((line: string) => {
    const t = new Date().toLocaleTimeString("vi-VN");
    setLogs((prev) => [...prev.slice(-120), `[${t}] ${line}`]);
  }, []);

  const loadDevices = useCallback(async () => {
    const res = await apiGet<{ ok: boolean; health: PhoneRelayHealth; devices: PhoneDeviceAdminItem[] }>(
      "/api/phone-cloud/devices"
    ).catch(() => null);
    if (res?.ok) {
      setRelayHealth(res.health);
      setDevices(res.devices || []);
    }
  }, []);

  useEffect(() => {
    const boot = setTimeout(() => void loadDevices(), 0);
    const id = setInterval(() => {
      if (!document.hidden) void loadDevices();
    }, 6000);
    return () => {
      clearTimeout(boot);
      clearInterval(id);
    };
  }, [loadDevices]);

  // Kết nối hoặc đóng WebCodecs Client khi chọn thiết bị
  const connectToDevice = useCallback(
    async (dev: PhoneDeviceAdminItem) => {
      clientRef.current?.disconnect();
      clientRef.current = null;
      setActiveDevice(dev);
      setQuality(String(dev.quality || 720));
      setFps(String(dev.fps || 30));
      setStreamConnected(false);
      setUiNodes([]);
      setShotDataUrl(null);

      // Chờ canvas mount vào DOM ở tick tiếp theo
      await new Promise((r) => setTimeout(r, 20));
      if (!canvasRef.current) return;

      const client = new PhoneCloudBrowserClient({
        deviceId: dev.device_id,
        password: dev.password,
        canvas: canvasRef.current,
        onConnect: (ok) => {
          setStreamConnected(ok);
          appendLog(ok ? `Đã nối luồng trực tiếp tới ${dev.name || dev.device_id}` : "Đã ngắt luồng hình");
        },
        onEvent: (ev) => {
          if (ev.type === "video_meta") {
            appendLog(`Nhận luồng H.264 ${ev.data?.width || "?"}x${ev.data?.height || "?"}`);
          } else if (ev.type === "device_status") {
            appendLog(`Trạng thái máy: ${ev.online ? "Online" : "Offline"}`);
            void loadDevices();
          } else if (ev.type === "error" && ev.msg) {
            appendLog(`Lỗi: ${ev.msg}`);
          }
        },
      });
      clientRef.current = client;
      try {
        await client.connect();
      } catch (err: any) {
        appendLog(`Không nối được luồng: ${err?.message || err}`);
      }
    },
    [appendLog, loadDevices]
  );

  const disconnectStream = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setStreamConnected(false);
    setLiveStats(null);
  }, []);

  useEffect(() => {
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!streamConnected) return;
    const id = setInterval(() => {
      if (!document.hidden && clientRef.current) {
        setLiveStats(clientRef.current.getStats());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [streamConnected]);

  const tailscaleServerUrl =
    health?.tailscaleIp && health?.port ? `http://${health.tailscaleIp}:${health.port}` : null;
  const localServerUrl = window.location.origin;
  const tunnelServerUrl = tunnel?.url || null;

  async function runMacro() {
    const client = clientRef.current;
    if (!client || !streamConnected) {
      appendLog("Cần mở kết nối tới điện thoại trước khi chạy kịch bản.");
      return;
    }
    stopMacroRef.current = false;
    setMacroRunning(true);
    try {
      const lines = macroScript.split("\n");
      for (const raw of lines) {
        if (stopMacroRef.current) {
          appendLog("Đã dừng kịch bản.");
          break;
        }
        const trimmed = raw.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const sp = trimmed.indexOf(" ");
        const cmd = (sp < 0 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
        const rest = sp < 0 ? "" : trimmed.slice(sp + 1).trim();

        if (cmd === "tap") {
          const [x, y] = rest.split(/\s+/).map(Number);
          if (Number.isFinite(x) && Number.isFinite(y)) client.tap(x!, y!);
        } else if (cmd === "swipe") {
          const [x1, y1, x2, y2, dur] = rest.split(/\s+/).map(Number);
          if ([x1, y1, x2, y2].every(Number.isFinite)) {
            client.swipe(x1!, y1!, x2!, y2!, dur || 280);
          }
        } else if (cmd === "wait") {
          await new Promise((r) => setTimeout(r, Number(rest) || 300));
        } else if (cmd === "key") {
          client.key(rest.toUpperCase());
        } else if (cmd === "text") {
          client.setText(rest);
        } else if (cmd === "find") {
          const found = await client.findElements(rest || "//*");
          appendLog(`find (${rest}): ${found.length} phần tử`);
        } else if (cmd === "click") {
          const r = await client.clickElement(rest);
          appendLog(`click (${rest}): ${JSON.stringify(r)}`);
        } else if (cmd === "app") {
          const r = await client.appCommand("start", rest);
          appendLog(`app (${rest}): ${JSON.stringify(r)}`);
        } else if (cmd === "shot") {
          const d = await client.screenshot();
          if (d?.pngBase64) {
            setShotDataUrl(`data:image/png;base64,${d.pngBase64}`);
            appendLog("Đã chụp ảnh PNG gốc từ điện thoại.");
          }
        }
      }
      appendLog("Hoàn tất kịch bản.");
    } catch (err: any) {
      appendLog(`Lỗi kịch bản: ${err?.message || err}`);
    } finally {
      setMacroRunning(false);
    }
  }

  return (
    <VStack gap={6}>
      <PageHeader
        title="PhoneCloud — Điều khiển Android từ xa"
        description="Tích hợp trực tiếp Relay H.264 WebCodecs, cây Accessibility và 20 công cụ AI MCP điều khiển điện thoại Android trên cùng cổng Otter."
        actions={
          <>
            <Badge
              variant={(relayHealth?.online ?? 0) > 0 ? "success" : "neutral"}
              label={`${relayHealth?.online ?? 0}/${relayHealth?.devices ?? 0} máy online`}
            />
            {relayHealth && relayHealth.frames > 0 && (
              <Badge
                variant="info"
                label={`${relayHealth.frames} fps · ${relayHealth.mbps} Mbps`}
              />
            )}
            <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadDevices()} />
          </>
        }
      />

      {/* Hướng dẫn ghép nối & Cấu hình nhanh */}
      <Grid columns={{ minWidth: 320, max: 2 }} gap={4} align="start">
        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Địa chỉ Server nhập vào App Android (PhoneCloud Agent)</Text>
            <Text type="supporting">
              Mở ứng dụng <strong>PhoneCloud Agent</strong> trên điện thoại Android, dán một trong các địa chỉ dưới đây rồi bấm{" "}
              <strong>Đăng ký thiết bị</strong> và <strong>Bật dịch vụ điều khiển</strong>:
            </Text>
            <List hasDividers edge="bleed">
              {tailscaleServerUrl && (
                <ListItem
                  label="Qua Tailscale VPN (Khuyên dùng)"
                  description={<span className="dash-mono">{tailscaleServerUrl}</span>}
                  endContent={
                    <Button
                      label="Sao chép"
                      size="sm"
                      variant="secondary"
                      onClick={() => void copyText(tailscaleServerUrl)}
                    />
                  }
                />
              )}
              {tunnelServerUrl && (
                <ListItem
                  label="Qua Cloudflare Quick Tunnel (4G/5G mọi nơi)"
                  description={<span className="dash-mono">{tunnelServerUrl}</span>}
                  endContent={
                    <Button
                      label="Sao chép"
                      size="sm"
                      variant="secondary"
                      onClick={() => void copyText(tunnelServerUrl)}
                    />
                  }
                />
              )}
              <ListItem
                label="Mạng nội bộ / Local"
                description={<span className="dash-mono">{localServerUrl}</span>}
                endContent={
                  <Button
                    label="Sao chép"
                    size="sm"
                    variant="secondary"
                    onClick={() => void copyText(localServerUrl)}
                  />
                }
              />
            </List>
          </VStack>
        </Card>

        <Card padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Bảo mật ghép nối & Đăng ký trước</Text>
            <Switch
              label="Cho phép điện thoại mới đăng ký qua Internet (Tunnel)"
              size="sm"
              value={relayHealth?.allowPublicRegister ?? true}
              onChange={(next) =>
                void act(
                  "pc-pub-reg",
                  async () => {
                    const st = await apiPost<PhoneRelayHealth>("/api/phone-cloud/config", {
                      allowPublicRegister: next,
                    });
                    setRelayHealth(st);
                  },
                  next ? "Đã mở đăng ký thiết bị mới." : "Đã khóa đăng ký thiết bị lạ từ Internet."
                )
              }
            />
            <HStack gap={2} align="end" wrap="wrap">
              <TextInput
                label="Tạo trước hồ sơ thiết bị (tùy chọn)"
                placeholder="VD: Samsung A71 Bán hàng"
                value={newDeviceName}
                onChange={setNewDeviceName}
              />
              <Button
                label="+ Tạo thiết bị"
                variant="primary"
                size="sm"
                isLoading={busy === "pc-create-dev"}
                onClick={() =>
                  void act(
                    "pc-create-dev",
                    async () => {
                      await apiPost("/api/phone-cloud/devices/register", {
                        name: newDeviceName.trim() || "Android Phone",
                      });
                      setNewDeviceName("");
                      await loadDevices();
                    },
                    "Đã tạo mã thiết bị mới."
                  )
                }
              />
            </HStack>
            <Text type="supporting">
              Mã nguồn Android Kotlin đi kèm sẵn tại <span className="dash-mono">tools/phone-cloud/android/</span>.
              AI trên ChatGPT / Claude / Antigravity điều khiển tự động qua nhóm 20 công cụ <span className="dash-mono">phone_*</span>.
            </Text>
          </VStack>
        </Card>
      </Grid>

      {/* Danh sách điện thoại đã ghép nối */}
      <Card padding={4}>
        <VStack gap={3}>
          <HStack justify="between" align="center" wrap="wrap">
            <Text weight="semibold">Danh sách điện thoại Android ({devices.length})</Text>
          </HStack>

          {devices.length === 0 ? (
            <EmptyState
              title="Chưa có điện thoại nào đăng ký"
              description="Nhập địa chỉ Otter Server vào app PhoneCloud Agent trên điện thoại rồi bấm Đăng ký thiết bị."
            />
          ) : (
            <List hasDividers edge="bleed">
              {devices.map((dev) => {
                const shownPass = revealPass[dev.device_id] ? dev.password : "••••••";
                const draftName = editingName[dev.device_id];
                const isEditing = draftName !== undefined;
                const isSelected = activeDevice?.device_id === dev.device_id;

                return (
                  <ListItem
                    key={dev.device_id}
                    label={dev.name || `Android #${dev.device_id}`}
                    description={
                      <VStack gap={1}>
                        <Text type="supporting">
                          ID: <strong className="dash-mono">{dev.device_id}</strong> · Mật khẩu:{" "}
                          <span className="dash-mono">{shownPass}</span> · {dev.quality}p/{dev.fps}fps
                          {dev.screenWidth > 0 ? ` · ${dev.screenWidth}×${dev.screenHeight}` : ""}
                          {dev.lastSeenAt ? ` · Hoạt động: ${fmtDate(dev.lastSeenAt)}` : ""}
                        </Text>
                        {isEditing && (
                          <HStack gap={2} align="center">
                            <TextInput
                              label="Tên thiết bị"
                              isLabelHidden
                              value={draftName}
                              onChange={(v) =>
                                setEditingName((prev) => ({ ...prev, [dev.device_id]: v }))
                              }
                            />
                            <Button
                              label="Lưu tên"
                              size="sm"
                              variant="primary"
                              onClick={() =>
                                void act(
                                  `pc-ren-${dev.device_id}`,
                                  async () => {
                                    await apiPost(`/api/phone-cloud/devices/${dev.device_id}/rename`, {
                                      name: draftName,
                                    });
                                    setEditingName((prev) => {
                                      const cp = { ...prev };
                                      delete cp[dev.device_id];
                                      return cp;
                                    });
                                    await loadDevices();
                                  },
                                  "Đã đổi tên thiết bị."
                                )
                              }
                            />
                            <Button
                              label="Hủy"
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setEditingName((prev) => {
                                  const cp = { ...prev };
                                  delete cp[dev.device_id];
                                  return cp;
                                })
                              }
                            />
                          </HStack>
                        )}
                      </VStack>
                    }
                    endContent={
                      <HStack gap={2} align="center" wrap="wrap">
                        <Badge
                          variant={dev.online ? "success" : "neutral"}
                          label={dev.online ? "Online" : "Offline"}
                        />
                        <Button
                          label={isSelected && streamConnected ? "Đang mở" : "Điều khiển"}
                          size="sm"
                          variant="primary"
                          onClick={() => void connectToDevice(dev)}
                        />
                        <Button
                          label={revealPass[dev.device_id] ? "Ẩn MK" : "Hiện MK"}
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setRevealPass((p) => ({ ...p, [dev.device_id]: !p[dev.device_id] }))
                          }
                        />
                        <Button
                          label="Đổi tên"
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setEditingName((p) => ({ ...p, [dev.device_id]: dev.name || "" }))
                          }
                        />
                        <Button
                          label="Đổi MK"
                          size="sm"
                          variant="secondary"
                          isLoading={busy === `pc-rot-${dev.device_id}`}
                          onClick={() =>
                            void act(
                              `pc-rot-${dev.device_id}`,
                              async () => {
                                await apiPost(
                                  `/api/phone-cloud/devices/${dev.device_id}/rotate-password`
                                );
                                await loadDevices();
                              },
                              "Đã cấp mật khẩu 6 số mới."
                            )
                          }
                        />
                        <Button
                          label="Xóa"
                          size="sm"
                          variant="destructive"
                          isLoading={busy === `pc-del-${dev.device_id}`}
                          onClick={() =>
                            void act(
                              `pc-del-${dev.device_id}`,
                              async () => {
                                if (isSelected) disconnectStream();
                                await apiDelete(`/api/phone-cloud/devices/${dev.device_id}`);
                                if (isSelected) setActiveDevice(null);
                                await loadDevices();
                              },
                              "Đã xóa thiết bị."
                            )
                          }
                        />
                      </HStack>
                    }
                  />
                );
              })}
            </List>
          )}
        </VStack>
      </Card>

      {/* Studio điều khiển trực tiếp WebCodecs */}
      {activeDevice && (
        <Grid columns={{ minWidth: 340, max: 2 }} gap={5} align="start">
          <Card padding={4}>
            <VStack gap={3}>
              <HStack justify="between" align="center" wrap="wrap">
                <HStack gap={2} align="center">
                  <Text weight="semibold">
                    Màn hình: {activeDevice.name || activeDevice.device_id}
                  </Text>
                  <Badge
                    variant={streamConnected ? "success" : "warning"}
                    label={streamConnected ? "Đang phát trực tiếp" : "Đã ngắt"}
                  />
                </HStack>
                <HStack gap={2}>
                  {streamConnected ? (
                    <Button label="Ngắt luồng" size="sm" variant="secondary" onClick={disconnectStream} />
                  ) : (
                    <Button
                      label="Kết nối lại"
                      size="sm"
                      variant="primary"
                      onClick={() => void connectToDevice(activeDevice)}
                    />
                  )}
                </HStack>
              </HStack>

              <Text type="supporting" className="dash-mono">
                {liveStats
                  ? `${liveStats.fps} fps · ${liveStats.bitrateMbps} Mbps · ${liveStats.width}×${liveStats.height} · hàng đợi ${liveStats.decodeQueue}`
                  : "Chờ luồng H.264 từ điện thoại (chạm trực tiếp lên màn hình bên dưới để thao tác)…"}
              </Text>

              <div ref={stageWrapRef} className="dash-phone-stage">
                <canvas
                  ref={canvasRef}
                  width={360}
                  height={640}
                  className={landscapeView ? "dash-phone-canvas is-landscape" : "dash-phone-canvas"}
                />
              </div>

              {/* Hàng phím cứng Android */}
              <HStack gap={2} wrap="wrap">
                <Button label="◀ Back" size="sm" variant="secondary" onClick={() => clientRef.current?.key("BACK")} />
                <Button label="⬤ Home" size="sm" variant="secondary" onClick={() => clientRef.current?.key("HOME")} />
                <Button label="▦ Recent" size="sm" variant="secondary" onClick={() => clientRef.current?.key("RECENTS")} />
                <Button label="🔔 Notif" size="sm" variant="secondary" onClick={() => clientRef.current?.key("NOTIFICATIONS")} />
                <Button label="⏻ Power" size="sm" variant="secondary" onClick={() => clientRef.current?.power()} />
                <Button label="↻ Keyframe" size="sm" variant="ghost" onClick={() => clientRef.current?.requestKeyFrame()} />
              </HStack>

              <HStack gap={2} wrap="wrap">
                <Button
                  label="📷 Lưu ảnh Canvas"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const url = clientRef.current?.canvasScreenshot();
                    if (!url) return;
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `phone-${activeDevice.device_id}-${Date.now()}.png`;
                    a.click();
                  }}
                />
                <Button
                  label="📸 Chụp PNG gốc"
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      const d = await clientRef.current?.screenshot();
                      if (d?.pngBase64) {
                        setShotDataUrl(`data:image/png;base64,${d.pngBase64}`);
                        appendLog("Đã chụp ảnh PNG gốc từ máy.");
                      }
                    } catch (err: any) {
                      appendLog(`Lỗi chụp ảnh: ${err?.message || err}`);
                    }
                  }}
                />
                <Button
                  label={landscapeView ? "Khung dọc" : "Khung ngang"}
                  size="sm"
                  variant="ghost"
                  onClick={() => setLandscapeView((v) => !v)}
                />
                <Button
                  label="Toàn màn hình"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const el = stageWrapRef.current;
                    if (!el) return;
                    if (document.fullscreenElement) void document.exitFullscreen();
                    else void el.requestFullscreen();
                  }}
                />
              </HStack>

              {/* Đổi chất lượng H.264 trực tiếp */}
              <Grid columns={{ minWidth: 130, max: 3 }} gap={2} align="end">
                <Selector
                  label="Độ phân giải"
                  options={QUALITY_OPTIONS}
                  value={quality}
                  onChange={setQuality}
                  presentation="adaptive"
                  width="100%"
                />
                <Selector
                  label="Tốc độ khung"
                  options={FPS_OPTIONS}
                  value={fps}
                  onChange={setFps}
                  presentation="adaptive"
                  width="100%"
                />
                <Button
                  label="Áp dụng"
                  size="sm"
                  variant="primary"
                  isLoading={busy === "pc-set-qual"}
                  onClick={() =>
                    void act(
                      "pc-set-qual",
                      async () => {
                        await apiPost(`/api/phone-cloud/devices/${activeDevice.device_id}/settings`, {
                          quality: Number(quality),
                          fps: Number(fps),
                        });
                        clientRef.current?.requestKeyFrame();
                        await loadDevices();
                      },
                      `Đã cập nhật luồng ${quality}p / ${fps}fps.`
                    )
                  }
                />
              </Grid>

              {shotDataUrl && (
                <img src={shotDataUrl} alt="Ảnh chụp gốc từ điện thoại" className="dash-img-preview" />
              )}
            </VStack>
          </Card>

          {/* Bảng công cụ Accessibility, App, Clipboard & Kịch bản */}
          <VStack gap={4}>
            <Card padding={4}>
              <VStack gap={3}>
                <Text weight="semibold">Thao tác nhanh, XPath & Ứng dụng</Text>

                <HStack gap={2} align="end">
                  <TextInput
                    label="Gõ chữ tiếng Việt vào ô đang focus"
                    placeholder="Nhập nội dung rồi nhấn Gửi chữ..."
                    value={quickText}
                    onChange={setQuickText}
                  />
                  <Button
                    label="Gửi chữ"
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      if (!quickText) return;
                      clientRef.current?.setText(quickText);
                      appendLog(`Đã gửi chữ: "${quickText}"`);
                    }}
                  />
                </HStack>

                <HStack gap={2} align="end" wrap="wrap">
                  <TextInput
                    label="Selector / XPath Android"
                    placeholder='//*[@text="OK"] hoặc //*[contains(@text,"Đăng nhập")]'
                    value={xpathInput}
                    onChange={setXpathInput}
                  />
                  <Button
                    label="Tìm"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const list = await clientRef.current?.findElements(xpathInput || "//*");
                        setUiNodes(list || []);
                        appendLog(`Tìm thấy ${list?.length || 0} phần tử.`);
                      } catch (err: any) {
                        appendLog(`Lỗi tìm phần tử: ${err?.message || err}`);
                      }
                    }}
                  />
                  <Button
                    label="Bấm"
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (!xpathInput.trim()) return;
                      try {
                        await clientRef.current?.clickElement(xpathInput.trim());
                        appendLog(`Đã bấm: ${xpathInput.trim()}`);
                      } catch (err: any) {
                        appendLog(`Lỗi bấm: ${err?.message || err}`);
                      }
                    }}
                  />
                </HStack>

                <HStack gap={2} align="end" wrap="wrap">
                  <TextInput
                    label="Quản lý App theo Package"
                    placeholder="com.android.chrome, com.zing.zalo..."
                    value={pkgInput}
                    onChange={setPkgInput}
                  />
                  <Button
                    label="Mở App"
                    size="sm"
                    variant="primary"
                    onClick={async () => {
                      if (!pkgInput.trim()) return;
                      try {
                        await clientRef.current?.appCommand("start", pkgInput.trim());
                        appendLog(`Đã mở app ${pkgInput.trim()}`);
                      } catch (err: any) {
                        appendLog(`Lỗi mở app: ${err?.message || err}`);
                      }
                    }}
                  />
                  <Button
                    label="Đóng"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!pkgInput.trim()) return;
                      try {
                        await clientRef.current?.appCommand("stop", pkgInput.trim());
                        appendLog(`Đã dừng nền ${pkgInput.trim()}`);
                      } catch (err: any) {
                        appendLog(`Lỗi đóng app: ${err?.message || err}`);
                      }
                    }}
                  />
                  <Button
                    label="TT App"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!pkgInput.trim()) return;
                      try {
                        await clientRef.current?.appCommand("openInfo", pkgInput.trim());
                      } catch {}
                    }}
                  />
                </HStack>

                <HStack gap={2} align="end" wrap="wrap">
                  <TextInput
                    label="Clipboard điện thoại"
                    placeholder="Nội dung clipboard..."
                    value={clipInput}
                    onChange={setClipInput}
                  />
                  <Button
                    label="Đọc"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const d = await clientRef.current?.clipboardGet();
                        setClipInput(d?.text || "");
                        appendLog(`Clipboard: "${d?.text || ""}"`);
                      } catch (err: any) {
                        appendLog(`Lỗi đọc clipboard: ${err?.message || err}`);
                      }
                    }}
                  />
                  <Button
                    label="Ghi"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await clientRef.current?.clipboardSet(clipInput);
                        appendLog("Đã cập nhật clipboard điện thoại.");
                      } catch (err: any) {
                        appendLog(`Lỗi ghi clipboard: ${err?.message || err}`);
                      }
                    }}
                  />
                </HStack>
              </VStack>
            </Card>

            <Card padding={4}>
              <VStack gap={3}>
                <HStack justify="between" align="center">
                  <Text weight="semibold">Cây giao diện Accessibility ({uiNodes.length})</Text>
                  <Button
                    label="Dump giao diện (//*)"
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const list = await clientRef.current?.findElements("//*");
                        setUiNodes(list || []);
                        appendLog(`Dump thành công ${list?.length || 0} phần tử.`);
                      } catch (err: any) {
                        appendLog(`Lỗi dump giao diện: ${err?.message || err}`);
                      }
                    }}
                  />
                </HStack>

                {uiNodes.length > 0 && (
                  <div className="dash-phone-uitable">
                    <table>
                      <thead>
                        <tr>
                          <th>Text / Mô tả</th>
                          <th>Lớp</th>
                          <th>Tọa độ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {uiNodes.slice(0, 80).map((el, idx) => {
                          const b = el.bounds || [0, 0, 0, 0];
                          const cx = Math.round((b[0] + b[2]) / 2);
                          const cy = Math.round((b[1] + b[3]) / 2);
                          return (
                            <tr
                              key={idx}
                              onClick={() => {
                                const xp = buildXpathForNode(el);
                                setXpathInput(xp);
                                clientRef.current?.tap(cx, cy);
                                appendLog(`Chạm (${cx},${cy}) · ${xp}`);
                              }}
                            >
                              <td>{el.text || el.contentDesc || el.resourceId || "—"}</td>
                              <td>{(el.className || "").split(".").pop() || "*"}</td>
                              <td className="dash-mono">
                                ({cx},{cy})
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </VStack>
            </Card>

            <Card padding={4}>
              <VStack gap={3}>
                <HStack justify="between" align="center">
                  <Text weight="semibold">Kịch bản tự chạy & Nhật ký</Text>
                  <HStack gap={2}>
                    <Button
                      label="Chạy kịch bản"
                      size="sm"
                      variant="primary"
                      isLoading={macroRunning}
                      onClick={() => void runMacro()}
                    />
                    {macroRunning && (
                      <Button
                        label="Dừng"
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          stopMacroRef.current = true;
                        }}
                      />
                    )}
                  </HStack>
                </HStack>
                <TextArea
                  label="Các lệnh (tap, swipe, wait, key, text, find, click, app, shot)"
                  value={macroScript}
                  onChange={setMacroScript}
                />
                <pre className="dash-phone-log">
                  {logs.length > 0 ? logs.join("\n") : "Chưa có nhật ký hoạt động."}
                </pre>
              </VStack>
            </Card>
          </VStack>
        </Grid>
      )}
    </VStack>
  );
}

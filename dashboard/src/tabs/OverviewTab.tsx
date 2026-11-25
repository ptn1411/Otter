import { useState } from "react";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Spinner } from "@astryxdesign/core/Spinner";
import { PageHeader } from "../components/PageHeader";
import {
  apiGet,
  apiPost,
  copyText,
  fmtTokens,
  fmtUptime,
  type HealthInfo,
  type ToolGroupsResponse,
  type TunnelInfo,
} from "../api";

interface Props {
  health: HealthInfo | null;
  tunnel: TunnelInfo | null;
  fullAccess: boolean | null;
  toolGroups: ToolGroupsResponse | null;
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
  onRefresh: () => void;
  onNavigate?: (section: "phone" | "office" | "tools" | "a2a") => void;
}

export default function OverviewTab({
  health,
  tunnel,
  fullAccess,
  toolGroups,
  busy,
  act,
  onRefresh,
  onNavigate,
}: Props) {
  const [doctorResult, setDoctorResult] = useState<string | null>(null);
  const tunnelOrigin = tunnel?.url ? tunnel.url.replace(/\/+$/, "") : null;
  const endpointBase = tunnelOrigin || window.location.origin;

  return (
    <VStack gap={6}>
      <PageHeader
        title="Tổng quan hệ thống"
        description="Theo dõi trạng thái Otter Daemon, đường kết nối từ xa và các điểm cuối MCP."
        actions={
          <>
            <Button
              label="Chạy Doctor"
              variant="secondary"
              size="sm"
              isLoading={busy === "doctor"}
              onClick={() =>
                act("doctor", async () => {
                  const data = await apiGet<{ ok: boolean; checks?: Array<{ name: string; ok: boolean }> }>(
                    "/api/doctor"
                  );
                  const summary = (data.checks || [])
                    .map((c) => `${c.name}: ${c.ok ? "OK" : "LỖI"}`)
                    .join(" · ");
                  setDoctorResult(
                    `Doctor ${data.ok ? "Hợp lệ" : "Cần kiểm tra"}${summary ? ` — ${summary}` : ""}`
                  );
                })
              }
            />
            <Button label="Làm mới" variant="secondary" size="sm" onClick={onRefresh} />
          </>
        }
      />

      {doctorResult && (
        <Card padding={3}>
          <Text type="supporting">
            <span className="dash-mono">{doctorResult}</span>
          </Text>
        </Card>
      )}

      {/* Compact operational status strip */}
      {!health ? (
        <HStack gap={3} align="center">
          <Spinner />
          <Text>Đang tải trạng thái daemon…</Text>
        </HStack>
      ) : (
        <Grid columns={{ minWidth: 200, max: 4 }} gap={3}>
          <Card padding={4}>
            <VStack gap={1.5}>
              <Text type="supporting">Daemon</Text>
              <HStack justify="between" align="center" gap={2}>
                <Text weight="semibold">
                  <span className="dash-mono">v{health.version}</span>
                </Text>
                <Badge variant="success" label="Online" />
              </HStack>
              <Text type="supporting">
                Cổng <span className="dash-mono">{health.port}</span> · {fmtUptime(health.uptime)}
              </Text>
            </VStack>
          </Card>

          <Card padding={4}>
            <VStack gap={1.5}>
              <Text type="supporting">MCP Tools đang bật</Text>
              <Text weight="semibold">
                <span className="dash-mono">
                  {toolGroups ? `${toolGroups.enabledTools}/${toolGroups.totalTools}` : "—"}
                </span>
              </Text>
              <Text type="supporting">
                {toolGroups ? `~${fmtTokens(toolGroups.enabledEstTokens)} token schema` : "Chưa tải"}
              </Text>
            </VStack>
          </Card>

          <Card padding={4}>
            <VStack gap={1.5}>
              <Text type="supporting">MCP Servers ngoài</Text>
              <Text weight="semibold">
                <span className="dash-mono">
                  {`${health.externalMcpServers.connected}/${health.externalMcpServers.total}`}
                </span>
              </Text>
              <Text type="supporting">Đang kết nối</Text>
            </VStack>
          </Card>

          <Card padding={4}>
            <VStack gap={1.5}>
              <Text type="supporting">Quyền tệp cục bộ</Text>
              <HStack justify="between" align="center" gap={2}>
                <Text weight="semibold">{fullAccess ? "Full Access" : "Workspace"}</Text>
                {fullAccess !== null && (
                  <Switch
                    label="Full Access"
                    value={fullAccess}
                    isLabelHidden
                    size="sm"
                    isLoading={busy === "full-access"}
                    onChange={(v) =>
                      act(
                        "full-access",
                        async () => {
                          await apiPost("/api/system/security/full-access", { enabled: v });
                        },
                        v ? "Đã bật Full Access." : "Đã tắt Full Access."
                      )
                    }
                  />
                )}
              </HStack>
              <Text type="supporting">
                {fullAccess ? "Truy cập mọi thư mục" : "Giới hạn workspace an toàn"}
              </Text>
            </VStack>
          </Card>
        </Grid>
      )}

      {/* Không gian điều hành trực quan (PhoneCloud Android & Phòng ban 3D) */}
      {health && (
        <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
          <Card padding={4}>
            <VStack gap={3}>
              <HStack justify="between" align="center" gap={2}>
                <Text weight="semibold">PhoneCloud (Android)</Text>
                <Badge
                  variant={(health.phoneCloud?.online ?? 0) > 0 ? "success" : "neutral"}
                  label={`${health.phoneCloud?.online ?? 0}/${health.phoneCloud?.devices ?? 0} máy online`}
                />
              </HStack>
              <Text type="supporting">
                Relay H.264 WebCodecs tích hợp sẵn, cây giao diện Accessibility và 20 công cụ MCP điều khiển điện thoại từ xa.
              </Text>
              {onNavigate && (
                <HStack>
                  <Button
                    label="Mở PhoneCloud Studio"
                    size="sm"
                    variant="secondary"
                    onClick={() => onNavigate("phone")}
                  />
                </HStack>
              )}
            </VStack>
          </Card>

          <Card padding={4}>
            <VStack gap={3}>
              <HStack justify="between" align="center" gap={2}>
                <Text weight="semibold">Phòng ban 3D (Command Office)</Text>
                <Badge variant="info" label="A2A Live" />
              </HStack>
              <Text type="supporting">
                Không gian 3D trực quan hóa đội ngũ AI Agent, theo dõi luồng giao nhận việc A2A và điều phối trực tiếp theo thời gian thực.
              </Text>
              {onNavigate && (
                <HStack gap={2} wrap="wrap">
                  <Button
                    label="Vào Phòng ban 3D"
                    size="sm"
                    variant="secondary"
                    onClick={() => onNavigate("office")}
                  />
                  <Button
                    label="Hộp thư A2A"
                    size="sm"
                    variant="ghost"
                    onClick={() => onNavigate("a2a")}
                  />
                </HStack>
              )}
            </VStack>
          </Card>
        </Grid>
      )}

      {/* Kết nối từ xa */}
      <VStack gap={3}>
        <Heading level={2}>Kết nối từ xa</Heading>
        <Grid columns={{ minWidth: 300, max: 2 }} gap={4}>
          <Card padding={4}>
            <VStack gap={3}>
              <HStack justify="between" align="center" gap={2}>
                <Text weight="semibold">Cloudflare Quick Tunnel</Text>
                <Badge
                  variant={tunnel?.status === "running" || tunnel?.url ? "success" : "neutral"}
                  label={tunnel?.status === "running" || tunnel?.url ? "Đang chạy" : "Chưa bật"}
                />
              </HStack>
              {tunnel?.url ? (
                <>
                  <Text type="supporting">URL công khai tạm thời (đổi sau mỗi lần khởi động lại):</Text>
                  <CodeBlock code={tunnel.url} language="plaintext" hasLanguageLabel={false} />
                  <HStack gap={2} wrap="wrap">
                    <Button
                      label="Mở Tunnel"
                      variant="primary"
                      size="sm"
                      onClick={() => window.open(`${tunnelOrigin}/dashboard`, "_blank", "noopener")}
                    />
                    <Button
                      label="Sao chép MCP"
                      size="sm"
                      onClick={() => copyText(tunnel.mcpUrl || `${tunnel.url}/mcp`)}
                    />
                    <Button
                      label="Dừng Tunnel"
                      variant="destructive"
                      size="sm"
                      isLoading={busy === "tunnel-stop"}
                      onClick={() =>
                        act(
                          "tunnel-stop",
                          async () => {
                            await apiPost("/api/system/tunnel/stop");
                          },
                          "Đã dừng Quick Tunnel."
                        )
                      }
                    />
                  </HStack>
                </>
              ) : (
                <>
                  <Text type="supporting">
                    Tạo địa chỉ HTTPS tạm thời cho ChatGPT. Mọi truy cập ngoài mạng tin cậy đều yêu cầu OAuth/token.
                  </Text>
                  <HStack>
                    <Button
                      label="Bật Quick Tunnel"
                      variant="primary"
                      size="sm"
                      isLoading={busy === "tunnel-start"}
                      onClick={() =>
                        act(
                          "tunnel-start",
                          async () => {
                            await apiPost("/api/system/tunnel/start");
                          },
                          "Quick Tunnel đã sẵn sàng."
                        )
                      }
                    />
                  </HStack>
                </>
              )}
              {tunnel?.error && <Text type="supporting">Lỗi gần nhất: {tunnel.error}</Text>}
            </VStack>
          </Card>

          <Card padding={4}>
            <VStack gap={3}>
              <HStack justify="between" align="center" gap={2}>
                <Text weight="semibold">Tailscale VPN</Text>
                <Badge
                  variant={health?.tailscaleIp ? "success" : "neutral"}
                  label={health?.tailscaleIp || "Không phát hiện"}
                />
              </HStack>
              {health?.tailscaleIp ? (
                <>
                  <Text type="supporting">Truy cập nội bộ ổn định qua mạng riêng Tailscale:</Text>
                  <CodeBlock
                    code={`http://${health.tailscaleIp}:${health.port}`}
                    language="plaintext"
                    hasLanguageLabel={false}
                  />
                  <HStack gap={2} wrap="wrap">
                    <Button
                      label="Sao chép URL"
                      size="sm"
                      onClick={() => copyText(`http://${health.tailscaleIp}:${health.port}`)}
                    />
                    <Button
                      label="Sao chép MCP"
                      size="sm"
                      onClick={() => copyText(`http://${health.tailscaleIp}:${health.port}/mcp`)}
                    />
                  </HStack>
                </>
              ) : (
                <Text type="supporting">Chưa thấy giao diện mạng Tailscale trên máy này.</Text>
              )}
            </VStack>
          </Card>
        </Grid>
      </VStack>

      {/* Điểm cuối kết nối */}
      <VStack gap={3}>
        <HStack justify="between" align="center" gap={2} wrap="wrap">
          <Heading level={2}>Điểm cuối kết nối</Heading>
          <Badge
            variant={tunnelOrigin ? "success" : "neutral"}
            label={tunnelOrigin ? "Đang dùng domain Quick Tunnel" : "Cục bộ (chưa bật Tunnel)"}
          />
        </HStack>
        <Card padding={0}>
          <List hasDividers edge="bleed">
            {[
              { label: "MCP Streamable HTTP", url: `${endpointBase}/mcp` },
              { label: "MCP SSE (Tương thích ngược)", url: `${endpointBase}/sse` },
              { label: "PhoneCloud Relay (App Android)", url: endpointBase },
              { label: "Phòng ban 3D (Toàn màn hình)", url: `${endpointBase}/dashboard/phong/` },
              { label: "OpenAPI Schema", url: `${endpointBase}/openapi.json` },
              { label: "Plan Dashboard (Standalone)", url: `${endpointBase}/plan-dashboard` },
            ].map((ep) => (
              <ListItem
                key={ep.label}
                label={ep.label}
                description={
                  <Text type="supporting">
                    <span className="dash-mono">{ep.url}</span>
                  </Text>
                }
                endContent={
                  <Button label="Sao chép" size="sm" variant="ghost" onClick={() => copyText(ep.url)} />
                }
              />
            ))}
          </List>
        </Card>
      </VStack>
    </VStack>
  );
}

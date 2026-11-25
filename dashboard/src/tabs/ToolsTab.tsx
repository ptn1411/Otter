import { useCallback, useEffect, useMemo, useState } from "react";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { List, ListItem } from "@astryxdesign/core/List";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
  apiGet,
  apiPost,
  fmtTokens,
  type ExternalMcpServer,
  type ToolGroupsResponse,
} from "../api";

interface Props {
  toolGroups: ToolGroupsResponse | null;
  busy: string | null;
  act: (key: string, fn: () => Promise<void>, okText?: string) => Promise<void>;
  onToolGroupsLoaded: (res: ToolGroupsResponse) => void;
}

export default function ToolsTab({
  toolGroups,
  busy,
  act,
  onToolGroupsLoaded,
}: Props) {
  const [search, setSearch] = useState("");
  const [servers, setServers] = useState<ExternalMcpServer[] | null>(null);

  const loadServers = useCallback(async () => {
    const srv = await apiGet<{ servers?: ExternalMcpServer[] }>("/api/mcp/servers").catch(() => null);
    if (srv) setServers(srv.servers || []);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void loadServers(), 0);
    return () => clearTimeout(t);
  }, [loadServers]);

  const filteredGroups = useMemo(() => {
    const groups = toolGroups?.groups || [];
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.id.toLowerCase().includes(q) ||
        g.nameVi.toLowerCase().includes(q) ||
        g.descVi.toLowerCase().includes(q)
    );
  }, [toolGroups, search]);

  return (
    <VStack gap={6}>
      <PageHeader
        title="Nhóm MCP Tools & Servers"
        description="Bật tắt từng nhóm công cụ để tối ưu token schema nạp vào AI theo thời gian thực."
        actions={
          toolGroups ? (
            <>
              <Badge
                variant="info"
                label={`${toolGroups.enabledTools}/${toolGroups.totalTools} tools`}
              />
              <Badge
                variant="neutral"
                label={`~${fmtTokens(toolGroups.enabledEstTokens)} token`}
              />
              <Badge variant="neutral" label={`${toolGroups.liveSessions} phiên sống`} />
            </>
          ) : undefined
        }
      />

      {!toolGroups ? (
        <Card padding={4}>
          <EmptyState
            title="Chưa tải được danh sách nhóm MCP"
            description="Kiểm tra kết nối tới daemon hoặc nhập Auth Token ở đầu trang."
          />
        </Card>
      ) : (
        <VStack gap={4}>
          <Card padding={4}>
            <HStack justify="between" align="end" wrap="wrap" gap={3}>
              <TextInput
                label="Tìm nhóm công cụ"
                placeholder="Lọc theo tên nhóm (code, browser, fb, vps...)"
                value={search}
                onChange={setSearch}
              />
              <HStack gap={2} wrap="wrap">
                {[
                  { id: "all", label: "Bật tất cả" },
                  { id: "minimal", label: "Tối thiểu" },
                  { id: "code", label: "Chỉ Code" },
                  { id: "fb", label: "Chỉ Facebook" },
                  { id: "phone", label: "Chỉ Điện thoại" },
                ].map((p) => (
                  <Button
                    key={p.id}
                    label={p.label}
                    size="sm"
                    variant="secondary"
                    isLoading={busy === `preset-${p.id}`}
                    onClick={() =>
                      act(
                        `preset-${p.id}`,
                        async () => {
                          const res = await apiPost<ToolGroupsResponse>("/api/tool-groups", {
                            preset: p.id,
                          });
                          onToolGroupsLoaded(res);
                        },
                        `Đã áp dụng preset "${p.label}".`
                      )
                    }
                  />
                ))}
              </HStack>
            </HStack>
          </Card>

          <Card padding={0}>
            <List hasDividers edge="bleed">
              {filteredGroups.map((g) => (
                <ListItem
                  key={g.id}
                  label={`${g.nameVi} (${g.id})`}
                  description={
                    <Text type="supporting">
                      {`${g.descVi} · ${g.toolCount} tools · ~${fmtTokens(g.estTokens)} token`}
                    </Text>
                  }
                  endContent={
                    <Switch
                      label={g.nameVi}
                      value={g.enabled}
                      isLabelHidden
                      isLoading={busy === `group-${g.id}`}
                      onChange={(v) =>
                        act(`group-${g.id}`, async () => {
                          const res = await apiPost<ToolGroupsResponse>("/api/tool-groups", {
                            group: g.id,
                            enabled: v,
                          });
                          onToolGroupsLoaded(res);
                        })
                      }
                    />
                  }
                />
              ))}
            </List>
          </Card>
        </VStack>
      )}

      {/* External MCP Servers */}
      <VStack gap={3}>
        <HStack justify="between" align="center" gap={2}>
          <Heading level={2}>MCP Servers đang kết nối</Heading>
          <Button label="Làm mới" size="sm" variant="secondary" onClick={() => void loadServers()} />
        </HStack>
        {servers === null ? (
          <Card padding={4}>
            <Text type="supporting">Đang tải danh sách MCP servers…</Text>
          </Card>
        ) : servers.length === 0 ? (
          <Card padding={4}>
            <EmptyState
              title="Chưa có MCP server ngoài nào"
              description="Thêm cấu hình server trong ~/.otter/mcp_config.json."
            />
          </Card>
        ) : (
          <Card padding={0}>
            <List hasDividers edge="bleed">
              {servers.map((s) => (
                <ListItem
                  key={s.name}
                  label={s.name}
                  description={
                    <Text type="supporting">
                      {s.url ? `URL: ${s.url}` : ""}
                      {s.error ? ` · Lỗi: ${s.error}` : ""}
                    </Text>
                  }
                  endContent={
                    <HStack gap={2} align="center">
                      <Badge variant="neutral" label={`${s.toolsCount} tools`} />
                      <Badge
                        variant={s.status === "connected" ? "success" : "error"}
                        label={s.status.toUpperCase()}
                      />
                    </HStack>
                  }
                />
              ))}
            </List>
          </Card>
        )}
      </VStack>
    </VStack>
  );
}

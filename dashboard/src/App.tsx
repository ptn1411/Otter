import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { SideNav, SideNavSection, SideNavItem } from "@astryxdesign/core/SideNav";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Avatar } from "@astryxdesign/core/Avatar";
import {
  apiGet,
  initTokenFromUrl,
  setToken,
  ApiError,
  type HealthInfo,
  type TunnelInfo,
  type ToolGroupsResponse,
  type UpdateStatus,
  type OAuthClientInfo,
} from "./api";
import { useAuth } from "./auth";
import {
  ActivityIcon,
  ClockIcon,
  CpuIcon,
  GlobeIcon,
  LayersIcon,
  MessageIcon,
  OtterMark,
  RefreshIcon,
  SettingsIcon,
  ShieldIcon,
  TerminalIcon,
  WrenchIcon,
} from "./components/Icons";
import OverviewTab from "./tabs/OverviewTab";
import SecurityAccountTab from "./tabs/SecurityAccountTab";
import SettingsTab from "./tabs/SettingsTab";
import UpdatesTab from "./tabs/UpdatesTab";
import ToolsTab from "./tabs/ToolsTab";
import CommandsTab from "./tabs/CommandsTab";
import BrowserTab from "./tabs/BrowserTab";
import GpmStudioTab from "./tabs/GpmStudioTab";
import PlansFleetTab from "./tabs/PlansFleetTab";
import ScheduledTasksTab from "./tabs/ScheduledTasksTab";
import FbSalesTab from "./tabs/FbSalesTab";
import A2aCoordinationTab from "./tabs/A2aCoordinationTab";

initTokenFromUrl();

type SectionKey =
  | "overview"
  | "security"
  | "settings"
  | "updates"
  | "tools"
  | "commands"
  | "browser"
  | "gpm"
  | "plans"
  | "tasks"
  | "fb-sales"
  | "a2a";

export default function App({
  mode,
  onToggleMode,
}: {
  mode: "dark" | "light";
  onToggleMode: () => void;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const [view, setView] = useState<SectionKey>("overview");
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [tunnel, setTunnel] = useState<TunnelInfo | null>(null);
  const [fullAccess, setFullAccess] = useState<boolean | null>(null);
  const [toolGroups, setToolGroups] = useState<ToolGroupsResponse | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [oauthClients, setOauthClients] = useState<OAuthClientInfo[] | null>(null);
  const [needToken, setNeedToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, t, fa, tg, upd, oc] = await Promise.all([
        apiGet<HealthInfo>("/health"),
        apiGet<TunnelInfo>("/api/system/tunnel").catch(() => null),
        apiGet<{ fullAccess: boolean }>("/api/system/security/full-access").catch(() => null),
        apiGet<ToolGroupsResponse>("/api/tool-groups").catch(() => null),
        apiGet<UpdateStatus>("/api/update/status").catch(() => null),
        apiGet<{ clients: OAuthClientInfo[] }>("/api/oauth/clients").catch(() => null),
      ]);
      setHealth(h);
      setTunnel(t);
      setFullAccess(fa?.fullAccess ?? null);
      setToolGroups(tg);
      setUpdate(upd);
      setOauthClients(oc?.clients ?? null);
      setNeedToken(tg === null && upd === null && oc === null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setNeedToken(true);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function act(key: string, fn: () => Promise<void>, okText?: string) {
    setBusy(key);
    setNotice(null);
    try {
      await fn();
      if (okText) setNotice({ type: "success", text: okText });
      await load();
    } catch (err) {
      setNotice({
        type: "error",
        text: err instanceof Error ? err.message : "Thao tác thất bại.",
      });
    } finally {
      setBusy(null);
    }
  }

  const topNav = (
    <TopNav
      label="Thanh điều hướng Otter Dashboard"
      heading={
        <TopNavHeading
          logo={<OtterMark />}
          heading="Otter"
          headingHref="/dashboard"
          headerEndContent={
            health ? (
              <Badge variant="success" label={`v${health.version}`} />
            ) : (
              <Badge variant="warning" label="Đang nối…" />
            )
          }
        />
      }
      endContent={
        <HStack gap={2} align="center" wrap="wrap">
          {tunnel?.url && <Badge variant="info" label="Tunnel bật" />}
          {fullAccess !== null && (
            <Badge
              variant={fullAccess ? "success" : "neutral"}
              label={fullAccess ? "Full Access" : "Workspace"}
            />
          )}
          <Button
            label={mode === "dark" ? "Sáng" : "Tối"}
            variant="ghost"
            size="sm"
            onClick={onToggleMode}
          />
          {!authLoading &&
            (user ? (
              <Button
                label={user.displayName || user.email || "Tài khoản"}
                variant="secondary"
                size="sm"
                icon={
                  <Avatar
                    src={user.photoURL || undefined}
                    name={user.displayName || user.email || "User"}
                    size="sm"
                  />
                }
                onClick={() => setView("security")}
              />
            ) : (
              <Button
                label="Đăng nhập"
                variant="primary"
                size="sm"
                onClick={() => setView("security")}
              />
            ))}
        </HStack>
      }
    />
  );

  const sideNav = (
    <SideNav
      aria-label="Danh mục quản trị Otter"
      collapsible
      resizable={{
        defaultWidth: 248,
        minWidth: 208,
        maxWidth: 320,
        autoSaveId: "otter-dash-sidenav",
      }}
    >
      <SideNavSection title="Hệ thống">
        <SideNavItem
          label="Tổng quan"
          icon={ActivityIcon}
          isSelected={view === "overview"}
          onClick={() => setView("overview")}
        />
        <SideNavItem
          label="Tài khoản & Bảo mật"
          icon={ShieldIcon}
          isSelected={view === "security"}
          endContent={
            user ? (
              <Badge variant="success" label="OK" />
            ) : oauthClients && oauthClients.length > 0 ? (
              <Badge variant="neutral" label={String(oauthClients.length)} />
            ) : undefined
          }
          onClick={() => setView("security")}
        />
        <SideNavItem
          label="Cập nhật"
          icon={RefreshIcon}
          isSelected={view === "updates"}
          endContent={
            update?.updateAvailable ? <Badge variant="success" label="Mới" /> : undefined
          }
          onClick={() => setView("updates")}
        />
        <SideNavItem
          label="Cấu hình & Env"
          icon={SettingsIcon}
          isSelected={view === "settings"}
          onClick={() => setView("settings")}
        />
      </SideNavSection>

      <SideNavSection title="Công cụ AI">
        <SideNavItem
          label="Nhóm MCP Tools"
          icon={WrenchIcon}
          isSelected={view === "tools"}
          endContent={
            toolGroups ? (
              <Badge variant="neutral" label={`${toolGroups.enabledTools}`} />
            ) : undefined
          }
          onClick={() => setView("tools")}
        />
        <SideNavItem
          label="Lệnh tùy chỉnh"
          icon={TerminalIcon}
          isSelected={view === "commands"}
          onClick={() => setView("commands")}
        />
      </SideNavSection>

      <SideNavSection title="Trình duyệt">
        <SideNavItem
          label="Trình duyệt & CDP"
          icon={GlobeIcon}
          isSelected={view === "browser"}
          onClick={() => setView("browser")}
        />
        <SideNavItem
          label="GPM Studio"
          icon={LayersIcon}
          isSelected={view === "gpm"}
          onClick={() => setView("gpm")}
        />
      </SideNavSection>

      <SideNavSection title="Tự động hóa">
        <SideNavItem
          label="Kế hoạch & Fleet"
          icon={CpuIcon}
          isSelected={view === "plans"}
          onClick={() => setView("plans")}
        />
        <SideNavItem
          label="Tác vụ hẹn giờ"
          icon={ClockIcon}
          isSelected={view === "tasks"}
          onClick={() => setView("tasks")}
        />
        <SideNavItem
          label="Kịch bản FB Sales"
          icon={MessageIcon}
          isSelected={view === "fb-sales"}
          onClick={() => setView("fb-sales")}
        />
        <SideNavItem
          label="Điều phối Bot (A2A)"
          icon={LayersIcon}
          isSelected={view === "a2a"}
          onClick={() => setView("a2a")}
        />
      </SideNavSection>
    </SideNav>
  );

  return (
    <AppShell topNav={topNav} sideNav={sideNav} contentPadding={6} height="fill">
      <div className="dash-content">
        <VStack gap={4}>
          {notice && (
            <Banner
              status={notice.type === "success" ? "success" : "error"}
              title={notice.text}
              isDismissable
              onDismiss={() => setNotice(null)}
            />
          )}

          {needToken && (
            <Banner
              status="warning"
              title="Cần Auth Token để quản lý"
              description="Truy cập từ mạng ngoài yêu cầu Auth Token (file ~/.otter/auth.token trên máy chạy daemon)."
              endContent={
                <HStack gap={2}>
                  <TextInput
                    label="Auth Token"
                    type="password"
                    value={tokenInput}
                    onChange={setTokenInput}
                    isLabelHidden
                  />
                  <Button
                    label="Lưu token"
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setToken(tokenInput.trim());
                      setTokenInput("");
                      load();
                    }}
                  />
                </HStack>
              }
            />
          )}

          {view === "overview" && (
            <OverviewTab
              health={health}
              tunnel={tunnel}
              fullAccess={fullAccess}
              toolGroups={toolGroups}
              busy={busy}
              act={act}
              onRefresh={() => void load()}
            />
          )}
          {view === "security" && (
            <SecurityAccountTab
              oauthClients={oauthClients}
              busy={busy}
              act={act}
            />
          )}
          {view === "updates" && (
            <UpdatesTab
              update={update}
              busy={busy}
              act={act}
              onUpdateLoaded={setUpdate}
            />
          )}
          {view === "settings" && (
            <SettingsTab
              busy={busy}
              act={act}
            />
          )}
          {view === "tools" && (
            <ToolsTab
              toolGroups={toolGroups}
              busy={busy}
              act={act}
              onToolGroupsLoaded={setToolGroups}
            />
          )}
          {view === "commands" && <CommandsTab busy={busy} act={act} />}
          {view === "browser" && <BrowserTab busy={busy} act={act} />}
          {view === "gpm" && <GpmStudioTab busy={busy} act={act} />}
          {view === "plans" && <PlansFleetTab busy={busy} act={act} />}
          {view === "tasks" && <ScheduledTasksTab busy={busy} act={act} />}
          {view === "fb-sales" && <FbSalesTab busy={busy} act={act} />}
          {view === "a2a" && <A2aCoordinationTab busy={busy} act={act} />}
        </VStack>
      </div>
    </AppShell>
  );
}

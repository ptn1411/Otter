import { Suspense, lazy, useCallback, useEffect, useState } from "react";
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
  BuildingIcon,
  ClockIcon,
  CpuIcon,
  GlobeIcon,
  LayersIcon,
  MessageIcon,
  OtterMark,
  RefreshIcon,
  SettingsIcon,
  ShieldIcon,
  SmartphoneIcon,
  TerminalIcon,
  WrenchIcon,
} from "./components/Icons";
import OverviewTab from "./tabs/OverviewTab";
const SecurityAccountTab = lazy(() => import("./tabs/SecurityAccountTab"));
const SettingsTab = lazy(() => import("./tabs/SettingsTab"));
const UpdatesTab = lazy(() => import("./tabs/UpdatesTab"));
const ToolsTab = lazy(() => import("./tabs/ToolsTab"));
const CommandsTab = lazy(() => import("./tabs/CommandsTab"));
const BrowserTab = lazy(() => import("./tabs/BrowserTab"));
const PhoneCloudTab = lazy(() => import("./tabs/PhoneCloudTab"));
const GpmStudioTab = lazy(() => import("./tabs/GpmStudioTab"));
const PlansFleetTab = lazy(() => import("./tabs/PlansFleetTab"));
const ScheduledTasksTab = lazy(() => import("./tabs/ScheduledTasksTab"));
const FbSalesTab = lazy(() => import("./tabs/FbSalesTab"));
const A2aCoordinationTab = lazy(() => import("./tabs/A2aCoordinationTab"));

initTokenFromUrl();

type SectionKey =
  | "overview"
  | "security"
  | "settings"
  | "updates"
  | "tools"
  | "commands"
  | "browser"
  | "phone"
  | "gpm"
  | "plans"
  | "tasks"
  | "fb-sales"
  | "a2a"
  | "office";

function initialSectionFromHash(): SectionKey {
  const h = window.location.hash.toLowerCase();
  if (h === "#phong" || h === "#office") return "office";
  if (h === "#phone" || h === "#phonecloud") return "phone";
  return "overview";
}

export default function App({
  mode,
  onToggleMode,
}: {
  mode: "dark" | "light";
  onToggleMode: () => void;
}) {
  const { user, isLoading: authLoading } = useAuth();
  const [view, setView] = useState<SectionKey>(initialSectionFromHash);
  const [officeEpoch, setOfficeEpoch] = useState(0);

  const selectView = useCallback((next: SectionKey) => {
    setView(next);
    const nextHash = next === "office" ? "#phong" : next === "phone" ? "#phone" : "";
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search + nextHash);
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.toLowerCase();
      if (h === "#phong" || h === "#office") setView("office");
      else if (h === "#phone" || h === "#phonecloud") setView("phone");
      else if (h === "#bang") setView("overview");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
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
    const boot = setTimeout(() => void load(), 0);
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      clearTimeout(boot);
      clearInterval(id);
    };
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
          {view === "office" && (
            <Button
              label="Mở toàn màn hình"
              variant="secondary"
              size="sm"
              onClick={() => window.open("/dashboard/phong/", "_blank", "noopener")}
            />
          )}
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
                onClick={() => selectView("security")}
              />
            ) : (
              <Button
                label="Đăng nhập"
                variant="primary"
                size="sm"
                onClick={() => selectView("security")}
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
          onClick={() => selectView("overview")}
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
          onClick={() => selectView("security")}
        />
        <SideNavItem
          label="Cập nhật"
          icon={RefreshIcon}
          isSelected={view === "updates"}
          endContent={
            update?.updateAvailable ? <Badge variant="success" label="Mới" /> : undefined
          }
          onClick={() => selectView("updates")}
        />
        <SideNavItem
          label="Cấu hình & Env"
          icon={SettingsIcon}
          isSelected={view === "settings"}
          onClick={() => selectView("settings")}
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
          onClick={() => selectView("tools")}
        />
        <SideNavItem
          label="Lệnh tùy chỉnh"
          icon={TerminalIcon}
          isSelected={view === "commands"}
          onClick={() => selectView("commands")}
        />
      </SideNavSection>

      <SideNavSection title="Thiết bị & Trình duyệt">
        <SideNavItem
          label="PhoneCloud (Android)"
          icon={SmartphoneIcon}
          isSelected={view === "phone"}
          endContent={
            health?.phoneCloud?.online ? (
              <Badge variant="success" label={`${health.phoneCloud.online}`} />
            ) : undefined
          }
          onClick={() => selectView("phone")}
        />
        <SideNavItem
          label="Trình duyệt & CDP"
          icon={GlobeIcon}
          isSelected={view === "browser"}
          onClick={() => selectView("browser")}
        />
        <SideNavItem
          label="GPM Studio"
          icon={LayersIcon}
          isSelected={view === "gpm"}
          onClick={() => selectView("gpm")}
        />
      </SideNavSection>

      <SideNavSection title="Tự động hóa">
        <SideNavItem
          label="Phòng ban (3D)"
          icon={BuildingIcon}
          isSelected={view === "office"}
          onClick={() => selectView("office")}
        />
        <SideNavItem
          label="Kế hoạch & Fleet"
          icon={CpuIcon}
          isSelected={view === "plans"}
          onClick={() => selectView("plans")}
        />
        <SideNavItem
          label="Tác vụ hẹn giờ"
          icon={ClockIcon}
          isSelected={view === "tasks"}
          onClick={() => selectView("tasks")}
        />
        <SideNavItem
          label="Kịch bản FB Sales"
          icon={MessageIcon}
          isSelected={view === "fb-sales"}
          onClick={() => selectView("fb-sales")}
        />
        <SideNavItem
          label="Điều phối Bot (A2A)"
          icon={LayersIcon}
          isSelected={view === "a2a"}
          onClick={() => selectView("a2a")}
        />
      </SideNavSection>
    </SideNav>
  );

  const tokenBanner = needToken ? (
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
              setOfficeEpoch((n) => n + 1);
              load();
            }}
          />
        </HStack>
      }
    />
  ) : null;

  return (
    <AppShell topNav={topNav} sideNav={sideNav} contentPadding={view === "office" ? 0 : 6} height="fill">
      {view === "office" ? (
        <div className="dash-office-wrap">
          {tokenBanner && <div className="dash-office-banner">{tokenBanner}</div>}
          <iframe
            key={officeEpoch}
            src="/dashboard/phong/index.html"
            title="Otter — Phòng ban 3D"
            className="dash-office-frame"
          />
        </div>
      ) : (
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

          {tokenBanner}

          <Suspense fallback={<div className="dash-mono">Đang tải…</div>}>
            {view === "overview" && (
              <OverviewTab
                health={health}
                tunnel={tunnel}
                fullAccess={fullAccess}
                toolGroups={toolGroups}
                busy={busy}
                act={act}
                onRefresh={() => void load()}
                onNavigate={(sec) => selectView(sec)}
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
            {view === "phone" && (
              <PhoneCloudTab health={health} tunnel={tunnel} busy={busy} act={act} />
            )}
            {view === "gpm" && <GpmStudioTab busy={busy} act={act} />}
            {view === "plans" && <PlansFleetTab busy={busy} act={act} />}
            {view === "tasks" && <ScheduledTasksTab busy={busy} act={act} />}
            {view === "fb-sales" && <FbSalesTab busy={busy} act={act} />}
            {view === "a2a" && <A2aCoordinationTab busy={busy} act={act} />}
          </Suspense>
        </VStack>
      </div>
      )}
    </AppShell>
  );
}

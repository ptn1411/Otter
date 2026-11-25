import { useEffect, useMemo, useState } from "react";
import { Section } from "@astryxdesign/core/Section";
import { Grid } from "@astryxdesign/core/Grid";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Badge } from "@astryxdesign/core/Badge";
import { Banner } from "@astryxdesign/core/Banner";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { List, ListItem } from "@astryxdesign/core/List";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { TabList, Tab } from "@astryxdesign/core/TabList";
import { Switch } from "@astryxdesign/core/Switch";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Divider } from "@astryxdesign/core/Divider";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { fetchVersions, componentLabel, type VersionRecord } from "../api";
import {
  ArrowRightIcon,
  CheckIcon,
  CpuIcon,
  GlobeIcon,
  MonitorIcon,
  ShieldIcon,
  TerminalIcon,
} from "../components/Icons";

interface Scenario {
  id: string;
  label: string;
  group: string;
  prompt: string;
  calls: Array<{ tool: string; arg: string; ms: number }>;
  result: string;
  latency: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "cdp",
    label: "Trình duyệt",
    group: "browser · CDP mặc định",
    prompt: "Mở trang báo giá, đọc toàn bộ bảng gói dịch vụ rồi lưu ra file prices.md.",
    calls: [
      { tool: "browser_open", arg: 'url="https://example.com/pricing"', ms: 42 },
      { tool: "browser_read_page", arg: "mode=structured_dom", ms: 18 },
      { tool: "write_file", arg: 'path="prices.md" (2.4 KB)', ms: 4 },
    ],
    result: "Đã lưu 3 gói dịch vụ vào prices.md qua Chrome CDP (không cần Extension).",
    latency: "64 ms",
  },
  {
    id: "code",
    label: "Mã & Test",
    group: "code · Terminal & Graph",
    prompt: "Tìm nguyên nhân lỗi test OAuth trong dự án, sửa xong chạy lại bun test.",
    calls: [
      { tool: "code_find_symbol", arg: 'symbol="handleOAuthRoutes"', ms: 11 },
      { tool: "edit_file", arg: 'path="src/daemon/routes/oauth-routes.ts"', ms: 6 },
      { tool: "execute_terminal_command", arg: '"bun test tests/oauth-security.test.ts"', ms: 312 },
    ],
    result: "9/9 bài kiểm thử bảo mật OAuth đã đạt.",
    latency: "329 ms",
  },
  {
    id: "meta",
    label: "Meta & MXH",
    group: "fb + meta · 74 tools",
    prompt: "Lọc bình luận hỏi giá mới nhất trên fanpage và soạn nháp trả lời.",
    calls: [
      { tool: "fb_read_comments", arg: 'post="latest", limit=20', ms: 184 },
      { tool: "fb_reply_save_draft", arg: "matched=6 comments", ms: 9 },
      { tool: "fb_reply_status", arg: "queue=6 ready_for_review", ms: 5 },
    ],
    result: "Đã lưu 6 bản nháp trả lời chờ bạn duyệt trước khi gửi.",
    latency: "198 ms",
  },
  {
    id: "desktop",
    label: "Desktop",
    group: "desktop · Windows / macOS",
    prompt: "Chụp cửa sổ ứng dụng kế toán đang mở và kiểm tra số tổng ở góc dưới.",
    calls: [
      { tool: "desktop_list_windows", arg: "visible=true", ms: 14 },
      { tool: "desktop_take_screenshot", arg: 'window="Accounting App"', ms: 68 },
      { tool: "cua_get_inventory", arg: "elements=42", ms: 21 },
    ],
    result: "Đã đọc giao diện cửa sổ ứng dụng và đối chiếu số liệu cục bộ.",
    latency: "103 ms",
  },
  {
    id: "phone",
    label: "Android",
    group: "phone · PhoneCloud 20 tools",
    prompt: "Mở Zalo trên điện thoại Android, đọc cây giao diện và gửi tin nhắn xác nhận.",
    calls: [
      { tool: "phone_open_app", arg: 'packageName="com.zing.zalo"', ms: 38 },
      { tool: "phone_get_ui_tree", arg: "maxResults=60", ms: 44 },
      { tool: "phone_set_text", arg: 'text="Đã xác nhận đơn hàng!"', ms: 29 },
    ],
    result: "Đã mở ứng dụng trên điện thoại Android từ xa và điền tin nhắn qua Accessibility.",
    latency: "111 ms",
  },
];

interface ToolGroup {
  id: string;
  label: string;
  count: number;
  estTokens: number;
  desc: string;
  samples: string[];
}

/** Nhóm MCP tools thật của Otter daemon (đối chiếu src/daemon/tool-groups.ts). */
const TOOL_GROUPS: ToolGroup[] = [
  {
    id: "code",
    label: "Mã nguồn & Terminal",
    count: 13,
    estTokens: 1050,
    desc: "Đọc, sửa tệp, tìm biểu tượng, kiểm tra Git và chạy lệnh terminal trực tiếp trong dự án.",
    samples: ["execute_terminal_command", "edit_file", "code_find_symbol"],
  },
  {
    id: "browser",
    label: "Trình duyệt CDP",
    count: 15,
    estTokens: 1200,
    desc: "Điều khiển Chrome qua CDP mặc định: mở trang, đọc DOM, bấm, gõ, chọn danh sách, tải tệp.",
    samples: ["browser_open", "browser_read_page", "browser_click"],
  },
  {
    id: "desktop",
    label: "Điều khiển Desktop",
    count: 6,
    estTokens: 520,
    desc: "Chụp màn hình, liệt kê cửa sổ, thao tác chuột, bàn phím và CUA trên Windows/macOS.",
    samples: ["desktop_take_screenshot", "desktop_mouse_action", "cua_execute_tool"],
  },
  {
    id: "phone",
    label: "PhoneCloud (Android)",
    count: 20,
    estTokens: 1180,
    desc: "Điều khiển điện thoại Android từ xa qua H.264 WebCodecs, cây Accessibility, chạm/vuốt/nhập chữ và mở ứng dụng.",
    samples: ["phone_get_ui_tree", "phone_click_element", "phone_open_app"],
  },
  {
    id: "agent-desktop",
    label: "Agent Desktop",
    count: 75,
    estTokens: 4200,
    desc: "Quan sát và điều khiển giao diện desktop theo cấu trúc ngữ nghĩa (snapshot, click, type, refs).",
    samples: ["adesktop_snapshot", "adesktop_click", "adesktop_status"],
  },
  {
    id: "fb",
    label: "Facebook Automation",
    count: 58,
    estTokens: 3800,
    desc: "Quản lý bài viết, nhóm, bình luận, Messenger, hàng đợi media và kịch bản phản hồi.",
    samples: ["fb_read_comments", "fb_group_schedule_post", "fb_messenger_history"],
  },
  {
    id: "meta",
    label: "Meta Unified (IG · Threads · Ads)",
    count: 16,
    estTokens: 1150,
    desc: "Kết nối Instagram, Threads và Meta Ads qua một cổng chuẩn hóa duy nhất.",
    samples: ["meta_ig_accounts", "meta_th_profile", "meta_ads_status"],
  },
  {
    id: "agents",
    label: "Điều phối đa AI",
    count: 57,
    estTokens: 3700,
    desc: "Tạo kế hoạch, vòng lặp tự động, giao việc qua hàng đợi và chạy Claude/Gemini/Codex CLI.",
    samples: ["plan_create", "loop_start", "fleet_dispatch"],
  },
  {
    id: "vps",
    label: "Quản trị VPS & SSH",
    count: 13,
    estTokens: 980,
    desc: "Thực thi SSH, truyền tệp SFTP, kiểm tra sức khỏe máy chủ, cấu hình SSL và tường lửa.",
    samples: ["vps_ssh_execute", "vps_sftp_upload", "vps_health_audit"],
  },
  {
    id: "skills",
    label: "Kỹ năng đóng gói sẵn",
    count: 14,
    estTokens: 1020,
    desc: "Cài đặt, tìm kiếm kỹ năng, dựng video Remotion, tạo giọng đọc TTS và nhạc nền.",
    samples: ["skills_install", "render_remotion_video", "generate_speech_audio"],
  },
  {
    id: "db",
    label: "Cơ sở dữ liệu",
    count: 10,
    estTokens: 780,
    desc: "Quản lý kết nối, mô tả bảng, truy vấn và xuất dữ liệu trực tiếp từ máy cục bộ.",
    samples: ["db_list_tables", "db_query", "db_export"],
  },
  {
    id: "social",
    label: "Mạng xã hội & Kho chung",
    count: 8,
    estTokens: 640,
    desc: "Kết nối bot MXH nội bộ, đồng bộ tệp làm việc chung giữa các trợ lý AI.",
    samples: ["social_bot_send", "mxh_files_tree", "mxh_files_edit"],
  },
  {
    id: "core",
    label: "Hệ thống lõi & Media",
    count: 9,
    estTokens: 700,
    desc: "Chạy lệnh hệ thống, đọc/ghi tệp cục bộ, tạo giọng nói TTS và công cụ tự cấu hình nhóm.",
    samples: ["read_file", "write_file", "tool_groups_set"],
  },
  {
    id: "gpm",
    label: "GPM Login",
    count: 6,
    estTokens: 358,
    desc: "Khởi chạy hồ sơ trình duyệt antidetect GPM Login và sinh kịch bản GPM Automate V3.",
    samples: ["gpm_start_profile", "gpm_test_xpath", "gpm_generate_script"],
  },
  {
    id: "antigravity",
    label: "Antigravity IDE",
    count: 4,
    estTokens: 414,
    desc: "Điều khiển trực tiếp Antigravity IDE qua Chrome DevTools Protocol và đọc hội thoại.",
    samples: ["agy_status", "agy_run_task", "agy_read_chat"],
  },
  {
    id: "muse",
    label: "Cầu nối Muse & Motion",
    count: 2,
    estTokens: 142,
    desc: "Phối hợp tác nhân đối tác Muse AI và tra cứu tài nguyên chuyển động Motion.",
    samples: ["ask_muse_agent", "motion_read_doc"],
  },
];

const TOTAL_TOOLS = TOOL_GROUPS.reduce((sum, g) => sum + g.count, 0);
const TOTAL_GROUPS = 18; // Đồng bộ với src/daemon/tool-groups.ts

const INSTALL_COMMANDS: Record<string, { label: string; code: string; language: string }> = {
  windows: {
    label: "Windows (PowerShell)",
    code: "irm https://otter.gpt.io.vn/setup.ps1 | iex",
    language: "powershell",
  },
  macos: {
    label: "macOS",
    code: "curl -fsSL https://otter.gpt.io.vn/setup.sh | bash",
    language: "bash",
  },
  linux: {
    label: "Linux",
    code: "curl -fsSL https://otter.gpt.io.vn/setup.sh | bash",
    language: "bash",
  },
};

const COMPARE_ROWS = [
  {
    task: "Duyệt web và trích xuất dữ liệu",
    desc: "Thủ công: mở từng tab rồi chép dán. Với Otter: nói một câu, ChatGPT mở Chrome qua CDP, đọc DOM và lưu kết quả.",
  },
  {
    task: "Sửa mã nguồn và chạy kiểm thử",
    desc: "Thủ công: chép qua lại giữa ChatGPT và editor. Với Otter: AI đọc kho mã, sửa đúng chỗ và chạy bộ test ngay trên máy.",
  },
  {
    task: "Vận hành Facebook, IG, Threads, Ads",
    desc: "Thủ công: chuyển qua lại nhiều công cụ rời rạc. Với Otter: 74 công cụ Facebook & Meta gom chung một cổng MCP.",
  },
  {
    task: "Tác vụ lặp lại hằng ngày",
    desc: "Thủ công: giải thích lại quy trình từ đầu. Với Otter: đóng gói thành kỹ năng hoặc bật sẵn nhóm công cụ trong Dashboard.",
  },
];

const FAQS: Array<{ q: string; a: string }> = [
  {
    q: "Otter có miễn phí thật không?",
    a: "Có. Otter phát hành theo giấy phép mã nguồn mở MIT, chạy cục bộ trên máy bạn ở cổng 1993 và không yêu cầu mua khóa bản quyền. Bạn chỉ cần tài khoản ChatGPT hoặc AI hỗ trợ MCP của chính mình.",
  },
  {
    q: "Dữ liệu trên máy tôi có bị gửi ra máy chủ trung gian không?",
    a: "Không. Daemon Otter chạy trực tiếp trên máy bạn. AI chỉ gọi được các nhóm công cụ bạn đang bật, và mọi kết nối từ xa đều được khóa bằng OAuth 2.1 riêng từng client kèm Auth Token cục bộ.",
  },
  {
    q: "Tôi có bắt buộc phải cài tiện ích Chrome không?",
    a: "Không bắt buộc. Otter mặc định điều khiển trình duyệt qua Chrome DevTools Protocol (CDP) và tự nạp sẵn lõi Page-Agent vào mọi tab. Tiện ích Chrome chỉ là tùy chọn phụ nếu bạn muốn thanh HUD nổi ngay trên trang ChatGPT.",
  },
  {
    q: "Làm sao cho Otter điều khiển Chrome mặc định đang đăng nhập sẵn Facebook/ChatGPT?",
    a: "Từ Chrome 144+, bạn chỉ cần mở tab mới vào địa chỉ chrome://inspect/#remote-debugging rồi bật ON mục 'Allow remote debugging for this browser'. Khi Otter kết nối lần đầu, bấm Allow 1 lần duy nhất — Otter tự đọc DevToolsActivePort, giữ 1 phiên WebSocket bền vững và dùng ngay các tài khoản bạn đã đăng nhập mà không cần cài Extension.",
  },
  {
    q: "Otter kết nối được với những AI nào?",
    a: "Mọi ứng dụng hỗ trợ chuẩn Model Context Protocol (MCP) đều kết nối được: ChatGPT, Claude, Gemini, Cursor, VS Code và các tác nhân tự động khác.",
  },
  {
    q: "Làm sao cập nhật khi có phiên bản mới?",
    a: "Daemon tự kiểm tra bản phát hành mới kèm xác minh SHA-256 trong Dashboard. Bạn cũng có thể theo dõi toàn bộ nhật ký thay đổi tại mục Cập nhật trên trang này.",
  },
];

function LatestVersionBanner() {
  const [latest, setLatest] = useState<VersionRecord | null>(null);

  useEffect(() => {
    let alive = true;
    fetchVersions()
      .then((v) => {
        if (alive && v.length > 0) setLatest(v[0]);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!latest) return null;
  return (
    <Section variant="muted" paddingBlock={4} paddingInline={6} dividers={["bottom"]}>
      <div className="otter-wrap">
        <Banner
          status="info"
          title={`Bản mới: ${componentLabel(latest.component)} ${latest.version}`}
          description={<Text type="supporting">Lấy trực tiếp từ máy chủ phát hành Otter — xem chi tiết thay đổi tại mục Cập nhật.</Text>}
          endContent={
            <Button
              label="Xem cập nhật"
              variant="secondary"
              size="sm"
              onClick={() => (window.location.hash = "#/updates")}
            />
          }
        />
      </div>
    </Section>
  );
}

export default function Home() {
  const [scenarioId, setScenarioId] = useState<string>(SCENARIOS[0].id);
  const [search, setSearch] = useState("");
  const [enabledGroups, setEnabledGroups] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, true]))
  );
  const [os, setOs] = useState<string>("windows");

  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  const install = INSTALL_COMMANDS[os];

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TOOL_GROUPS;
    return TOOL_GROUPS.filter(
      (g) =>
        g.id.includes(q) ||
        g.label.toLowerCase().includes(q) ||
        g.desc.toLowerCase().includes(q) ||
        g.samples.some((s) => s.toLowerCase().includes(q))
    );
  }, [search]);

  const budget = useMemo(() => {
    let tools = 0;
    let tokens = 0;
    for (const g of TOOL_GROUPS) {
      if (enabledGroups[g.id]) {
        tools += g.count;
        tokens += g.estTokens;
      }
    }
    return { tools, tokens };
  }, [enabledGroups]);

  function applyPreset(preset: "all" | "code" | "fb" | "phone" | "minimal") {
    const keep: Record<string, Set<string>> = {
      all: new Set(TOOL_GROUPS.map((g) => g.id)),
      code: new Set(["core", "code", "agents", "skills"]),
      fb: new Set(["core", "browser", "fb", "meta"]),
      phone: new Set(["core", "phone", "browser"]),
      minimal: new Set(["core", "browser"]),
    };
    const set = keep[preset];
    setEnabledGroups(Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, set.has(g.id)])));
  }

  return (
    <VStack gap={0}>
      {/* ── Screen 1: Hero (Split Architectural Layout + Live Interactive MCP Console) ── */}
      <div className="otter-hero-shell">
        <Section variant="transparent" paddingBlock={10} paddingInline={6} dividers={["bottom"]}>
          <div className="otter-wrap">
            <Grid columns={{ minWidth: 320, max: 2 }} gap={8} align="center">
              <VStack gap={5}>
                <Heading level={1} type="display-2">
                  ChatGPT điều khiển máy tính của bạn.
                </Heading>
                <p className="otter-lead">
                  Otter chạy cục bộ ở cổng <span className="otter-mono">1993</span> và nối ChatGPT
                  trực tiếp với Chrome (CDP), điện thoại Android (PhoneCloud), terminal, mã nguồn và desktop qua giao thức MCP. Bạn
                  ra lệnh bằng tiếng Việt, Otter thực thi ngay trên máy bạn.
                </p>
                <HStack gap={3} wrap="wrap">
                  <Button
                    label="Cài đặt bằng 1 lệnh"
                    variant="primary"
                    size="lg"
                    endContent={<ArrowRightIcon size={16} />}
                    onClick={() => document.getElementById("cai-dat")?.scrollIntoView({ behavior: "smooth" })}
                  />
                  <Button
                    label={`Xem ${TOTAL_TOOLS} công cụ`}
                    variant="secondary"
                    size="lg"
                    onClick={() => document.getElementById("tinh-nang")?.scrollIntoView({ behavior: "smooth" })}
                  />
                </HStack>
                <Divider />
                <VStack gap={2}>
                  <HStack gap={2} align="center">
                    <CheckIcon size={15} />
                    <Text type="supporting">Miễn phí · Mã nguồn mở MIT · Không cần khóa bản quyền</Text>
                  </HStack>
                  <HStack gap={2} align="center">
                    <CheckIcon size={15} />
                    <Text type="supporting">Điều khiển Chrome trực tiếp qua Native CDP (Không cần Extension)</Text>
                  </HStack>
                  <HStack gap={2} align="center">
                    <CheckIcon size={15} />
                    <Text type="supporting">Bảo mật OAuth 2.1 riêng từng AI, thu hồi ngay trong Dashboard</Text>
                  </HStack>
                </VStack>
              </VStack>

              {/* Real Interactive Otter MCP Console */}
              <Card padding={0}>
                <VStack gap={0}>
                  <HStack padding={4} gap={3} justify="between" align="center" wrap="wrap">
                    <HStack gap={2} align="center">
                      <TerminalIcon size={16} />
                      <Text weight="semibold">
                        <span className="otter-mono">otter-daemon · localhost:1993</span>
                      </Text>
                    </HStack>
                    <HStack gap={2} align="center">
                      <Badge variant="success" label={`MCP ${__OTTER_VERSION__}`} />
                      <Badge variant="neutral" label={`${TOTAL_TOOLS} tools`} />
                    </HStack>
                  </HStack>

                  <Divider />

                  <TabList
                    value={scenario.id}
                    onChange={setScenarioId}
                    size="sm"
                    hasDivider
                    role="tablist"
                  >
                    {SCENARIOS.map((s) => (
                      <Tab key={s.id} value={s.id} label={s.label} panelId={`panel-${s.id}`} />
                    ))}
                  </TabList>

                  <VStack gap={4} padding={4} id={`panel-${scenario.id}`} role="tabpanel">
                    <Section variant="muted" padding={3}>
                      <VStack gap={1}>
                        <Text type="supporting" weight="semibold">
                          Lệnh tiếng Việt trong ChatGPT
                        </Text>
                        <Text>{scenario.prompt}</Text>
                      </VStack>
                    </Section>

                    <List hasDividers edge="bleed">
                      {scenario.calls.map((c) => (
                        <ListItem
                          key={`${scenario.id}-${c.tool}`}
                          label={c.tool}
                          description={<Text type="supporting"><span className="otter-mono">{c.arg}</span></Text>}
                          endContent={<Badge variant="neutral" label={`${c.ms} ms`} />}
                        />
                      ))}
                    </List>

                    <Banner
                      status="success"
                      title={scenario.result}
                      endContent={<Badge variant="success" label={scenario.latency} />}
                    />
                  </VStack>

                  <Divider />
                  <HStack padding={3} justify="between" wrap="wrap" gap={2}>
                    <Text type="supporting"><span className="otter-mono">{scenario.group}</span></Text>
                    <Text type="supporting"><span className="otter-mono">{TOTAL_GROUPS} nhóm công cụ</span></Text>
                  </HStack>
                </VStack>
              </Card>
            </Grid>
          </div>
        </Section>
      </div>

      <LatestVersionBanner />

      {/* ── Screen 2: Kiến trúc & 3 bước vận hành ──────────────────────── */}
      <Section variant="muted" paddingBlock={10} paddingInline={6} dividers={["bottom"]}>
        <div className="otter-wrap">
          <VStack gap={6}>
            <VStack gap={2} maxWidth={680}>
              <Heading level={2}>Ba bước nối AI thẳng vào máy của bạn</Heading>
              <Text type="supporting">
                Không đi qua máy chủ lưu dữ liệu bên thứ ba. Otter mở cầu nối MCP trực tiếp trên
                thiết bị, xác thực theo từng phiên và tự chọn engine phù hợp.
              </Text>
            </VStack>

            {/* Architecture Hub-and-Lanes Card */}
            <Card padding={5}>
              <Grid columns={{ minWidth: 240, max: 3 }} gap={5} align="stretch">
                <Section variant="muted" padding={4} height="100%">
                  <VStack gap={3}>
                    <HStack justify="between" align="center" gap={2}>
                      <HStack gap={2} align="center">
                        <CpuIcon size={18} />
                        <Text weight="semibold">1 · Trợ lý AI</Text>
                      </HStack>
                      <Badge variant="neutral" label="MCP Client" />
                    </HStack>
                    <Text type="supporting">
                      ChatGPT, Claude, Cursor, Gemini hoặc VS Code gửi yêu cầu qua chuẩn MCP.
                    </Text>
                    <svg width="100%" height="10" viewBox="0 0 220 10" fill="none" aria-hidden="true">
                      <line x1="0" y1="5" x2="220" y2="5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
                      <line x1="0" y1="5" x2="220" y2="5" stroke="var(--color-accent)" strokeWidth="2" className="otter-wire-pulse" />
                    </svg>
                    <Text type="supporting"><span className="otter-mono">SSE / HTTP · OAuth 2.1</span></Text>
                  </VStack>
                </Section>

                <Section variant="muted" padding={4} height="100%">
                  <VStack gap={3}>
                    <HStack justify="between" align="center" gap={2}>
                      <HStack gap={2} align="center">
                        <ShieldIcon size={18} />
                        <Text weight="semibold">2 · Otter Daemon</Text>
                      </HStack>
                      <Badge variant="success" label=":1993" />
                    </HStack>
                    <Text type="supporting">
                      Xác thực token riêng từng client, kiểm soát {TOTAL_GROUPS} nhóm công cụ, Phòng ban 3D A2A và tự cập nhật SHA-256.
                    </Text>
                    <svg width="100%" height="10" viewBox="0 0 220 10" fill="none" aria-hidden="true">
                      <line x1="0" y1="5" x2="220" y2="5" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1.5" />
                      <line x1="0" y1="5" x2="220" y2="5" stroke="var(--color-accent)" strokeWidth="2" className="otter-wire-pulse" />
                    </svg>
                    <Text type="supporting"><span className="otter-mono">Dashboard nhúng sẵn trong binary</span></Text>
                  </VStack>
                </Section>

                <Section variant="muted" padding={4} height="100%">
                  <VStack gap={3}>
                    <HStack justify="between" align="center" gap={2}>
                      <Text weight="semibold">3 · Tài nguyên máy bạn</Text>
                      <Badge variant="neutral" label="Local" />
                    </HStack>
                    <VStack gap={2}>
                      <HStack gap={2} align="center">
                        <GlobeIcon size={15} />
                        <Text type="supporting">Chrome CDP (tự động hóa web)</Text>
                      </HStack>
                      <HStack gap={2} align="center">
                        <TerminalIcon size={15} />
                        <Text type="supporting">Terminal, mã nguồn & SQLite</Text>
                      </HStack>
                      <HStack gap={2} align="center">
                        <MonitorIcon size={15} />
                        <Text type="supporting">Desktop, PhoneCloud Android & Meta CLI</Text>
                      </HStack>
                    </VStack>
                  </VStack>
                </Section>
              </Grid>
            </Card>

            <Grid columns={{ minWidth: 240, max: 3 }} gap={6}>
              <VStack gap={2}>
                <Divider />
                <Text weight="semibold"><span className="otter-mono">01</span> · Cài Otter bằng một lệnh</Text>
                <Text type="supporting">
                  Một tệp thực thi duy nhất chạy nền ở cổng 1993, kèm sẵn giao diện Dashboard quản
                  trị nhúng trực tiếp bên trong.
                </Text>
              </VStack>
              <VStack gap={2}>
                <Divider />
                <Text weight="semibold"><span className="otter-mono">02</span> · Kết nối ChatGPT qua MCP</Text>
                <Text type="supporting">
                  Thêm địa chỉ MCP của Otter vào ChatGPT, xác nhận bằng Auth Token cục bộ. Thu hồi
                  quyền từng AI bất cứ lúc nào.
                </Text>
              </VStack>
              <VStack gap={2}>
                <Divider />
                <Text weight="semibold"><span className="otter-mono">03</span> · Bật đúng nhóm việc cần dùng</Text>
                <Text type="supporting">
                  Chỉ nạp các nhóm công cụ phù hợp tác vụ để giữ ngữ cảnh gọn nhẹ, phản hồi nhanh
                  và tránh AI gọi nhầm công cụ.
                </Text>
              </VStack>
            </Grid>
          </VStack>
        </div>
      </Section>

      {/* ── Screen 3: Interactive 229 MCP Tools Explorer ───────────────── */}
      <Section paddingBlock={10} paddingInline={6} dividers={["bottom"]}>
        <div className="otter-wrap" id="tinh-nang">
          <VStack gap={6}>
            <VStack gap={2} maxWidth={680}>
              <Heading level={2}>{TOTAL_TOOLS} công cụ, bật tắt độc lập theo nhóm</Heading>
              <Text type="supporting">
                Thử lọc hoặc bật/tắt các nhóm bên dưới như trong Dashboard thật của Otter để xem
                ngay lượng ngữ cảnh (token) tiết kiệm được cho mỗi phiên AI.
              </Text>
            </VStack>

            <Card padding={4}>
              <VStack gap={4}>
                <Grid columns={{ minWidth: 260, max: 2 }} gap={4} align="end">
                  <TextInput
                    label="Tìm nhóm hoặc tên công cụ"
                    placeholder="Ví dụ: browser, fb, ssh, sqlite..."
                    value={search}
                    onChange={setSearch}
                  />
                  <VStack gap={2}>
                    <HStack gap={2} align="center" wrap="wrap">
                      <Text type="supporting">Đang bật:</Text>
                      <Badge variant="success" label={`${budget.tools} tools`} />
                      <Badge variant="neutral" label={`~${budget.tokens.toLocaleString("vi-VN")} token`} />
                    </HStack>
                    <HStack gap={2} wrap="wrap">
                      <Button label="Tất cả" variant="secondary" size="sm" onClick={() => applyPreset("all")} />
                      <Button label="Chỉ Code" variant="secondary" size="sm" onClick={() => applyPreset("code")} />
                      <Button label="Chỉ Facebook" variant="secondary" size="sm" onClick={() => applyPreset("fb")} />
                      <Button label="Chỉ Điện thoại" variant="secondary" size="sm" onClick={() => applyPreset("phone")} />
                      <Button label="Tối thiểu" variant="secondary" size="sm" onClick={() => applyPreset("minimal")} />
                    </HStack>
                  </VStack>
                </Grid>
              </VStack>
            </Card>

            {filteredGroups.length === 0 ? (
              <EmptyState
                title={`Không tìm thấy nhóm công cụ cho "${search}"`}
                description="Thử từ khóa khác như code, browser, fb, meta hoặc vps."
                actions={<Button label="Xóa bộ lọc" variant="secondary" onClick={() => setSearch("")} />}
              />
            ) : (
              <Grid columns={{ minWidth: 320, max: 2 }} gap={4}>
                {filteredGroups.map((g) => {
                  const on = Boolean(enabledGroups[g.id]);
                  return (
                    <div key={g.id} className={on ? undefined : "otter-dimmed"}>
                      <Card padding={4}>
                        <VStack gap={3}>
                          <HStack justify="between" align="center" gap={3}>
                            <HStack gap={2} align="center" wrap="wrap">
                              <Text weight="semibold"><span className="otter-mono">{g.id}</span></Text>
                              <Text type="supporting">{g.label}</Text>
                            </HStack>
                            <HStack gap={3} align="center">
                              <Text type="supporting">
                                <span className="otter-mono">
                                  {g.count} · ~{g.estTokens.toLocaleString("vi-VN")}t
                                </span>
                              </Text>
                              <Switch
                                label={`Bật nhóm ${g.label}`}
                                isLabelHidden
                                size="sm"
                                value={on}
                                onChange={(checked) =>
                                  setEnabledGroups((prev) => ({ ...prev, [g.id]: checked }))
                                }
                              />
                            </HStack>
                          </HStack>
                          <Text type="supporting">{g.desc}</Text>
                          <HStack gap={1.5} wrap="wrap">
                            {g.samples.map((s) => (
                              <Badge key={s} variant="neutral" label={s} />
                            ))}
                          </HStack>
                        </VStack>
                      </Card>
                    </div>
                  );
                })}
              </Grid>
            )}
          </VStack>
        </div>
      </Section>

      {/* ── Screen 4: Cài đặt trong 30 giây ────────────────────────────── */}
      <Section variant="muted" paddingBlock={10} paddingInline={6} dividers={["bottom"]}>
        <div className="otter-wrap" id="cai-dat">
          <Grid columns={{ minWidth: 320, max: 2 }} gap={8} align="start">
            <VStack gap={4}>
              <Heading level={2}>Cài đặt trong 30 giây</Heading>
              <Text type="supporting">
                Dán một dòng lệnh duy nhất để tải binary Otter đúng kiến trúc máy, khởi động dịch
                vụ nền và mở Dashboard quản lý cục bộ.
              </Text>
              <VStack gap={3}>
                <HStack gap={2} align="center">
                  <CheckIcon size={16} />
                  <Text>Tự khởi động Chrome CDP khi cần, không cần cấu hình tay.</Text>
                </HStack>
                <HStack gap={2} align="center">
                  <CheckIcon size={16} />
                  <Text>Xác minh SHA-256 tự động khi cập nhật phiên bản mới.</Text>
                </HStack>
                <HStack gap={2} align="center">
                  <CheckIcon size={16} />
                  <Text>Hỗ trợ Windows x64, macOS (Apple Silicon & Intel) và Linux x64.</Text>
                </HStack>
              </VStack>
            </VStack>

            <VStack gap={4}>
              <SegmentedControl label="Hệ điều hành" value={os} onChange={setOs}>
                <SegmentedControlItem value="windows" label="Windows" />
                <SegmentedControlItem value="macos" label="macOS" />
                <SegmentedControlItem value="linux" label="Linux" />
              </SegmentedControl>

              <CodeBlock code={install.code} language={install.language} title={install.label} />

              <Card padding={4}>
                <VStack gap={1.5}>
                  <Text type="supporting">
                    <span className="otter-mono">✓ Xác minh SHA-256 hợp lệ ({install.label})</span>
                  </Text>
                  <Text type="supporting">
                    <span className="otter-mono">✓ MCP Server: http://localhost:1993/mcp</span>
                  </Text>
                  <Text type="supporting">
                    <span className="otter-mono">✓ Dashboard: http://localhost:1993/dashboard</span>
                  </Text>
                </VStack>
              </Card>

              <Text type="supporting">
                Otter điều khiển trình duyệt trực tiếp qua Chrome DevTools Protocol (CDP), không cần cài Extension.
              </Text>
            </VStack>
          </Grid>
        </div>
      </Section>

      {/* ── Screen 5: So sánh quy trình ────────────────────────────────── */}
      <Section paddingBlock={10} paddingInline={6} dividers={["bottom"]}>
        <div className="otter-wrap">
          <VStack gap={5}>
            <VStack gap={2} maxWidth={680}>
              <Heading level={2}>Làm thủ công hay giao cho Otter?</Heading>
              <Text type="supporting">
                Loại bỏ bước sao chép qua lại giữa trình duyệt, khung chat và cửa sổ terminal.
              </Text>
            </VStack>

            <Card padding={0}>
              <List hasDividers edge="bleed">
                {COMPARE_ROWS.map((row) => (
                  <ListItem
                    key={row.task}
                    label={row.task}
                    description={<Text type="supporting">{row.desc}</Text>}
                  />
                ))}
              </List>
            </Card>
          </VStack>
        </div>
      </Section>

      {/* ── Screen 6: FAQ ──────────────────────────────────────────────── */}
      <Section variant="muted" paddingBlock={10} paddingInline={6}>
        <div className="otter-wrap-narrow">
          <VStack gap={4}>
            <Heading level={2}>Câu hỏi thường gặp</Heading>
            {FAQS.map((f, idx) => (
              <Collapsible
                key={f.q}
                trigger={<Text weight="semibold">{f.q}</Text>}
                defaultIsOpen={idx === 0}
              >
                <Text type="supporting">{f.a}</Text>
              </Collapsible>
            ))}
          </VStack>
        </div>
      </Section>
    </VStack>
  );
}

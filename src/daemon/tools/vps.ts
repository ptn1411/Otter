import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { invokeVpsSsh } from "../vps";
import { createVpsSshSession, getLatestActiveSession, sendTerminalInput } from "../terminal";

export function registerVpsTools(mcp: McpServer, onActivity?: (event: any) => void): void {
  // Tool 22: Kiểm tra kết nối SSH đến VPS (Ping / Test Handshake)
  mcp.tool(
    "vps_test_connection",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền của VPS (ví dụ: '160.250.181.51')"),
      user: z.string().optional().describe("Tên người dùng SSH (mặc định: 'root')"),
      port: z.number().optional().describe("Cổng kết nối SSH (mặc định: 22)"),
      key: z.string().optional().describe("Tên hoặc đường dẫn SSH Private Key trong ~/.ssh (ví dụ: 'vps2', 'id_ed25519')"),
      password: z.string().optional().describe("Mật khẩu SSH nếu không dùng key"),
      timeout: z.number().optional().describe("Thời gian chờ tối đa (giây, mặc định: 15)")
    },
    async (args) => {
      const res = await invokeVpsSsh("test", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `[VPS Connection Failed]: ${res.error}` }],
          isError: true
        };
      }
      const d = res.data;
      const summary = [
        `✅ Kết nối thành công đến VPS: ${d.user}@${d.host}:${d.port}`,
        `• Hostname: ${d.hostname}`,
        `• Kernel: ${d.kernel}`,
        `• Uptime: ${d.uptime}`,
        `• SSH Banner: ${d.ssh_banner}`,
        `• Độ trễ (Latency): ${d.latency_ms} ms`
      ].join("\n");

      onActivity?.({
        type: "terminal_output",
        output: `\x1b[32m[VPS Connected]\x1b[0m ${d.user}@${d.host}:${d.port} (${d.latency_ms}ms)\r\n`
      });

      return {
        content: [{ type: "text", text: summary }]
      };
    }
  );

  // Tool 23: Thực thi lệnh console trên VPS qua SSH
  mcp.tool(
    "vps_ssh_execute",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền của VPS"),
      command: z.string().describe("Lệnh bash/shell cần thực thi trên VPS (ví dụ: 'docker ps', 'df -h', 'systemctl status nginx')"),
      user: z.string().optional().describe("Tên người dùng SSH (mặc định: 'root')"),
      port: z.number().optional().describe("Cổng kết nối SSH (mặc định: 22)"),
      key: z.string().optional().describe("Tên hoặc đường dẫn SSH Private Key trong ~/.ssh (ví dụ: 'vps2')"),
      password: z.string().optional().describe("Mật khẩu SSH nếu dùng xác thực mật khẩu"),
      passphrase: z.string().optional().describe("Passphrase giải mã private key nếu có"),
      cwd: z.string().optional().describe("Thư mục làm việc trên VPS (sẽ cd vào trước khi chạy lệnh)"),
      timeout: z.number().optional().describe("Thời gian chờ tối đa (giây, mặc định: 60)")
    },
    async (args) => {
      const header = `\x1b[36m[VPS SSH] ${args.user || "root"}@${args.host}:${args.port || 22}\x1b[0m $ ${args.command}`;
      const res = await invokeVpsSsh("exec", args);

      const stdout = res.data?.stdout || "";
      const stderr = res.data?.stderr || "";
      const exitCode = res.data?.exit_code ?? (res.ok ? 0 : 1);

      onActivity?.({
        type: "terminal_output",
        output: `${header}\r\n${stdout || stderr || ""}\r\n[Exit: ${exitCode}]\r\n`
      });

      if (!res.ok && !stdout && !stderr) {
        return {
          content: [{ type: "text", text: `Lỗi kết nối hoặc thực thi SSH: ${res.error}` }],
          isError: true
        };
      }

      const outputParts = [
        `Command: ${args.command}`,
        `Exit Code: ${exitCode}`,
        stdout ? `[STDOUT]\n${stdout}` : "",
        stderr ? `[STDERR]\n${stderr}` : ""
      ].filter(Boolean).join("\n\n");

      return {
        content: [{ type: "text", text: outputParts }]
      };
    }
  );

  // Tool 24: Tải tệp hoặc thư mục từ máy lên VPS qua SFTP
  mcp.tool(
    "vps_sftp_upload",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      local: z.string().describe("Đường dẫn tệp hoặc thư mục cục bộ cần tải lên"),
      remote: z.string().describe("Đường dẫn đích trên VPS (ví dụ: '/var/www/app' hoặc '/root/config.env')"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      const res = await invokeVpsSsh("upload", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `SFTP Upload thất bại: ${res.error}` }],
          isError: true
        };
      }
      const d = res.data;
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[35m[VPS SFTP Upload]\x1b[0m ${d.local} -> ${args.user || "root"}@${args.host}:${d.remote} (${d.files_count} files, ${d.bytes_transferred} bytes)\r\n`
      });

      return {
        content: [{
          type: "text",
          text: `✅ Tải lên VPS thành công:\n• Nguồn: ${d.local}\n• Đích: ${d.remote}\n• Số tệp: ${d.files_count}\n• Dung lượng: ${d.bytes_transferred} bytes\n• Thời gian: ${d.duration_ms} ms`
        }]
      };
    }
  );

  // Tool 25: Tải tệp từ VPS về máy tính qua SFTP
  mcp.tool(
    "vps_sftp_download",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      remote: z.string().describe("Đường dẫn tệp từ xa trên VPS cần tải về"),
      local: z.string().describe("Đường dẫn lưu tệp trên máy cục bộ"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      const res = await invokeVpsSsh("download", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `SFTP Download thất bại: ${res.error}` }],
          isError: true
        };
      }
      const d = res.data;
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[35m[VPS SFTP Download]\x1b[0m ${args.user || "root"}@${args.host}:${d.remote} -> ${d.local} (${d.bytes_transferred} bytes)\r\n`
      });

      return {
        content: [{
          type: "text",
          text: `✅ Tải từ VPS về máy thành công:\n• Nguồn VPS: ${d.remote}\n• Đích máy tính: ${d.local}\n• Dung lượng: ${d.bytes_transferred} bytes\n• Thời gian: ${d.duration_ms} ms`
        }]
      };
    }
  );

  // Tool 26: Xem danh sách tệp & thư mục trên VPS qua SFTP
  mcp.tool(
    "vps_sftp_list",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      remote_dir: z.string().optional().describe("Thư mục từ xa cần xem (mặc định: '/')"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      const res = await invokeVpsSsh("list", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `SFTP List thất bại: ${res.error}` }],
          isError: true
        };
      }
      const d = res.data;
      const formatted = (d.items || []).map((it: any) => 
        `${it.is_dir ? "📁" : "📄"} [${it.permissions}] ${it.name.padEnd(30)} ${String(it.size).padStart(10)} B`
      ).join("\n");

      return {
        content: [{
          type: "text",
          text: `📂 Danh sách tệp trong ${d.remote_dir} (${d.count} mục):\n\n${formatted}`
        }]
      };
    }
  );

  // Tool 27: Mở phiên SSH tương tác bền vững (Persistent Keep-Alive Session không tắt)
  mcp.tool(
    "vps_session_open",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      user: z.string().optional().describe("Username SSH (mặc định: 'root')"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("Tên hoặc đường dẫn SSH Private Key trong ~/.ssh (ví dụ: 'vps2')"),
      password: z.string().optional().describe("Mật khẩu SSH nếu dùng xác thực mật khẩu"),
      conversationId: z.string().optional().describe("Mã hội thoại để gắn phiên Terminal")
    },
    async (args) => {
      const convId = args.conversationId || "default";
      const session = createVpsSshSession(
        convId,
        args.host,
        args.user || "root",
        args.key,
        args.port || 22,
        args.password
      );

      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS Persistent Session Initialized]\x1b[0m ${args.user || "root"}@${args.host}:${args.port || 22} (Session ID: ${session.id})\r\n`
      });

      return {
        content: [{
          type: "text",
          text: `✅ Đã mở thành công phiên SSH liên tục (Persistent Session: ${session.id}) đến ${args.user || "root"}@${args.host}:${args.port || 22}.\n\n• Phiên này được GIỮ KẾT NỐI KHÔNG TẮT (Keep-Alive).\n• Thư mục làm việc (cd), biến môi trường và tiến trình sẽ được bảo lưu giữa các lần ra lệnh.\n• Bạn và AI có thể chat và gửi lệnh tiếp nối liên tục qua 'vps_session_send' hoặc gõ trực tiếp trên Live Terminal Panel.`
        }]
      };
    }
  );

  // Tool 28: Gửi lệnh vào phiên SSH đang duy trì liên tục
  mcp.tool(
    "vps_session_send",
    {
      command: z.string().describe("Lệnh bash/shell muốn gửi vào phiên SSH đang chạy (ví dụ: 'cd /var/www', 'ls -la', 'docker-compose up -d')"),
      sessionId: z.string().optional().describe("ID của phiên Terminal (tùy chọn, nếu không truyền sẽ tự động dùng phiên đang mở gần nhất)")
    },
    async ({ command, sessionId }) => {
      let targetId = sessionId;
      if (!targetId) {
        const latest = getLatestActiveSession();
        targetId = latest?.id;
      }

      if (!targetId) {
        return {
          content: [{
            type: "text",
            text: "❌ Chưa có phiên Terminal/SSH nào đang mở. Hãy gọi 'vps_session_open' để bắt đầu phiên làm việc liên tục."
          }],
          isError: true
        };
      }

      const ok = await sendTerminalInput(targetId, command + "\r\n");
      if (!ok) {
        return {
          content: [{ type: "text", text: `Không thể gửi lệnh vào phiên [${targetId}]. Phiên có thể đã bị đóng.` }],
          isError: true
        };
      }

      return {
        content: [{
          type: "text",
          text: `Đã gửi lệnh vào phiên [${targetId}]:\n$ ${command}\n\nKết quả đang được stream trực tiếp theo thời gian thực trên Live Terminal Panel.`
        }]
      };
    }
  );

  // Tool 29: Kiểm tra toàn diện sức khỏe VPS & Đánh giá bảo mật hàng ngày (Health Audit)
  mcp.tool(
    "vps_health_audit",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      user: z.string().optional().describe("Username SSH (mặc định: 'root')"),
      port: z.number().optional().describe("Port SSH (mặc định: 22)"),
      key: z.string().optional().describe("SSH Private Key (ví dụ: 'vps2')"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS Health Audit]\x1b[0m Đang quét toàn diện tài nguyên & bảo mật trên ${args.host}...\r\n`
      });

      const res = await invokeVpsSsh("audit", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Kiểm tra sức khỏe VPS thất bại: ${res.error}` }],
          isError: true
        };
      }

      const d = res.data;
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[32m[VPS Health Score: ${d.health_score}/100]\x1b[0m RAM: ${d.memory?.usage_percent}% | Disk: ${d.disk?.usage_percent} | Failed SSH: ${d.failed_ssh_attempts_today}\r\n`
      });

      return {
        content: [{
          type: "text",
          text: d.markdown_report || JSON.stringify(d, null, 2)
        }]
      };
    }
  );

  // Tool 30: Cấu hình quy trình tự động kiểm tra sức khỏe hàng ngày (Daily Cronjob & Telegram Alerts)
  mcp.tool(
    "vps_setup_daily_cron",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      cron_time: z.string().optional().describe("Thời gian chạy hàng ngày định dạng HH:MM (mặc định: '08:00')"),
      telegram_bot_token: z.string().optional().describe("Bot Token Telegram nhận báo cáo hàng ngày (tùy chọn)"),
      telegram_chat_id: z.string().optional().describe("Chat ID Telegram nhận báo cáo (tùy chọn)"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS Cron Setup]\x1b[0m Đang thiết lập kịch bản tự động kiểm tra hàng ngày trên ${args.host}...\r\n`
      });

      const res = await invokeVpsSsh("cron", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Thiết lập Cron thất bại: ${res.error}` }],
          isError: true
        };
      }

      const d = res.data;
      return {
        content: [{
          type: "text",
          text: `✅ ${d.message}\n• Thời gian kích hoạt: ${d.cron_schedule} (Mỗi ngày)\n• File kịch bản: ${d.script_path}\n• File cấu hình Cron: ${d.cron_file}\n• File lưu lịch sử: ${d.log_file}\n• Báo cáo qua Telegram: ${d.telegram_alert_enabled ? "Đã kích hoạt" : "Chưa cấu hình"}`
        }]
      };
    }
  );

  // Tool 31: Tự động cài đặt phần mềm & stack lên VPS (Docker, Nginx, Node/Bun, Python, DB, Tools)
  mcp.tool(
    "vps_install_software",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      packages: z.array(z.enum([
        "docker", "nginx", "node", "bun", "python", "redis", "postgresql", "mysql", "tools"
      ])).describe("Danh sách các phần mềm / stack cần cài đặt: docker, nginx, node, bun, python, redis, postgresql, mysql, tools"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS Software Installer]\x1b[0m Đang tự động cài đặt: ${args.packages.join(", ")} trên ${args.host}...\r\n`
      });

      const res = await invokeVpsSsh("install", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Cài đặt phần mềm thất bại: ${res.error || res.data?.stderr}` }],
          isError: true
        };
      }

      const d = res.data;
      const summary = (d.installed_packages || []).map((p: string) => `• ✅ ${p}`).join("\n");

      return {
        content: [{
          type: "text",
          text: `🎉 Cài đặt hoàn tất trên VPS (${args.host}):\n${summary}\n\nThời gian xử lý: ${d.duration_ms} ms`
        }]
      };
    }
  );

  // Tool 32: Cài đặt chứng chỉ SSL Let's Encrypt cho Domain (Certbot + Nginx + Auto Renewal)
  mcp.tool(
    "vps_setup_ssl",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      domain: z.string().describe("Tên miền cần cấp SSL (ví dụ: 'app.example.com' hoặc 'api.mysite.com')"),
      email: z.string().optional().describe("Email nhận thông báo gia hạn từ Let's Encrypt"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS SSL Setup]\x1b[0m Đang yêu cầu chứng chỉ SSL Let's Encrypt cho ${args.domain}...\r\n`
      });

      const res = await invokeVpsSsh("ssl", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Cài đặt SSL thất bại: ${res.error}` }],
          isError: true
        };
      }

      const d = res.data;
      return {
        content: [{
          type: "text",
          text: `${d.message}\n• Domain: ${d.domain}\n• HTTPS URL: ${d.https_url}\n• Tự động gia hạn: ${d.auto_renew}`
        }]
      };
    }
  );

  // Tool 33: Cài đặt SSH Key & Tăng cường bảo mật đăng nhập máy chủ (Chống Brute-force)
  mcp.tool(
    "vps_setup_ssh_key",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      public_key: z.string().describe("Nội dung SSH Public Key (bắt đầu bằng 'ssh-ed25519' hoặc 'ssh-rsa')"),
      disable_password: z.boolean().optional().describe("Tắt đăng nhập bằng mật khẩu (chỉ cho phép đăng nhập qua SSH key, khuyến nghị true)"),
      harden_sshd: z.boolean().optional().describe("Bật cấu hình bảo mật sshd_config chuẩn (mặc định: true)"),
      new_port: z.number().optional().describe("Đổi sang cổng SSH mới an toàn hơn (ví dụ: 2222, mặc định giữ nguyên port hiện tại)"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH hiện tại (22)"),
      key: z.string().optional().describe("SSH Private Key hiện tại"),
      password: z.string().optional().describe("Mật khẩu SSH hiện tại")
    },
    async (args) => {
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS SSH Key Hardening]\x1b[0m Đang cài đặt SSH Key & thiết lập bảo mật trên ${args.host}...\r\n`
      });

      const res = await invokeVpsSsh("sshkey", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Cài đặt SSH Key thất bại: ${res.error}` }],
          isError: true
        };
      }

      const d = res.data;
      const hardeningList = (d.hardening || []).map((h: string) => `• 🔒 ${h}`).join("\n");

      return {
        content: [{
          type: "text",
          text: `${d.message}\n${hardeningList ? `\nCác biện pháp tăng cường bảo mật đã kích hoạt:\n${hardeningList}` : ""}`
        }]
      };
    }
  );

  // Tool 34: Cài đặt tường lửa UFW và Fail2ban chống DDoS, HTTP flood & Brute-force
  mcp.tool(
    "vps_setup_firewall_fail2ban",
    {
      host: z.string().describe("Địa chỉ IP hoặc tên miền VPS"),
      ssh_port: z.number().optional().describe("Cổng SSH đang sử dụng (mặc định: 22)"),
      custom_ports: z.array(z.number()).optional().describe("Các cổng khác cần mở trên tường lửa (mặc định mở 80 và 443 cho Web)"),
      ban_time_hours: z.number().optional().describe("Thời gian cấm IP tấn công (giờ, mặc định: 24 giờ)"),
      max_retry: z.number().optional().describe("Số lần thử sai tối đa trước khi khóa IP (mặc định: 3 lần)"),
      user: z.string().optional().describe("Username SSH"),
      port: z.number().optional().describe("Port SSH (22)"),
      key: z.string().optional().describe("SSH Private Key"),
      password: z.string().optional().describe("Mật khẩu SSH")
    },
    async (args) => {
      onActivity?.({
        type: "terminal_output",
        output: `\x1b[36m[VPS Firewall & Fail2ban]\x1b[0m Đang cài đặt UFW & Fail2ban chống DDoS trên ${args.host}...\r\n`
      });

      const res = await invokeVpsSsh("firewall", args);
      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Cài đặt Firewall & Fail2ban thất bại: ${res.error}` }],
          isError: true
        };
      }

      const d = res.data;
      return {
        content: [{
          type: "text",
          text: `${d.message}\n• Cổng SSH được bảo vệ: ${d.ssh_port_protected}\n• Cổng mở cho phép: ${d.allowed_ports?.join(", ")}\n• Thời gian khóa IP vi phạm: ${d.ban_duration}\n• Số lần sai tối đa: ${d.max_failed_attempts}\n\n[Trạng thái UFW & Jails]:\n${d.status_summary}`
        }]
      };
    }
  );
}

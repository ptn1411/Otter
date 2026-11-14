#!/usr/bin/env python3
"""
Otter VPS SSH & SFTP Engine (Powered by Paramiko)
Provides comprehensive SSH execution, SFTP file transfer, and remote server management.
Outputs clean structured JSON for AI and Daemon consumption.
"""

import sys
import os
import io

if sys.platform == "win32":
    if hasattr(sys.stdout, "buffer"):
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "buffer"):
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

import time
import json
import argparse
import stat
from typing import Dict, Any, Optional, List

try:
    import paramiko
except ImportError:
    print(json.dumps({
        "ok": False,
        "error": "Thư viện 'paramiko' chưa được cài đặt. Chạy: pip install paramiko"
    }, ensure_ascii=False))
    sys.exit(1)


def resolve_key_path(key_path: Optional[str]) -> Optional[str]:
    """Resolve key path handling ~ and Windows backslashes."""
    if not key_path:
        return None
    expanded = os.path.expanduser(os.path.expandvars(key_path))
    if os.path.exists(expanded):
        return os.path.abspath(expanded)
    # Thử tìm trong ~/.ssh/ nếu chỉ truyền tên key (ví dụ: 'vps2')
    ssh_dir_path = os.path.join(os.path.expanduser("~/.ssh"), key_path)
    if os.path.exists(ssh_dir_path):
        return os.path.abspath(ssh_dir_path)
    return expanded


def load_private_key(key_file: str, passphrase: Optional[str] = None) -> Optional[paramiko.PKey]:
    """Tự động nhận diện và nạp các loại SSH Private Key (Ed25519, RSA, ECDSA, PuTTY PPK)."""
    key_loaders = [
        paramiko.Ed25519Key.from_private_key_file,
        paramiko.RSAKey.from_private_key_file,
        paramiko.ECDSAKey.from_private_key_file,
        paramiko.DSSKey.from_private_key_file,
    ]

    last_error = None
    for loader in key_loaders:
        try:
            return loader(key_file, password=passphrase)
        except Exception as e:
            last_error = e

    # Thử nạp bằng PuTTY PPK format nếu paramiko hỗ trợ
    try:
        if key_file.lower().endswith(".ppk"):
            return paramiko.RSAKey.from_private_key_file(key_file, password=passphrase)
    except Exception:
        pass

    raise RuntimeError(f"Không thể đọc private key từ '{key_file}': {last_error}")


def create_ssh_client(args: Dict[str, Any]) -> paramiko.SSHClient:
    """Khởi tạo và kết nối SSHClient với đầy đủ cấu hình bảo vệ & timeout."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    host = args.get("host")
    if not host:
        raise ValueError("Thiếu tham số 'host'")

    port = int(args.get("port", 22))
    user = args.get("user") or "root"
    password = args.get("password") or None
    passphrase = args.get("passphrase") or None
    raw_key = args.get("key") or args.get("key_path")
    timeout = float(args.get("timeout", 15))

    pkey = None
    key_path = resolve_key_path(raw_key)

    if key_path and os.path.exists(key_path):
        try:
            pkey = load_private_key(key_path, passphrase)
        except Exception as e:
            # Fallback truyền đường dẫn trực tiếp cho paramiko tự parse
            pass

    connect_kwargs: Dict[str, Any] = {
        "hostname": host,
        "port": port,
        "username": user,
        "timeout": timeout,
        "banner_timeout": timeout,
        "auth_timeout": timeout,
        "look_for_keys": True,
        "allow_agent": True,
    }

    if pkey:
        connect_kwargs["pkey"] = pkey
    elif key_path and os.path.exists(key_path):
        connect_kwargs["key_filename"] = key_path

    if password:
        connect_kwargs["password"] = password

    client.connect(**connect_kwargs)
    return client


def action_test(args: Dict[str, Any]) -> Dict[str, Any]:
    """Kiểm tra kết nối và độ trễ đến VPS."""
    t0 = time.time()
    client = create_ssh_client(args)
    t_connected = time.time()
    try:
        # Lấy thông tin cơ bản: hostname, kernel, uptime
        stdin, stdout, stderr = client.exec_command("hostname && uname -sr && uptime", timeout=10)
        output = stdout.read().decode("utf-8", errors="replace").strip().splitlines()
        
        hostname = output[0] if len(output) > 0 else "unknown"
        kernel = output[1] if len(output) > 1 else "unknown"
        uptime_info = output[2] if len(output) > 2 else ""

        transport = client.get_transport()
        banner = transport.remote_version if transport else ""

        return {
            "ok": True,
            "connected": True,
            "host": args.get("host"),
            "user": args.get("user") or "root",
            "port": args.get("port", 22),
            "hostname": hostname,
            "kernel": kernel,
            "uptime": uptime_info,
            "ssh_banner": banner,
            "latency_ms": round((t_connected - t0) * 1000, 2)
        }
    finally:
        client.close()


def action_exec(args: Dict[str, Any]) -> Dict[str, Any]:
    """Thực thi lệnh từ xa trên VPS và thu thập stdout/stderr."""
    command = args.get("command") or args.get("cmd")
    if not command:
        raise ValueError("Thiếu tham số 'command'")

    cwd = args.get("cwd")
    env = args.get("env") or {}
    timeout = float(args.get("timeout", 60))

    # Xây dựng lệnh hoàn chỉnh có hỗ trợ cd và environment variables
    full_cmd = []
    if env and isinstance(env, dict):
        env_strs = [f"{k}={json.dumps(str(v))}" for k, v in env.items()]
        full_cmd.append("export " + " ".join(env_strs))
    if cwd:
        full_cmd.append(f"cd {json.dumps(cwd)}")
    full_cmd.append(command)

    final_command = " && ".join(full_cmd) if len(full_cmd) > 1 else full_cmd[0]

    t0 = time.time()
    client = create_ssh_client(args)
    try:
        stdin, stdout, stderr = client.exec_command(final_command, timeout=timeout)
        
        out_text = stdout.read().decode("utf-8", errors="replace")
        err_text = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        duration_ms = round((time.time() - t0) * 1000, 2)

        return {
            "ok": exit_code == 0,
            "stdout": out_text,
            "stderr": err_text,
            "exit_code": exit_code,
            "command": command,
            "duration_ms": duration_ms
        }
    finally:
        client.close()


def sftp_mkdir_p(sftp: paramiko.SFTPClient, remote_directory: str):
    """Tạo thư mục đệ quy tương đương mkdir -p."""
    if remote_directory in ("/", ""):
        return
    try:
        sftp.stat(remote_directory)
    except IOError:
        parent = os.path.dirname(remote_directory.rstrip("/"))
        if parent:
            sftp_mkdir_p(sftp, parent)
        try:
            sftp.mkdir(remote_directory)
        except IOError:
            pass


def action_upload(args: Dict[str, Any]) -> Dict[str, Any]:
    """Tải tệp hoặc toàn bộ thư mục lên VPS qua SFTP."""
    local_path = os.path.abspath(os.path.expanduser(args.get("local") or args.get("local_path") or ""))
    remote_path = args.get("remote") or args.get("remote_path")

    if not local_path or not os.path.exists(local_path):
        raise FileNotFoundError(f"Tệp/thư mục cục bộ không tồn tại: {local_path}")
    if not remote_path:
        raise ValueError("Thiếu tham số 'remote_path'")

    client = create_ssh_client(args)
    sftp = client.open_sftp()
    t0 = time.time()
    files_uploaded = 0
    bytes_uploaded = 0

    try:
        if os.path.isfile(local_path):
            remote_dir = os.path.dirname(remote_path)
            if remote_dir:
                sftp_mkdir_p(sftp, remote_dir)
            
            file_size = os.path.getsize(local_path)
            sftp.put(local_path, remote_path)
            files_uploaded = 1
            bytes_uploaded = file_size
        else:
            # Tải lên đệ quy toàn bộ thư mục
            for root, dirs, files in os.walk(local_path):
                rel_path = os.path.relpath(root, local_path)
                dest_dir = os.path.join(remote_path, rel_path).replace("\\", "/")
                sftp_mkdir_p(sftp, dest_dir)

                for f in files:
                    src_file = os.path.join(root, f)
                    dest_file = os.path.join(dest_dir, f).replace("\\", "/")
                    sftp.put(src_file, dest_file)
                    files_uploaded += 1
                    bytes_uploaded += os.path.getsize(src_file)

        return {
            "ok": True,
            "local": local_path,
            "remote": remote_path,
            "files_count": files_uploaded,
            "bytes_transferred": bytes_uploaded,
            "duration_ms": round((time.time() - t0) * 1000, 2)
        }
    finally:
        sftp.close()
        client.close()


def action_download(args: Dict[str, Any]) -> Dict[str, Any]:
    """Tải tệp từ VPS về máy cục bộ qua SFTP."""
    remote_path = args.get("remote") or args.get("remote_path")
    local_path = os.path.abspath(os.path.expanduser(args.get("local") or args.get("local_path") or ""))

    if not remote_path:
        raise ValueError("Thiếu tham số 'remote_path'")
    if not local_path:
        raise ValueError("Thiếu tham số 'local_path'")

    local_dir = os.path.dirname(local_path)
    if local_dir:
        os.makedirs(local_dir, exist_ok=True)

    client = create_ssh_client(args)
    sftp = client.open_sftp()
    t0 = time.time()

    try:
        remote_stat = sftp.stat(remote_path)
        sftp.get(remote_path, local_path)
        return {
            "ok": True,
            "remote": remote_path,
            "local": local_path,
            "bytes_transferred": remote_stat.st_size,
            "duration_ms": round((time.time() - t0) * 1000, 2)
        }
    finally:
        sftp.close()
        client.close()


def action_list(args: Dict[str, Any]) -> Dict[str, Any]:
    """Liệt kê danh sách tệp & thư mục từ xa kèm thuộc tính."""
    remote_dir = args.get("remote_dir") or args.get("remote") or "/"
    client = create_ssh_client(args)
    sftp = client.open_sftp()

    try:
        entries = sftp.listdir_attr(remote_dir)
        items = []
        for attr in entries:
            is_dir = stat.S_ISDIR(attr.st_mode) if attr.st_mode else False
            items.append({
                "name": attr.filename,
                "size": attr.st_size,
                "is_dir": is_dir,
                "permissions": oct(attr.st_mode)[-3:] if attr.st_mode else "",
                "modified_at": int(attr.st_mtime) if attr.st_mtime else 0
            })

        # Sắp xếp: Thư mục lên trước, sau đó theo tên
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        return {
            "ok": True,
            "remote_dir": remote_dir,
            "count": len(items),
            "items": items
        }
    finally:
        sftp.close()
        client.close()


def action_shell(args: Dict[str, Any]):
    """Mở một persistent interactive shell PTY bền vững giữ kết nối không tắt."""
    client = create_ssh_client(args)
    channel = client.invoke_shell(term='xterm-256color', width=120, height=40)
    channel.setblocking(0)

    import threading

    def reader():
        while True:
            try:
                if channel.closed:
                    break
                if channel.recv_ready():
                    data = channel.recv(4096)
                    if not data:
                        break
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
                else:
                    time.sleep(0.01)
            except Exception:
                break

    t = threading.Thread(target=reader, daemon=True)
    t.start()

    try:
        while not channel.closed:
            chunk = sys.stdin.buffer.read(1024)
            if not chunk:
                break
            channel.sendall(chunk)
    except Exception:
        pass
    finally:
        try:
            channel.close()
            client.close()
        except Exception:
            pass


def action_health_audit(args: Dict[str, Any]) -> Dict[str, Any]:
    """Kiểm tra toàn diện sức khỏe VPS: CPU, RAM, Disk, Port, Tiến trình, Bảo mật."""
    client = create_ssh_client(args)
    try:
        collector_script = r"""
        export LC_ALL=C
        echo "===OS==="
        grep -E '^(PRETTY_NAME|ID|VERSION_ID)=' /etc/os-release 2>/dev/null || cat /etc/issue 2>/dev/null || uname -s
        echo "===UPTIME==="
        uptime 2>/dev/null
        echo "===CPU==="
        nproc 2>/dev/null || echo 1
        grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2 | xargs || uname -m
        top -bn1 2>/dev/null | grep -E "%?Cpu" | head -n1 || echo ""
        echo "===MEM==="
        free -m 2>/dev/null || echo ""
        echo "===DISK==="
        df -h / 2>/dev/null | tail -n 1
        echo "===PORTS==="
        ss -tulpn 2>/dev/null | grep LISTEN || netstat -tulpn 2>/dev/null | grep LISTEN || echo ""
        echo "===TOP_CPU==="
        ps -eo pid,user,%cpu,%mem,comm --sort=-%cpu 2>/dev/null | head -n 6
        echo "===TOP_MEM==="
        ps -eo pid,user,%cpu,%mem,comm --sort=-%mem 2>/dev/null | head -n 6
        echo "===FAILED_SSH==="
        if command -v journalctl >/dev/null 2>&1; then
            journalctl -u ssh -u sshd --since today 2>/dev/null | grep -c "Failed password" 2>/dev/null || echo 0
        elif [ -f /var/log/auth.log ]; then
            grep -c "Failed password" /var/log/auth.log 2>/dev/null || echo 0
        else
            echo 0
        fi
        echo "===SECURITY==="
        ufw status 2>/dev/null | head -n 2 || echo "ufw: not installed/inactive"
        systemctl is-active fail2ban 2>/dev/null || echo "fail2ban: inactive"
        if command -v docker >/dev/null 2>&1; then
            docker ps -a --format "{{.Names}} ({{.Status}})" 2>/dev/null | head -n 10
        else
            echo "docker: not installed"
        fi
        """
        stdin, stdout, stderr = client.exec_command(collector_script, timeout=30)
        raw_output = stdout.read().decode("utf-8", errors="replace")

        sections: Dict[str, str] = {}
        current_sec = "HEADER"
        for line in raw_output.splitlines():
            if line.startswith("===") and line.endswith("==="):
                current_sec = line.strip("=").strip()
                sections[current_sec] = ""
            else:
                sections[current_sec] = sections.get(current_sec, "") + line + "\n"

        # Parse OS
        os_name = "Linux"
        for line in sections.get("OS", "").splitlines():
            if "PRETTY_NAME=" in line:
                os_name = line.split("=", 1)[1].strip('"\'')
                break

        # Parse CPU
        cpu_lines = [l.strip() for l in sections.get("CPU", "").splitlines() if l.strip()]
        cpu_cores = int(cpu_lines[0]) if cpu_lines and cpu_lines[0].isdigit() else 1
        cpu_model = cpu_lines[1] if len(cpu_lines) > 1 else "Unknown CPU"

        # Parse Memory
        mem_text = sections.get("MEM", "")
        mem_total, mem_used, mem_free, mem_pct = 0, 0, 0, 0.0
        for line in mem_text.splitlines():
            if line.startswith("Mem:"):
                parts = line.split()
                if len(parts) >= 4:
                    mem_total = int(parts[1])
                    mem_used = int(parts[2])
                    mem_free = int(parts[3])
                    mem_pct = round((mem_used / mem_total) * 100, 1) if mem_total > 0 else 0.0

        # Parse Disk
        disk_line = sections.get("DISK", "").strip()
        disk_parts = disk_line.split()
        disk_total = disk_parts[1] if len(disk_parts) > 1 else "N/A"
        disk_used = disk_parts[2] if len(disk_parts) > 2 else "N/A"
        disk_free = disk_parts[3] if len(disk_parts) > 3 else "N/A"
        disk_pct_str = disk_parts[4] if len(disk_parts) > 4 else "0%"
        disk_pct = int(disk_pct_str.rstrip("%")) if disk_pct_str.rstrip("%").isdigit() else 0

        # Parse Failed SSH
        failed_ssh_str = sections.get("FAILED_SSH", "").strip()
        failed_ssh = int(failed_ssh_str) if failed_ssh_str.isdigit() else 0

        # Parse Security
        sec_text = sections.get("SECURITY", "")
        ufw_active = "Status: active" in sec_text or "active" in sec_text.lower()
        fail2ban_active = "active" in sec_text and "fail2ban: inactive" not in sec_text

        # Health Scoring & Warnings
        score = 100
        warnings: List[str] = []

        if disk_pct > 85:
            score -= 25
            warnings.append(f"Ổ đĩa / đã dùng {disk_pct}% (Nguy cơ đầy ổ đĩa)")
        elif disk_pct > 75:
            score -= 10
            warnings.append(f"Ổ đĩa / đã dùng {disk_pct}% (Cần chú ý)")

        if mem_pct > 90:
            score -= 20
            warnings.append(f"RAM đang dùng {mem_pct}% (Nguy cơ Out Of Memory)")
        elif mem_pct > 80:
            score -= 10
            warnings.append(f"RAM đang dùng {mem_pct}%")

        if not ufw_active:
            score -= 15
            warnings.append("Firewall (UFW) chưa được kích hoạt")

        if not fail2ban_active:
            score -= 15
            warnings.append("Fail2ban chưa được kích hoạt (Nguy cơ bị tấn công Brute-force SSH)")

        if failed_ssh > 50:
            score -= 10
            warnings.append(f"Phát hiện {failed_ssh} lần đăng nhập SSH thất bại hôm nay")

        score = max(0, score)

        # Tạo Markdown Report tóm tắt
        md_report = f"""# 📊 BÁO CÁO SỨC KHỎE VPS ({args.get('host')})
- **Thời gian kiểm tra**: {time.strftime('%Y-%m-%d %H:%M:%S')}
- **Hệ điều hành**: {os_name}
- **Uptime**: {sections.get('UPTIME', '').strip()}
- **Điểm sức khỏe (Health Score)**: **{score}/100** {'🟢 Tốt' if score >= 80 else '🟡 Cảnh báo' if score >= 60 else '🔴 Nguy hiểm'}

---
### ⚙️ 1. Tài nguyên phần cứng
- **CPU**: {cpu_model} ({cpu_cores} cores)
- **RAM**: {mem_used} MB / {mem_total} MB ({mem_pct}%)
- **Disk (Root /)**: {disk_used} / {disk_total} ({disk_pct_str})

### 🛡️ 2. Bảo mật & Phòng thủ
- **Tường lửa (UFW)**: {'✅ Đang bật' if ufw_active else '❌ Tắt'}
- **Chống DDoS/Brute-force (Fail2ban)**: {'✅ Đang bảo vệ' if fail2ban_active else '❌ Tắt'}
- **Lượt thử SSH thất bại hôm nay**: {failed_ssh} lần

### ⚠️ 3. Cảnh báo quan trọng
{chr(10).join(['- ' + w for w in warnings]) if warnings else '✅ Không phát hiện cảnh báo bất thường nào.'}
"""

        return {
            "ok": True,
            "host": args.get("host"),
            "health_score": score,
            "os": os_name,
            "cpu": {"model": cpu_model, "cores": cpu_cores},
            "memory": {"total_mb": mem_total, "used_mb": mem_used, "free_mb": mem_free, "usage_percent": mem_pct},
            "disk": {"total": disk_total, "used": disk_used, "free": disk_free, "usage_percent": disk_pct},
            "failed_ssh_attempts_today": failed_ssh,
            "security": {"ufw_active": ufw_active, "fail2ban_active": fail2ban_active},
            "warnings": warnings,
            "markdown_report": md_report,
            "raw_details": {
                "top_cpu": sections.get("TOP_CPU", "").strip().splitlines(),
                "top_mem": sections.get("TOP_MEM", "").strip().splitlines(),
                "listening_ports": [l.strip() for l in sections.get("PORTS", "").splitlines() if l.strip()]
            }
        }
    finally:
        client.close()


def action_setup_daily_cron(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cài đặt kịch bản kiểm tra VPS tự động chạy hàng ngày kèm cảnh báo Telegram/Log."""
    client = create_ssh_client(args)
    try:
        cron_time = args.get("cron_time") or "08:00"
        parts = cron_time.split(":")
        minute = parts[1] if len(parts) > 1 else "0"
        hour = parts[0] if len(parts) > 0 else "8"

        bot_token = args.get("telegram_bot_token") or ""
        chat_id = args.get("telegram_chat_id") or ""

        telegram_snippet = ""
        if bot_token and chat_id:
            telegram_snippet = f"""
            MSG="🚨 [BÁO CÁO VPS $(hostname) - $(date '+%Y-%m-%d %H:%M')]\n• RAM: ${{MEM_USED}}MB/${{MEM_TOTAL}}MB (${{MEM_PCT}}%)\n• Disk: ${{DISK_USED}}/${{DISK_TOTAL}} (${{DISK_PCT}})\n• SSH Failed Today: ${{FAILED_SSH}}\n• Uptime: ${{UPTIME_SHORT}}"
            curl -s -X POST "https://api.telegram.org/bot{bot_token}/sendMessage" -d chat_id="{chat_id}" -d text="$MSG" >/dev/null 2>&1 || true
            """

        script_content = f"""#!/usr/bin/env bash
# Otter VPS Daily Health Check & Alert Script
set -e
export LC_ALL=C

LOG_FILE="/var/log/otter-daily-health.log"
DATE_STR=$(date '+%Y-%m-%d %H:%M:%S')

MEM_TOTAL=$(free -m | awk '/Mem:/ {{print $2}}')
MEM_USED=$(free -m | awk '/Mem:/ {{print $3}}')
MEM_PCT=$(awk "BEGIN {{printf \\"%.1f\\", ($MEM_USED/$MEM_TOTAL)*100}}")

DISK_TOTAL=$(df -h / | awk 'NR==2 {{print $2}}')
DISK_USED=$(df -h / | awk 'NR==2 {{print $3}}')
DISK_PCT=$(df -h / | awk 'NR==2 {{print $5}}')

UPTIME_SHORT=$(uptime -p 2>/dev/null || uptime)
FAILED_SSH=$(journalctl -u ssh -u sshd --since today 2>/dev/null | grep -c "Failed password" 2>/dev/null || grep -c "Failed password" /var/log/auth.log 2>/dev/null || echo 0)

echo "[$DATE_STR] Health Check: RAM=${{MEM_USED}}MB/${{MEM_TOTAL}}MB (${{MEM_PCT}}%), Disk=${{DISK_USED}}/${{DISK_TOTAL}} (${{DISK_PCT}}), SSH_Failed=${{FAILED_SSH}}" >> "$LOG_FILE"
{telegram_snippet}
"""
        # Ghi file bash lên VPS
        sftp = client.open_sftp()
        with sftp.file("/usr/local/bin/otter-daily-health.sh", "w") as f:
            f.write(script_content)
        sftp.chmod("/usr/local/bin/otter-daily-health.sh", 0o755)

        # Cấu hình cron job trong /etc/cron.d/otter-daily-health
        cron_entry = f"{minute} {hour} * * * root /usr/local/bin/otter-daily-health.sh\n"
        with sftp.file("/etc/cron.d/otter-daily-health", "w") as f:
            f.write(cron_entry)
        sftp.chmod("/etc/cron.d/otter-daily-health", 0o644)
        sftp.close()

        # Chạy thử 1 lần
        stdin, stdout, stderr = client.exec_command("/usr/local/bin/otter-daily-health.sh", timeout=15)
        stdout.channel.recv_exit_status()

        return {
            "ok": True,
            "cron_schedule": f"{minute} {hour} * * *",
            "script_path": "/usr/local/bin/otter-daily-health.sh",
            "cron_file": "/etc/cron.d/otter-daily-health",
            "log_file": "/var/log/otter-daily-health.log",
            "telegram_alert_enabled": bool(bot_token and chat_id),
            "message": f"Đã thiết lập tự động kiểm tra sức khỏe VPS hàng ngày vào lúc {hour}:{minute.zfill(2)}!"
        }
    finally:
        client.close()


def action_install_software(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cài đặt tự động phần mềm (Docker, Nginx, Node/Bun, Python, Databases, Tools) lên VPS."""
    packages_input = args.get("packages") or args.get("software") or []
    if isinstance(packages_input, str):
        packages = [p.strip().lower() for p in packages_input.split(",") if p.strip()]
    else:
        packages = [str(p).strip().lower() for p in packages_input]

    if not packages:
        raise ValueError("Thiếu danh sách phần mềm 'packages' (ví dụ: ['docker', 'nginx', 'bun', 'tools'])")

    commands: List[str] = [
        "export DEBIAN_FRONTEND=noninteractive",
        "apt-get update -qq || yum check-update || true"
    ]

    installed_summary: List[str] = []

    for pkg in packages:
        if pkg in ("docker", "docker-compose"):
            commands.append("command -v docker >/dev/null 2>&1 || (curl -fsSL https://get.docker.com | sh && systemctl enable --now docker)")
            installed_summary.append("Docker Engine & Docker Compose Plugin")
        elif pkg == "nginx":
            commands.append("(command -v apt-get >/dev/null 2>&1 && apt-get install -y nginx) || (command -v yum >/dev/null 2>&1 && yum install -y nginx) || true")
            commands.append("systemctl enable --now nginx || true")
            installed_summary.append("Nginx Web Server")
        elif pkg in ("node", "nodejs"):
            commands.append("command -v node >/dev/null 2>&1 || (curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs)")
            installed_summary.append("Node.js LTS & npm")
        elif pkg == "bun":
            commands.append("command -v bun >/dev/null 2>&1 || (curl -fsSL https://bun.sh/install | bash && ln -sf /root/.bun/bin/bun /usr/local/bin/bun)")
            installed_summary.append("Bun JavaScript Runtime")
        elif pkg in ("python", "python3"):
            commands.append("(command -v apt-get >/dev/null 2>&1 && apt-get install -y python3 python3-pip python3-venv build-essential) || yum install -y python3 python3-pip")
            installed_summary.append("Python 3 & Build Tools")
        elif pkg == "redis":
            commands.append("(command -v apt-get >/dev/null 2>&1 && apt-get install -y redis-server) || yum install -y redis")
            commands.append("sed -i 's/^bind .*/bind 127.0.0.1 ::1/' /etc/redis/redis.conf 2>/dev/null || true")
            commands.append("systemctl enable --now redis || systemctl enable --now redis-server || true")
            installed_summary.append("Redis Server (Bind localhost)")
        elif pkg in ("postgres", "postgresql"):
            commands.append("apt-get install -y postgresql postgresql-contrib || yum install -y postgresql-server")
            commands.append("systemctl enable --now postgresql || true")
            installed_summary.append("PostgreSQL Database")
        elif pkg in ("mysql", "mariadb"):
            commands.append("apt-get install -y mariadb-server || apt-get install -y mysql-server || yum install -y mariadb-server")
            commands.append("systemctl enable --now mariadb || systemctl enable --now mysql || true")
            installed_summary.append("MariaDB/MySQL Database Server")
        elif pkg in ("tools", "basic-tools"):
            commands.append("apt-get install -y curl wget git htop jq ufw unzip rsync || yum install -y curl wget git htop jq ufw unzip rsync")
            installed_summary.append("Standard Sysadmin Tools (curl, git, htop, jq, ufw, unzip, rsync)")

    combined_cmd = " && ".join(commands)

    t0 = time.time()
    client = create_ssh_client(args)
    try:
        stdin, stdout, stderr = client.exec_command(combined_cmd, timeout=float(args.get("timeout", 300)))
        out_text = stdout.read().decode("utf-8", errors="replace")
        err_text = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()

        return {
            "ok": exit_code == 0,
            "installed_packages": installed_summary,
            "duration_ms": round((time.time() - t0) * 1000, 2),
            "exit_code": exit_code,
            "output": out_text.strip()[-2000:] if len(out_text) > 2000 else out_text.strip(),
            "stderr": err_text.strip()[-1000:] if len(err_text) > 1000 else err_text.strip()
        }
    finally:
        client.close()


def action_setup_ssl(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cài đặt chứng chỉ SSL Let's Encrypt tự động cho Domain qua Certbot + Nginx."""
    domain = args.get("domain")
    if not domain:
        raise ValueError("Thiếu tham số 'domain' (ví dụ: 'app.example.com')")

    email = args.get("email") or f"admin@{domain}"
    client = create_ssh_client(args)
    try:
        setup_ssl_cmd = f"""
        set -e
        export DEBIAN_FRONTEND=noninteractive
        # 1. Cài đặt Nginx & Certbot nếu chưa có
        command -v nginx >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y nginx)
        command -v certbot >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y certbot python3-certbot-nginx)

        # 2. Tạo Virtual Host Nginx cơ bản nếu chưa có file cấu hình
        CONF_FILE="/etc/nginx/sites-available/{domain}"
        if [ ! -f "$CONF_FILE" ]; then
            cat << 'EOF' > "$CONF_FILE"
server {{
    listen 80;
    server_name {domain};
    root /var/www/html;
    index index.html index.htm;
    location / {{
        try_files $uri $uri/ =404;
    }}
}}
EOF
            ln -sf "$CONF_FILE" /etc/nginx/sites-enabled/
        fi

        nginx -t
        systemctl reload nginx || systemctl restart nginx

        # 3. Yêu cầu chứng chỉ SSL Certbot
        certbot --nginx -d {domain} --non-interactive --agree-tos -m {email} --redirect

        # 4. Kiểm tra timer gia hạn tự động
        systemctl is-active certbot.timer >/dev/null 2>&1 || systemctl enable --now certbot.timer || true
        """

        stdin, stdout, stderr = client.exec_command(setup_ssl_cmd, timeout=120)
        out_text = stdout.read().decode("utf-8", errors="replace")
        err_text = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()

        if exit_code != 0:
            return {
                "ok": False,
                "domain": domain,
                "error": f"Lỗi cấp chứng chỉ SSL: {err_text or out_text}",
                "exit_code": exit_code
            }

        return {
            "ok": True,
            "domain": domain,
            "email": email,
            "ssl_enabled": True,
            "https_url": f"https://{domain}",
            "auto_renew": "Đã kích hoạt Certbot systemd timer tự động gia hạn 90 ngày",
            "message": f"✅ Cài đặt chứng chỉ SSL thành công cho domain https://{domain}!"
        }
    finally:
        client.close()


def action_setup_ssh_key(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cài đặt SSH Public Key và tăng cường bảo mật sshd (chống brute force)."""
    public_key = args.get("public_key")
    if not public_key:
        raise ValueError("Thiếu tham số 'public_key' (Nội dung SSH Public Key)")

    public_key = public_key.strip()
    harden = bool(args.get("harden_sshd", True))
    disable_password = bool(args.get("disable_password", False))
    new_port = args.get("new_port")

    client = create_ssh_client(args)
    try:
        # Ghi public key vào ~/.ssh/authorized_keys
        sftp = client.open_sftp()
        ssh_dir = ".ssh"
        try:
            sftp.stat(ssh_dir)
        except IOError:
            sftp.mkdir(ssh_dir, mode=0o700)
        sftp.chmod(ssh_dir, 0o700)

        auth_keys_path = ".ssh/authorized_keys"
        existing_keys = ""
        try:
            with sftp.file(auth_keys_path, "r") as f:
                existing_keys = f.read().decode("utf-8", errors="replace")
        except IOError:
            pass

        if public_key not in existing_keys:
            new_keys = (existing_keys.strip() + "\n" + public_key + "\n").lstrip()
            with sftp.file(auth_keys_path, "w") as f:
                f.write(new_keys)
        sftp.chmod(auth_keys_path, 0o600)
        sftp.close()

        hardening_applied = []
        if harden:
            sshd_cmd = "mkdir -p /etc/ssh/sshd_config.d\n"
            conf_lines = ["# Otter Hardening Config", "PubkeyAuthentication yes"]
            if disable_password:
                conf_lines.append("PasswordAuthentication no")
                hardening_applied.append("Tắt đăng nhập bằng mật khẩu (PasswordAuthentication no)")
            conf_lines.append("PermitRootLogin prohibit-password")
            hardening_applied.append("Chặn root đăng nhập bằng mật khẩu (PermitRootLogin prohibit-password)")

            if new_port and int(new_port) != 22:
                port_num = int(new_port)
                conf_lines.append(f"Port {port_num}")
                sshd_cmd += f"command -v ufw >/dev/null 2>&1 && ufw allow {port_num}/tcp comment 'New SSH Port' || true\n"
                hardening_applied.append(f"Đổi SSH Port sang {port_num} (Đã tự động mở trên UFW)")

            conf_content = "\n".join(conf_lines) + "\n"
            sshd_cmd += f"echo '{conf_content}' > /etc/ssh/sshd_config.d/99-otter-hardening.conf\n"
            sshd_cmd += "sshd -t && (systemctl reload ssh || systemctl reload sshd || service ssh reload)\n"

            stdin, stdout, stderr = client.exec_command(sshd_cmd, timeout=20)
            exit_code = stdout.channel.recv_exit_status()
            if exit_code != 0:
                err_msg = stderr.read().decode("utf-8", errors="replace")
                return {
                    "ok": True,
                    "key_installed": True,
                    "hardening_error": f"Cài key thành công nhưng cấu hình sshd thất bại: {err_msg}"
                }

        return {
            "ok": True,
            "key_installed": True,
            "key_preview": public_key[:40] + "..." + public_key[-20:],
            "hardening": hardening_applied,
            "message": "✅ Đã cài đặt SSH Key an toàn vào ~/.ssh/authorized_keys!"
        }
    finally:
        client.close()


def action_setup_firewall_fail2ban(args: Dict[str, Any]) -> Dict[str, Any]:
    """Cài đặt & cấu hình UFW và Fail2ban chống DDoS, HTTP flooding & Brute-force."""
    ssh_port = int(args.get("ssh_port", 22))
    ban_time_hours = int(args.get("ban_time_hours", 24))
    max_retry = int(args.get("max_retry", 3))
    custom_ports = args.get("custom_ports") or [80, 443]

    client = create_ssh_client(args)
    try:
        ports_script = "\n".join([f"ufw allow {p}/tcp || true" for p in custom_ports])
        setup_script = f"""
        set -e
        export DEBIAN_FRONTEND=noninteractive
        # 1. Cài đặt UFW và Fail2ban
        apt-get update -qq
        apt-get install -y ufw fail2ban

        # 2. Cấu hình UFW
        ufw default deny incoming
        ufw default allow outgoing
        ufw limit {ssh_port}/tcp comment "SSH Rate Limit (Anti-Bruteforce)"
        {ports_script}
        echo "y" | ufw enable || true

        # 3. Cấu hình Fail2ban
        cat << 'EOF' > /etc/fail2ban/jail.local
[DEFAULT]
bantime = {ban_time_hours}h
findtime = 10m
maxretry = {max_retry}
banaction = ufw

[sshd]
enabled = true
port = {ssh_port}
maxretry = {max_retry}
bantime = {ban_time_hours}h

[nginx-http-auth]
enabled = true

[nginx-botsearch]
enabled = true
maxretry = 2

[nginx-limit-req]
enabled = true
EOF

        # 4. Khởi động Fail2ban
        systemctl enable --now fail2ban
        systemctl restart fail2ban
        fail2ban-client reload || true
        """

        stdin, stdout, stderr = client.exec_command(setup_script, timeout=120)
        out_text = stdout.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()

        # Kiểm tra trạng thái sau cấu hình
        stdin, stdout, stderr = client.exec_command("ufw status && fail2ban-client status sshd", timeout=15)
        status_text = stdout.read().decode("utf-8", errors="replace")

        return {
            "ok": exit_code == 0,
            "ssh_port_protected": ssh_port,
            "ban_duration": f"{ban_time_hours} giờ",
            "max_failed_attempts": max_retry,
            "allowed_ports": custom_ports + [ssh_port],
            "status_summary": status_text.strip(),
            "message": "✅ Đã kích hoạt tường lửa UFW và Fail2ban chống DDoS/Brute-force thành công!"
        }
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser(description="Otter VPS SSH & SFTP Engine")
    parser.add_argument("action", nargs="?", default="", help="Hành động: test, exec, upload, download, list, shell, audit, cron, install, ssl, sshkey, firewall")
    parser.add_argument("--json", dest="json_payload", help="Toàn bộ tham số dưới dạng JSON string")
    parser.add_argument("--host", help="Địa chỉ IP hoặc hostname VPS")
    parser.add_argument("--user", default="root", help="Username đăng nhập")
    parser.add_argument("--port", type=int, default=22, help="Port SSH (mặc định: 22)")
    parser.add_argument("--key", help="Đường dẫn SSH Private Key")
    parser.add_argument("--password", help="Mật khẩu đăng nhập")
    parser.add_argument("--passphrase", help="Mật khẩu giải mã Private Key")
    parser.add_argument("--cmd", "--command", dest="command", help="Lệnh cần thực thi")
    parser.add_argument("--cwd", help="Thư mục làm việc trên VPS")
    parser.add_argument("--local", help="Đường dẫn tệp/thư mục cục bộ")
    parser.add_argument("--remote", help="Đường dẫn tệp/thư mục từ xa")
    parser.add_argument("--timeout", type=float, default=30.0, help="Thời gian chờ tối đa (giây)")

    parsed = parser.parse_args()

    args_dict: Dict[str, Any] = {}
    if parsed.json_payload:
        try:
            args_dict = json.loads(parsed.json_payload)
        except Exception as e:
            print(json.dumps({"ok": False, "error": f"Lỗi parse JSON payload: {e}"}, ensure_ascii=False))
            sys.exit(1)
    else:
        args_dict = vars(parsed)

    action = args_dict.get("action") or parsed.action
    action = (action or "").lower().strip()

    actions_map = {
        "test": action_test,
        "ping": action_test,
        "exec": action_exec,
        "execute": action_exec,
        "upload": action_upload,
        "put": action_upload,
        "download": action_download,
        "get": action_download,
        "list": action_list,
        "ls": action_list,
        "shell": action_shell,
        "interactive": action_shell,
        "audit": action_health_audit,
        "health": action_health_audit,
        "cron": action_setup_daily_cron,
        "daily_cron": action_setup_daily_cron,
        "install": action_install_software,
        "install_software": action_install_software,
        "ssl": action_setup_ssl,
        "setup_ssl": action_setup_ssl,
        "sshkey": action_setup_ssh_key,
        "setup_sshkey": action_setup_ssh_key,
        "firewall": action_setup_firewall_fail2ban,
        "fail2ban": action_setup_firewall_fail2ban,
    }

    if action not in actions_map:
        print(json.dumps({
            "ok": False,
            "error": f"Hành động '{action}' không hợp lệ. Các hành động hỗ trợ: {list(actions_map.keys())}"
        }, ensure_ascii=False))
        sys.exit(1)

    try:
        handler = actions_map[action]
        result = handler(args_dict)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except Exception as err:
        print(json.dumps({
            "ok": False,
            "error": str(err),
            "error_type": err.__class__.__name__
        }, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()

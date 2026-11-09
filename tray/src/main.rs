#![windows_subsystem = "windows"]

use std::{
    fs::{self, OpenOptions},
    io::Write,
    net::TcpStream,
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};
use tray_item::{IconSource, TrayItem};

fn log_msg(msg: &str) {
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let p = Path::new(&local_appdata).join("Otter").join("tray.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "[{}] {}", chrono_lite_timestamp(), msg);
        }
    }
}

fn chrono_lite_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn get_install_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let binary_name = if cfg!(windows) { "otter.exe" } else { "otter" };
            if parent.join(binary_name).exists() {
                return parent.to_path_buf();
            }
        }
    }
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        let p = Path::new(&local_appdata).join("Otter");
        if p.exists() {
            return p;
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = Path::new(&home).join(".otter");
        if p.exists() {
            return p;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn get_otter_binary(install_dir: &Path) -> Option<PathBuf> {
    let binary_name = if cfg!(windows) { "otter.exe" } else { "otter" };
    let candidates = [
        install_dir.join(binary_name),
        install_dir.join("bin").join(binary_name),
        PathBuf::from(binary_name),
        PathBuf::from("deploy").join(binary_name),
        PathBuf::from("dist").join(binary_name),
    ];

    for path in candidates {
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn is_port_open(port: u16) -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    )
    .is_ok()
}

fn spawn_otter_daemon(install_dir: &Path, exe: &Path) {
    let log_path = install_dir.join("otter.log");
    let log_out = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path);

    let mut cmd = Command::new(exe);
    cmd.arg("--tunnel").current_dir(install_dir);

    if let Ok(f_out) = log_out {
        if let Ok(f_err) = f_out.try_clone() {
            cmd.stdout(std::process::Stdio::from(f_out));
            cmd.stderr(std::process::Stdio::from(f_err));
        }
    } else {
        cmd.stdout(std::process::Stdio::null());
        cmd.stderr(std::process::Stdio::null());
    }
    cmd.stdin(std::process::Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }

    match cmd.spawn() {
        Ok(child) => log_msg(&format!("Spawned daemon PID {}", child.id())),
        Err(e) => log_msg(&format!("Failed to spawn daemon: {:?}", e)),
    }
}

fn ensure_daemon_running() {
    if is_port_open(1993) {
        return;
    }

    let install_dir = get_install_dir();
    log_msg(&format!("Install dir: {:?}", install_dir));
    if let Some(exe) = get_otter_binary(&install_dir) {
        log_msg(&format!("Found binary: {:?}", exe));
        spawn_otter_daemon(&install_dir, &exe);
    } else {
        log_msg("Could not find otter binary!");
    }
}

fn get_tunnel_url() -> Option<String> {
    let install_dir = get_install_dir();
    let mut candidates = vec![
        install_dir.join("tunnel.url"),
        install_dir.join("bin").join("tunnel.url"),
        PathBuf::from("tunnel.url"),
    ];
    if let Ok(local_appdata) = std::env::var("LOCALAPPDATA") {
        candidates.push(Path::new(&local_appdata).join("Otter").join("tunnel.url"));
    }
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(Path::new(&home).join(".otter").join("tunnel.url"));
    }

    for path in candidates {
        if let Ok(content) = fs::read_to_string(&path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }
    None
}

fn copy_to_clipboard(text: &str) {
    if let Ok(mut clipboard) = arboard::Clipboard::new() {
        let _ = clipboard.set_text(text);
    }
}

fn open_url(url: &str) {
    let _ = open::that(url);
}

fn restart_daemon() {
    let install_dir = get_install_dir();
    let binary = get_otter_binary(&install_dir);

    // 1. Dừng tiến trình cũ
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "otter.exe"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill")
            .arg("-f")
            .arg("otter")
            .output();
    }

    std::thread::sleep(Duration::from_millis(600));

    // 2. Bật lại tiến trình
    if let Some(exe) = binary {
        spawn_otter_daemon(&install_dir, &exe);
    }
}

fn quit_all() {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/IM", "otter.exe"])
            .output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("pkill")
            .arg("-f")
            .arg("otter")
            .output();
    }
    std::process::exit(0);
}

fn configure_tray(tray: &mut TrayItem) {
    log_msg("Configuring tray menus...");
    let _ = tray.add_label("🦦 Otter Background Agent");
    let _ = tray.inner_mut().add_separator();

    // 1. Mở Dashboard
    let _ = tray.add_menu_item("🌐 Mở Otter Dashboard", || {
        open_url("http://127.0.0.1:1993/activity");
    });

    // 2. Mở Cổng MCP Endpoint
    let _ = tray.add_menu_item("⚙️ Mở MCP Endpoint", || {
        open_url("http://127.0.0.1:1993/mcp");
    });

    // 3. Mở Quick Tunnel trên Trình duyệt
    let _ = tray.add_menu_item("🚀 Mở Quick Tunnel (Trình duyệt)", || {
        if let Some(url) = get_tunnel_url() {
            open_url(&url);
        } else {
            open_url("http://127.0.0.1:1993/activity");
        }
    });

    // 4. Sao chép Quick Tunnel URL
    let _ = tray.add_menu_item("🔗 Sao chép Quick Tunnel URL", || {
        if let Some(url) = get_tunnel_url() {
            copy_to_clipboard(&url);
        } else {
            copy_to_clipboard("http://127.0.0.1:1993");
        }
    });

    let _ = tray.inner_mut().add_separator();

    // 4. Khởi động lại Daemon
    let _ = tray.add_menu_item("🔄 Khởi động lại Otter", || {
        restart_daemon();
    });

    let _ = tray.inner_mut().add_separator();

    // 5. Thoát hoàn toàn
    let _ = tray.add_menu_item("❌ Thoát Otter", || {
        quit_all();
    });
}

#[cfg(target_os = "windows")]
fn try_create_tray() -> Option<TrayItem> {
    use std::ptr;
    use windows_sys::Win32::UI::WindowsAndMessaging::FindWindowW;

    // Kiểm tra taskbar Explorer đã sẵn sàng trên desktop hiện tại chưa
    let class_tray = [
        'S' as u16, 'h' as u16, 'e' as u16, 'l' as u16, 'l' as u16, '_' as u16,
        'T' as u16, 'r' as u16, 'a' as u16, 'y' as u16, 'W' as u16, 'n' as u16, 'd' as u16, 0,
    ];
    let tray_wnd = unsafe { FindWindowW(class_tray.as_ptr(), ptr::null()) };
    if tray_wnd == 0 {
        return None;
    }

    TrayItem::new("Otter", IconSource::Resource("otter"))
        .or_else(|_| TrayItem::new("Otter", IconSource::Resource("tray-default")))
        .or_else(|_| TrayItem::new("Otter", IconSource::Resource("1")))
        .or_else(|_| TrayItem::new("Otter", IconSource::Resource("")))
        .ok()
}

#[cfg(target_os = "macos")]
fn try_create_tray() -> Option<TrayItem> {
    TrayItem::new("Otter", IconSource::Resource("")).ok()
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn try_create_tray() -> Option<TrayItem> {
    TrayItem::new("Otter", IconSource::Resource("otter")).ok()
}

#[cfg(target_os = "windows")]
fn is_another_instance_running() -> bool {
    use std::ptr;
    use windows_sys::Win32::Foundation::GetLastError;

    extern "system" {
        fn CreateMutexW(lp_mutex_attributes: *const std::ffi::c_void, b_initial_owner: i32, lp_name: *const u16) -> isize;
    }

    let mutex_name = [
        'L' as u16, 'o' as u16, 'c' as u16, 'a' as u16, 'l' as u16, '\\' as u16,
        'O' as u16, 't' as u16, 't' as u16, 'e' as u16, 'r' as u16,
        'T' as u16, 'r' as u16, 'a' as u16, 'y' as u16, 'M' as u16, 'u' as u16, 't' as u16, 'e' as u16, 'x' as u16, 0,
    ];

    unsafe {
        let handle = CreateMutexW(ptr::null(), 0, mutex_name.as_ptr());
        if handle != 0 && GetLastError() == 183 {
            // ERROR_ALREADY_EXISTS = 183
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn is_another_instance_running() -> bool {
    false
}

fn main() {
    let is_autostart = std::env::args().any(|arg| arg == "--autostart");
    log_msg(&format!("=== Otter Tray starting (autostart={}) ===", is_autostart));

    // Đảm bảo đơn thực thể (Single Instance)
    if is_another_instance_running() {
        log_msg("Another instance of Otter Tray is already running.");
        if !is_autostart {
            log_msg("User requested launch: opening dashboard in browser...");
            open_url("http://127.0.0.1:1993/activity");
        }
        return;
    }

    // Nếu người dùng nhấp trực tiếp (không phải Windows boot autostart), mở Dashboard ngay
    if !is_autostart {
        log_msg("Opening Otter Dashboard in default browser...");
        open_url("http://127.0.0.1:1993/activity");
    }

    // Khởi chạy daemon ngầm
    ensure_daemon_running();

    // Vòng lặp giám sát liên tục (Daemon Watchdog & Dynamic Tray Creator)
    let mut tray_opt: Option<TrayItem> = None;
    let mut retry_count = 0u64;

    loop {
        ensure_daemon_running();

        if tray_opt.is_none() {
            if let Some(mut tray) = try_create_tray() {
                log_msg("TrayItem created successfully!");
                configure_tray(&mut tray);
                tray_opt = Some(tray);
            } else {
                retry_count += 1;
                if retry_count % 10 == 1 {
                    log_msg("Waiting for desktop shell tray...");
                }
            }
        }

        std::thread::sleep(Duration::from_secs(3));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tray_compilation_and_detection() {
        let install_dir = get_install_dir();
        println!("Install dir: {:?}", install_dir);
        assert!(!install_dir.as_os_str().is_empty());
    }
}

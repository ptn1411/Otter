/**
 * Desktop Control & Computer Use Module for Windows & macOS
 * Provides native desktop automation (List Windows, Screenshot, Mouse, Keyboard, CUA Tools)
 */
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { executeCommand } from "./terminal";

export interface WindowInfo {
  pid: number;
  processName: string;
  title: string;
}

/**
 * Liệt kê tất cả các cửa sổ ứng dụng đang mở trên desktop (Windows & macOS)
 */
export async function listWindows(): Promise<WindowInfo[]> {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    try {
      const scriptPath = path.resolve("src/daemon/list_windows.ps1");
      const res = await executeCommand(`powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`);
      if (res.stdout) {
        const data = JSON.parse(res.stdout);
        return Array.isArray(data) ? data : [data];
      }
      return [];
    } catch {
      return [];
    }
  }

  if (process.platform === "linux") {
    // wmctrl -l: "0x01200003  0 1234 host Title" — cột 1 là id hex,
    // cột 3 là pid, phần còn lại là tiêu đề. Fallback: xdotool search.
    try {
      const wm = await executeCommand(`wmctrl -l -p`);
      if (wm.stdout?.trim()) {
        return wm.stdout.trim().split("\n").map((line) => {
          const m = line.match(/^\S+\s+\S+\s+(\d+)\s+\S+\s+(.*)$/);
          return { pid: m ? Number(m[1]) : 0, processName: "", title: m ? m[2] : line };
        });
      }
    } catch {}
    try {
      const xd = await executeCommand(`xdotool search --name "" getwindowname %@ 2>/dev/null`);
      if (xd.stdout?.trim()) {
        return xd.stdout.trim().split("\n").map((t) => ({ pid: 0, processName: "", title: t }));
      }
    } catch {}
    return [];
  }

  if (isMac) {
    try {
      const jxa = `
        const se = Application("System Events");
        const procs = se.processes.whose({ backgroundOnly: false })();
        const list = [];
        for (let i = 0; i < procs.length; i++) {
          try {
            const p = procs[i];
            const name = p.name();
            const pid = p.unixId();
            const wins = p.windows();
            if (wins && wins.length > 0) {
              for (let j = 0; j < wins.length; j++) {
                list.push({ pid, processName: name, title: wins[j].name() || name });
              }
            } else {
              list.push({ pid, processName: name, title: name });
            }
          } catch (e) {}
        }
        JSON.stringify(list);
      `;
      const res = await executeCommand(`osascript -l JavaScript -e '${jxa.replace(/'/g, "'\\''")}'`);
      if (res.stdout) {
        const data = JSON.parse(res.stdout.trim());
        return Array.isArray(data) ? data : [data];
      }
      return [];
    } catch {
      return [];
    }
  }

  return [];
}

async function pngSize(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const buf = await fs.readFile(filePath);
    // PNG IHDR: signature 8 byte, rồi width/height big-endian ở offset 16/20.
    if (buf.length >= 24 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch {}
  return null;
}
async function assertScreenshotFile(targetPath: string, tried: string): Promise<{ width: number; height: number }> {
  try {
    const stat = await fs.stat(targetPath);
    if (stat.size === 0) throw new Error("file rỗng");
    const size = await pngSize(targetPath);
    if (size) return size;
    return { width: 1920, height: 1080 };
  } catch {
    throw new Error(`Chụp màn hình thất bại (${tried}): không ghi được file ${targetPath}.`);
  }
}
async function hasCommand(cmd: string): Promise<boolean> {
  const res = await executeCommand(process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`);
  return Boolean(res.stdout?.trim());
}

/**
 * Chụp ảnh màn hình toàn bộ hoặc cửa sổ, lưu vào tệp PNG (Windows & macOS & Linux)
 * Tối ưu đa nền tảng: trước đây nhánh Linux rơi xuống cuối hàm và trả
 * về 1920x1080 dù không ghi file nào — đó là thành công giả. Giờ mọi
 * nhánh đều kiểm chứng file thật trước khi trả về, và Linux thử lần
 * lượt grim (Wayland), gnome-screenshot, scrot, import (ImageMagick).
 */
export async function takeScreenshot(outputPath?: string): Promise<{ filePath: string; width: number; height: number }> {
  const targetPath = outputPath ? path.resolve(outputPath) : path.resolve(`screenshot_${Date.now()}.png`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  if (isWindows) {
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms;
      Add-Type -AssemblyName System.Drawing;
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Drawing;
      using System.Drawing.Imaging;
      using System.Threading;
      using System.Windows.Forms;

      public class DesktopCapture {
          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

          [DllImport("user32.dll", SetLastError = true)]
          public static extern bool SetThreadDesktop(IntPtr hDesktop);

          [DllImport("user32.dll", SetLastError = true)]
          public static extern bool CloseDesktop(IntPtr hDesktop);

          const uint DESKTOP_ALL_ACCESS = 0x01FF;

          public static string Capture(string outputPath) {
              Exception lastEx = null;
              string res = "";
              IntPtr hDesk = OpenDesktop("Default", 0, false, DESKTOP_ALL_ACCESS);
              if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, DESKTOP_ALL_ACCESS);

              Thread t = new Thread(() => {
                  if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
                  try {
                      Rectangle bounds = Screen.PrimaryScreen.Bounds;
                      using (Bitmap bmp = new Bitmap(bounds.Width, bounds.Height)) {
                          using (Graphics g = Graphics.FromImage(bmp)) {
                              g.CopyFromScreen(bounds.Location, Point.Empty, bounds.Size);
                          }
                          bmp.Save(outputPath, ImageFormat.Png);
                      }
                      res = bounds.Width + "x" + bounds.Height;
                  } catch (Exception ex) {
                      lastEx = ex;
                  }
              });

              t.SetApartmentState(ApartmentState.STA);
              t.Start();
              t.Join();
              if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
              if (lastEx != null) throw lastEx;
              return res;
          }
      }
"@ -ReferencedAssemblies "System.Drawing", "System.Windows.Forms";

      [DesktopCapture]::Capture('${targetPath.replace(/'/g, "''")}')
    `;

    const res = await executeCommand(psScript);
    const [w, h] = (res.stdout?.trim() || "1920x1080").split("x").map(Number);
    const verified = await pngSize(targetPath);
    if (!verified && !(await exists(targetPath))) {
      throw new Error(`Chụp màn hình thất bại (PowerShell): ${res.stderr || "không ghi được file " + targetPath}`);
    }

    // Kiểm tra xem ảnh chụp có bị đen thui hoàn toàn không (Black screen detection)
    try {
      const buf = await fs.readFile(targetPath);
      let nonZeroCount = 0;
      for (let i = 0; i < buf.length; i++) {
        if (buf[i] !== 0) nonZeroCount++;
        if (nonZeroCount > 500) break;
      }
      if (nonZeroCount <= 200 && buf.length < 20000) {
        throw new Error(
          "Ảnh chụp màn hình bị đen hoàn toàn: Màn hình máy tính hiện đang bị khóa (Win+L), tắt hoặc ở chế độ chờ (Sleep/DPMS). Vui lòng mở khóa hoặc bật màn hình máy tính."
        );
      }
    } catch {}

    return {
      filePath: targetPath,
      width: verified?.width || w || 1920,
      height: verified?.height || h || 1080
    };
  }

  if (isMac) {
    // Dùng lệnh native screencapture của macOS
    await executeCommand(`/usr/sbin/screencapture -x "${targetPath}"`);
    const size = await assertScreenshotFile(targetPath, "screencapture");
    return { filePath: targetPath, width: size.width, height: size.height };
  }

  if (isLinux) {
    const candidates: Array<[string, string]> = [
      ["grim", `grim "${targetPath}"`],
      ["gnome-screenshot", `gnome-screenshot -f "${targetPath}"`],
      ["scrot", `scrot "${targetPath}"`],
      ["import", `import -window root "${targetPath}"`],
    ];
    const tried: string[] = [];
    for (const [tool, cmd] of candidates) {
      if (!(await hasCommand(tool))) continue;
      tried.push(tool);
      await executeCommand(cmd);
      try {
        const size = await assertScreenshotFile(targetPath, tool);
        return { filePath: targetPath, width: size.width, height: size.height };
      } catch {}
    }
    throw new Error(
      `Chụp màn hình chưa hỗ trợ trên Linux này: đã thử ${tried.join(", ") || "không có công cụ nào"} ` +
      `(cần một trong: grim, gnome-screenshot, scrot, ImageMagick import) và cần có màn hình thật (DISPLAY/WAYLAND_DISPLAY).`
    );
  }

  throw new Error(`Chụp màn hình chưa hỗ trợ trên ${process.platform}.`);
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/**
 * Di chuyển và click chuột tại toạ độ (x, y) (Windows & macOS)
 */
export async function mouseAction(action: "left_click" | "right_click" | "double_click" | "move", x: number, y: number): Promise<string> {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    const psScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Threading;

      public class NativeMouse {
          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
          [DllImport("user32.dll", SetLastError = true)]
          public static extern bool SetThreadDesktop(IntPtr hDesktop);
          [DllImport("user32.dll", SetLastError = true)]
          public static extern bool CloseDesktop(IntPtr hDesktop);

          [DllImport("user32.dll")]
          public static extern bool SetCursorPos(int X, int Y);
          [DllImport("user32.dll")]
          public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);

          private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
          private const uint MOUSEEVENTF_LEFTUP   = 0x0004;
          private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
          private const uint MOUSEEVENTF_RIGHTUP   = 0x0010;

          public static void Act(string act, int x, int y) {
              IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
              if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x01FF);

              Thread t = new Thread(() => {
                  if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
                  SetCursorPos(x, y);
                  Thread.Sleep(30);
                  if (act == "left_click") {
                      mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, (uint)x, (uint)y, 0, 0);
                  } else if (act == "right_click") {
                      mouse_event(MOUSEEVENTF_RIGHTDOWN | MOUSEEVENTF_RIGHTUP, (uint)x, (uint)y, 0, 0);
                  } else if (act == "double_click") {
                      mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, (uint)x, (uint)y, 0, 0);
                      Thread.Sleep(80);
                      mouse_event(MOUSEEVENTF_LEFTDOWN | MOUSEEVENTF_LEFTUP, (uint)x, (uint)y, 0, 0);
                  }
              });
              t.SetApartmentState(ApartmentState.STA);
              t.Start();
              t.Join();
              if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
          }
      }
"@
      [NativeMouse]::Act('${action}', ${x}, ${y})
    `;

    await executeCommand(psScript);
    return `Thực hiện ${action} tại tọa độ (${x}, ${y}) thành công.`;
  }

  if (isMac) {
    const script = `tell application "System Events" to click at {${x}, ${y}}`;
    await executeCommand(`osascript -e '${script}'`);
    return `Thực hiện ${action} tại tọa độ (${x}, ${y}) trên macOS thành công.`;
  }

  if (process.platform === "linux") {
    if (!(await hasCommand("xdotool"))) {
      return `Thao tác chuột chưa hỗ trợ trên Linux này: cần cài xdotool (X11) — ví dụ: sudo apt install xdotool — và cần có màn hình thật (DISPLAY).`;
    }
    const clickArg = action === "right_click" ? "3" : "1";
    const repeat = action === "double_click" ? "--repeat 2 --delay 80 " : "";
    const res = await executeCommand(`xdotool mousemove ${x} ${y} ${action === "move" ? "" : `click ${repeat}${clickArg}`}`);
    if (res.stderr?.trim()) return `Thao tác chuột thất bại trên Linux (xdotool): ${res.stderr.trim()}`;
    return `Thực hiện ${action} tại tọa độ (${x}, ${y}) trên Linux thành công.`;
  }

  return `Thao tác chuột chưa hỗ trợ trên ${process.platform}.`;
}

/**
 * Gõ văn bản hoặc gửi phím tắt (Windows & macOS)
 */
export async function keyboardAction(keys: string): Promise<string> {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    const psScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Threading;
      using System.Windows.Forms;

      public class NativeKeyboard {
          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
          [DllImport("user32.dll", SetLastError = true)]
          public static extern bool SetThreadDesktop(IntPtr hDesktop);
          [DllImport("user32.dll", SetLastError = true)]
          public static extern bool CloseDesktop(IntPtr hDesktop);

          public static void Send(string keys) {
              IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
              if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x01FF);

              Thread t = new Thread(() => {
                  if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);
                  SendKeys.SendWait(keys);
              });
              t.SetApartmentState(ApartmentState.STA);
              t.Start();
              t.Join();
              if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
          }
      }
"@ -ReferencedAssemblies "System.Windows.Forms";
      [NativeKeyboard]::Send('${keys.replace(/'/g, "''")}')
    `;

    await executeCommand(psScript);
    return `Đã gửi phím / văn bản: "${keys}"`;
  }

  if (isMac) {
    let script: string;
    if (keys === "{ENTER}") {
      script = `tell application "System Events" to key code 36`;
    } else if (keys === "{TAB}") {
      script = `tell application "System Events" to key code 48`;
    } else if (keys === "^c") {
      script = `tell application "System Events" to keystroke "c" using command down`;
    } else if (keys === "^v") {
      script = `tell application "System Events" to keystroke "v" using command down`;
    } else {
      const safe = keys.replace(/"/g, '\\"');
      script = `tell application "System Events" to keystroke "${safe}"`;
    }

    await executeCommand(`osascript -e '${script}'`);
    return `Đã gửi phím / văn bản trên macOS: "${keys}"`;
  }

  if (process.platform === "linux") {
    if (!(await hasCommand("xdotool"))) {
      return `Thao tác bàn phím chưa hỗ trợ trên Linux này: cần cài xdotool (X11) — ví dụ: sudo apt install xdotool — và cần có màn hình thật (DISPLAY).`;
    }
    const keyMap: Record<string, string> = { "{ENTER}": "Return", "{TAB}": "Tab", "^c": "ctrl+c", "^v": "ctrl+v" };
    const mapped = keyMap[keys];
    const res = mapped
      ? await executeCommand(`xdotool key ${mapped}`)
      : await executeCommand(`xdotool type -- "${keys.replace(/"/g, '\\"')}"`);
    if (res.stderr?.trim()) return `Thao tác bàn phím thất bại trên Linux (xdotool): ${res.stderr.trim()}`;
    return `Đã gửi phím / văn bản trên Linux: "${keys}"`;
  }

  return `Thao tác bàn phím chưa hỗ trợ trên ${process.platform}.`;
}

/**
 * Đọc danh mục công cụ CUA của OpenAI (nếu có driver sdk trong hệ thống hoặc bin/cua)
 */
export async function getCuaToolList(): Promise<any[]> {
  const ext = process.platform === "darwin" ? "dylib" : (process.platform === "win32" ? "dll" : "so");
  const fileName = `cua_driver_sdk.${ext}`;
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.resolve("tools/cua", fileName),
    path.join(exeDir, "tools", "cua", fileName),
    path.join(process.cwd(), "tools", "cua", fileName),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Otter", "tools", "cua", fileName) : "",
    path.resolve("bin/cua", fileName),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Cua", "cua-driver", "bin", fileName) : "",
    path.join(os.homedir(), ".cua-driver", "packages", "current", fileName)
  ].filter(Boolean);

  let dllPath = "";
  for (const c of candidates) {
    try {
      await fs.access(c);
      dllPath = c;
      break;
    } catch {}
  }

  if (!dllPath) {
    return [{ error: `Cannot load CUA library (${ext}): cua_driver_sdk not found in tools/cua/ or system.` }];
  }

  try {
    const { dlopen, FFIType, ptr, toArrayBuffer } = await import("bun:ffi");
    const lib = dlopen(dllPath, {
      cua_driver_create_v1: {
        args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
      cua_driver_destroy_v1: {
        args: [FFIType.ptr],
        returns: FFIType.void,
      },
      cua_driver_list_tools_json_v1: {
        args: [FFIType.ptr, FFIType.ptr, FFIType.ptr],
        returns: FFIType.i32,
      },
      cua_driver_buffer_free_v1: {
        args: [FFIType.ptr],
        returns: FFIType.void,
      }
    });

    const handleBuf = new BigUint64Array(1);
    const errorBuf = new Uint8Array(24);
    const emptyOptions = Buffer.from("{}");

    lib.symbols.cua_driver_create_v1(
      ptr(emptyOptions),
      BigInt(emptyOptions.length),
      ptr(handleBuf),
      ptr(errorBuf)
    );

    const handle = handleBuf[0];
    const toolsBuffer = new Uint8Array(24);
    lib.symbols.cua_driver_list_tools_json_v1(handle, ptr(toolsBuffer), ptr(errorBuf));

    const view = new DataView(toolsBuffer.buffer, toolsBuffer.byteOffset, toolsBuffer.byteLength);
    const dataPtr = view.getBigUint64(0, true);
    const dataLen = Number(view.getBigUint64(8, true));

    const ab = toArrayBuffer(dataPtr, 0, dataLen);
    const jsonStr = new TextDecoder().decode(ab);
    const parsed = JSON.parse(jsonStr);

    lib.symbols.cua_driver_buffer_free_v1(ptr(toolsBuffer));
    lib.symbols.cua_driver_destroy_v1(ptr(handleBuf));

    return Array.isArray(parsed) ? parsed : parsed.tools || [];
  } catch (err: any) {
    return [{ error: `Cannot load CUA library (${ext}): ${err.message}` }];
  }
}

/**
 * Tìm đường dẫn file thực thi cua-driver trên hệ thống
 */
export async function findCuaDriverExe(): Promise<string> {
  const isWindows = process.platform === "win32";
  const ext = isWindows ? ".exe" : "";
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.resolve(`tools/cua/cua-driver${ext}`),
    path.join(exeDir, "tools", "cua", `cua-driver${ext}`),
    path.join(process.cwd(), "tools", "cua", `cua-driver${ext}`),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Otter", "tools", "cua", `cua-driver${ext}`) : "",
    path.resolve(`bin/cua/cua-driver${ext}`),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "Cua", "cua-driver", "bin", `cua-driver${ext}`) : "",
    path.join(os.homedir(), ".cua-driver", "packages", "current", `cua-driver${ext}`)
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {}
  }

  throw new Error(`Không tìm thấy file thực thi cua-driver tại tools/cua/cua-driver${ext}`);
}

/**
 * Thực thi một công cụ CUA (Computer-Use Agent) từ trycua/cua
 */
export async function executeCuaTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
  const isWindows = process.platform === "win32";
  const driverExe = await findCuaDriverExe();

  // Đảm bảo daemon CUA đang chạy
  try {
    const statusRes = await executeCommand(`"${driverExe}" status`);
    if (!statusRes.stdout?.toLowerCase().includes("running")) {
      const { spawn } = await import("bun");
      spawn({
        cmd: [driverExe, "serve", "--no-overlay"],
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore"
      });
      await new Promise(r => setTimeout(r, 600));
    }
  } catch {}

  const jsonArg = JSON.stringify(args || {});
  const cmd = isWindows
    ? `& "${driverExe}" call ${toolName} '${jsonArg.replace(/'/g, "''")}'`
    : `"${driverExe}" call ${toolName} '${jsonArg.replace(/'/g, "'\\''")}'`;
  const res = await executeCommand(cmd);

  if (res.exitCode !== 0 && (!res.stdout || res.stderr)) {
    throw new Error(`Lỗi CUA (${res.exitCode}): ${res.stderr || res.stdout}`);
  }

  try {
    return JSON.parse(res.stdout);
  } catch {
    return res.stdout || "Success";
  }
}

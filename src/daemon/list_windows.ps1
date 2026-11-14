# List visible top-level windows on interactive desktop
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using System.Diagnostics;

public class WinLister {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    const uint DESKTOP_ALL_ACCESS = 0x01FF;

    public class WinItem {
        public int pid { get; set; }
        public string processName { get; set; }
        public string title { get; set; }
    }

    public static string GetWindowsJson() {
        var items = new List<WinItem>();
        IntPtr hDesk = OpenDesktop("Default", 0, false, DESKTOP_ALL_ACCESS);
        if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, DESKTOP_ALL_ACCESS);

        Thread t = new Thread(() => {
            if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);

            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                    var sb = new StringBuilder(512);
                    GetWindowText(hWnd, sb, 512);
                    string title = sb.ToString();
                    if (!string.IsNullOrWhiteSpace(title) && title != "Program Manager") {
                        uint pid;
                        GetWindowThreadProcessId(hWnd, out pid);
                        string procName = "";
                        try {
                            using (var p = Process.GetProcessById((int)pid)) {
                                procName = p.ProcessName;
                            }
                        } catch {}

                        items.Add(new WinItem {
                            pid = (int)pid,
                            processName = procName,
                            title = title
                        });
                    }
                }
                return true;
            }, IntPtr.Zero);
        });

        t.SetApartmentState(ApartmentState.STA);
        t.Start();
        t.Join();
        if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);

        var sbJson = new StringBuilder();
        sbJson.Append("[");
        for (int i = 0; i < items.Count; i++) {
            var item = items[i];
            if (i > 0) sbJson.Append(",");
            sbJson.AppendFormat("{{\"pid\":{0},\"processName\":{1},\"title\":{2}}}",
                item.pid,
                "\"" + (item.processName ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"",
                "\"" + (item.title ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"");
        }
        sbJson.Append("]");
        return sbJson.ToString();
    }
}
'@

try {
    $res = [WinLister]::GetWindowsJson()
    if ($res -and $res -ne "[]") {
        Write-Output $res
        exit 0
    }
} catch {}

# Fallback
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) }
$items = @()
foreach ($p in $procs) {
    $items += [PSCustomObject]@{
        pid = $p.Id
        processName = $p.ProcessName
        title = $p.MainWindowTitle
    }
}
$items | ConvertTo-Json -Compress

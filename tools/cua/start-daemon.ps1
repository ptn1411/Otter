$exe = (Resolve-Path "$PSScriptRoot\cua-driver.exe").Path
$status = & "$exe" status 2>$null
if ($status -and ($status -match "running")) {
    Write-Host "[+] CUA Daemon is already running."
    exit 0
}

$code = @"
using System;
using System.Runtime.InteropServices;

public class CuaDaemonLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenDesktop(string lpszDesktop, uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool CloseDesktop(IntPtr hDesktop);

    public static void RunForever(string exe, string args, string dir) {
        IntPtr hDesk = OpenDesktop("Default", 0, false, 0x01FF);
        if (hDesk == IntPtr.Zero) hDesk = OpenInputDesktop(0, false, 0x01FF);
        if (hDesk != IntPtr.Zero) SetThreadDesktop(hDesk);

        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = @"WinSta0\Default";
        si.dwFlags = 1;
        si.wShowWindow = 0;
        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

        string cmd = "\"" + exe + "\" " + args;
        bool ok = CreateProcess(null, cmd, IntPtr.Zero, IntPtr.Zero, false, 0x08000000, IntPtr.Zero, dir, ref si, out pi);
        if (hDesk != IntPtr.Zero) CloseDesktop(hDesk);
        if (!ok) throw new Exception("CreateProcess error: " + Marshal.GetLastWin32Error());
        
        Console.WriteLine("CUA Daemon started with PID " + pi.dwProcessId + " on WinSta0\\Default");
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    }
}
"@
Add-Type -TypeDefinition $code
$exe = (Resolve-Path "$PSScriptRoot\cua-driver.exe").Path
$dir = Split-Path $exe
[CuaDaemonLauncher]::RunForever($exe, "serve --no-overlay", $dir)

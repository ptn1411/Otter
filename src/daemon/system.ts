import { spawn } from "bun";

export interface PickerResult {
  path: string | null;
  paths?: string[];
  error?: string;
}

export type FolderPickerResult = PickerResult;

function escapePsSingleQuote(str: string): string {
  return str.replace(/'/g, "''");
}

/**
 * Mở hộp thoại chọn thư mục (Hỗ trợ cả Windows và macOS)
 */
export async function openFolderPicker(initialPath?: string): Promise<PickerResult> {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    const safePath = escapePsSingleQuote(initialPath || "");
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = "Chọn thư mục dự án làm việc với Otter"
$dialog.ShowNewFolderButton = $true
$dialog.AutoUpgradeEnabled = $true
$init = '${safePath}'
if ($init -and (Test-Path -LiteralPath $init)) {
  if (Test-Path -LiteralPath $init -PathType Leaf) {
    $dialog.SelectedPath = [System.IO.Path]::GetDirectoryName($init)
  } else {
    $dialog.SelectedPath = $init
  }
}
$topForm = New-Object System.Windows.Forms.Form
$topForm.TopMost = $true
$res = $dialog.ShowDialog($topForm)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
} else {
  Write-Output "::CANCELED::"
}
`;

    try {
      const proc = spawn({
        cmd: ["powershell.exe", "-NoProfile", "-Sta", "-Command", psScript],
        stdout: "pipe",
        stderr: "pipe"
      });

      const stdout = (await new Response(proc.stdout).text()).trim();
      await proc.exited;

      if (!stdout || stdout === "::CANCELED::") {
        return { path: null };
      }
      return { path: stdout, paths: [stdout] };
    } catch (err: any) {
      console.error("[System] openFolderPicker Windows error:", err);
      return { path: null, error: err.message };
    }
  }

  if (isMac) {
    try {
      const script = initialPath
        ? `POSIX path of (choose folder with prompt "Chọn thư mục dự án làm việc với Otter" default location POSIX file "${initialPath.replace(/"/g, '\\"')}")`
        : `POSIX path of (choose folder with prompt "Chọn thư mục dự án làm việc với Otter")`;

      const proc = spawn({
        cmd: ["osascript", "-e", script],
        stdout: "pipe",
        stderr: "pipe"
      });

      const stdout = (await new Response(proc.stdout).text()).trim();
      const exitCode = await proc.exited;

      if (exitCode !== 0 || !stdout) {
        return { path: null };
      }

      const cleanPath = stdout.replace(/\/+$/, "");
      return { path: cleanPath, paths: [cleanPath] };
    } catch (err: any) {
      console.error("[System] openFolderPicker macOS error:", err);
      return { path: null, error: err.message };
    }
  }

  return { path: null, error: `Hệ điều hành ${process.platform} chưa hỗ trợ hộp thoại GUI native` };
}

/**
 * Mở hộp thoại chọn tệp tin (Hỗ trợ cả Windows và macOS)
 */
export async function openFilePicker(initialPath?: string, multiple: boolean = false): Promise<PickerResult> {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWindows) {
    const safePath = escapePsSingleQuote(initialPath || "");
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = "Chọn tệp làm việc với Otter"
$dialog.Filter = "Tất cả các tệp (*.*)|*.*"
$dialog.AutoUpgradeEnabled = $true
$dialog.Multiselect = ${multiple ? "$true" : "$false"}
$init = '${safePath}'
if ($init -and (Test-Path -LiteralPath $init)) {
  if (Test-Path -LiteralPath $init -PathType Leaf) {
    $dialog.FileName = $init
    $dialog.InitialDirectory = [System.IO.Path]::GetDirectoryName($init)
  } else {
    $dialog.InitialDirectory = $init
  }
}
$topForm = New-Object System.Windows.Forms.Form
$topForm.TopMost = $true
$res = $dialog.ShowDialog($topForm)
if ($res -eq [System.Windows.Forms.DialogResult]::OK) {
  $dialog.FileNames | ForEach-Object { Write-Output $_ }
} else {
  Write-Output "::CANCELED::"
}
`;

    try {
      const proc = spawn({
        cmd: ["powershell.exe", "-NoProfile", "-Sta", "-Command", psScript],
        stdout: "pipe",
        stderr: "pipe"
      });

      const stdout = (await new Response(proc.stdout).text()).trim();
      await proc.exited;

      if (!stdout || stdout === "::CANCELED::") {
        return { path: null };
      }

      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        return { path: null };
      }
      return {
        path: lines[0],
        paths: lines
      };
    } catch (err: any) {
      console.error("[System] openFilePicker Windows error:", err);
      return { path: null, error: err.message };
    }
  }

  if (isMac) {
    try {
      let script: string;
      if (multiple) {
        script = `
set fileList to choose file with prompt "Chọn tệp làm việc với Otter" multiple selections allowed true
set outStr to ""
repeat with aFile in fileList
  set outStr to outStr & POSIX path of aFile & linefeed
end repeat
return outStr
`;
      } else {
        script = `POSIX path of (choose file with prompt "Chọn tệp làm việc với Otter")`;
      }

      const proc = spawn({
        cmd: ["osascript", "-e", script],
        stdout: "pipe",
        stderr: "pipe"
      });

      const stdout = (await new Response(proc.stdout).text()).trim();
      const exitCode = await proc.exited;

      if (exitCode !== 0 || !stdout) {
        return { path: null };
      }

      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      return {
        path: lines[0] || null,
        paths: lines
      };
    } catch (err: any) {
      console.error("[System] openFilePicker macOS error:", err);
      return { path: null, error: err.message };
    }
  }

  return { path: null, error: `Hệ điều hành ${process.platform} chưa hỗ trợ hộp thoại GUI native` };
}

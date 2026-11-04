# List visible top-level windows or interactive GUI processes
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and -not [string]::IsNullOrWhiteSpace($_.MainWindowTitle) }
$items = @()

foreach ($p in $procs) {
    $items += [PSCustomObject]@{
        pid = $p.Id
        processName = $p.ProcessName
        title = $p.MainWindowTitle
    }
}

if ($items.Count -eq 0) {
    # If MainWindowHandle is 0 (e.g. non-interactive context), list active user apps in current session
    $currentSessionId = (Get-Process -Id $PID).SessionId
    $userApps = Get-Process | Where-Object { 
        $_.SessionId -eq $currentSessionId -and 
        $_.ProcessName -notmatch '^(svchost|csrss|winlogon|smss|system|idle|conhost|runtimebroker|sihost|explorer|searchhost|taskhostw|fontdrvhost|dwm)$' 
    } | Select-Object -First 15

    foreach ($p in $userApps) {
        $items += [PSCustomObject]@{
            pid = $p.Id
            processName = $p.ProcessName
            title = if ($p.MainWindowTitle) { $p.MainWindowTitle } else { "$($p.ProcessName) (PID $($p.Id))" }
        }
    }
}

$items | ConvertTo-Json -Compress

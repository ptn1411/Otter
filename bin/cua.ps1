param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
)

$candidates = @(
    (Join-Path $PSScriptRoot "..\tools\cua\cua-driver.exe"),
    (Join-Path $PSScriptRoot "tools\cua\cua-driver.exe"),
    (Join-Path $env:LOCALAPPDATA "Otter\tools\cua\cua-driver.exe"),
    (Join-Path $HOME ".cua-driver\packages\current\cua-driver.exe")
)

foreach ($c in $candidates) {
    if (Test-Path $c) {
        & $c @Args
        exit $LASTEXITCODE
    }
}

otter cua @Args
exit $LASTEXITCODE

[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$runningDesktop = @(Get-Process -Name 'Docker Desktop','com.docker.backend' -ErrorAction SilentlyContinue)
if ($runningDesktop.Count) {
    throw 'Quit Docker Desktop completely, then run this script again.'
}

$runtimeRoot = [IO.Path]::GetFullPath($env:LOCALAPPDATA)
$runtimeTargets = @(
    [IO.Path]::Combine($runtimeRoot, 'docker-secrets-engine'),
    [IO.Path]::Combine($runtimeRoot, 'Docker', 'run')
)
$repairStamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')

# Preflight both exact runtime directories before changing either one.
foreach ($runtimeTarget in $runtimeTargets) {
    $resolvedTarget = [IO.Path]::GetFullPath($runtimeTarget)
    if (-not $resolvedTarget.StartsWith($runtimeRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The target is outside the expected LocalAppData directory.'
    }
    if (-not (Test-Path -LiteralPath $resolvedTarget)) { continue }
    $directoryInfo = Get-Item -Force -LiteralPath $resolvedTarget
    if (-not $directoryInfo.PSIsContainer -or ($directoryInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw ('Unexpected directory type. No changes made: ' + $resolvedTarget)
    }
    $entries = @(Get-ChildItem -Force -LiteralPath $resolvedTarget)
    if ($entries | Where-Object { $_.PSIsContainer -or $_.Length -ne 0 }) {
        throw ('Directory contains data or subdirectories. No changes made: ' + $resolvedTarget)
    }
    if (Test-Path -LiteralPath ($resolvedTarget + '.mgo-backup-' + $repairStamp)) {
        throw 'Backup target already exists. No changes made.'
    }
}

foreach ($runtimeTarget in $runtimeTargets) {
    if (-not (Test-Path -LiteralPath $runtimeTarget)) { continue }
    $directoryInfo = Get-Item -Force -LiteralPath $runtimeTarget
    $backupName = $directoryInfo.Name + '.mgo-backup-' + $repairStamp
    if ($PSCmdlet.ShouldProcess($runtimeTarget, 'Preserve the socket-only runtime directory by renaming it, then create a new directory')) {
        Rename-Item -LiteralPath $runtimeTarget -NewName $backupName
        New-Item -ItemType Directory -Path $runtimeTarget | Out-Null
        Write-Output ('Preserved original directory: ' + [IO.Path]::Combine($directoryInfo.Parent.FullName, $backupName))
    }
}

if (-not $WhatIfPreference) {
    $desktopExecutable = [IO.Path]::Combine($env:ProgramFiles, 'Docker', 'Docker', 'Docker Desktop.exe')
    if (Test-Path -LiteralPath $desktopExecutable) {
        Start-Process -FilePath $desktopExecutable -WindowStyle Hidden
        Write-Output 'Docker Desktop restarted. Run docker info when it is ready.'
    }
}

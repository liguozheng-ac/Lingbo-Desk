$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$rootProcessId = [int]$request.rootProcessId
if ($rootProcessId -le 0) { throw 'A positive owned root process ID is required' }
# Enumerate only parent relationships; do not collect other applications' command lines.
$relationships = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId)
$ownedIds = [Collections.Generic.HashSet[int]]::new()
[void]$ownedIds.Add($rootProcessId)
do {
    $changed = $false
    foreach ($relationship in $relationships) {
        if ($ownedIds.Contains([int]$relationship.ParentProcessId) -and $ownedIds.Add([int]$relationship.ProcessId)) { $changed = $true }
    }
} while ($changed)
$rows = @()
foreach ($ownedId in $ownedIds) {
    $ownedProcess = Get-Process -Id $ownedId -ErrorAction SilentlyContinue
    if ($null -eq $ownedProcess) { continue }
    $relation = $relationships | Where-Object { [int]$_.ProcessId -eq $ownedId } | Select-Object -First 1
    $rows += [pscustomobject]@{
        pid = $ownedId
        parentPid = [int]$relation.ParentProcessId
        name = $ownedProcess.ProcessName
        privateBytes = [long]$ownedProcess.PrivateMemorySize64
        workingSetBytes = [long]$ownedProcess.WorkingSet64
        handles = [int]$ownedProcess.HandleCount
        threads = [int]$ownedProcess.Threads.Count
        cpuSeconds = [double]$ownedProcess.TotalProcessorTime.TotalSeconds
    }
}
ConvertTo-Json -InputObject $rows -Depth 4 -Compress

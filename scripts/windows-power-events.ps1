$ErrorActionPreference = 'Stop'
$modernDefinitions = $false
try {
    $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $since = [DateTimeOffset]::Parse($inputData.since)
    $until = [DateTimeOffset]::Parse($inputData.until)
    if ($until -le $since) { throw 'Invalid observation window' }
    $window = @{ since = $since.UtcDateTime.ToString('o'); until = $until.UtcDateTime.ToString('o') }
    try {
        $definedIds = @((Get-WinEvent -ListProvider 'Microsoft-Windows-Kernel-Power' -ErrorAction Stop).Events.Id)
        $modernDefinitions = ($definedIds -contains 506) -and ($definedIds -contains 507)
    } catch { $modernDefinitions = $false }
    # Only event identity, time and optional numeric cycle IDs. Never export
    # event messages, audio, battery data, usernames or device details.
    $raw = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; StartTime = $since.LocalDateTime; EndTime = $until.LocalDateTime; ProviderName = @('Microsoft-Windows-Kernel-Power', 'Microsoft-Windows-Power-Troubleshooter'); Id = @(1, 42, 107, 506, 507) } -MaxEvents 201 -ErrorAction Stop)
    $events = @($raw | Select-Object -First 200 | ForEach-Object {
        $item = @{ id = $_.Id; provider = $_.ProviderName; recordId = $_.RecordId; at = $_.TimeCreated.ToUniversalTime().ToString('o') }
        if ($_.ProviderName -eq 'Microsoft-Windows-Kernel-Power' -and $_.Id -in @(506,507)) {
            $xml = [xml]$_.ToXml()
            foreach ($field in @(@('ScenarioInstanceIdV2','scenarioIdV2'), @('ScenarioInstanceId','scenarioId'), @('BootId','bootId'))) {
                $value = @($xml.Event.EventData.Data | Where-Object Name -eq $field[0])
                if ($value.Count -eq 1 -and $value[0].InnerText -match '^\d{1,20}$') { $item[$field[1]] = $value[0].InnerText }
            }
        }
        $item
    })
    @{ available = $true; events = $events; truncated = ($raw.Count -gt 200); window = $window; modernStandbyDefinitionsAvailable = $modernDefinitions } | ConvertTo-Json -Depth 5 -Compress
} catch {
    if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') {
        @{ available = $true; events = @(); truncated = $false; window = $window; modernStandbyDefinitionsAvailable = $modernDefinitions } | ConvertTo-Json -Depth 4 -Compress
    } else {
        @{ available = $false; events = @(); reason = 'Power event metadata unavailable'; modernStandbyDefinitionsAvailable = $modernDefinitions } | ConvertTo-Json -Compress
    }
}

$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = '9B6F8915F688B8709643092E452BCB778CA985BBEE2DAE80E1EFCEFC35DF331D'
$expectedPreflightSha256 = '6451DED6DEA1DC6CCC59FED84D348D9358E1A6976C2F72AB5E44B022842967E5'
$preflightFile = Join-Path $PSScriptRoot 'preflight_20261031160000.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261031160000_organization_twilio_calling.sql'

foreach ($file in @($preflightFile,$migrationFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
$sha = [Security.Cryptography.SHA256]::Create()
try {
    $actualHash = [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($migrationFile))).Replace('-','').ToUpperInvariant()
}
finally { $sha.Dispose() }
if (-not [string]::Equals($actualHash,$expectedMigrationSha256,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Migration checksum mismatch; expected $expectedMigrationSha256, found $actualHash. No SQL was run."
}
$preflightSha = [Security.Cryptography.SHA256]::Create()
try {
    $actualPreflightHash = [BitConverter]::ToString($preflightSha.ComputeHash([IO.File]::ReadAllBytes($preflightFile))).Replace('-','').ToUpperInvariant()
}
finally { $preflightSha.Dispose() }
if (-not [string]::Equals($actualPreflightHash,$expectedPreflightSha256,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Preflight checksum mismatch; expected $expectedPreflightSha256, found $actualPreflightHash. No Docker or SQL command was run."
}

$facts = & docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $expectedContainerId
if ($LASTEXITCODE -ne 0) { throw 'Docker inspection failed; no database command was run.' }
$parts = $facts -split '\|',4
if ($parts.Count -ne 4 -or $parts[0] -ne $expectedContainerId -or $parts[1] -ne $expectedContainerName -or
    $parts[2] -ne 'running' -or $parts[3] -ne 'healthy') {
    throw 'Container identity/state/health mismatch; no database command was run.'
}

$oldEap = $ErrorActionPreference
$nativePreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
try {
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $output = Get-Content -Raw -LiteralPath $preflightFile |
        & docker exec -i $expectedContainerId psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 2>&1
    $exitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $oldEap
    if ($null -ne $nativePreference) { $PSNativeCommandUseErrorActionPreference = $nativePreference.Value }
    else { Remove-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue }
}
$outputText = ($output | ForEach-Object { [string]$_ }) -join "`n"
$output | Write-Output
if ($exitCode -ne 0) { throw "Read-only Twilio preflight failed; psql/docker exit code $exitCode." }
if ($outputText -notmatch 'TWILIO_PREFLIGHT_SAFE_TO_APPLY\|PASS\|target=20261031160000') {
    throw 'Twilio preflight did not emit the exact safe-to-apply marker. Stop for review.'
}
Write-Output "TWILIO_PREFLIGHT_RUNNER|PASS|container=$expectedContainerName migration_sha256=$actualHash preflight_sha256=$actualPreflightHash"

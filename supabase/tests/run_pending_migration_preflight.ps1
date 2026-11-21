$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$preflightFile = Join-Path $PSScriptRoot 'preflight_pending_migrations.sql'

$inspection = & docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $expectedContainerId
if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect the designated local validation container.'
}

$containerFacts = $inspection -split '\|', 4
if ($containerFacts.Count -ne 4 -or
    $containerFacts[0] -ne $expectedContainerId -or
    $containerFacts[1] -ne $expectedContainerName -or
    $containerFacts[2] -ne 'running' -or
    $containerFacts[3] -ne 'healthy') {
    throw 'Container identity or health differs from the approved isolated validation target.'
}
if (-not (Test-Path -LiteralPath $preflightFile -PathType Leaf)) {
    throw 'Read-only preflight SQL file is missing.'
}

# The SQL file itself checks database name, connected role, PostgreSQL 17,
# container port, history state, and read-only execution readiness.
$sqlText = Get-Content -Raw -LiteralPath $preflightFile
$priorErrorActionPreference = $ErrorActionPreference
$nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
try {
    # PowerShell 7 can promote native stderr (including PostgreSQL NOTICE) to
    # error records. Capture it as output and use psql's exit code to detect SQL
    # errors; ON_ERROR_STOP remains enabled and no stderr is discarded.
    $ErrorActionPreference = 'Continue'
    $PSNativeCommandUseErrorActionPreference = $false
    $output = $sqlText |
        & docker exec -i $expectedContainerId psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 2>&1
    $psqlExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $priorErrorActionPreference
    if ($null -ne $nativePreference) {
        $PSNativeCommandUseErrorActionPreference = $nativePreference.Value
    }
    else {
        Remove-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    }
}
$output | Write-Output

if ($psqlExitCode -ne 0) {
    throw "Read-only migration preflight failed with psql exit code $psqlExitCode."
}

$combinedOutput = $output -join "`n"
if ($combinedOutput -notmatch 'PREFLIGHT_SAFE_TO_APPLY\|PASS\|history prerequisites recorded exactly-once target_20261031150000=ABSENT') {
    throw 'Preflight did not report the exact safe-to-apply result; do not apply the migration.'
}
if ($combinedOutput -match 'PREFLIGHT_BLOCKED\|FAIL\|') {
    throw 'Preflight reported a blocking condition; do not apply the migration.'
}

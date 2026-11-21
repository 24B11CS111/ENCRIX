$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = 'C8D70B7C601E10F9F7BF1C4566C07AEBA63ECAC93B41E2072FBE7FA4DED243B7'
$expectedPreflightSha256 = '772B5BD2A77D9E31373CDB02A721AD2F473126DD44CA6176EB9572E6FCF5C138'
$preflightFile = Join-Path $PSScriptRoot 'preflight_20261031180000.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261031180000_paid_subscription_entitlement_gate.sql'
$regressionFile = Join-Path $PSScriptRoot 'paid_subscription_entitlement_gate.test.sql'

function Get-Sha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-', '').ToUpperInvariant() }
    finally { $algorithm.Dispose() }
}

function Invoke-LocalPsql {
    param([Parameter(Mandatory=$true)][string]$SqlText,[Parameter(Mandatory=$true)][string]$Stage,[switch]$TuplesOnly)
    $arguments = @('-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1')
    if ($TuplesOnly) { $arguments += '-At' }
    $oldEap = $ErrorActionPreference
    $nativePreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    $output = @()
    $exitCode = $null
    try {
        $ErrorActionPreference = 'Continue'
        $PSNativeCommandUseErrorActionPreference = $false
        $output = @($SqlText | & docker exec -i $expectedContainerId psql @arguments 2>&1)
        $exitCode = [int]$LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldEap
        if ($null -ne $nativePreference) { $PSNativeCommandUseErrorActionPreference = $nativePreference.Value }
        else { Remove-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue }
    }
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    if ($exitCode -ne 0) {
        $diagnostics = if ([string]::IsNullOrWhiteSpace($text)) { '<no process output>' } else { $text }
        throw "$Stage failed; process exit code $exitCode. Complete output:`n$diagnostics`nStopped without retry or repair."
    }
    return [pscustomobject]@{ Output=$output; Text=$text; ExitCode=$exitCode }
}

function Assert-Marker([string]$Text,[string]$Marker,[string]$Stage) {
    if ($Text.IndexOf($Marker,[StringComparison]::Ordinal) -lt 0) { throw "$Stage did not emit required marker: $Marker" }
}

# Pin and validate all source bytes before invoking Docker or PostgreSQL.
foreach ($file in @($migrationFile,$preflightFile,$regressionFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
$migrationSha256 = Get-Sha256 $migrationFile
if ($migrationSha256 -cne $expectedMigrationSha256) { throw "Migration checksum mismatch: expected $expectedMigrationSha256, found $migrationSha256. No Docker/SQL command ran." }
$preflightSha256 = Get-Sha256 $preflightFile
if ($preflightSha256 -cne $expectedPreflightSha256) { throw "Preflight checksum mismatch: expected $expectedPreflightSha256, found $preflightSha256. No Docker/SQL command ran." }
$migrationSql = [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($migrationFile))
if (([regex]::Matches($migrationSql,'(?im)^BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($migrationSql,'(?im)^COMMIT\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($migrationSql,'(?im)^\s*(ROLLBACK|SAVEPOINT|RELEASE)\b') -or
    [regex]::IsMatch($migrationSql,'(?i)CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY')) {
    throw 'Migration transaction structure differs from the reviewed transactional source.'
}
$migrationBody = [regex]::new('(?im)^BEGIN\s*;\s*').Replace($migrationSql,'',1)
$migrationBody = [regex]::new('(?im)^COMMIT\s*;\s*\z').Replace($migrationBody,'',1)
if ($migrationBody -eq $migrationSql) { throw 'Could not isolate migration body.' }

$testText = Get-Content -Raw -LiteralPath $regressionFile
if (([regex]::Matches($testText,'(?im)^\s*BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($testText,'(?im)^\s*ROLLBACK\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($testText,'(?im)^\s*COMMIT\s*;') -or
    [regex]::IsMatch($testText,'(?im)^\s*\\(connect|include|ir|i|!)\b')) {
    throw 'Entitlement regression test is not a single rollback-only transaction.'
}
$testWithoutSet = [regex]::Replace($testText,'(?im)^\s*\\set\s+ON_ERROR_STOP\s+on\s*\r?\n','')
if ($testWithoutSet -eq $testText) { throw 'Expected psql ON_ERROR_STOP directive was not found.' }
$testWithoutSet = [regex]::new('(?im)^\s*BEGIN\s*;\s*').Replace($testWithoutSet,'',1)
$testBody = [regex]::new('(?im)^\s*ROLLBACK\s*;\s*\z').Replace($testWithoutSet,'',1)
if ($testBody -eq $testWithoutSet -or ([regex]::Matches($testBody,'(?im)^\s*DO\s+\$[A-Za-z_][A-Za-z0-9_]*\$')).Count -ne 1) {
    throw 'Could not isolate the one assertion DO block from the rollback-only regression test.'
}

Write-Output "MIGRATION_SHA256=$migrationSha256"
Write-Output "PREFLIGHT_SHA256=$preflightSha256"
$facts = & docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $expectedContainerId
$dockerExit = [int]$LASTEXITCODE
if ($dockerExit -ne 0) { throw "Docker inspect failed with exit code $dockerExit; no SQL ran." }
$parts = $facts -split '\|',4
if ($parts.Count -ne 4 -or $parts[0] -ne $expectedContainerId -or $parts[1] -ne $expectedContainerName -or
    $parts[2] -ne 'running' -or $parts[3] -ne 'healthy') { throw 'Container ID/name/state/health mismatch; no SQL ran.' }

$identity = Invoke-LocalPsql -Stage 'Local database identity' -TuplesOnly -SqlText @'
SELECT current_database() || '|' || current_user || '|' || session_user || '|'
  || current_setting('server_version_num') || '|' || current_setting('port');
'@
if ($identity.Text.Trim() -notmatch '^postgres\|postgres\|postgres\|17[0-9]{4}\|5432$') {
    throw "Database identity mismatch: $($identity.Text.Trim())"
}
Write-Output "DATABASE_IDENTITY=$($identity.Text.Trim())"

$preflightSql = [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($preflightFile))
$preflight = Invoke-LocalPsql -Stage 'Read-only migration 180000 preflight' -SqlText $preflightSql
$preflight.Output | Write-Output
Assert-Marker $preflight.Text 'ENTITLEMENT_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031180000' 'Entitlement preflight'

$catalogAndHistory = @'
DO $entitlement_postcheck$
DECLARE v_fn oid; v_actual record; v_definition text; v_count bigint;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN RAISE EXCEPTION 'local database identity guard failed'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>0 THEN
    RAISE EXCEPTION 'migration 180000 history precondition changed';
  END IF;
  v_fn := pg_catalog.to_regprocedure('public.organization_has_active_paid_entitlement(uuid)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'entitlement function was not created'; END IF;
  SELECT p.*,pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,l.lanname
    INTO v_actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=v_fn;
  IF v_actual.owner_name IS DISTINCT FROM 'postgres' OR NOT v_actual.prosecdef
     OR v_actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
     OR v_actual.lanname IS DISTINCT FROM 'sql' OR v_actual.prorettype<>'pg_catalog.bool'::regtype
     OR v_actual.provolatile IS DISTINCT FROM 's' OR v_actual.proisstrict OR v_actual.proparallel IS DISTINCT FROM 'u'
     OR v_actual.pronargs<>1 OR v_actual.proargnames IS DISTINCT FROM ARRAY['p_organization_id']::text[]
     OR v_actual.proargmodes IS NOT NULL THEN RAISE EXCEPTION 'entitlement function metadata mismatch'; END IF;
  v_definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(v_fn));
  IF v_definition NOT LIKE '%s.plan_code = ''business''%'
     OR v_definition NOT LIKE '%s.amount_paise = 999900%'
     OR v_definition NOT LIKE '%s.entitlement_source = ''razorpay''%'
     OR v_definition NOT LIKE '%s.status = ''active''%'
     OR v_definition NOT LIKE '%s.is_current is true%'
     OR v_definition NOT LIKE '%s.checkout_creation_status = ''created''%'
     OR v_definition NOT LIKE '%p.status = ''captured''%'
     OR v_definition NOT LIKE '%p.currency = ''inr''%'
     OR v_definition NOT LIKE '%p.signature_verified_at is not null%'
     OR v_definition NOT LIKE '%p.amount_refunded_paise < p.amount_paise%'
     OR v_definition NOT LIKE '%p.organization_id = s.organization_id%'
     OR v_definition NOT LIKE '%p.paid_at >= s.current_period_start%'
     OR v_definition NOT LIKE '%p.paid_at < s.current_period_end%'
     OR v_definition NOT LIKE '%s.current_period_end > pg_catalog.statement_timestamp()%'
     OR v_definition NOT LIKE '%coalesce(exists%' THEN
    RAISE EXCEPTION 'entitlement function business definition mismatch';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
     OR (SELECT count(*) FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.grantee='service_role'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)<>1
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.grantee IN ('anon'::regrole,'authenticated'::regrole) AND a.privilege_type='EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (v_actual.proowner,'service_role'::regrole)) THEN
    RAISE EXCEPTION 'entitlement function execute ACL mismatch';
  END IF;
  IF NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid FROM pg_catalog.pg_class WHERE oid='public.billing_payments'::regclass)
     OR NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid FROM pg_catalog.pg_class WHERE oid='public.organization_subscriptions'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.billing_payments'::regclass
       AND polname='Service role manages billing payments' AND polroles=ARRAY['service_role'::regrole::oid])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.organization_subscriptions'::regclass
       AND polname='Service role manages organization subscriptions' AND polroles=ARRAY['service_role'::regrole::oid]) THEN
    RAISE EXCEPTION 'billing table RLS/policy contract changed';
  END IF;
  RAISE NOTICE 'ENTITLEMENT_CATALOG_VERIFY|PASS|function metadata, definition, grants and billing RLS verified';
END;
$entitlement_postcheck$;
'@

# One transaction contains the migration, catalog verification, regression body,
# regression-fixture rollback, and history insertion. Any error aborts the batch.
$transactionSql = @"
BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
DO `$entitlement_precondition`$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'local database identity guard failed';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>0 THEN
    RAISE EXCEPTION 'migration history precondition changed';
  END IF;
END;
`$entitlement_precondition`$;
$migrationBody
$catalogAndHistory
SAVEPOINT entitlement_regression_fixtures;
$testBody
ROLLBACK TO SAVEPOINT entitlement_regression_fixtures;
RELEASE SAVEPOINT entitlement_regression_fixtures;
DO `$entitlement_regression_pass`$ BEGIN RAISE NOTICE 'ENTITLEMENT_REGRESSION|PASS|target=20261031180000'; END `$entitlement_regression_pass`$;
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES ('20261031180000',NULL,'paid_subscription_entitlement_gate');
DO `$entitlement_history_verify`$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>1
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261031180000'
       AND statements IS NULL AND name='paid_subscription_entitlement_gate') THEN
    RAISE EXCEPTION 'migration history insert verification failed';
  END IF;
END;
`$entitlement_history_verify`$;
COMMIT;
"@

$execution = Invoke-LocalPsql -Stage 'Atomic entitlement migration, validation, test and history transaction' -SqlText $transactionSql
$execution.Output | Write-Output
Assert-Marker $execution.Text 'ENTITLEMENT_REGRESSION|PASS|target=20261031180000' 'SQL regression assertions'
Write-Output 'MIGRATION_180000|COMMITTED|local isolated validation database'

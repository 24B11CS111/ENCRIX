$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = 'A02F67B8B92DCDB008F755E0BDE033EB4879FB3B187C693520571C525C726D7E'
$expectedPreflightSha256 = '7ED881DE71CBA246FC5A8BF9E50A4751B4652BF1E0196EB60AE6377A91E5A2B2'
$expectedRegressionSha256 = 'BB0593F8E5EBAD6FB1EBEE9010AF13089B7FE9F5474EB1F5B3628BBCD9A99504'
$preflightFile = Join-Path $PSScriptRoot 'preflight_20261101100000.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261101100000_unique_pending_invitations.sql'
$regressionFile = Join-Path $PSScriptRoot 'pending_invitation_uniqueness.test.sql'

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
        $diagnostic = if ([string]::IsNullOrWhiteSpace($text)) { '<no process output>' } else { $text }
        throw "$Stage failed; process exit code $exitCode. Complete output:`n$diagnostic`nStopped without retry or repair."
    }
    return [pscustomobject]@{ Output=$output; Text=$text; ExitCode=$exitCode }
}

function Assert-Marker([string]$Text,[string]$Marker,[string]$Stage) {
    if ($Text.IndexOf($Marker,[StringComparison]::Ordinal) -lt 0) { throw "$Stage did not emit required marker: $Marker" }
}

# Pin and verify all reviewed inputs before any Docker/PostgreSQL command.
foreach ($file in @($preflightFile,$migrationFile,$regressionFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
foreach ($check in @(
    @{ Path=$migrationFile; Expected=$expectedMigrationSha256; Label='Migration' },
    @{ Path=$preflightFile; Expected=$expectedPreflightSha256; Label='Preflight' },
    @{ Path=$regressionFile; Expected=$expectedRegressionSha256; Label='Regression test' }
)) {
    if ($check.Expected -eq 'TO_BE_PINNED') { throw 'Reviewed file checksums must be pinned before this runner can be used.' }
    $actual = Get-Sha256 $check.Path
    if ($actual -cne $check.Expected) { throw "$($check.Label) checksum mismatch: expected $($check.Expected), found $actual. No Docker/SQL command ran." }
    Write-Output "$($check.Label.ToUpperInvariant())_SHA256=$actual"
}

$migrationSql = [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($migrationFile))
$proceduralBlocks = [regex]::Matches($migrationSql,'(?is)\bDO\s+\$\$.*?\$\$\s*;')
if ($proceduralBlocks.Count -ne 1) {
    throw 'Migration procedural block structure differs from the reviewed source.'
}
$topLevelMigrationSql = [regex]::Replace($migrationSql,'(?is)\bDO\s+\$\$.*?\$\$\s*;',' ')
$transactionControlInProcedure = [regex]::IsMatch($proceduralBlocks[0].Value,'(?im)^\s*(COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b')
if ([regex]::IsMatch($topLevelMigrationSql,'(?im)^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b') -or
    $transactionControlInProcedure -or
    [regex]::IsMatch($migrationSql,'(?is)\bCREATE\s+(UNIQUE\s+)?INDEX\s+[^;]*?\bCONCURRENTLY\b')) {
    throw 'Migration contains a transaction-control or non-transactional index statement; reviewed runner cannot wrap it atomically.'
}
$testText = [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($regressionFile))
if (([regex]::Matches($testText,'(?im)^\s*BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($testText,'(?im)^\s*ROLLBACK\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($testText,'(?im)^\s*COMMIT\s*;') -or
    [regex]::IsMatch($testText,'(?im)^\s*\\(connect|include|ir|i|!)\b') -or
    ([regex]::Matches($testText,'(?im)^\s*DO\s+\$pending_invitation_unique_test\$')).Count -ne 1) {
    throw 'Invitation SQL regression is not the reviewed single rollback-only assertion block.'
}
$testBody = [regex]::new('(?im)^\s*BEGIN\s*;\s*').Replace($testText,'',1)
$testBody = [regex]::new('(?im)^\s*ROLLBACK\s*;\s*\z').Replace($testBody,'',1)
if ($testBody -eq $testText) { throw 'Could not isolate the reviewed invitation regression body.' }

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
$preflight = Invoke-LocalPsql -Stage 'Read-only migration 20261101100000 preflight' -SqlText $preflightSql
$preflight.Output | Write-Output
Assert-Marker $preflight.Text 'INVITATION_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101100000' 'Invitation preflight'

$migrationBody = $migrationSql
$postCatalog = @'
DO $invitation_catalog_verify$
DECLARE v_table oid; v_index oid; v_expression text; v_predicate text; v_index_owner text;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'local database identity guard failed';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101090000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101100000')<>0 THEN
    RAISE EXCEPTION 'invitation migration history precondition changed';
  END IF;
  v_table:=pg_catalog.to_regclass('public.organization_invitations');
  SELECT idx.oid,pg_catalog.pg_get_expr(i.indexprs,i.indrelid),pg_catalog.pg_get_expr(i.indpred,i.indrelid),pg_catalog.pg_get_userbyid(idx.relowner)
    INTO v_index,v_expression,v_predicate,v_index_owner
    FROM pg_catalog.pg_class idx JOIN pg_catalog.pg_namespace ns ON ns.oid=idx.relnamespace
    JOIN pg_catalog.pg_index i ON i.indexrelid=idx.oid
   WHERE ns.nspname='public' AND idx.relname='organization_invitations_pending_org_email_uidx';
  IF v_table IS NULL OR v_index IS NULL OR v_index_owner IS DISTINCT FROM 'postgres'
     OR (SELECT i.indrelid FROM pg_catalog.pg_index i WHERE i.indexrelid=v_index) IS DISTINCT FROM v_table
     OR NOT (SELECT i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
                    AND i.indnatts=2 AND i.indnkeyatts=2 AND i.indpred IS NOT NULL
                    AND NOT i.indnullsnotdistinct AND am.amname='btree'
               FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
               JOIN pg_catalog.pg_am am ON am.oid=c.relam WHERE i.indexrelid=v_index)
     OR (SELECT i.indkey[0] FROM pg_catalog.pg_index i WHERE i.indexrelid=v_index) IS DISTINCT FROM
        (SELECT a.attnum FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_table AND a.attname='organization_id' AND a.attnum>0 AND NOT a.attisdropped)
     OR (SELECT i.indkey[1] FROM pg_catalog.pg_index i WHERE i.indexrelid=v_index) IS DISTINCT FROM 0
     OR pg_catalog.regexp_replace(pg_catalog.lower(v_expression),'::character varying(\([0-9]+\))?|::text|[()"[:space:]]|pg_catalog\.','','g') IS DISTINCT FROM 'lowerbtrimemail'
     OR pg_catalog.regexp_replace(pg_catalog.lower(v_predicate),'::character varying(\([0-9]+\))?|::text|[()"[:space:]]|pg_catalog\.','','g') IS DISTINCT FROM 'status=''pending''andemailisnotnull'
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conindid=v_index) THEN
    RAISE EXCEPTION 'pending invitation unique index catalog contract mismatch';
  END IF;
  RAISE NOTICE 'INVITATION_CATALOG_VERIFY|PASS|correct relation, ordered keys, expression, predicate, btree and valid unique index';
END;
$invitation_catalog_verify$;
'@

$transactionSql = @"
BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
DO `$invitation_history_precondition`$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'local database identity guard failed';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101090000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101100000')<>0 THEN
    RAISE EXCEPTION 'invitation migration history precondition changed';
  END IF;
END;
`$invitation_history_precondition`$;
$migrationBody
$postCatalog
SAVEPOINT invitation_regression_fixtures;
$testBody
ROLLBACK TO SAVEPOINT invitation_regression_fixtures;
RELEASE SAVEPOINT invitation_regression_fixtures;
DO `$invitation_regression_pass`$ BEGIN RAISE NOTICE 'INVITATION_SQL_REGRESSION|PASS|fixtures rolled back to savepoint'; END `$invitation_regression_pass`$;
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES ('20261101100000',NULL,'unique_pending_invitations');
DO `$invitation_history_verify`$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101100000')<>1
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261101100000'
       AND statements IS NULL AND name='unique_pending_invitations') THEN
    RAISE EXCEPTION 'invitation migration history insert verification failed';
  END IF;
END;
`$invitation_history_verify`$;
COMMIT;
"@

$execution = Invoke-LocalPsql -Stage 'Atomic invitation migration, catalog assertions, regression and history transaction' -SqlText $transactionSql
$execution.Output | Write-Output
Assert-Marker $execution.Text 'INVITATION_CATALOG_VERIFY|PASS|' 'Invitation catalog verification'
Assert-Marker $execution.Text 'INVITATION_SQL_REGRESSION|PASS|fixtures rolled back to savepoint' 'Invitation SQL regression'

$post = Invoke-LocalPsql -Stage 'Post-commit invitation migration and fixture verification' -TuplesOnly -SqlText @'
SELECT (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101100000')::text || '|'
 || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101100000' AND statements IS NULL AND name='unique_pending_invitations')::text || '|'
 || (SELECT count(*) FROM public.organizations WHERE slug LIKE 'migration-200-org-%')::text || '|'
 || (SELECT count(*) FROM auth.users WHERE email LIKE 'migration-200-%@fixture.invalid')::text || '|'
 || (SELECT count(*) FROM public.profiles WHERE full_name LIKE 'Migration 200 Test Owner %')::text || '|'
 || (SELECT count(*) FROM public.organization_invitations WHERE token LIKE 'migration-200-%');
'@
if ($post.Text.Trim() -ne '1|1|0|0|0|0') { throw "Post-commit verification mismatch: $($post.Text.Trim())" }
Write-Output 'MIGRATION_20261101100000|COMMITTED|isolated local validation database'
Write-Output 'INVITATION_FIXTURE_CLEANUP|PASS|organization=0 auth_user=0 profile=0 invitation=0'

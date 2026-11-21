$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = '1855F5502C29AE65BBC9E3D5C0771E98A3360A9C65817A95D69DF4EA6D9A71BD'
$expectedPreflightSha256 = 'F571338D922BE4EA0B477529D5D024324A13B8EC4398738F4764AB26D4053B72'
$preflightFile = Join-Path $PSScriptRoot 'preflight_20261031170000.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261031170000_razorpay_atomic_subscription_lifecycle.sql'
$regressionFile = Join-Path $PSScriptRoot 'razorpay_atomic_subscription_lifecycle.test.sql'

function Invoke-LocalPsql {
    param([Parameter(Mandatory=$true)][string]$SqlText, [Parameter(Mandatory=$true)][string]$Stage, [switch]$TuplesOnly)
    $psqlArgs = @('-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1')
    if ($TuplesOnly) { $psqlArgs += '-At' }
    $oldEap = $ErrorActionPreference
    $nativePreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    $output = @()
    $psqlExitCode = $null
    try {
        $ErrorActionPreference = 'Continue'
        # PostgreSQL NOTICE messages use stderr; capture both streams without
        # letting PowerShell treat stderr as a substitute for process status.
        $PSNativeCommandUseErrorActionPreference = $false
        $output = @($SqlText | & docker exec -i $expectedContainerId psql @psqlArgs 2>&1)
        $psqlExitCode = [int]$LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $oldEap
        if ($null -ne $nativePreference) { $PSNativeCommandUseErrorActionPreference = $nativePreference.Value }
        else { Remove-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue }
    }
    $text = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    if ($psqlExitCode -ne 0) {
        $diagnostic = if ([string]::IsNullOrWhiteSpace($text)) { '<no process output>' } else { $text }
        throw "$Stage failed; psql/docker exit code $psqlExitCode. Complete captured stdout/stderr follows:`n$diagnostic`nStopping without retry or repair."
    }
    return [pscustomobject]@{ Output=$output; Text=$text; ExitCode=$psqlExitCode }
}

function Assert-Marker {
    param([string]$Text, [string]$Marker, [string]$Stage)
    if ($Text.IndexOf($Marker,[StringComparison]::Ordinal) -lt 0) { throw "$Stage did not emit required marker: $Marker" }
}

foreach ($file in @($preflightFile,$migrationFile,$regressionFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

# Verify exact reviewed bytes before invoking Docker or PostgreSQL.
$migrationBytes = [IO.File]::ReadAllBytes($migrationFile)
$sha = [Security.Cryptography.SHA256]::Create()
try { $migrationSha256 = [BitConverter]::ToString($sha.ComputeHash($migrationBytes)).Replace('-', '').ToUpperInvariant() }
finally { $sha.Dispose() }
if (-not [string]::Equals($migrationSha256,$expectedMigrationSha256,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Migration checksum mismatch; expected $expectedMigrationSha256, found $migrationSha256. No Docker or SQL command was run."
}
$preflightBytes = [IO.File]::ReadAllBytes($preflightFile)
$preflightSha = [Security.Cryptography.SHA256]::Create()
try { $preflightSha256 = [BitConverter]::ToString($preflightSha.ComputeHash($preflightBytes)).Replace('-', '').ToUpperInvariant() }
finally { $preflightSha.Dispose() }
if (-not [string]::Equals($preflightSha256,$expectedPreflightSha256,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Preflight checksum mismatch; expected $expectedPreflightSha256, found $preflightSha256. No Docker or SQL command was run."
}
$migrationSql = [Text.UTF8Encoding]::new($false,$true).GetString($migrationBytes)
if (([regex]::Matches($migrationSql,'(?im)^BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($migrationSql,'(?im)^COMMIT\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($migrationSql,'(?im)^\s*(ROLLBACK|SAVEPOINT|RELEASE)\b') -or
    [regex]::IsMatch($migrationSql,'(?i)CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY')) {
    throw 'Migration transaction boundaries or unsupported transactional statement differ from the reviewed source.'
}
$migrationBody = [regex]::new('(?im)^BEGIN\s*;\s*').Replace($migrationSql,'',1)
$migrationBody = [regex]::new('(?im)^COMMIT\s*;\s*\z').Replace($migrationBody,'',1)
if ($migrationBody -eq $migrationSql) { throw 'Could not isolate the reviewed migration body.' }

$testText = Get-Content -Raw -LiteralPath $regressionFile
if (([regex]::Matches($testText,'(?im)^\s*BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($testText,'(?im)^\s*ROLLBACK\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($testText,'(?im)^\s*COMMIT\s*;') -or
    [regex]::IsMatch($testText,'(?im)^\s*\\(connect|include|ir|i|!)\b')) {
    throw 'Razorpay SQL regression test is not one rollback-only local transaction.'
}
$testWithoutSet = [regex]::Replace($testText,'(?im)^\s*\\set\s+ON_ERROR_STOP\s+on\s*\r?\n','')
if ($testWithoutSet -eq $testText -or
    $testWithoutSet -notmatch '(?is)^\s*--[\s\S]*?BEGIN\s*;\s*DO\s+\$\$[\s\S]*\$\$\s*;\s*ROLLBACK\s*;\s*$') {
    throw 'Razorpay regression test structure changed; review before embedding it in the migration transaction.'
}
$testBody = [regex]::new('(?im)^\s*BEGIN\s*;\s*').Replace($testWithoutSet,'',1)
$testBody = [regex]::new('(?im)^\s*ROLLBACK\s*;\s*\z').Replace($testBody,'',1)
if ($testBody -eq $testWithoutSet -or ([regex]::Matches($testBody,'(?im)^\s*DO\s+\$\$')).Count -ne 1) {
    throw 'Could not isolate the single Razorpay regression DO block.'
}

Write-Output "MIGRATION_FILE=$migrationFile"
Write-Output "MIGRATION_SHA256=$migrationSha256"
Write-Output "PREFLIGHT_SHA256=$preflightSha256"

$facts = & docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $expectedContainerId
if ($LASTEXITCODE -ne 0) { throw 'Docker inspection failed; no SQL was run.' }
$parts = $facts -split '\|',4
if ($parts.Count -ne 4 -or $parts[0] -ne $expectedContainerId -or $parts[1] -ne $expectedContainerName -or
    $parts[2] -ne 'running' -or $parts[3] -ne 'healthy') {
    throw 'Container ID/name/state/health mismatch; no database command was run.'
}

$identity = Invoke-LocalPsql -Stage 'Local database identity check' -TuplesOnly -SqlText @'
SELECT current_database() || '|' || current_user || '|' || session_user || '|'
    || current_setting('server_version_num') || '|' || current_setting('port');
'@
if ($identity.Text.Trim() -notmatch '^postgres\|postgres\|postgres\|17[0-9]{4}\|5432$') {
    throw "Database identity mismatch: $($identity.Text.Trim())"
}
Write-Output "DATABASE_IDENTITY=$($identity.Text.Trim())"

$preflightSql = [Text.UTF8Encoding]::new($false,$true).GetString($preflightBytes)
$preflight = Invoke-LocalPsql -Stage 'Read-only migration 170000 preflight' -SqlText $preflightSql
$preflight.Output | Write-Output
Assert-Marker $preflight.Text 'RAZORPAY_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031170000' 'Razorpay targeted preflight'

$catalogVerify = @'
DO $razorpay_verify$
DECLARE v_expected record; v_actual record; v_fn oid; v_index oid; v_expr text;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN RAISE EXCEPTION 'local database identity guard failed'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261023000000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261030000000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031000000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>0 THEN
    RAISE EXCEPTION 'Razorpay migration history precondition changed';
  END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('billing_payments','amount_refunded_paise','bigint',true),
    ('organization_subscriptions','razorpay_total_count','integer',false)
  ) AS c(table_name,column_name,type_name,not_null)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull INTO v_actual
      FROM pg_catalog.pg_attribute a
     WHERE a.attrelid=pg_catalog.to_regclass('public.'||v_expected.table_name)
       AND a.attname=v_expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND OR v_actual.format_type IS DISTINCT FROM v_expected.type_name
       OR v_actual.attnotnull IS DISTINCT FROM v_expected.not_null THEN
      RAISE EXCEPTION 'Razorpay target column mismatch: %.%',v_expected.table_name,v_expected.column_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.billing_payments'::regclass AND a.attname='amount_refunded_paise'
        AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'::bigint$','')='0')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.organization_subscriptions'::regclass AND a.attname='razorpay_total_count') THEN
    RAISE EXCEPTION 'Razorpay lifecycle column defaults differ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::regclass
      AND c.conname='billing_payments_refund_amount_valid' AND c.contype='c' AND c.convalidated
      AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) LIKE '%amount_refunded_paise>=0%'
      AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) LIKE '%amount_refunded_paise<=amount_paise%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.billing_payments'::regclass
      AND c.conname='billing_payments_refund_status_valid' AND c.contype='c' AND c.convalidated
      AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) LIKE '%amount_refunded_paise=0%'
      AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) LIKE '%captured%refunded%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='public.organization_subscriptions'::regclass
      AND c.conname='organization_subscriptions_total_count_positive' AND c.contype='c' AND c.convalidated
      AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) LIKE '%razorpay_total_countisnull%'
      AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_constraintdef(c.oid),'\s+','','g')) LIKE '%razorpay_total_count>0%') THEN
    RAISE EXCEPTION 'Razorpay lifecycle constraint definitions mismatch';
  END IF;

  SELECT i.indexrelid INTO v_index FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class x ON x.oid=i.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=x.relnamespace
   WHERE n.nspname='public' AND x.relname='billing_payments_verified_subscription_period'
     AND i.indrelid='public.billing_payments'::regclass AND NOT i.indisunique AND i.indisvalid AND i.indisready
     AND i.indnatts=2 AND i.indnkeyatts=2 AND i.indpred IS NOT NULL
     AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
            FROM unnest(i.indkey) WITH ORDINALITY k(attnum,ord)
            JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum)
         = ARRAY['subscription_id','paid_at']::text[];
  IF v_index IS NULL THEN RAISE EXCEPTION 'Razorpay verified-payment index missing or incompatible'; END IF;
  SELECT pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_expr(i.indpred,i.indrelid),'\s+','','g'))
    INTO v_expr FROM pg_catalog.pg_index i WHERE i.indexrelid=v_index;
  IF v_expr NOT LIKE '%status=''captured''%' OR v_expr NOT LIKE '%signature_verified_atisnotnull%' THEN
    RAISE EXCEPTION 'Razorpay verified-payment index predicate mismatch';
  END IF;

  v_fn := 'public.apply_verified_razorpay_payment(uuid,uuid,text,text,text,bigint,text,text,timestamp with time zone,bigint,integer,text,timestamp with time zone,timestamp with time zone,timestamp with time zone)'::regprocedure::oid;
  SELECT p.*,pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,l.lanname
    INTO v_actual FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=v_fn;
  IF v_actual.owner_name IS DISTINCT FROM 'postgres' OR NOT v_actual.prosecdef
     OR v_actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
     OR v_actual.lanname IS DISTINCT FROM 'plpgsql' OR v_actual.prorettype<>'pg_catalog.jsonb'::regtype
     OR v_actual.provolatile IS DISTINCT FROM 'v' OR v_actual.proisstrict OR v_actual.proparallel IS DISTINCT FROM 'u'
     OR v_actual.pronargs<>15
     OR v_actual.proargnames IS DISTINCT FROM ARRAY[
       'p_organization_id','p_local_subscription_id','p_provider_subscription_id','p_payment_id','p_invoice_id',
       'p_amount_paise','p_currency','p_payment_status','p_payment_created_at','p_amount_refunded_paise',
       'p_provider_total_count','p_provider_subscription_status','p_current_period_start','p_current_period_end',
       'p_provider_verified_at'
     ]::text[]
     OR v_actual.proargmodes IS NOT NULL THEN
    RAISE EXCEPTION 'Razorpay RPC metadata mismatch';
  END IF;
  IF NOT pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
     OR (SELECT count(*) FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.grantee='service_role'::regrole AND a.privilege_type='EXECUTE')<>1
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.grantee='service_role'::regrole AND a.privilege_type='EXECUTE' AND a.is_grantable)
     OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
        WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (v_actual.proowner,'service_role'::regrole)) THEN
    RAISE EXCEPTION 'Razorpay RPC execute ACL mismatch';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.billing_payments'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.organization_subscriptions'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.billing_payments'::regclass
       AND polname='Service role manages billing payments' AND polcmd='*' AND polroles=ARRAY['service_role'::regrole::oid])
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid='public.organization_subscriptions'::regclass
       AND polname='Service role manages organization subscriptions' AND polcmd='*' AND polroles=ARRAY['service_role'::regrole::oid]) THEN
    RAISE EXCEPTION 'Billing RLS or service-role policies changed';
  END IF;
  RAISE NOTICE 'RAZORPAY_CATALOG_VERIFY|PASS|columns constraints index function metadata ACL RLS';
END;
$razorpay_verify$;
'@

$preApplyGuard = @'
DO $razorpay_guard$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN RAISE EXCEPTION 'local database identity guard failed'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261023000000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261030000000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031000000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>0 THEN
    RAISE EXCEPTION 'Razorpay migration history changed after preflight';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.billing_payments'::regclass
       AND attname='amount_refunded_paise' AND attnum>0 AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.organization_subscriptions'::regclass
       AND attname='razorpay_total_count' AND attnum>0 AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname IN
       ('billing_payments_refund_amount_valid','billing_payments_refund_status_valid','organization_subscriptions_total_count_positive'))
     OR pg_catalog.to_regclass('public.billing_payments_verified_subscription_period') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='apply_verified_razorpay_payment') THEN
    RAISE EXCEPTION 'Razorpay migration target artifact appeared after preflight';
  END IF;
END;
$razorpay_guard$;
'@

$historyAndCommit = @'
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES ('20261031170000',NULL,'razorpay_atomic_subscription_lifecycle');
DO $history_verify$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000'
      AND statements IS NULL AND name='razorpay_atomic_subscription_lifecycle')<>1 THEN
    RAISE EXCEPTION 'migration 170000 history verification failed';
  END IF;
  RAISE NOTICE 'RAZORPAY_HISTORY_VERIFY|PASS|version=20261031170000 count=1 statements=NULL name=razorpay_atomic_subscription_lifecycle';
END;
$history_verify$;
COMMIT;
'@

$applySql = @"
BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
$preApplyGuard
$migrationBody
$catalogVerify
SAVEPOINT razorpay_regression_fixtures;
$testBody
ROLLBACK TO SAVEPOINT razorpay_regression_fixtures;
RELEASE SAVEPOINT razorpay_regression_fixtures;
DO `$razorpay_test_marker`$
BEGIN
  RAISE NOTICE 'RAZORPAY_SQL_REGRESSION|PASS|fixtures rolled back to savepoint';
END;
`$razorpay_test_marker`$;
$historyAndCommit
"@
$applied = Invoke-LocalPsql -Stage 'Razorpay migration, catalog verification, rollback-only regression and history in one transaction' -SqlText $applySql
$applied.Output | Write-Output
Assert-Marker $applied.Text 'RAZORPAY_CATALOG_VERIFY|PASS|' 'Razorpay catalog verification'
Assert-Marker $applied.Text 'RAZORPAY_SQL_REGRESSION|PASS|fixtures rolled back to savepoint' 'Razorpay SQL regression'
Assert-Marker $applied.Text 'RAZORPAY_HISTORY_VERIFY|PASS|version=20261031170000 count=1 statements=NULL name=razorpay_atomic_subscription_lifecycle' 'Razorpay history verification'

$post = Invoke-LocalPsql -Stage 'Razorpay post-apply history check' -TuplesOnly -SqlText @'
SELECT '160=' || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')::text
    || '|170=' || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')::text;
'@
if ($post.Text.Trim() -ne '160=1|170=1') { throw 'Post-apply migration history counts are unexpected.' }
Write-Output 'RAZORPAY_FIXTURE_CLEANUP|PASS|regression fixtures rolled back to savepoint before the migration commit'
Write-Output 'RUN_COMPLETE|PASS|migration=20261031170000 history_160=1 history_170=1'

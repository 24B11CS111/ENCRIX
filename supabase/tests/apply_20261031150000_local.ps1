$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = '11E88F5FEC735067FAE1632BA7A6B8133513B6C9309E9B99DE2D3DD9FCCE89A8'
$preflightFile = Join-Path $PSScriptRoot 'preflight_pending_migrations.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261031150000_durable_email_otp_attempts.sql'
$regressionFile = Join-Path $PSScriptRoot 'durable_email_otp_attempts.test.sql'

function Invoke-LocalPsql {
    param(
        [Parameter(Mandatory = $true)][string]$SqlText,
        [Parameter(Mandatory = $true)][string]$Stage,
        [switch]$TuplesOnly
    )

    $psqlArgs = @('-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1')
    if ($TuplesOnly) { $psqlArgs += '-At' }

    $previousEap = $ErrorActionPreference
    $nativePreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    try {
        # PostgreSQL NOTICE is written to stderr. Preserve it in captured output;
        # use psql's exit code (with ON_ERROR_STOP) to detect actual SQL errors.
        $ErrorActionPreference = 'Continue'
        $PSNativeCommandUseErrorActionPreference = $false
        $output = $SqlText | & docker exec -i $expectedContainerId psql @psqlArgs 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousEap
        if ($null -ne $nativePreference) {
            $PSNativeCommandUseErrorActionPreference = $nativePreference.Value
        }
        else {
            Remove-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
        }
    }

    $outputText = ($output | ForEach-Object { [string]$_ }) -join "`n"
    if ($exitCode -ne 0) {
        $output | Write-Output
        throw "$Stage failed; psql/docker exit code $exitCode. Stopping without retry or repair."
    }
    return [pscustomobject]@{ Output = $output; Text = $outputText; ExitCode = $exitCode }
}

function Assert-ContainsMarker {
    param([string]$Text, [string]$Marker, [string]$Stage)
    if ($Text.IndexOf($Marker, [StringComparison]::Ordinal) -lt 0) {
        throw "$Stage did not emit required marker: $Marker"
    }
}

# Pin execution to the approved container identity and health state.
$inspection = & docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $expectedContainerId
if ($LASTEXITCODE -ne 0) { throw 'Docker inspection failed; no database command was run.' }
$containerFacts = $inspection -split '\|', 4
if ($containerFacts.Count -ne 4 -or
    $containerFacts[0] -ne $expectedContainerId -or
    $containerFacts[1] -ne $expectedContainerName -or
    $containerFacts[2] -ne 'running' -or
    $containerFacts[3] -ne 'healthy') {
    throw 'Container ID/name/state/health mismatch; no database command was run.'
}

foreach ($file in @($preflightFile, $migrationFile, $regressionFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

# Verify the regression file is a rollback-only SQL test, not a migration.
$testText = Get-Content -Raw -LiteralPath $regressionFile
if (([regex]::Matches($testText, '(?im)^\s*BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($testText, '(?im)^\s*ROLLBACK\s*;\s*$')).Count -ne 1 -or
    $testText -match '(?im)^\s*COMMIT\s*;') {
    throw 'OTP regression file is not exactly one BEGIN with a final ROLLBACK; refusing to run it.'
}
if ($testText -notmatch '(?is)^\s*BEGIN\s*;.*\bDO\s+\$\$.*\$\$\s*;\s*ROLLBACK\s*;\s*$') {
    throw 'OTP regression file does not have the expected transactional test structure.'
}

# Hash and execute these exact bytes, without writing the checksum or contents to disk.
$migrationBytes = [IO.File]::ReadAllBytes($migrationFile)
$sha = [Security.Cryptography.SHA256]::Create()
try { $migrationSha256 = [BitConverter]::ToString($sha.ComputeHash($migrationBytes)).Replace('-', '').ToUpperInvariant() }
finally { $sha.Dispose() }
if (-not [string]::Equals($migrationSha256, $expectedMigrationSha256, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Migration checksum mismatch; expected $expectedMigrationSha256, found $migrationSha256. No migration SQL was run."
}
$migrationSql = [Text.UTF8Encoding]::new($false, $true).GetString($migrationBytes)
Write-Output "MIGRATION_FILE=$migrationFile"
Write-Output "MIGRATION_SHA256=$migrationSha256"

# Prove the database identity over the same pinned container/socket before any writes.
$identity = Invoke-LocalPsql -Stage 'Local database identity check' -TuplesOnly -SqlText @'
SELECT current_database() || '|' || current_user || '|' || current_setting('server_version_num') || '|' || current_setting('port');
'@
if ($identity.Text.Trim() -notmatch '^postgres\|postgres\|17[0-9]{4}\|5432$') {
    $identity.Output | Write-Output
    throw 'Database identity did not match postgres/postgres/PostgreSQL 17/container port 5432.'
}
Write-Output "DATABASE_IDENTITY=$($identity.Text.Trim())"

# Re-run the full read-only preflight immediately before applying; require its
# history-specific absence marker and exact safe-to-apply marker.
$preflight = Invoke-LocalPsql -Stage 'Migration preflight' -SqlText (Get-Content -Raw -LiteralPath $preflightFile)
$preflight.Output | Write-Output
Assert-ContainsMarker $preflight.Text 'MIGRATION_HISTORY|20261008000000|count=1|required=1' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'MIGRATION_HISTORY|20261031130000|count=1|required=1' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'MIGRATION_HISTORY|20261031140000|count=1|required=1' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'MIGRATION_HISTORY|20261031150000|count=0|required=0' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'OTP_PREFLIGHT|id_default_resolution|PASS|' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'OTP_PREFLIGHT|table_and_data|PASS|' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'MIGRATION|20261031150000|PASS|' 'Migration preflight'
Assert-ContainsMarker $preflight.Text 'PREFLIGHT_SAFE_TO_APPLY|PASS|history prerequisites recorded exactly-once target_20261031150000=ABSENT' 'Migration preflight'
if ($preflight.Text.Contains('PREFLIGHT_BLOCKED|FAIL|')) { throw 'Preflight emitted PREFLIGHT_BLOCKED; refusing to apply.' }

# The psql transaction applies only the selected migration. The guarded history
# insert records this psql-applied migration only after catalog checks pass;
# any failure before COMMIT rolls back both schema changes and that one record.
$applyPrefix = @'
BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
DO $apply_guard$
DECLARE v_count bigint; v_columns integer;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'local database identity guard failed';
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_columns
    FROM information_schema.columns
   WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'
     AND ((column_name='version' AND data_type='text' AND is_nullable='NO')
       OR (column_name='statements' AND data_type='ARRAY' AND udt_name='_text' AND is_nullable='YES')
       OR (column_name='name' AND data_type='text' AND is_nullable='YES'));
  IF v_columns<>3 OR (SELECT pg_catalog.count(*) FROM information_schema.columns
       WHERE table_schema='supabase_migrations' AND table_name='schema_migrations')<>3
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
       WHERE c.conrelid='supabase_migrations.schema_migrations'::pg_catalog.regclass
         AND c.contype='p' AND c.conkey=ARRAY[(SELECT a.attnum
           FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.conrelid
             AND a.attname='version' AND NOT a.attisdropped)]::smallint[]) THEN
    RAISE EXCEPTION 'unexpected migration history schema';
  END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version='20261008000000';
  IF v_count<>1 THEN RAISE EXCEPTION 'migration 080000 prerequisite is not recorded exactly once'; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version='20261031130000';
  IF v_count<>1 THEN RAISE EXCEPTION 'migration 130000 prerequisite is not recorded exactly once'; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version='20261031140000';
  IF v_count<>1 THEN RAISE EXCEPTION 'migration 140000 prerequisite is not recorded exactly once'; END IF;
  SELECT pg_catalog.count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version='20261031150000';
  IF v_count<>0 THEN RAISE EXCEPTION 'migration 150000 is no longer absent from history'; END IF;
END;
$apply_guard$;
'@

$verifyAndRecord = @'
DO $apply_verify$
DECLARE
  v_oid oid;
  v_expected record;
  v_proc record;
  v_count bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.email_otps'::pg_catalog.regclass AND a.attname='ticket_id'
      AND a.atttypid='pg_catalog.uuid'::pg_catalog.regtype AND NOT a.attnotnull
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.email_otps'::pg_catalog.regclass AND a.attname='verified_at'
      AND a.atttypid='timestamp with time zone'::pg_catalog.regtype AND NOT a.attnotnull
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum)) THEN
    RAISE EXCEPTION 'migration 150000 target columns do not match expected definitions';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_am am ON am.oid=c.relam
    WHERE n.nspname='public' AND c.relname='email_otps_ticket_id_uidx'
      AND i.indrelid='public.email_otps'::pg_catalog.regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey::text=(
        SELECT a.attnum::text FROM pg_catalog.pg_attribute a
         WHERE a.attrelid=i.indrelid AND a.attname='ticket_id' AND NOT a.attisdropped)
      AND am.amname='btree'
      AND pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred,i.indrelid)),'[()"[:space:]]','','g')='ticket_idisnotnull'
  ) THEN RAISE EXCEPTION 'migration 150000 partial unique ticket index verification failed'; END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('public.issue_email_otp_ticket(uuid,text,text,text,timestamp with time zone,timestamp with time zone)',ARRAY['p_ticket_id','p_email','p_purpose','p_otp_hash','p_resend_after','p_expires_at']::text[],'jsonb','4cf0df1329fa0ab39f0b14a3781bc956'),
    ('public.complete_email_otp_verification(uuid,text,text,boolean)',ARRAY['p_ticket_id','p_email','p_purpose','p_is_valid']::text[],'jsonb','c3eb7b2579bd07b1274f370b4391b3e2'),
    ('public.cancel_email_otp_ticket(uuid,text,text)',ARRAY['p_ticket_id','p_email','p_purpose']::text[],'boolean','5bf04cce3a75594874c64c63383ad2dd')
  ) AS expected(signature,arg_names,result_type,body_md5)
  LOOP
    v_oid:=pg_catalog.to_regprocedure(v_expected.signature)::oid;
    IF v_oid IS NULL THEN RAISE EXCEPTION 'required OTP function missing: %',v_expected.signature; END IF;
    SELECT p.*,pg_catalog.pg_get_userbyid(p.proowner)::text AS owner_name,
           l.lanname,pg_catalog.format_type(p.prorettype,NULL) AS result_name
      INTO v_proc FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
     WHERE p.oid=v_oid;
    IF v_proc.owner_name IS DISTINCT FROM 'postgres'
       OR v_proc.prosecdef IS DISTINCT FROM true
       OR v_proc.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
       OR v_proc.lanname IS DISTINCT FROM 'plpgsql'
       OR v_proc.provolatile IS DISTINCT FROM 'v'
       OR v_proc.proisstrict IS DISTINCT FROM false
       OR v_proc.proparallel IS DISTINCT FROM 'u'
       OR v_proc.proargnames IS DISTINCT FROM v_expected.arg_names
       OR v_proc.proargmodes IS NOT NULL OR v_proc.proallargtypes IS NOT NULL
       OR v_proc.result_name IS DISTINCT FROM v_expected.result_type
       OR pg_catalog.md5(v_proc.prosrc) IS DISTINCT FROM v_expected.body_md5 THEN
      RAISE EXCEPTION 'OTP function definition/metadata mismatch: %',v_expected.signature;
    END IF;
    IF pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres',v_oid,'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a
         WHERE a.grantee IN ('anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole)
           AND a.privilege_type='EXECUTE')
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a
         WHERE a.grantee='service_role'::pg_catalog.regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_proc.proacl,pg_catalog.acldefault('f',v_proc.proowner))) a
         WHERE a.grantee NOT IN (0::oid,'anon'::pg_catalog.regrole,'authenticated'::pg_catalog.regrole,
                                  'service_role'::pg_catalog.regrole,v_proc.proowner)
           AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'OTP function EXECUTE privilege mismatch: %',v_expected.signature;
    END IF;
  END LOOP;

  SELECT pg_catalog.count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version='20261031150000';
  IF v_count<>0 THEN RAISE EXCEPTION 'migration history row appeared before guarded insert'; END IF;
END;
$apply_verify$;

INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES ('20261031150000',NULL,'durable_email_otp_attempts');

DO $history_verify$
DECLARE v_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_count
    FROM supabase_migrations.schema_migrations
   WHERE version='20261031150000' AND statements IS NULL
     AND name='durable_email_otp_attempts';
  IF v_count<>1 THEN
    RAISE EXCEPTION 'migration 150000 history row verification failed';
  END IF;
END;
$history_verify$;
COMMIT;
'@

$applySql = $applyPrefix + "`n" + $migrationSql + "`n" + $verifyAndRecord
$applyResult = Invoke-LocalPsql -Stage 'Migration 150000 transactional apply and verification' -SqlText $applySql
$applyResult.Output | Write-Output
Write-Output 'MIGRATION_APPLY|20261031150000|PASS|schema verified and one history row committed'

# The SQL regression file owns a transaction and ends in ROLLBACK. Its only
# durable output is PASS/NOTICE; any assertion error exits psql nonzero.
$testResult = Invoke-LocalPsql -Stage 'Durable OTP SQL regression test' -SqlText $testText
$testResult.Output | Write-Output
Assert-ContainsMarker $testResult.Text 'PASS: durable OTP schema, permissions, attempt limit, expiry, replay, cancellation, missing-row fail-closed and issue cooldown' 'OTP SQL regression test'

$postApply = Invoke-LocalPsql -Stage 'Post-migration history and fixture verification' -SqlText @'
DO $final_verify$
DECLARE v_count bigint; v_fixture_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_count FROM supabase_migrations.schema_migrations WHERE version='20261031150000';
  IF v_count<>1 THEN RAISE EXCEPTION 'migration 150000 history count is %, expected 1',v_count; END IF;
  SELECT pg_catalog.count(*) INTO v_fixture_count FROM public.email_otps
   WHERE ticket_id IN (
     'f6d2a05e-c470-4bd3-9a16-b13d086cfad1','a5f81a71-2f2b-4cde-9c14-35bafca019e2',
     'f3f7d84d-8076-49de-9509-d5d0853b4aa8','c11b5f39-2b21-49a5-a29a-c6eac6f32ab7',
     'f8f63db0-70a9-424f-b15c-c17970de1007','ed0041db-b323-47f8-a529-f2a81c878d97',
     'b8b879ad-58f0-4400-aad7-a38ca971c0db'
   );
  IF v_fixture_count<>0 THEN RAISE EXCEPTION 'OTP test fixtures remain after rollback: %',v_fixture_count; END IF;
  RAISE NOTICE 'POST_MIGRATION_VERIFY|PASS|history_count=1 otp_fixture_count=0';
END;
$final_verify$;
'@
$postApply.Output | Write-Output
Assert-ContainsMarker $postApply.Text 'POST_MIGRATION_VERIFY|PASS|history_count=1 otp_fixture_count=0' 'Post-migration verification'

Write-Output 'RUN_COMPLETE|PASS|migration=20261031150000 otp_regression=PASS history_count=1 fixture_count=0'

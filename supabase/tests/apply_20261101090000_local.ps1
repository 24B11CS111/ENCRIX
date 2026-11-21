$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = '4084EAFAFA0BFDF065478287A1F6F84B5361E4430766D6C56EADCFD1B2902E1E'
$expectedPreflightSha256 = '3FFD7597234C86B18AE205B2A83EF242D6925C285E8A097C579F514F1F3A962A'
$expectedRegressionSha256 = '4996CCA8A1C8A675BBA91021A4B1E697115018BA3F067EA2C5DE9918CF70862A'
$preflightFile = Join-Path $PSScriptRoot 'preflight_20261101090000.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261101090000_followup_email_outbox.sql'
$regressionFile = Join-Path $PSScriptRoot 'followup_email_outbox.test.sql'

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

# Verify exact reviewed bytes before invoking Docker or PostgreSQL.
foreach ($file in @($preflightFile,$migrationFile,$regressionFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}
foreach ($check in @(
    @{ Path=$migrationFile; Expected=$expectedMigrationSha256; Label='Migration' },
    @{ Path=$preflightFile; Expected=$expectedPreflightSha256; Label='Preflight' },
    @{ Path=$regressionFile; Expected=$expectedRegressionSha256; Label='Regression test' }
)) {
    $actual = Get-Sha256 $check.Path
    if ($actual -cne $check.Expected) { throw "$($check.Label) checksum mismatch: expected $($check.Expected), found $actual. No Docker/SQL command ran." }
    Write-Output "$($check.Label.ToUpperInvariant())_SHA256=$actual"
}

$migrationSql = [Text.UTF8Encoding]::new($false,$true).GetString([IO.File]::ReadAllBytes($migrationFile))
if (([regex]::Matches($migrationSql,'(?im)^BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($migrationSql,'(?im)^COMMIT\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($migrationSql,'(?im)^\s*(ROLLBACK|SAVEPOINT|RELEASE)\b') -or
    [regex]::IsMatch($migrationSql,'(?i)CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY')) {
    throw 'Migration transaction structure differs from the reviewed source.'
}
$migrationBody = [regex]::new('(?im)^BEGIN\s*;\s*').Replace($migrationSql,'',1)
$migrationBody = [regex]::new('(?im)^COMMIT\s*;\s*\z').Replace($migrationBody,'',1)
if ($migrationBody -eq $migrationSql) { throw 'Could not isolate migration body.' }

$testText = Get-Content -Raw -LiteralPath $regressionFile
if (([regex]::Matches($testText,'(?im)^\s*BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($testText,'(?im)^\s*ROLLBACK\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($testText,'(?im)^\s*COMMIT\s*;') -or
    [regex]::IsMatch($testText,'(?im)^\s*\\(connect|include|ir|i|!)\b')) {
    throw 'Outbox SQL test is not a single rollback-only local transaction.'
}
$testBody = [regex]::new('(?im)^\s*BEGIN\s*;\s*').Replace($testText,'',1)
$testBody = [regex]::new('(?im)^\s*ROLLBACK\s*;\s*\z').Replace($testBody,'',1)
if ($testBody -eq $testText -or ([regex]::Matches($testBody,'(?im)^\s*DO\s+\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$')).Count -ne 2) {
    throw 'Could not isolate the two reviewed outbox SQL assertion blocks.'
}

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
$preflight = Invoke-LocalPsql -Stage 'Read-only migration 20261101090000 preflight' -SqlText $preflightSql
$preflight.Output | Write-Output
Assert-Marker $preflight.Text 'OUTBOX_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261101090000' 'Outbox preflight'

$postCatalog = @'
DO $outbox_catalog_verify$
DECLARE v_target oid; v_actual record; v_expected record; v_columns text[]; v_expression text; v_fn oid;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'local database identity guard failed';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101090000')<>0 THEN
    RAISE EXCEPTION 'outbox migration history precondition changed';
  END IF;

  v_target := pg_catalog.to_regclass('public.follow_up_email_outbox');
  IF v_target IS NULL OR (SELECT relkind FROM pg_catalog.pg_class WHERE oid=v_target)<>'r'
     OR NOT (SELECT relrowsecurity AND relowner='postgres'::regrole::oid FROM pg_catalog.pg_class WHERE oid=v_target)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=v_target) THEN
    RAISE EXCEPTION 'outbox relation, owner, RLS, or policy state differs';
  END IF;
  FOR v_expected IN SELECT * FROM (VALUES
    ('id','uuid',true),('organization_id','uuid',true),('follow_up_id','uuid',true),
    ('recipient_profile_id','uuid',true),('milestone','text',true),('recipient_email','text',true),
    ('subject','text',true),('text_body','text',true),('html_body','text',true),('status','text',true),
    ('attempts','integer',true),('claim_token','uuid',false),('created_at','timestamp with time zone',true),
    ('claimed_at','timestamp with time zone',false),('sent_at','timestamp with time zone',false),
    ('provider_message_id','text',false),('failure_code','text',false)
  ) AS c(column_name,expected_type,expected_not_null)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull INTO v_actual
      FROM pg_catalog.pg_attribute a WHERE a.attrelid=v_target AND a.attname=v_expected.column_name
        AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND OR v_actual.format_type IS DISTINCT FROM v_expected.expected_type
       OR v_actual.attnotnull IS DISTINCT FROM v_expected.expected_not_null THEN
      RAISE EXCEPTION 'outbox column definition mismatch: %',v_expected.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid=v_target AND attnum>0 AND NOT attisdropped)<>17 THEN
    RAISE EXCEPTION 'unexpected outbox column count';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
       ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=v_target AND a.attname='id'
       AND pg_catalog.replace(pg_catalog.lower(pg_catalog.pg_get_expr(d.adbin,d.adrelid)),'pg_catalog.','')='gen_random_uuid()')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
       ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=v_target AND a.attname='status'
       AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='''QUEUED''::text')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
       ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=v_target AND a.attname='attempts'
       AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='0')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a
       ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid=v_target AND a.attname='created_at'
       AND pg_catalog.replace(pg_catalog.lower(pg_catalog.pg_get_expr(d.adbin,d.adrelid)),'pg_catalog.','')='now()') THEN
    RAISE EXCEPTION 'outbox column defaults differ';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target AND c.conname='follow_up_email_outbox_pkey'
       AND c.contype='p' AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
         FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_catalog.pg_attribute a
           ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['id']::text[]
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=c.conindid AND i.indrelid=v_target
         AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indpred IS NULL))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target
       AND c.conname='follow_up_email_outbox_event_unique' AND c.contype='u' AND c.convalidated
       AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
         FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_catalog.pg_attribute a
           ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['follow_up_id','recipient_profile_id','milestone']::text[]
       AND EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indexrelid=c.conindid AND i.indrelid=v_target
         AND i.indisunique AND i.indisvalid AND i.indisready AND i.indnatts=3 AND i.indnkeyatts=3 AND i.indpred IS NULL))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target
       AND c.conname='follow_up_email_outbox_milestone_check' AND c.contype='c' AND c.convalidated
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%UPCOMING_REMINDER%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%OVERDUE_ALERT%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%OWNER_ESCALATION%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target
       AND c.conname='follow_up_email_outbox_status_check' AND c.contype='c' AND c.convalidated
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%QUEUED%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%SENDING%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%SENT%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%FAILED%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target
       AND c.conname='follow_up_email_outbox_attempts_check' AND c.contype='c' AND c.convalidated
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%attempts >= 0%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%attempts <= 1%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target
       AND c.conname='follow_up_email_outbox_state_check' AND c.contype='c' AND c.convalidated
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%status = ''QUEUED''%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%status = ''SENDING''%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%status = ''SENT''%'
       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%status = ''FAILED''%')
     OR (SELECT count(*) FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target AND c.contype='c' AND c.convalidated)<>4
     OR (SELECT count(*) FROM pg_catalog.pg_index i WHERE i.indrelid=v_target)<>2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid=v_target AND (NOT i.indisvalid OR NOT i.indisready)) THEN
    RAISE EXCEPTION 'outbox primary key, idempotency unique key, or state constraints differ';
  END IF;
  FOR v_expected IN SELECT * FROM (VALUES
    ('follow_up_email_outbox_organization_id_fkey','organization_id','organizations','id'),
    ('follow_up_email_outbox_follow_up_id_fkey','follow_up_id','follow_ups','id'),
    ('follow_up_email_outbox_recipient_profile_id_fkey','recipient_profile_id','profiles','id')
  ) AS fk(constraint_name,child_column,parent_table,parent_column)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid=v_target
         AND c.conname=v_expected.constraint_name AND c.contype='f' AND c.convalidated AND c.confdeltype='c'
         AND c.confrelid=pg_catalog.to_regclass('public.'||v_expected.parent_table)
         AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord) JOIN pg_catalog.pg_attribute a
             ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY[v_expected.child_column]::text[]
         AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY k.ord)
           FROM unnest(c.confkey) WITH ORDINALITY k(attnum,ord) JOIN pg_catalog.pg_attribute a
             ON a.attrelid=c.confrelid AND a.attnum=k.attnum)=ARRAY[v_expected.parent_column]::text[]) THEN
      RAISE EXCEPTION 'outbox foreign key mismatch: %',v_expected.constraint_name;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(
       (SELECT relacl FROM pg_catalog.pg_class WHERE oid=v_target),pg_catalog.acldefault('r','postgres'::regrole::oid))) a
       WHERE a.grantee IN (0,'anon'::regrole,'authenticated'::regrole,'service_role'::regrole))
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::text[]) p
        WHERE has_table_privilege('anon',v_target,p) OR has_table_privilege('authenticated',v_target,p)
          OR has_table_privilege('service_role',v_target,p)) THEN
    RAISE EXCEPTION 'outbox table has unexpected direct API/service-role ACLs';
  END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('public.queue_follow_up_reminder_email(uuid,uuid,uuid,text,text,text,text,text)'::regprocedure::oid,'boolean'::regtype,8,0,false,
      ARRAY['p_organization_id','p_follow_up_id','p_recipient_profile_id','p_milestone','p_recipient_email','p_subject','p_text_body','p_html_body']::text[]),
    ('public.claim_follow_up_reminder_emails(uuid,integer)'::regprocedure::oid,'record'::regtype,2,2,true,
      ARRAY['p_organization_id','p_limit','id','claim_token','recipient_email','subject','text_body','html_body','milestone']::text[]),
    ('public.complete_follow_up_reminder_email(uuid,uuid,boolean,text,text)'::regprocedure::oid,'boolean'::regtype,5,2,false,
      ARRAY['p_id','p_claim_token','p_sent','p_provider_message_id','p_failure_code']::text[])
  ) AS f(oid,return_type,arg_count,default_count,returns_set,arg_names)
  LOOP
    SELECT p.*,pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,l.lanname INTO v_actual
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=v_expected.oid;
    IF v_actual.owner_name IS DISTINCT FROM 'postgres' OR NOT v_actual.prosecdef
       OR v_actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
       OR v_actual.lanname IS DISTINCT FROM 'plpgsql' OR v_actual.prorettype IS DISTINCT FROM v_expected.return_type
       OR v_actual.pronargs IS DISTINCT FROM v_expected.arg_count OR v_actual.proisstrict OR v_actual.provolatile<>'v'
       OR v_actual.proparallel<>'u' OR v_actual.pronargdefaults IS DISTINCT FROM v_expected.default_count
       OR v_actual.proretset IS DISTINCT FROM v_expected.returns_set
       OR v_actual.proargnames IS DISTINCT FROM v_expected.arg_names THEN
      RAISE EXCEPTION 'outbox RPC metadata mismatch: %',v_expected.oid::regprocedure;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role',v_expected.oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_expected.oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_expected.oid,'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,
            pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.privilege_type='EXECUTE' AND a.grantee NOT IN (v_actual.proowner,'service_role'::regrole))
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,
            pg_catalog.acldefault('f',v_actual.proowner))) a
          WHERE a.grantee='service_role'::regrole AND (a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
      RAISE EXCEPTION 'outbox RPC execution ACL mismatch: %',v_expected.oid::regprocedure;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,
          pg_catalog.acldefault('f',v_actual.proowner))) a
        WHERE a.grantee='service_role'::regrole AND a.privilege_type='EXECUTE' AND NOT a.is_grantable)<>1 THEN
      RAISE EXCEPTION 'outbox RPC must have one non-grantable service_role EXECUTE ACL: %',v_expected.oid::regprocedure;
    END IF;
  END LOOP;
  RAISE NOTICE 'OUTBOX_CATALOG_VERIFY|PASS|table, constraints, RLS, RPC metadata and grants verified';
END;
$outbox_catalog_verify$;
'@

$transactionSql = @"
BEGIN;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
DO `$outbox_history_precondition`$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999 OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'local database identity guard failed';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031170000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031180000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101090000')<>0 THEN
    RAISE EXCEPTION 'outbox migration history precondition changed';
  END IF;
END;
`$outbox_history_precondition`$;
$migrationBody
$postCatalog
SAVEPOINT outbox_regression_fixtures;
$testBody
ROLLBACK TO SAVEPOINT outbox_regression_fixtures;
RELEASE SAVEPOINT outbox_regression_fixtures;
DO `$outbox_regression_pass`$ BEGIN RAISE NOTICE 'OUTBOX_SQL_REGRESSION|PASS|fixtures rolled back to savepoint'; END `$outbox_regression_pass`$;
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES ('20261101090000',NULL,'followup_email_outbox');
DO `$outbox_history_verify`$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261101090000')<>1
     OR NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261101090000'
        AND statements IS NULL AND name='followup_email_outbox') THEN
    RAISE EXCEPTION 'outbox migration history insert verification failed';
  END IF;
END;
`$outbox_history_verify`$;
COMMIT;
"@

$execution = Invoke-LocalPsql -Stage 'Atomic outbox migration, catalog assertions, SQL regression and history transaction' -SqlText $transactionSql
$execution.Output | Write-Output
Assert-Marker $execution.Text 'OUTBOX_CATALOG_VERIFY|PASS|' 'Outbox catalog verification'
Assert-Marker $execution.Text 'OUTBOX_SQL_REGRESSION|PASS|fixtures rolled back to savepoint' 'Outbox SQL regression'
Write-Output 'MIGRATION_20261101090000|COMMITTED|isolated local validation database'

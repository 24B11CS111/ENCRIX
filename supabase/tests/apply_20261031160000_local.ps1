$ErrorActionPreference = 'Stop'

$expectedContainerId = '6b97a64a0a617766983bc08375e64babc95444ce5d7059266c80d718458e413b'
$expectedContainerName = '/supabase_db_encrix-sql-validation-0ec65673d9ba'
$expectedMigrationSha256 = '9B6F8915F688B8709643092E452BCB778CA985BBEE2DAE80E1EFCEFC35DF331D'
$expectedPreflightSha256 = '6451DED6DEA1DC6CCC59FED84D348D9358E1A6976C2F72AB5E44B022842967E5'
$preflightFile = Join-Path $PSScriptRoot 'preflight_20261031160000.sql'
$migrationFile = Join-Path $PSScriptRoot '..\migrations\20261031160000_organization_twilio_calling.sql'
$regressionFile = Join-Path $PSScriptRoot 'organization_twilio_calling.test.sql'

function Invoke-LocalPsql {
    param([Parameter(Mandatory=$true)][string]$SqlText, [Parameter(Mandatory=$true)][string]$Stage, [switch]$TuplesOnly)
    $args = @('-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1')
    if ($TuplesOnly) { $args += '-At' }
    $oldEap = $ErrorActionPreference
    $nativePreference = Get-Variable PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    $output = @()
    $psqlExitCode = $null
    try {
        $ErrorActionPreference = 'Continue'
        # PostgreSQL NOTICE messages use stderr. Capture both streams as text,
        # but do not let PowerShell's native-stderr policy substitute for the
        # process exit status. ON_ERROR_STOP remains enabled in psql.
        $PSNativeCommandUseErrorActionPreference = $false
        $output = @($SqlText | & docker exec -i $expectedContainerId psql @args 2>&1)
        # This must be the first operation after docker exec: Docker propagates
        # psql's exit status, and any later native command could overwrite it.
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
    if ($Text.IndexOf($Marker, [StringComparison]::Ordinal) -lt 0) { throw "$Stage did not emit required marker: $Marker" }
}

foreach ($file in @($preflightFile,$migrationFile,$regressionFile)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required file missing: $file" }
}

# Hash the exact migration bytes before any SQL. The migration owns BEGIN/COMMIT;
# below, only those verified outer boundary lines are moved under this runner's
# transaction so catalog verification and history insertion can be atomic too.
$migrationBytes = [IO.File]::ReadAllBytes($migrationFile)
$sha = [Security.Cryptography.SHA256]::Create()
try { $migrationSha256 = [BitConverter]::ToString($sha.ComputeHash($migrationBytes)).Replace('-', '').ToUpperInvariant() }
finally { $sha.Dispose() }
if (-not [string]::Equals($migrationSha256,$expectedMigrationSha256,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Migration checksum mismatch; expected $expectedMigrationSha256, found $migrationSha256. No migration SQL was run."
}
$preflightBytes = [IO.File]::ReadAllBytes($preflightFile)
$preflightSha = [Security.Cryptography.SHA256]::Create()
try { $preflightSha256 = [BitConverter]::ToString($preflightSha.ComputeHash($preflightBytes)).Replace('-', '').ToUpperInvariant() }
finally { $preflightSha.Dispose() }
if (-not [string]::Equals($preflightSha256,$expectedPreflightSha256,[StringComparison]::OrdinalIgnoreCase)) {
    throw "Preflight checksum mismatch; expected $expectedPreflightSha256, found $preflightSha256. No Docker or SQL command was run."
}
$migrationSql = [Text.UTF8Encoding]::new($false,$true).GetString($migrationBytes)
$beginCount = [regex]::Matches($migrationSql,'(?im)^BEGIN\s*;\s*$').Count
$commitCount = [regex]::Matches($migrationSql,'(?im)^COMMIT\s*;\s*$').Count
if ($beginCount -ne 1 -or $commitCount -ne 1 -or
    [regex]::IsMatch($migrationSql,'(?im)^\s*(ROLLBACK|SAVEPOINT|RELEASE)\b') -or
    [regex]::IsMatch($migrationSql,'(?i)CREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY')) {
    throw 'Migration transaction boundaries or unsupported transaction statement differ from reviewed source; stopping.'
}
$migrationBody = [regex]::new('(?im)^BEGIN\s*;\s*').Replace($migrationSql,'',1)
$migrationBody = [regex]::new('(?im)^COMMIT\s*;\s*\z').Replace($migrationBody,'',1)
if ($migrationBody -eq $migrationSql) { throw 'Could not safely isolate the reviewed migration body.' }

$testText = Get-Content -Raw -LiteralPath $regressionFile
if (([regex]::Matches($testText,'(?im)^\s*BEGIN\s*;\s*$')).Count -ne 1 -or
    ([regex]::Matches($testText,'(?im)^\s*ROLLBACK\s*;\s*$')).Count -ne 1 -or
    [regex]::IsMatch($testText,'(?im)^\s*COMMIT\s*;')) {
    throw 'Twilio SQL regression test is not one BEGIN/final ROLLBACK transaction.'
}
if ($testText -notmatch '(?is)^\s*BEGIN\s*;.*\bDO\s+\$test\$.*\$test\$\s*;\s*ROLLBACK\s*;\s*$') {
    throw 'Twilio regression file does not have the expected rollback-only test structure.'
}
if ([regex]::IsMatch($testText,'(?im)^\s*(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|ALTER|DROP|CALL|COPY)\b') -or
    [regex]::IsMatch($testText,'(?im)^\s*\\(connect|include|ir|i|!)\b')) {
    throw 'Twilio SQL regression test now contains fixture writes; inspect before using this runner.'
}
$testBody = [regex]::new('(?im)^\s*BEGIN\s*;\s*').Replace($testText,'',1)
$testBody = [regex]::new('(?im)^\s*ROLLBACK\s*;\s*\z').Replace($testBody,'',1)
if ($testBody -eq $testText -or
    $testBody -notmatch '(?is)^\s*DO\s+\$test\$[\s\S]*\$test\$\s*;\s*$' -or
    ([regex]::Matches($testBody,'(?im)^\s*DO\s+\$test\$')).Count -ne 1 -or
    $testText -notmatch "RAISE NOTICE 'PASS: % organization Twilio schema, RLS, grants and call-flow assertions'") {
    throw 'Twilio test is not exactly one checked DO assertion block with its required PASS notice.'
}
Write-Output "MIGRATION_FILE=$migrationFile"
Write-Output "MIGRATION_SHA256=$migrationSha256"
Write-Output "PREFLIGHT_SHA256=$preflightSha256"

# Pin execution to the sole approved local validation container only after both
# SQL source files have passed their checksum guards.
$facts = & docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{.State.Health.Status}}' $expectedContainerId
if ($LASTEXITCODE -ne 0) { throw 'Docker inspection failed; no database command was run.' }
$parts = $facts -split '\|',4
if ($parts.Count -ne 4 -or $parts[0] -ne $expectedContainerId -or $parts[1] -ne $expectedContainerName -or
    $parts[2] -ne 'running' -or $parts[3] -ne 'healthy') {
    throw 'Container ID/name/state/health mismatch; no database command was run.'
}

$identity = Invoke-LocalPsql -Stage 'Local database identity check' -TuplesOnly -SqlText @'
SELECT current_database() || '|' || current_user || '|' || current_setting('server_version_num') || '|' || current_setting('port');
'@
if ($identity.Text.Trim() -notmatch '^postgres\|postgres\|17[0-9]{4}\|5432$') {
    $identity.Output | Write-Output
    throw 'Database identity did not match postgres/postgres/PostgreSQL 17/container port 5432.'
}
Write-Output "DATABASE_IDENTITY=$($identity.Text.Trim())"

# Run only the read-only migration-160000-specific preflight. This avoids
# reclassifying already-recorded historical migrations as pending.
$preflight = Invoke-LocalPsql -Stage 'Read-only migration 160000 preflight' -SqlText ([Text.UTF8Encoding]::new($false,$true).GetString($preflightBytes))
$preflight.Output | Write-Output
Assert-Marker $preflight.Text 'TWILIO_PREFLIGHT_SAFE_TO_APPLY|PASS|target=20261031160000' 'Twilio targeted preflight'

$history = Invoke-LocalPsql -Stage 'Twilio migration history precheck' -TuplesOnly -SqlText @'
SELECT version || '|' || count(*)::text
  FROM supabase_migrations.schema_migrations
 WHERE version IN ('20261031150000','20261031160000')
 GROUP BY version ORDER BY version;
'@
if ($history.Text.Trim() -notmatch '(?m)^20261031150000\|1$' -or $history.Text -match '(?m)^20261031160000\|') {
    $history.Output | Write-Output
    throw 'Required history state is not exactly 150000 once and 160000 absent.'
}

$catalogVerify = @'
DO $twilio_verify$
DECLARE v_table oid; v_fn oid; v_expected record; v_actual record; v_default record; v_count integer; v_def text; v_service_acl text[]; v_grantable boolean;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN RAISE EXCEPTION 'local database identity guard failed'; END IF;
  IF pg_catalog.to_regclass('public.organization_twilio_credentials') IS NULL
     OR pg_catalog.to_regclass('public.telephony_inbound_attempts') IS NULL THEN RAISE EXCEPTION 'Twilio tables missing'; END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('organization_twilio_credentials','organization_id','uuid',true,''),
    ('organization_twilio_credentials','twilio_phone_number','text',true,''),
    ('organization_twilio_credentials','key_id','text',true,''),
    ('organization_twilio_credentials','nonce','text',true,''),
    ('organization_twilio_credentials','ciphertext','text',true,''),
    ('organization_twilio_credentials','auth_tag','text',true,''),
    ('organization_twilio_credentials','status','text',true,''),
    ('organization_twilio_credentials','updated_by','uuid',false,''),
    ('organization_twilio_credentials','created_at','timestamp with time zone',true,''),
    ('organization_twilio_credentials','updated_at','timestamp with time zone',true,''),
    ('telephony_inbound_attempts','id','uuid',true,''),
    ('telephony_inbound_attempts','organization_id','uuid',false,''),
    ('telephony_inbound_attempts','provider_call_sid','text',true,''),
    ('telephony_inbound_attempts','outcome','text',true,''),
    ('telephony_inbound_attempts','created_at','timestamp with time zone',true,''),
    ('call_bridges','flow','text',true,'')
  ) AS x(table_name,column_name,type_name,not_null,unused)
  LOOP
    SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,a.attnotnull
      INTO v_actual FROM pg_catalog.pg_attribute a
     WHERE a.attrelid=pg_catalog.to_regclass('public.'||v_expected.table_name)
       AND a.attname=v_expected.column_name AND a.attnum>0 AND NOT a.attisdropped;
    IF NOT FOUND OR v_actual.type_name IS DISTINCT FROM v_expected.type_name
       OR v_actual.attnotnull IS DISTINCT FROM v_expected.not_null THEN
      RAISE EXCEPTION 'Twilio column contract mismatch: %.%',v_expected.table_name,v_expected.column_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='public.organization_twilio_credentials'::regclass AND attnum>0 AND NOT attisdropped)<>10
     OR (SELECT count(*) FROM pg_catalog.pg_attribute WHERE attrelid='public.telephony_inbound_attempts'::regclass AND attnum>0 AND NOT attisdropped)<>5 THEN
    RAISE EXCEPTION 'unexpected extra or missing Twilio table columns';
  END IF;
  -- Emit diagnostic rows before enforcing the default contract so a rollback
  -- reports every inspected column, including missing defaults/columns.
  FOR v_default IN
    SELECT x.schema_name, x.table_name, x.column_name, x.expected_type,
           x.expected_nullability, x.expected_default,
           CASE WHEN a.attname IS NULL THEN '<missing>' ELSE pg_catalog.format_type(a.atttypid,a.atttypmod) END AS actual_type,
           CASE WHEN a.attname IS NULL THEN '<missing>' WHEN a.attnotnull THEN 'NOT NULL' ELSE 'NULL' END AS actual_nullability,
           COALESCE(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'<none>') AS actual_default
      FROM (VALUES
        ('public','organization_twilio_credentials','status','text','NOT NULL','''ACTIVE'''),
        ('public','organization_twilio_credentials','created_at','timestamp with time zone','NOT NULL','now()'),
        ('public','organization_twilio_credentials','updated_at','timestamp with time zone','NOT NULL','now()'),
        ('public','telephony_inbound_attempts','id','uuid','NOT NULL','extensions.uuid_generate_v4()'),
        ('public','telephony_inbound_attempts','created_at','timestamp with time zone','NOT NULL','now()'),
        ('public','call_bridges','flow','text','NOT NULL','''OUTBOUND''')
      ) AS x(schema_name,table_name,column_name,expected_type,expected_nullability,expected_default)
      LEFT JOIN pg_catalog.pg_namespace n ON n.nspname=x.schema_name
      LEFT JOIN pg_catalog.pg_class c ON c.relnamespace=n.oid AND c.relname=x.table_name
      LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=x.column_name
        AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
     ORDER BY x.schema_name,x.table_name,x.column_name
  LOOP
    RAISE NOTICE 'TWILIO_DEFAULT_DIAGNOSTIC|schema=%|table=%|column=%|expected_type=%|actual_type=%|expected_nullability=%|actual_nullability=%|expected_default=%|actual_default=%',
      v_default.schema_name,v_default.table_name,v_default.column_name,v_default.expected_type,
      v_default.actual_type,v_default.expected_nullability,v_default.actual_nullability,
      v_default.expected_default,v_default.actual_default;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.organization_twilio_credentials'::regclass AND a.attname='status'
        AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'::text$','')='''ACTIVE''')
     OR (SELECT count(*) FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.organization_twilio_credentials'::regclass
        AND a.attname IN ('created_at','updated_at') AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='now()')<>2
     OR (SELECT count(*) FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.organization_twilio_credentials'::regclass AND a.attname IN ('created_at','updated_at'))<>2
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.telephony_inbound_attempts'::regclass AND a.attname='id'
        AND pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'"',''),'\s','','g'))
          IN ('extensions.uuid_generate_v4()','uuid_generate_v4()')
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_depend dep
          WHERE dep.classid='pg_catalog.pg_attrdef'::regclass AND dep.objid=d.oid
            AND dep.refclassid='pg_catalog.pg_proc'::regclass
            AND dep.refobjid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()')))
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.telephony_inbound_attempts'::regclass AND a.attname='created_at'
        AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='now()')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef d JOIN pg_catalog.pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.call_bridges'::regclass AND a.attname='flow'
        AND pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'::text$','')='''OUTBOUND''') THEN
    RAISE EXCEPTION 'Twilio column default contract mismatch';
  END IF;

  FOR v_expected IN SELECT * FROM (VALUES
    ('organization_twilio_credentials','organization_twilio_credentials_pkey','p'),
    ('organization_twilio_credentials','organization_twilio_credentials_organization_id_fkey','f'),
    ('organization_twilio_credentials','organization_twilio_credentials_updated_by_fkey','f'),
    ('organization_twilio_credentials','organization_twilio_phone_e164_check','c'),
    ('organization_twilio_credentials','organization_twilio_key_id_check','c'),
    ('organization_twilio_credentials','organization_twilio_nonce_base64_check','c'),
    ('organization_twilio_credentials','organization_twilio_auth_tag_base64_check','c'),
    ('organization_twilio_credentials','organization_twilio_ciphertext_nonempty_check','c'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_pkey','p'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_organization_id_fkey','f'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_provider_call_sid_key','u'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_provider_call_sid_check','c'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_outcome_check','c'),
    ('call_bridges','call_bridges_customer_leg_state_check','c'),
    ('call_bridges','call_bridges_flow_check','c')
  ) AS x(table_name,constraint_name,constraint_type)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
      WHERE c.conrelid=pg_catalog.to_regclass('public.'||v_expected.table_name)
        AND c.conname=v_expected.constraint_name AND c.contype=v_expected.constraint_type AND c.convalidated) THEN
      RAISE EXCEPTION 'Twilio constraint missing or incompatible: %',v_expected.constraint_name;
    END IF;
  END LOOP;
  IF (SELECT confdeltype FROM pg_catalog.pg_constraint WHERE conname='organization_twilio_credentials_organization_id_fkey')<>'c'
     OR (SELECT confdeltype FROM pg_catalog.pg_constraint WHERE conname='organization_twilio_credentials_updated_by_fkey')<>'n'
     OR (SELECT confdeltype FROM pg_catalog.pg_constraint WHERE conname='telephony_inbound_attempts_organization_id_fkey')<>'n' THEN
    RAISE EXCEPTION 'Twilio foreign-key delete behavior mismatch';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
      WHERE c.relname='organization_twilio_active_phone_uidx' AND i.indrelid='public.organization_twilio_credentials'::regclass
        AND i.indisunique AND i.indisvalid AND i.indnatts=1 AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(twilio_phone_number)%'
        AND pg_catalog.pg_get_expr(i.indpred,i.indrelid) LIKE '%ACTIVE%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
      WHERE c.relname='leads_org_phone_inbound_idx' AND i.indrelid='public.leads'::regclass
        AND NOT i.indisunique AND i.indisvalid AND i.indnatts=2
        AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(organization_id, phone)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
      WHERE c.relname='calls_twilio_provider_call_id_uidx' AND i.indrelid='public.calls'::regclass
        AND i.indisunique AND i.indisvalid AND i.indnatts=1
        AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%(provider_call_id)%'
        AND pg_catalog.pg_get_expr(i.indpred,i.indrelid) LIKE '%TWILIO%') THEN
    RAISE EXCEPTION 'Twilio index contract mismatch';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['public.organization_twilio_credentials'::regclass::oid,'public.telephony_inbound_attempts'::regclass::oid] LOOP
    IF (SELECT relowner<>'postgres'::regrole::oid OR NOT relrowsecurity FROM pg_catalog.pg_class WHERE oid=v_table) THEN
      RAISE EXCEPTION 'Twilio table owner or RLS mismatch';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE((SELECT relacl FROM pg_catalog.pg_class WHERE oid=v_table),pg_catalog.acldefault('r',(SELECT relowner FROM pg_catalog.pg_class WHERE oid=v_table)))) a
        WHERE a.grantee=0 AND a.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')) THEN
      RAISE EXCEPTION 'PUBLIC has direct Twilio table privileges';
    END IF;
    IF pg_catalog.has_table_privilege('anon',v_table,'SELECT') OR pg_catalog.has_table_privilege('authenticated',v_table,'SELECT') THEN
      RAISE EXCEPTION 'browser role can read Twilio private table';
    END IF;
  END LOOP;
  SELECT pg_catalog.array_agg(a.privilege_type ORDER BY a.privilege_type),COALESCE(pg_catalog.bool_or(a.is_grantable),false)
    INTO v_service_acl,v_grantable
    FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a
   WHERE c.oid='public.organization_twilio_credentials'::regclass AND a.grantee='service_role'::regrole;
  IF v_service_acl IS DISTINCT FROM ARRAY['SELECT']::text[] OR v_grantable
     OR pg_catalog.has_table_privilege('service_role','public.telephony_inbound_attempts','SELECT')
     OR pg_catalog.has_table_privilege('service_role','public.telephony_inbound_attempts','INSERT') THEN
    RAISE EXCEPTION 'Twilio service_role table grants mismatch';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid='public.organization_twilio_credentials'::regclass AND p.polname='organization_twilio_service_role_only'
       AND p.polroles=ARRAY['service_role'::regrole::oid] AND p.polcmd='*')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid='public.telephony_inbound_attempts'::regclass AND p.polname='telephony_inbound_attempts_service_role_only'
       AND p.polroles=ARRAY['service_role'::regrole::oid] AND p.polcmd='*') THEN
    RAISE EXCEPTION 'Twilio service-role RLS policies missing';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.prepare_twilio_outbound_call(uuid,uuid,uuid,uuid,timestamp with time zone)'::regprocedure::oid,
    'public.claim_twilio_customer_leg(uuid)'::regprocedure::oid,
    'public.attach_twilio_leg_sid(uuid,text,text)'::regprocedure::oid,
    'public.record_twilio_inbound_attempt(uuid,text,text)'::regprocedure::oid,
    'public.prepare_twilio_inbound_call(uuid,text,text,text,timestamp with time zone)'::regprocedure::oid,
    'public.save_organization_twilio_credentials(uuid,text,text,text,text,text,uuid)'::regprocedure::oid,
    'public.revoke_organization_twilio_credentials(uuid,uuid)'::regprocedure::oid
  ] LOOP
    SELECT p.*,pg_catalog.pg_get_userbyid(p.proowner) AS owner_name,l.lanname INTO v_actual
      FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang WHERE p.oid=v_fn;
    IF v_actual.owner_name IS DISTINCT FROM 'postgres' OR NOT v_actual.prosecdef
       OR v_actual.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
       OR v_actual.lanname IS DISTINCT FROM 'plpgsql' OR v_actual.provolatile IS DISTINCT FROM 'v'
       OR v_actual.proisstrict OR v_actual.proparallel IS DISTINCT FROM 'u' THEN
      RAISE EXCEPTION 'Twilio function metadata mismatch: %',v_fn::regprocedure;
    END IF;
    IF NOT pg_catalog.has_function_privilege('service_role',v_fn,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_fn,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_fn,'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
         WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_actual.proacl,pg_catalog.acldefault('f',v_actual.proowner))) a
         WHERE a.grantee NOT IN (v_actual.proowner,'service_role'::regrole) AND a.privilege_type='EXECUTE') THEN
      RAISE EXCEPTION 'Twilio function execute grants mismatch: %',v_fn::regprocedure;
    END IF;
  END LOOP;
  RAISE NOTICE 'TWILIO_CATALOG_VERIFY|PASS|tables columns constraints indexes RLS functions owners paths grants';
END;
$twilio_verify$;
'@

$preApplyGuard = @'
DO $twilio_guard$
DECLARE v_count bigint;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN RAISE EXCEPTION 'local database identity guard failed'; END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031150000')<>1
     OR (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')<>0 THEN
    RAISE EXCEPTION 'history must contain 150000 exactly once and 160000 zero times';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations')<>3
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE c.conrelid='supabase_migrations.schema_migrations'::regclass
       AND c.contype='p' AND c.conkey=ARRAY[(SELECT a.attnum FROM pg_catalog.pg_attribute a
         WHERE a.attrelid=c.conrelid AND a.attname='version' AND NOT a.attisdropped)]::smallint[]) THEN
    RAISE EXCEPTION 'unexpected migration history schema';
  END IF;
  IF pg_catalog.to_regclass('public.organization_twilio_credentials') IS NOT NULL
     OR pg_catalog.to_regclass('public.telephony_inbound_attempts') IS NOT NULL
     OR pg_catalog.to_regclass('public.organization_twilio_active_phone_uidx') IS NOT NULL
     OR pg_catalog.to_regclass('public.leads_org_phone_inbound_idx') IS NOT NULL
     OR pg_catalog.to_regclass('public.calls_twilio_provider_call_id_uidx') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.prepare_twilio_outbound_call(uuid,uuid,uuid,uuid,timestamp with time zone)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.claim_twilio_customer_leg(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.attach_twilio_leg_sid(uuid,text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.record_twilio_inbound_attempt(uuid,text,text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.prepare_twilio_inbound_call(uuid,text,text,text,timestamp with time zone)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.save_organization_twilio_credentials(uuid,text,text,text,text,text,uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.revoke_organization_twilio_credentials(uuid,uuid)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.call_bridges'::regclass AND attname='flow' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'Twilio target artifacts already exist; refusing replay';
  END IF;
END;
$twilio_guard$;
'@

$historyAndCommit = @'
INSERT INTO supabase_migrations.schema_migrations(version,statements,name)
VALUES ('20261031160000',NULL,'organization_twilio_calling');
DO $history_verify$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000'
      AND statements IS NULL AND name='organization_twilio_calling')<>1 THEN
    RAISE EXCEPTION 'migration 160000 history verification failed';
  END IF;
  RAISE NOTICE 'TWILIO_HISTORY_VERIFY|PASS|version=20261031160000 count=1 statements=NULL name=organization_twilio_calling';
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
$testBody
SELECT true AS twilio_regression_passed \gset
\if :twilio_regression_passed
$historyAndCommit
\else
\quit 3
\endif
"@
$apply = Invoke-LocalPsql -Stage 'Twilio migration, catalog assertions, regression test and history in one transaction' -SqlText $applySql
$apply.Output | Write-Output
Assert-Marker $apply.Text 'TWILIO_CATALOG_VERIFY|PASS|' 'Twilio catalog verification'
Assert-Marker $apply.Text 'PASS: 17 organization Twilio schema, RLS, grants and call-flow assertions' 'Twilio regression assertions'
Assert-Marker $apply.Text 'TWILIO_HISTORY_VERIFY|PASS|version=20261031160000 count=1 statements=NULL name=organization_twilio_calling' 'Migration history verification'

$post = Invoke-LocalPsql -Stage 'Twilio post-apply history and rollback verification' -TuplesOnly -SqlText @'
SELECT 'history_150=' || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031150000')::text
    || '|history_160=' || (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='20261031160000')::text;
'@
if ($post.Text.Trim() -ne 'history_150=1|history_160=1') { $post.Output | Write-Output; throw 'Post-apply migration history counts do not match expected 150=1, 160=1.' }
Write-Output 'TWILIO_TEST_FIXTURE_CLEANUP|PASS|read-only regression assertions ran in the migration transaction; no fixtures were created'
Write-Output 'RUN_COMPLETE|PASS|migration=20261031160000 twilio_regression=PASS history_150=1 history_160=1'

-- Read-only catalog and migration-history verification for ENCRIX migration 160000.
-- Run only against the already identified isolated local PostgreSQL database.
BEGIN TRANSACTION READ ONLY;

SELECT 'DATABASE_IDENTITY' AS section,
       current_database() AS database_name,
       current_user AS connected_role,
       session_user AS session_role,
       version() AS server_version,
       inet_server_addr()::text AS server_address,
       inet_server_port() AS server_port,
       CASE WHEN current_database()='postgres' AND current_user='postgres'
                  AND current_setting('server_version_num')::integer BETWEEN 170000 AND 179999
                  AND current_setting('port')='5432'
            THEN 'MATCHES_EXPECTED' ELSE 'EXISTS_BUT_DIFFERS' END AS classification;

DO $local_identity_guard$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres'
     OR current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_setting('port')<>'5432' THEN
    RAISE EXCEPTION 'Refusing diagnostics: expected isolated local postgres database/role, PostgreSQL 17, container port 5432';
  END IF;
END;
$local_identity_guard$;

-- History is evidence about recording, not proof that the schema effects exist.
SELECT 'MIGRATION_HISTORY' AS section, v.version, count(m.version) AS row_count,
       CASE WHEN v.version='20261031150000' AND count(m.version)=1 THEN 'MATCHES_EXPECTED'
            WHEN v.version='20261031150000' THEN 'EXISTS_BUT_DIFFERS'
            WHEN v.version='20261031160000' AND count(m.version)=0 THEN 'ABSENT'
            ELSE 'EXISTS_BUT_DIFFERS' END AS classification
  FROM (VALUES ('20261031150000'),('20261031160000')) v(version)
  LEFT JOIN supabase_migrations.schema_migrations m ON m.version=v.version
 GROUP BY v.version ORDER BY v.version;

-- Migration 160000 creates these two relations. Owner is reported as evidence;
-- ownership is not explicitly assigned in the migration and is not inferred.
SELECT 'CREATED_TABLE' AS object_kind, e.table_name AS object_name,
       CASE WHEN c.oid IS NULL THEN 'ABSENT'
            WHEN c.relkind='r' AND c.relrowsecurity THEN 'MATCHES_EXPECTED'
            ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       pg_catalog.pg_get_userbyid(c.relowner) AS actual_owner,
       c.relkind::text AS relation_kind, c.relrowsecurity AS rls_enabled,
       NULL::text AS definition
  FROM (VALUES ('organization_twilio_credentials'),('telephony_inbound_attempts')) e(table_name)
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.table_name
 ORDER BY e.table_name;

-- These five relations predate the objects created by 160000; their existence
-- cannot attribute the migration. call_bridges.flow is checked separately below.
SELECT 'PRE_EXISTING_RELATION' AS object_kind, e.table_name AS object_name,
       CASE WHEN c.oid IS NULL THEN 'ABSENT' ELSE 'PRE_EXISTING_OR_NOT_ATTRIBUTABLE' END AS classification,
       pg_catalog.pg_get_userbyid(c.relowner) AS actual_owner,
       c.relkind::text AS relation_kind, c.relrowsecurity AS rls_enabled,
       NULL::text AS definition
  FROM (VALUES ('call_bridges'),('call_outcomes'),('call_recordings'),
               ('caller_phone_enrollments'),('calls')) e(table_name)
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.table_name
 ORDER BY e.table_name;

-- Exact expected columns, SQL types, nullability, and normalized defaults.
WITH expected(table_name,column_name,type_name,is_not_null,default_normalized) AS (
  VALUES
    ('organization_twilio_credentials','organization_id','uuid',true,NULL::text),
    ('organization_twilio_credentials','twilio_phone_number','text',true,NULL::text),
    ('organization_twilio_credentials','key_id','text',true,NULL::text),
    ('organization_twilio_credentials','nonce','text',true,NULL::text),
    ('organization_twilio_credentials','ciphertext','text',true,NULL::text),
    ('organization_twilio_credentials','auth_tag','text',true,NULL::text),
    ('organization_twilio_credentials','status','text',true,'active::text'),
    ('organization_twilio_credentials','updated_by','uuid',false,NULL::text),
    ('organization_twilio_credentials','created_at','timestamp with time zone',true,'now'),
    ('organization_twilio_credentials','updated_at','timestamp with time zone',true,'now'),
    ('telephony_inbound_attempts','id','uuid',true,'extensions.uuid_generate_v4'),
    ('telephony_inbound_attempts','organization_id','uuid',false,NULL::text),
    ('telephony_inbound_attempts','provider_call_sid','text',true,NULL::text),
    ('telephony_inbound_attempts','outcome','text',true,NULL::text),
    ('telephony_inbound_attempts','created_at','timestamp with time zone',true,'now'),
    ('call_bridges','flow','text',true,'outbound::text')
), actual AS (
  SELECT e.*, c.oid AS table_oid, a.attname AS actual_column,
         pg_catalog.format_type(a.atttypid,a.atttypmod) AS actual_type,
         a.attnotnull AS actual_not_null,
         CASE WHEN d.adbin IS NULL THEN NULL
              ELSE pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.pg_get_expr(d.adbin,d.adrelid),'[()[:space:]"'']','','g'))
          END AS actual_default,
         CASE WHEN e.table_name='telephony_inbound_attempts' AND e.column_name='id' THEN
           EXISTS (SELECT 1 FROM pg_catalog.pg_depend dep
             WHERE dep.classid='pg_catalog.pg_attrdef'::pg_catalog.regclass AND dep.objid=d.oid
               AND dep.refclassid='pg_catalog.pg_proc'::pg_catalog.regclass
               AND dep.refobjid=pg_catalog.to_regprocedure('extensions.uuid_generate_v4()'))
           ELSE true END AS expected_default_function
    FROM expected e
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.table_name
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attname=e.column_name
                                      AND a.attnum>0 AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
)
SELECT 'COLUMN' AS object_kind, table_name||'.'||column_name AS object_name,
       CASE WHEN table_oid IS NULL OR actual_column IS NULL THEN 'ABSENT'
            WHEN actual_type=type_name AND actual_not_null=is_not_null AND expected_default_function
             AND ((table_name='telephony_inbound_attempts' AND column_name='id')
                  OR actual_default IS NOT DISTINCT FROM default_normalized) THEN 'MATCHES_EXPECTED'
            ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       type_name AS expected_type, actual_type, is_not_null AS expected_not_null,
       actual_not_null, default_normalized AS expected_default, actual_default
  FROM actual ORDER BY table_name,column_name;

-- Detect unexpected extra columns on both newly created tables.
SELECT 'TABLE_COLUMN_SET' AS object_kind, x.table_name AS object_name,
       CASE WHEN c.oid IS NULL THEN 'ABSENT'
            WHEN count(a.attnum) FILTER (WHERE a.attnum>0 AND NOT a.attisdropped)=x.expected_count
              THEN 'MATCHES_EXPECTED' ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       x.expected_count, count(a.attnum) FILTER (WHERE a.attnum>0 AND NOT a.attisdropped) AS actual_count
  FROM (VALUES ('organization_twilio_credentials',10),('telephony_inbound_attempts',5)) x(table_name,expected_count)
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=x.table_name
  LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 GROUP BY x.table_name,x.expected_count,c.oid ORDER BY x.table_name;

SELECT 'TABLE_CONSTRAINT_SET' AS object_kind,x.table_name AS object_name,
       CASE WHEN c.oid IS NULL THEN 'ABSENT'
            WHEN count(k.oid)=x.expected_count THEN 'MATCHES_EXPECTED'
            ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       x.expected_count,count(k.oid) AS actual_count,
       pg_catalog.array_agg(k.conname ORDER BY k.conname) FILTER (WHERE k.oid IS NOT NULL) AS actual_constraint_names
  FROM (VALUES ('organization_twilio_credentials',8),('telephony_inbound_attempts',5)) x(table_name,expected_count)
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=x.table_name
  LEFT JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid
 GROUP BY x.table_name,x.expected_count,c.oid ORDER BY x.table_name;

-- Constraints created or replaced by the migration. The fragments check the
-- intended referenced table/delete action or the key/check expression tokens.
WITH expected(table_name,constraint_name,constraint_type,required_fragment) AS (
  VALUES
    ('organization_twilio_credentials','organization_twilio_credentials_pkey','p','PRIMARY KEY (organization_id)'),
    ('organization_twilio_credentials','organization_twilio_credentials_organization_id_fkey','f','organizations(id) ON DELETE CASCADE'),
    ('organization_twilio_credentials','organization_twilio_credentials_updated_by_fkey','f','profiles(id) ON DELETE SET NULL'),
    ('organization_twilio_credentials','organization_twilio_phone_e164_check','c','twilio_phone_number ~ ''^\+[1-9][0-9]{7,14}$'''),
    ('organization_twilio_credentials','organization_twilio_key_id_check','c','key_id ~ ''^[A-Za-z0-9_-]{1,32}$'''),
    ('organization_twilio_credentials','organization_twilio_nonce_base64_check','c','nonce ~ ''^[A-Za-z0-9+/]{16}$'''),
    ('organization_twilio_credentials','organization_twilio_auth_tag_base64_check','c','auth_tag ~ ''^[A-Za-z0-9+/]{22}==$'''),
    ('organization_twilio_credentials','organization_twilio_ciphertext_nonempty_check','c','length(ciphertext) > 0'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_pkey','p','PRIMARY KEY (id)'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_organization_id_fkey','f','organizations(id) ON DELETE SET NULL'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_provider_call_sid_key','u','UNIQUE (provider_call_sid)'),
    ('telephony_inbound_attempts','telephony_inbound_attempts_provider_call_sid_check','c','provider_call_sid ~ ''^CA[0-9A-Fa-f]{32}$'''),
    ('telephony_inbound_attempts','telephony_inbound_attempts_outcome_check','c','PROVIDER_ERROR'),
    ('call_bridges','call_bridges_customer_leg_state_check','c','RECOVERY_REQUIRED'),
    ('call_bridges','call_bridges_flow_check','c','OUTBOUND''::text, ''INBOUND''::text')
)
SELECT 'CONSTRAINT' AS object_kind, e.table_name||'.'||e.constraint_name AS object_name,
       CASE WHEN c.oid IS NULL THEN 'ABSENT'
            WHEN k.oid IS NOT NULL AND k.contype=e.constraint_type AND k.convalidated
             AND pg_catalog.strpos(pg_catalog.pg_get_constraintdef(k.oid),e.required_fragment)>0
             THEN 'MATCHES_EXPECTED' ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       e.constraint_type AS expected_type, k.contype AS actual_type,
       k.convalidated AS validated, pg_catalog.pg_get_constraintdef(k.oid) AS actual_definition
  FROM expected e
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.table_name
  LEFT JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid AND k.conname=e.constraint_name
 ORDER BY e.table_name,e.constraint_name;

-- Index key columns, uniqueness, method, validity, and predicate.
WITH expected(index_name,table_name,key_columns,is_unique,predicate_fragment) AS (
  VALUES
    ('organization_twilio_active_phone_uidx','organization_twilio_credentials',ARRAY['twilio_phone_number']::text[],true,'ACTIVE'),
    ('leads_org_phone_inbound_idx','leads',ARRAY['organization_id','phone']::text[],false,NULL::text),
    ('calls_twilio_provider_call_id_uidx','calls',ARRAY['provider_call_id']::text[],true,'TWILIO')
), actual AS (
  SELECT e.*, pg_catalog.to_regclass('public.'||e.table_name) AS expected_table_oid,
         i.indrelid AS actual_table_oid, i.indexrelid, i.indisunique, i.indisvalid, i.indisready,
         am.amname, pg_catalog.pg_get_indexdef(i.indexrelid) AS index_definition,
         pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS predicate,
         ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY q(attnum,ord)
               JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=q.attnum
              WHERE q.ord<=i.indnkeyatts ORDER BY q.ord) AS actual_keys,
         i.indnatts,i.indnkeyatts
    FROM expected e
    LEFT JOIN pg_catalog.pg_class idx ON idx.relnamespace='public'::regnamespace AND idx.relname=e.index_name
    LEFT JOIN pg_catalog.pg_index i ON i.indexrelid=idx.oid
    LEFT JOIN pg_catalog.pg_am am ON am.oid=idx.relam
)
SELECT 'INDEX' AS object_kind,index_name AS object_name,
       CASE WHEN indexrelid IS NULL THEN 'ABSENT'
            WHEN actual_table_oid=expected_table_oid
             AND indisunique=is_unique AND indisvalid AND indisready AND amname='btree'
             AND indnatts=cardinality(key_columns) AND indnkeyatts=cardinality(key_columns)
             AND actual_keys=key_columns
             AND ((predicate_fragment IS NULL AND predicate IS NULL)
               OR (predicate_fragment IS NOT NULL AND predicate ILIKE '%'||predicate_fragment||'%'))
             THEN 'MATCHES_EXPECTED' ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       table_name,expected_table_oid,actual_table_oid,key_columns AS expected_keys,actual_keys,
       is_unique AS expected_unique,indisunique AS actual_unique,
       predicate AS actual_predicate,index_definition
  FROM actual ORDER BY index_name;

-- RLS policies must be ALL policies addressed only to service_role and true.
WITH expected(table_name,policy_name) AS (
  VALUES ('organization_twilio_credentials','organization_twilio_service_role_only'),
         ('telephony_inbound_attempts','telephony_inbound_attempts_service_role_only')
)
SELECT 'POLICY' AS object_kind,e.table_name||'.'||e.policy_name AS object_name,
       CASE WHEN c.oid IS NULL OR p.oid IS NULL THEN 'ABSENT'
            WHEN p.polcmd='*' AND p.polpermissive
             AND p.polroles=ARRAY['service_role'::regrole::oid]
             AND COALESCE(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'true')='true'
             AND COALESCE(pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid),'true')='true'
             THEN 'MATCHES_EXPECTED' ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       p.polcmd,p.polpermissive,p.polroles,pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
  FROM expected e
  LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.table_name
  LEFT JOIN pg_catalog.pg_policy p ON p.polrelid=c.oid AND p.polname=e.policy_name
 ORDER BY e.table_name;

-- Function bodies are fingerprinted from the source migration. The migration
-- does not explicitly SET OWNER, so owner is reported separately as not attributable.
WITH expected(signature,body_md5,expected_result_type) AS (
  VALUES
    ('public.save_organization_twilio_credentials(uuid,text,text,text,text,text,uuid)'::text,'e093c9f3bc8eb1bde5816760ff97e9c2','boolean'),
    ('public.revoke_organization_twilio_credentials(uuid,uuid)'::text,'1d6bbe581828ddb349a1c1e790067100','boolean'),
    ('public.prepare_twilio_outbound_call(uuid,uuid,uuid,uuid,timestamp with time zone)'::text,'c48a7ca04bea5404f330b96f16346fd6','record'),
    ('public.claim_twilio_customer_leg(uuid)'::text,'2109f939bf7ae3562e58e2c11661124b','boolean'),
    ('public.attach_twilio_leg_sid(uuid,text,text)'::text,'bc4a0915b1ebb3038b50d4bbcd43d9eb','boolean'),
    ('public.record_twilio_inbound_attempt(uuid,text,text)'::text,'7b4f05a61ebf8e3217650fe83dd8ab42','boolean'),
    ('public.prepare_twilio_inbound_call(uuid,text,text,text,timestamp with time zone)'::text,'7bf3bed1b4dff279cf86958f3c2c936b','record')
), resolved AS (
  SELECT e.*,pg_catalog.to_regprocedure(e.signature) AS fn_oid FROM expected e
), actual AS (
  SELECT r.*,p.proowner,p.prosecdef,p.proconfig,p.provolatile,p.proisstrict,p.proparallel,
         l.lanname,p.prosrc,p.proacl,p.proargnames,pg_catalog.format_type(p.prorettype,NULL) AS actual_result_type,
         pg_catalog.pg_get_userbyid(p.proowner) AS owner_name
    FROM resolved r LEFT JOIN pg_catalog.pg_proc p ON p.oid=r.fn_oid
    LEFT JOIN pg_catalog.pg_language l ON l.oid=p.prolang
)
SELECT 'FUNCTION' AS object_kind,signature AS object_name,
       CASE WHEN fn_oid IS NULL THEN 'ABSENT'
            WHEN pg_catalog.md5(prosrc)=body_md5 AND prosecdef
             AND proconfig=ARRAY['search_path=pg_catalog, pg_temp']::text[]
             AND lanname='plpgsql' AND provolatile='v' AND NOT proisstrict AND proparallel='u'
             AND actual_result_type=expected_result_type
             AND pg_catalog.has_function_privilege('service_role',fn_oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('anon',fn_oid,'EXECUTE')
             AND NOT pg_catalog.has_function_privilege('authenticated',fn_oid,'EXECUTE')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a
                 WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a
                 WHERE a.grantee NOT IN (proowner,'service_role'::regrole) AND a.privilege_type='EXECUTE')
             AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(proacl,pg_catalog.acldefault('f',proowner))) a
                 WHERE a.grantee='service_role'::regrole AND a.privilege_type='EXECUTE' AND a.is_grantable)
             THEN 'MATCHES_EXPECTED' ELSE 'EXISTS_BUT_DIFFERS' END AS classification,
       owner_name AS actual_owner,
       CASE WHEN fn_oid IS NULL THEN 'ABSENT' ELSE 'PRE_EXISTING_OR_NOT_ATTRIBUTABLE' END AS owner_attribution,
       prosecdef AS security_definer,proconfig AS search_path,lanname AS language,
       proargnames AS actual_argument_names,actual_result_type,
       pg_catalog.has_function_privilege('service_role',fn_oid,'EXECUTE') AS service_role_execute,
       pg_catalog.has_function_privilege('postgres',fn_oid,'EXECUTE') AS postgres_execute,
       pg_catalog.has_function_privilege('anon',fn_oid,'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated',fn_oid,'EXECUTE') AS authenticated_execute,
       proacl AS stored_acl,pg_catalog.md5(prosrc) AS actual_body_md5,body_md5 AS expected_body_md5
  FROM actual ORDER BY signature;

-- Explicit grants are read directly from migration 160000: both tables revoke
-- all table privileges from PUBLIC/anon/authenticated/service_role; only the
-- credentials table then grants non-grantable SELECT to service_role. postgres
-- effective access depends on the migration executor/owner and is reported as
-- not attributable rather than assumed.
WITH expected(table_name,role_name,expected_privileges,attributable) AS (
  VALUES
    ('organization_twilio_credentials','PUBLIC',ARRAY[]::text[],true),
    ('organization_twilio_credentials','anon',ARRAY[]::text[],true),
    ('organization_twilio_credentials','authenticated',ARRAY[]::text[],true),
    ('organization_twilio_credentials','service_role',ARRAY['SELECT']::text[],true),
    ('organization_twilio_credentials','postgres',ARRAY[]::text[],false),
    ('telephony_inbound_attempts','PUBLIC',ARRAY[]::text[],true),
    ('telephony_inbound_attempts','anon',ARRAY[]::text[],true),
    ('telephony_inbound_attempts','authenticated',ARRAY[]::text[],true),
    ('telephony_inbound_attempts','service_role',ARRAY[]::text[],true),
    ('telephony_inbound_attempts','postgres',ARRAY[]::text[],false)
), resolved AS (
  SELECT e.*,c.oid AS table_oid,c.relowner,c.relacl,
         CASE WHEN e.role_name='PUBLIC' THEN 0::oid ELSE pg_catalog.to_regrole(e.role_name)::oid END AS grantee_oid
    FROM expected e
    LEFT JOIN pg_catalog.pg_class c ON c.relnamespace='public'::regnamespace AND c.relname=e.table_name
), stored AS (
  SELECT r.*,
         COALESCE((SELECT pg_catalog.array_agg(a.privilege_type ORDER BY a.privilege_type)
                     FROM pg_catalog.aclexplode(r.relacl) a
                    WHERE a.grantee=r.grantee_oid),ARRAY[]::text[]) AS stored_privileges,
         COALESCE((SELECT pg_catalog.bool_or(a.is_grantable)
                     FROM pg_catalog.aclexplode(r.relacl) a
                    WHERE a.grantee=r.grantee_oid),false) AS stored_grant_option
    FROM resolved r
)
SELECT 'TABLE_ACL' AS object_kind,table_name AS object_name,role_name,
       CASE WHEN table_oid IS NULL THEN 'ABSENT'
            WHEN NOT attributable THEN 'PRE_EXISTING_OR_NOT_ATTRIBUTABLE'
            WHEN stored_privileges=expected_privileges AND NOT stored_grant_option THEN 'MATCHES_EXPECTED'
            ELSE 'EXISTS_BUT_DIFFERS' END AS stored_acl_classification,
       CASE WHEN table_oid IS NULL THEN 'ABSENT'
            WHEN NOT attributable THEN 'PRE_EXISTING_OR_NOT_ATTRIBUTABLE'
            WHEN role_name<>'PUBLIC' AND ARRAY(
              SELECT p.privilege_type
                FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']::text[]) p(privilege_type)
               WHERE pg_catalog.has_table_privilege(role_name,table_oid,p.privilege_type)
               ORDER BY p.privilege_type
            )=expected_privileges THEN 'MATCHES_EXPECTED'
            WHEN role_name='PUBLIC' AND stored_privileges=expected_privileges THEN 'MATCHES_EXPECTED'
            ELSE 'EXISTS_BUT_DIFFERS' END AS effective_acl_classification,
       expected_privileges,stored_privileges,stored_grant_option,relacl AS complete_stored_relacl,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'SELECT') END AS effective_select,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'INSERT') END AS effective_insert,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'UPDATE') END AS effective_update,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'DELETE') END AS effective_delete,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'TRUNCATE') END AS effective_truncate,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'REFERENCES') END AS effective_references,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'TRIGGER') END AS effective_trigger,
       CASE WHEN table_oid IS NULL OR role_name='PUBLIC' THEN NULL
            ELSE pg_catalog.has_table_privilege(role_name,table_oid,'MAINTAIN') END AS effective_maintain
  FROM stored ORDER BY table_name,role_name;

COMMIT;

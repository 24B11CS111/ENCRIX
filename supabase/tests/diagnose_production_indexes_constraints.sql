-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Index and constraint catalog definitions.

-- SECTION 6A: All indexes attached to public relations. Definitions,
-- expressions and predicates describe schema metadata only; no table rows
-- are read.
SELECT 'INDEX_CATALOG' AS section, ni.nspname AS index_schema, ci.relname AS index_name,
       nt.nspname AS parent_schema, ct.relname AS parent_table,
       am.amname AS access_method,
       i.indisprimary AS is_primary, i.indisunique AS is_unique,
       i.indisexclusion AS is_exclusion,
       i.indnullsnotdistinct AS nulls_not_distinct,
       i.indnkeyatts AS key_attribute_count, i.indnatts AS total_attribute_count,
       i.indisvalid AS is_valid, i.indisready AS is_ready,
       pg_catalog.pg_get_expr(i.indexprs,i.indrelid) AS expression_columns,
       pg_catalog.pg_get_expr(i.indpred,i.indrelid) AS partial_index_predicate,
       pg_catalog.pg_get_indexdef(i.indexrelid) AS definition,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class ci ON ci.oid=i.indexrelid
JOIN pg_catalog.pg_namespace ni ON ni.oid=ci.relnamespace
JOIN pg_catalog.pg_class ct ON ct.oid=i.indrelid
JOIN pg_catalog.pg_namespace nt ON nt.oid=ct.relnamespace
JOIN pg_catalog.pg_am am ON am.oid=ci.relam
WHERE nt.nspname='public' ORDER BY ct.relname,ci.relname;

-- SECTION 6B: Primary key, foreign key, unique, check and exclusion
-- constraints, with validation/deferral state and the associated constraint
-- index when PostgreSQL records one.
SELECT 'CONSTRAINT_CATALOG' AS section, n.nspname AS schema_name,
       c.relname AS relation_name, con.conname AS constraint_name,
       CASE con.contype
         WHEN 'p' THEN 'PRIMARY KEY'
         WHEN 'f' THEN 'FOREIGN KEY'
         WHEN 'u' THEN 'UNIQUE'
         WHEN 'c' THEN 'CHECK'
         WHEN 'x' THEN 'EXCLUSION'
         ELSE con.contype::text
       END AS constraint_type,
       con.convalidated AS validated,
       con.condeferrable AS deferrable, con.condeferred AS initially_deferred,
       pg_catalog.pg_get_constraintdef(con.oid,true) AS definition,
       CASE WHEN con.conindid=0::oid THEN NULL ELSE ni.nspname END AS constraint_index_schema,
       CASE WHEN con.conindid=0::oid THEN NULL ELSE ci.relname END AS constraint_index_name,
       CASE WHEN con.conindid=0::oid THEN NULL ELSE pg_catalog.pg_get_indexdef(con.conindid) END
         AS constraint_index_definition,
       CASE WHEN con.contype='f' AND con.conindid<>0::oid
         THEN 'referenced-key index for foreign key'
         WHEN con.conindid<>0::oid THEN 'constraint enforcement index'
         ELSE NULL
       END AS constraint_index_role,
       'PRESENT'::text AS catalog_classification, 'UNKNOWN'::text AS source_comparison
FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_catalog.pg_class ci ON ci.oid=con.conindid AND con.conindid<>0::oid
LEFT JOIN pg_catalog.pg_namespace ni ON ni.oid=ci.relnamespace
WHERE n.nspname='public' ORDER BY c.relname,con.conname;

-- SECTION 6C: Source-defined named artifacts to compare against repository
-- migrations. This is a fixed list of names, not application data. The full
-- catalogs above remain authoritative for all unnamed/auto-named constraints
-- and indexes. For a foreign key, conindid identifies its referenced key
-- index; it does not assert an index exists on the referencing columns.
WITH expected(version, migration_file, artifact_kind, relation_name, artifact_name) AS (
  VALUES
    ('20261023000000','20261023000000_billing_foundation.sql','INDEX','organization_subscriptions','organization_subscriptions_one_current_per_org'),
    ('20261023000000','20261023000000_billing_foundation.sql','INDEX','organization_subscriptions','organization_subscriptions_status_period_end'),
    ('20261023000000','20261023000000_billing_foundation.sql','INDEX','billing_payments','billing_payments_org_created'),
    ('20261023000000','20261023000000_billing_foundation.sql','INDEX','billing_payments','billing_payments_subscription_created'),
    ('20261023000000','20261023000000_billing_foundation.sql','CONSTRAINT','organization_subscriptions','organization_subscriptions_period_order'),
    ('20261023000000','20261023000000_billing_foundation.sql','CONSTRAINT','organization_subscriptions','organization_subscriptions_id_organization_unique'),
    ('20261023000000','20261023000000_billing_foundation.sql','CONSTRAINT','billing_payments','billing_payments_subscription_organization_fkey'),
    ('20261023000000','20261023000000_billing_foundation.sql','CONSTRAINT','billing_webhook_events','billing_webhook_events_provider_event_unique'),
    ('20261030000000','20261030000000_owner_business_billing_details.sql','INDEX','profiles','profiles_email_unique_lower'),
    ('20261030000000','20261030000000_owner_business_billing_details.sql','INDEX','organizations','organizations_owner_id_unique'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','CONSTRAINT','organization_subscriptions','organization_subscriptions_amount_required'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','CONSTRAINT','billing_payments','billing_payments_subscription_required'),
    ('20261031000000','20261031000000_onboarding_billing_integrity.sql','CONSTRAINT','billing_payments','billing_payments_status_timestamps'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','INDEX','billing_payments','billing_payments_verified_subscription_period'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','CONSTRAINT','billing_payments','billing_payments_refund_amount_valid'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','CONSTRAINT','organization_subscriptions','organization_subscriptions_total_count_positive'),
    ('20261031170000','20261031170000_razorpay_atomic_subscription_lifecycle.sql','CONSTRAINT','billing_payments','billing_payments_refund_status_valid'),
    ('20261101100000','20261101100000_unique_pending_invitations.sql','INDEX','organization_invitations','organization_invitations_pending_org_email_uidx'),
    ('20261105160000','20261105160000_registration_otp_send_rate_limit.sql','INDEX','registration_otp_attempts','registration_otp_attempts_email_created_at_idx'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','CONSTRAINT','organization_subscriptions','organization_subscriptions_cancellation_request_status_valid'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','CONSTRAINT','billing_refund_requests','billing_refund_requests_payment_subscription_org_fkey'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','CONSTRAINT','billing_refund_requests','billing_refund_requests_idempotency_unique'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','CONSTRAINT','billing_refund_requests','billing_refund_requests_approved_state_consistency'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','INDEX','billing_refund_requests','billing_refund_requests_payment_status_idx'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','INDEX','billing_refund_requests','billing_refund_requests_org_created_idx'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','INDEX','billing_refund_requests','billing_refund_requests_one_open_per_payment_idx'),
    ('20261105170000','20261105170000_billing_refund_cancellation_workflows.sql','INDEX','billing_refund_review_events','billing_refund_review_events_request_idx'),
    ('20261106100000','20261106100000_admin_refund_management.sql','INDEX','billing_refund_audit_events','billing_refund_audit_events_request_created_idx')
), resolved AS (
  SELECT e.*,
         CASE WHEN e.artifact_kind='INDEX' THEN EXISTS (
           SELECT 1 FROM pg_catalog.pg_class idx
           JOIN pg_catalog.pg_namespace idx_ns ON idx_ns.oid=idx.relnamespace
           JOIN pg_catalog.pg_index i ON i.indexrelid=idx.oid
           JOIN pg_catalog.pg_class tbl ON tbl.oid=i.indrelid
           JOIN pg_catalog.pg_namespace tbl_ns ON tbl_ns.oid=tbl.relnamespace
           WHERE idx_ns.nspname='public' AND idx.relname=e.artifact_name
             AND tbl_ns.nspname='public' AND tbl.relname=e.relation_name
         )
         WHEN e.artifact_kind='CONSTRAINT' THEN EXISTS (
           SELECT 1 FROM pg_catalog.pg_constraint con
           JOIN pg_catalog.pg_class tbl ON tbl.oid=con.conrelid
           JOIN pg_catalog.pg_namespace tbl_ns ON tbl_ns.oid=tbl.relnamespace
           WHERE tbl_ns.nspname='public' AND tbl.relname=e.relation_name
             AND con.conname=e.artifact_name
         )
         ELSE FALSE END AS artifact_exists
  FROM expected e
)
SELECT 'SOURCE_EXPECTATION_CATALOG' AS section, version, migration_file,
       artifact_kind, 'public'::text AS schema_name, relation_name, artifact_name,
       CASE WHEN pg_catalog.to_regclass('public.'||relation_name) IS NULL THEN 'RELATION_MISSING'
            WHEN artifact_exists THEN 'PRESENT'
            ELSE 'MISSING'
       END AS catalog_status
FROM resolved
ORDER BY version, relation_name, artifact_kind, artifact_name;

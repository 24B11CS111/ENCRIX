-- ENCRIX production reconciliation diagnostic section.
-- Standalone SQL Editor script copied from diagnose_all_production_migrations.sql.
-- READ ONLY: catalog SELECTs and fixed catalog-guarded aggregate SELECTs only.
-- No application RPCs or customer/lead/payment/personal row values are returned.

-- Purpose: Guarded aggregate-only compatibility conflict counts.

-- SECTION 11: Aggregate-only data compatibility checks. Each result is
-- UNKNOWN if required relation/columns are missing; values/records never emit.
WITH checks(check_name, required_relation, required_columns, aggregate_sql) AS (
 VALUES
 ('profile_email_casefold_duplicates','public.profiles',ARRAY['email']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT lower(email) FROM public.profiles WHERE email IS NOT NULL GROUP BY lower(email) HAVING count(*)>1) q'),
 ('organization_owner_duplicates','public.organizations',ARRAY['owner_id']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT owner_id FROM public.organizations WHERE owner_id IS NOT NULL GROUP BY owner_id HAVING count(*)>1) q'),
 ('pending_registration_email_duplicates','public.pending_registrations',ARRAY['email']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT email FROM public.pending_registrations WHERE email IS NOT NULL GROUP BY email HAVING count(*)>1) q'),
 ('email_otp_duplicate_ticket_ids','public.email_otps',ARRAY['ticket_id']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT ticket_id FROM public.email_otps WHERE ticket_id IS NOT NULL GROUP BY ticket_id HAVING count(*)>1) q'),
 ('pending_invitation_duplicates','public.organization_invitations',ARRAY['organization_id','status','email']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT organization_id,lower(btrim(email)) FROM public.organization_invitations WHERE status=''PENDING'' AND email IS NOT NULL GROUP BY organization_id,lower(btrim(email)) HAVING count(*)>1) q'),
 ('normalized_lead_phone_duplicates','public.leads',ARRAY['organization_id','phone']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT organization_id,regexp_replace(phone,''\D'','''',''g'') FROM public.leads WHERE phone IS NOT NULL AND regexp_replace(phone,''\D'','''',''g'')<>'''' GROUP BY organization_id,regexp_replace(phone,''\D'','''',''g'') HAVING count(*)>1) q'),
 ('csv_import_marker_duplicates','public.leads',ARRAY['organization_id','metadata']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT organization_id,metadata->>''csv_import_id'',metadata->>''csv_import_row_index'' FROM public.leads WHERE metadata ? ''csv_import_id'' AND metadata->>''csv_import_row_index'' IS NOT NULL GROUP BY organization_id,metadata->>''csv_import_id'',metadata->>''csv_import_row_index'' HAVING count(*)>1) q'),
 ('billing_nonpositive_subscription_amounts','public.organization_subscriptions',ARRAY['amount_paise']::text[],
  'SELECT count(*) AS conflict_count FROM public.organization_subscriptions WHERE amount_paise<=0'),
 ('billing_nonpositive_razorpay_total_counts','public.organization_subscriptions',ARRAY['razorpay_total_count']::text[],
  'SELECT count(*) AS conflict_count FROM public.organization_subscriptions WHERE razorpay_total_count IS NOT NULL AND razorpay_total_count<=0'),
 ('billing_invalid_refund_amounts','public.billing_payments',ARRAY['amount_paise','amount_refunded_paise']::text[],
  'SELECT count(*) AS conflict_count FROM public.billing_payments WHERE amount_refunded_paise<0 OR amount_refunded_paise>amount_paise'),
 ('billing_missing_subscription_links','public.billing_payments',ARRAY['subscription_id']::text[],
  'SELECT count(*) AS conflict_count FROM public.billing_payments WHERE subscription_id IS NULL'),
 ('billing_payment_state_timestamp_conflicts','public.billing_payments',ARRAY['status','paid_at','signature_verified_at','failed_at']::text[],
  'SELECT count(*) AS conflict_count FROM public.billing_payments WHERE (status=''captured'' AND (paid_at IS NULL OR signature_verified_at IS NULL)) OR (status=''failed'' AND failed_at IS NULL)'),
 ('active_twilio_phone_duplicates','public.organization_twilio_credentials',ARRAY['twilio_phone_number','status']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT twilio_phone_number FROM public.organization_twilio_credentials WHERE status=''ACTIVE'' GROUP BY twilio_phone_number HAVING count(*)>1) q'),
 ('twilio_duplicate_provider_call_ids','public.calls',ARRAY['provider_call_id']::text[],
  'SELECT count(*) AS conflict_count FROM (SELECT provider_call_id FROM public.calls WHERE provider_call_id IS NOT NULL GROUP BY provider_call_id HAVING count(*)>1) q')
), evaluated AS (
 SELECT c.*,
   pg_catalog.to_regclass(c.required_relation) AS rel,
   NOT EXISTS (
     SELECT 1 FROM unnest(c.required_columns) AS req(col)
     WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                       WHERE a.attrelid=pg_catalog.to_regclass(c.required_relation)
                         AND a.attname=req.col AND a.attnum>0 AND NOT a.attisdropped)
   ) AS columns_ok
 FROM checks c
), results AS (
 SELECT e.*,
   CASE WHEN rel IS NULL OR NOT columns_ok THEN NULL::xml
        ELSE pg_catalog.query_to_xml(aggregate_sql,true,false,'') END AS aggregate_xml
 FROM evaluated e
)
SELECT 'DATA_PREFLIGHT' AS section, check_name,
       CASE WHEN rel IS NULL OR NOT columns_ok THEN 'UNKNOWN'
            WHEN COALESCE(((pg_catalog.xpath('/table/row/conflict_count/text()',aggregate_xml))[1])::text,'0')::bigint > 0 THEN 'CONFLICTING'
            ELSE 'PRESENT' END AS classification,
       CASE WHEN aggregate_xml IS NULL THEN NULL::bigint
            ELSE COALESCE(((pg_catalog.xpath('/table/row/conflict_count/text()',aggregate_xml))[1])::text,'0')::bigint END AS aggregate_conflict_count
FROM results ORDER BY check_name;

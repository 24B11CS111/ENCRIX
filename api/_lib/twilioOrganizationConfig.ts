import type { OrganizationTwilioCredentials, EncryptedTwilioCredentials } from './twilioCredentials.js';
import { decryptOrganizationTwilioCredentials } from './twilioCredentials.js';

export interface OrganizationTwilioRecord extends EncryptedTwilioCredentials {
  organization_id: string;
  twilio_phone_number: string;
  status: 'ACTIVE' | 'REVOKED';
  updated_at: string;
}

export async function getOrganizationTwilioConfig(
  supabase: any,
  organizationId: string,
): Promise<{ record: OrganizationTwilioRecord; credentials: OrganizationTwilioCredentials } | null> {
  const { data, error } = await supabase
    .from('organization_twilio_credentials')
    .select('organization_id, twilio_phone_number, key_id, nonce, ciphertext, auth_tag, status, updated_at')
    .eq('organization_id', organizationId)
    .eq('status', 'ACTIVE')
    .maybeSingle();
  if (error) throw new Error('organization_twilio_config_lookup_failed');
  if (!data) return null;
  const record = data as OrganizationTwilioRecord;
  const credentials = decryptOrganizationTwilioCredentials(organizationId, record);
  if (credentials.phoneNumber !== record.twilio_phone_number) {
    throw new Error('organization_twilio_config_integrity_failed');
  }
  return { record, credentials };
}

export async function getOrganizationForTwilioNumber(
  supabase: any,
  phoneNumber: string,
): Promise<{ record: OrganizationTwilioRecord; credentials: OrganizationTwilioCredentials } | null> {
  const { data, error } = await supabase
    .from('organization_twilio_credentials')
    .select('organization_id, twilio_phone_number, key_id, nonce, ciphertext, auth_tag, status, updated_at')
    .eq('twilio_phone_number', phoneNumber)
    .eq('status', 'ACTIVE');
  if (error) throw new Error('organization_twilio_route_lookup_failed');
  if (!Array.isArray(data) || data.length !== 1) return null;
  const record = data[0] as OrganizationTwilioRecord;
  const credentials = decryptOrganizationTwilioCredentials(record.organization_id, record);
  if (credentials.phoneNumber !== record.twilio_phone_number) {
    throw new Error('organization_twilio_config_integrity_failed');
  }
  return { record, credentials };
}

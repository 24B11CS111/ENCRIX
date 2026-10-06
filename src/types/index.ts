// LEADVAULT TypeScript Core Type Definitions

export type UserRole = 'ADMIN' | 'OWNER' | 'TELECALLER';

export type UserStatus = 'ACTIVE' | 'DISABLED' | 'PENDING';

export type OrgStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL';

export type LeadStatus =
  | 'NEW'
  | 'ASSIGNED'
  | 'CONTACTED'
  | 'INTERESTED'
  | 'FOLLOW_UP'
  | 'CONVERTED'
  | 'NOT_INTERESTED'
  | 'INVALID'
  | 'DO_NOT_CONTACT';

export type LeadPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type CallStatus =
  | 'INITIATED'
  | 'RINGING'
  | 'CONNECTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'MISSED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'CANCELED'
  | 'FAILED';

export type CallOutcomeType =
  | 'POSITIVE'
  | 'NEGATIVE'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'CALL_BACK'
  | 'WRONG_NUMBER'
  | 'DO_NOT_CONTACT'
  | 'CONVERTED'
  | 'FOLLOW_UP';

export type NegativeReason =
  | 'Not Interested'
  | 'Price'
  | 'Competitor'
  | 'Already Purchased'
  | 'Not Eligible'
  | 'Wrong Requirement'
  | 'Other';

export type FollowUpStatus = 'PENDING' | 'COMPLETED' | 'MISSED' | 'CANCELLED';

export type SecuritySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ActivityAction =
  | 'LOGIN'
  | 'LOGOUT'
  | 'LEAD_VIEW'
  | 'LEAD_CREATED'
  | 'LEAD_UPDATED'
  | 'LEAD_ASSIGNED'
  | 'LEAD_REASSIGNED'
  | 'CALL_STARTED'
  | 'CALL_COMPLETED'
  | 'OUTCOME_CHANGED'
  | 'FOLLOWUP_CREATED'
  | 'USER_CREATED'
  | 'USER_DISABLED'
  | 'EXPORT_ATTEMPT'
  | 'SECURITY_EVENT';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  industry: string;
  company_size?: string;
  logo_url?: string;
  status: OrgStatus;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  user_id: string;
  organization_id: string;
  full_name: string;
  phone?: string;
  role: UserRole;
  avatar_url?: string;
  status: UserStatus;
  created_at: string;
  updated_at: string;
  // Computed / client fields
  assigned_count?: number;
  calls_today?: number;
  positive_count?: number;
  conversion_rate?: number;
  last_active?: string;
}

export interface Lead {
  id: string;
  organization_id: string;
  lead_code: string;
  name: string;
  phone: string; // Stored securely; masked for telecallers
  email?: string;
  source: string;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_to?: string | null;
  assigned_profile?: Profile | null;
  notes?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_contacted_at?: string | null;
  calls_count?: number;
}

export interface LeadAssignment {
  id: string;
  organization_id: string;
  lead_id: string;
  user_id: string;
  assigned_by: string;
  assigned_at: string;
  unassigned_at?: string | null;
}

export interface Call {
  id: string;
  organization_id: string;
  lead_id: string;
  telecaller_id: string;
  telecaller_name?: string;
  lead_name?: string;
  lead_code?: string;
  provider: 'MOCK' | 'TWILIO' | 'EXOTEL' | 'KNOWLARITY';
  provider_call_id?: string;
  started_at: string;
  ended_at?: string | null;
  duration_seconds: number;
  status: CallStatus;
  recording_url?: string;
  recording_consent: boolean;
  outcome?: CallOutcomeType;
  notes?: string;
  created_at: string;
}

export interface CallOutcome {
  id: string;
  organization_id: string;
  call_id: string;
  lead_id: string;
  telecaller_id: string;
  outcome: CallOutcomeType;
  reason?: string;
  interest_level?: string;
  requirement?: string;
  notes?: string;
  created_at: string;
}

export interface FollowUp {
  id: string;
  organization_id: string;
  lead_id: string;
  lead_code?: string;
  lead_name?: string;
  lead_phone?: string;
  assigned_to: string;
  assigned_profile?: Profile;
  scheduled_at: string;
  status: FollowUpStatus;
  priority: LeadPriority;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  organization_id: string;
  user_id: string;
  type: 'LEAD_ASSIGNED' | 'CALL_OUTCOME' | 'FOLLOW_UP_DUE' | 'SECURITY_ALERT' | 'SYSTEM';
  title: string;
  message: string;
  read: boolean;
  link?: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  organization_id: string;
  user_id?: string;
  user_name?: string;
  user_role?: UserRole;
  action: ActivityAction;
  entity_type: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface SecurityEvent {
  id: string;
  organization_id: string;
  user_id?: string;
  user_name?: string;
  event_type: string;
  severity: SecuritySeverity;
  description: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

// Telephony Provider Interface
export interface TelephonySession {
  callId: string;
  leadId: string;
  telecallerId: string;
  phoneNumber?: string; // Server/provider internal; masked for telecaller client
  maskedPhoneNumber?: string;
  status: CallStatus;
  startedAt: Date;
  durationSeconds: number;
  isMuted: boolean;
  recordingUrl?: string;
}

export interface TelephonyProvider {
  name: string;
  initiateCall(params: { leadId: string; telecallerId: string; phoneNumber?: string }): Promise<TelephonySession>;
  endCall(callId: string): Promise<{ durationSeconds: number; recordingUrl: string }>;
  getCallStatus(callId: string): Promise<CallStatus>;
  toggleMute(callId: string, isMuted: boolean): Promise<boolean>;
}

// Import Wizard Types
export interface ColumnMapping {
  csvColumn: string;
  targetField: 'name' | 'phone' | 'email' | 'source' | 'priority' | 'notes' | 'ignore';
}

export interface ParsedLeadRow {
  rowIndex?: number;
  name: string;
  phone: string;
  email?: string;
  source?: string;
  priority?: LeadPriority;
  notes?: string;
  raw?: Record<string, string>;
  isValid: boolean;
  isDuplicate?: boolean;
  validationErrors: string[];
}

export interface ImportSummary {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  invalidRows: number;
  importedAt?: string;
}

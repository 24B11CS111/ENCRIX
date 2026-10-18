// LEADVAULT TypeScript Core Type Definitions

export type UserRole = 'ADMIN' | 'OWNER' | 'TELECALLER';

export type UserStatus =
  | 'ACTIVE'
  | 'DISABLED'
  | 'PENDING'
  | 'PENDING_VERIFICATION'
  | 'SUSPENDED';

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

export type FollowUpStatus =
  | 'PENDING'
  | 'SCHEDULED'
  | 'DUE'
  | 'COMPLETED'
  | 'RESCHEDULED'
  | 'CANCELLED'
  | 'OVERDUE'
  | 'MISSED';

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
  | 'FOLLOWUP_RESCHEDULED'
  | 'FOLLOWUP_CANCELLED'
  | 'FOLLOWUP_REASSIGNED'
  | 'FOLLOWUP_ESCALATED'
  | 'FOLLOWUP_COMPLETED'
  | 'FOLLOWUP_REMINDER_SENT'
  | 'USER_CREATED'
  | 'USER_DISABLED'
  | 'EXPORT_ATTEMPT'
  | 'SECURITY_EVENT'
  | 'OTP_REQUESTED'
  | 'OTP_VERIFIED'
  | 'ACCOUNT_CREATED'
  | 'INVITATION_CREATED'
  | 'INVITATION_ACCEPTED'
  | 'INVITATION_REVOKED'
  | 'LEAD_DETAILS_ACCESSED'
  | 'DISTRIBUTION_CONFIG_UPDATED'
  | 'ASSIGNMENT_FAILED';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';

export type OtpPurpose = 'LOGIN' | 'REGISTER' | 'INVITATION';

export interface OrganizationInvitation {
  id: string;
  organization_id: string;
  organization_name?: string;
  phone_number?: string;
  full_name: string;
  email?: string;
  invited_by: string;
  role: 'TELECALLER';
  status: InvitationStatus;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface PendingRegistration {
  id: string;
  phone_number?: string;
  company_name: string;
  owner_name: string;
  email?: string;
  industry?: string;
  company_size?: string;
  otp_hash: string;
  attempts: number;
  resend_after: string;
  expires_at: string;
  created_at: string;
}

export interface OtpVerificationRecord {
  id: string;
  phone_number?: string;
  email_address?: string;
  purpose: OtpPurpose;
  otp_hash: string;
  attempts: number;
  resend_after: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

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
  email?: string;
  phone?: string;
  email_verified?: boolean;
  phone_verified?: boolean;
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

  // Student & Family Information
  father_name?: string | null;
  mother_name?: string | null;

  // Academic / Examination Information
  neet_score?: number | string | null;
  neet_rank?: number | string | null;
  neet_year?: number | string | null;
  neet_attempts?: number | string | null;

  eamcet_score?: number | string | null;
  eamcet_rank?: number | string | null;
  eamcet_year?: number | string | null;
  eamcet_attempts?: number | string | null;

  ipe_marks?: number | string | null;
  ipe_percentage?: number | string | null;
  ipe_year?: number | string | null;
  ipe_attempts?: number | string | null;

  // Approved Student Profile Fields
  category?: string | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  school_or_college?: string | null;
  course_interest?: string | null;

  // Phase 20: Smart Distribution & Workload Balancing
  unassigned_reason?: UnassignedReason | string | null;
  reassigned_at?: string | null;
  reassign_reason?: string | null;
}

/**
 * Authorized Student Detail representation for Telecallers.
 * CRITICAL SECURITY INVARIANT: Phone number is NEVER included in this interface,
 * preventing any phone exposure at compile and runtime layers.
 */
export interface StudentDetails {
  id: string;
  organization_id: string;
  lead_code: string;
  name: string; // Student's full name
  email?: string;
  source: string;
  status: LeadStatus;
  priority: LeadPriority;
  assigned_to?: string | null;
  notes?: string;
  created_at: string;
  updated_at?: string;
  last_contacted_at?: string | null;
  calls_count?: number;

  // Family details
  father_name?: string | null;
  mother_name?: string | null;

  // Academic / Examination details
  neet_score?: number | string | null;
  neet_rank?: number | string | null;
  neet_year?: number | string | null;
  neet_attempts?: number | string | null;

  eamcet_score?: number | string | null;
  eamcet_rank?: number | string | null;
  eamcet_year?: number | string | null;
  eamcet_attempts?: number | string | null;

  ipe_marks?: number | string | null;
  ipe_percentage?: number | string | null;
  ipe_year?: number | string | null;
  ipe_attempts?: number | string | null;

  // Additional approved profile fields
  category?: string | null;
  gender?: string | null;
  city?: string | null;
  state?: string | null;
  school_or_college?: string | null;
  course_interest?: string | null;
}

export type DistributionMode = 'MANUAL' | 'ROUND_ROBIN' | 'WORKLOAD_BALANCED';

export type UnassignedReason =
  | 'NO_ELIGIBLE_TELECALLERS'
  | 'CAPACITY_REACHED'
  | 'MANUAL_UNASSIGNED'
  | 'EXCLUDED_POOL'
  | 'EMPTY_TEAM';

export interface LeadAssignment {
  id: string;
  organization_id: string;
  lead_id: string;
  user_id: string;
  assigned_by: string;
  assigned_at: string;
  unassigned_at?: string | null;
  reassign_reason?: string | null;
  previous_user_id?: string | null;
  mode?: DistributionMode | string;
}

export interface OrganizationDistributionConfig {
  id: string;
  organization_id: string;
  mode: DistributionMode;
  enabled_for_import: boolean;
  max_workload: number | null; // maximum open leads per telecaller, null for unlimited
  eligible_telecaller_ids: string[]; // empty array means all active telecallers in org are eligible
  round_robin_index: number; // persistent pointer to next telecaller in rotation
  updated_at: string;
  updated_by?: string;
}

export interface DistributionPreviewItem {
  telecaller_id: string;
  telecaller_name: string;
  current_open_leads: number;
  leads_to_assign: number;
  projected_open_leads: number;
  at_capacity: boolean;
}

export interface DistributionPreview {
  mode: DistributionMode;
  total_leads: number;
  assignable_count: number;
  unassigned_count: number;
  unassigned_reason?: UnassignedReason | null;
  telecaller_breakdown: DistributionPreviewItem[];
}

export interface DistributionResult {
  success: boolean;
  mode: DistributionMode;
  total_requested: number;
  assigned_count: number;
  unassigned_count: number;
  assignments: Record<string, number>; // telecaller_id -> count
  unassigned_lead_ids: string[];
  unassigned_reason?: UnassignedReason | null;
  audit_id?: string;
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
  created_by?: string;
  scheduled_at: string;
  timezone?: string;
  status: FollowUpStatus;
  priority: LeadPriority;
  notes?: string;
  reason?: string;

  // Completion Tracking
  completed_at?: string | null;
  outcome?: CallOutcomeType | string | null;
  outcome_notes?: string | null;

  // Rescheduling History
  rescheduled_at?: string | null;
  reschedule_reason?: string | null;
  previous_due_at?: string | null;
  reschedule_count?: number;

  // Reminders & Overdue Escalation (Independent Idempotency Controls)
  reminded_at?: string | null; // T-15m upcoming alert sent
  overdue_notified_at?: string | null; // Telecaller overdue notification sent
  owner_alerted_at?: string | null; // Owner 30m overdue escalation alert sent
  escalated_at?: string | null; // Manual owner escalation timestamp
  escalated_by?: string | null;
  escalation_reason?: string | null;

  created_at: string;
  updated_at: string;
}

export interface Notification {
  id: string;
  organization_id: string;
  user_id: string;
  type:
    | 'LEAD_ASSIGNED'
    | 'CALL_OUTCOME'
    | 'FOLLOW_UP_DUE'
    | 'FOLLOW_UP_OVERDUE'
    | 'FOLLOW_UP_ESCALATED'
    | 'SECURITY_ALERT'
    | 'SYSTEM';
  title: string;
  message: string;
  read: boolean;
  link?: string;
  created_at: string;
}

/**
 * Derives the active runtime follow-up status dynamically from scheduled_at and now.
 * Prevents stale client timer drift.
 */
export function getDerivedFollowUpStatus(
  followUp: { status: FollowUpStatus; scheduled_at: string },
  referenceTime: Date = new Date()
): FollowUpStatus {
  if (
    followUp.status === 'COMPLETED' ||
    followUp.status === 'CANCELLED' ||
    followUp.status === 'RESCHEDULED'
  ) {
    return followUp.status;
  }

  const scheduledTime = new Date(followUp.scheduled_at).getTime();
  const now = referenceTime.getTime();

  if (now > scheduledTime) {
    return 'OVERDUE';
  }

  // Within 15 minutes of scheduled time
  const fifteenMinutesMs = 15 * 60 * 1000;
  if (scheduledTime - now <= fifteenMinutesMs) {
    return 'DUE';
  }

  return 'SCHEDULED';
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

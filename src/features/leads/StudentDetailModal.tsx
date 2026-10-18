import React, { useState, useEffect } from 'react';
import { StudentDetails } from '@/types';
import { leadService } from '@/services/leads/leadService';
import { useAuth } from '@/features/auth/AuthContext';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import {
  X,
  Phone,
  GraduationCap,
  Users,
  ShieldCheck,
  AlertCircle,
  Loader2,
  BookOpen,
  MapPin,
  Building2,
  Calendar,
  Award,
} from 'lucide-react';

interface StudentDetailModalProps {
  leadId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onInitiateCall?: (leadId: string) => void;
}

export const StudentDetailModal: React.FC<StudentDetailModalProps> = ({
  leadId,
  isOpen,
  onClose,
  onInitiateCall,
}) => {
  const { profile } = useAuth();
  const [details, setDetails] = useState<StudentDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !leadId || !profile) {
      setDetails(null);
      setError(null);
      setLoading(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);
    setDetails(null);

    leadService
      .getStudentDetails(leadId, profile)
      .then((data) => {
        if (isMounted) {
          setDetails(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err?.message || 'Failed to retrieve authorized student details. Access may be restricted.');
          setLoading(false);
          // SECURITY INVARIANT: NEVER fall back to mock data or full lead objects on failure!
          setDetails(null);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, leadId, profile]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0B1F3A]/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white rounded-[16px] border border-[#DCE4EE] shadow-dropdown overflow-hidden flex flex-col max-h-[90vh]">
        {/* MODAL HEADER */}
        <div className="p-5 border-b border-[#DCE4EE] bg-[#F6F8FB] flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold text-[#1E4D8F] px-2.5 py-0.5 rounded-[6px] bg-[#EAF2FB] border border-[#C7DCF3]">
                {details?.lead_code || 'STUDENT LEAD'}
              </span>
              {details && (
                <>
                  <StatusBadge status={details.status} />
                  <PriorityBadge priority={details.priority} />
                </>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#16845B] bg-[#EAF7EE] px-2 py-0.5 rounded-[6px] border border-[#C3EBD0]">
                <ShieldCheck className="w-3 h-3 text-[#16845B]" />
                Zero Phone Exposure
              </span>
            </div>

            <h2 className="text-xl font-bold text-[#0B1F3A] tracking-tight">
              {loading ? 'Retrieving Records...' : details?.name || 'Student Profile'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {details && onInitiateCall && (
              <button
                onClick={() => {
                  onClose();
                  onInitiateCall(details.id);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0B1F3A] hover:bg-[#071A33] text-white text-xs font-semibold rounded-[8px] shadow-subtle transition-colors"
                title="Call via Gateway"
              >
                <Phone className="w-3.5 h-3.5" />
                <span>Call via Gateway</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-[8px] text-[#64748B] hover:text-[#0B1F3A] hover:bg-white border border-transparent hover:border-[#DCE4EE] transition-colors"
              title="Close panel"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* MODAL CONTENT BODY */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* LOADING STATE */}
          {loading && (
            <div className="py-16 flex flex-col items-center justify-center text-center space-y-3">
              <Loader2 className="w-8 h-8 text-[#1E4D8F] animate-spin" />
              <div className="text-xs font-semibold text-[#0B1F3A]">
                Verifying Session & Retrieving Authorized Records...
              </div>
              <p className="text-[11px] text-[#64748B] max-w-sm">
                Enforcing tenant isolation and role-gated student privacy protocols.
              </p>
            </div>
          )}

          {/* SAFE ERROR STATE */}
          {error && !loading && (
            <div className="p-4 rounded-[12px] bg-[#FEECEB] border border-[#F8C8C6] flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-[#C53030] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-xs font-bold text-[#C53030]">Access Restricted or Lead Unavailable</div>
                <p className="text-xs text-[#172B4D] leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {/* AUTHORIZED STUDENT DETAILS VIEW */}
          {details && !loading && !error && (
            <div className="space-y-5">
              {/* SECTION 1: STUDENT & FAMILY INFORMATION */}
              <div className="rounded-[12px] border border-[#DCE4EE] bg-white p-4 space-y-3.5 shadow-subtle">
                <div className="flex items-center gap-2 border-b border-[#DCE4EE] pb-2 text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
                  <Users className="w-4 h-4 text-[#1E4D8F]" />
                  <span>Student & Family Profile</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div>
                    <span className="text-[#64748B] block text-[11px]">Student Full Name</span>
                    <span className="text-[#0B1F3A] font-semibold">{details.name || 'Not provided'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block text-[11px]">Father's Name</span>
                    <span className="text-[#172B4D] font-medium">{details.father_name || 'Not provided'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block text-[11px]">Mother's Name</span>
                    <span className="text-[#172B4D] font-medium">{details.mother_name || 'Not provided'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block text-[11px]">Category / Reservation</span>
                    <span className="text-[#172B4D] font-medium">{details.category || 'Not provided'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block text-[11px]">Gender</span>
                    <span className="text-[#172B4D] font-medium">{details.gender || 'Not provided'}</span>
                  </div>

                  <div>
                    <span className="text-[#64748B] block text-[11px] flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-[#64748B]" />
                      Location (City, State)
                    </span>
                    <span className="text-[#172B4D] font-medium">
                      {details.city && details.state
                        ? `${details.city}, ${details.state}`
                        : details.city || details.state || 'Not provided'}
                    </span>
                  </div>

                  <div className="sm:col-span-2">
                    <span className="text-[#64748B] block text-[11px] flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-[#64748B]" />
                      School / Junior College
                    </span>
                    <span className="text-[#172B4D] font-medium">{details.school_or_college || 'Not provided'}</span>
                  </div>

                  <div className="sm:col-span-2">
                    <span className="text-[#64748B] block text-[11px] flex items-center gap-1">
                      <BookOpen className="w-3 h-3 text-[#64748B]" />
                      Target Course Interest
                    </span>
                    <span className="text-[#172B4D] font-semibold">{details.course_interest || 'Not provided'}</span>
                  </div>
                </div>
              </div>

              {/* SECTION 2: EXAMINATION & ACADEMIC INFORMATION */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#0B1F3A] uppercase tracking-wider">
                  <GraduationCap className="w-4 h-4 text-[#1E4D8F]" />
                  <span>Examination & Academic Record</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* NEET EXAM CARD */}
                  <div className="rounded-[12px] border border-[#DCE4EE] bg-[#F6F8FB] p-3.5 space-y-2.5 shadow-subtle">
                    <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-1.5">
                      <span className="text-xs font-bold text-[#0B1F3A]">NEET Examination</span>
                      <Award className="w-3.5 h-3.5 text-[#1E4D8F]" />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-[#64748B] block text-[10px]">Score</span>
                        <span className="font-semibold text-[#0B1F3A] text-sm">
                          {details.neet_score != null ? details.neet_score : 'Not provided'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#64748B] block text-[10px]">All India Rank</span>
                        <span className="font-mono text-[#172B4D]">
                          {details.neet_rank != null ? `#${details.neet_rank}` : 'Not provided'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-[#64748B] block text-[10px]">Year</span>
                          <span className="text-[#172B4D]">{details.neet_year != null ? details.neet_year : 'Not provided'}</span>
                        </div>
                        <div>
                          <span className="text-[#64748B] block text-[10px]">Attempts</span>
                          <span className="text-[#172B4D]">{details.neet_attempts != null ? details.neet_attempts : 'Not provided'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* EAMCET EXAM CARD */}
                  <div className="rounded-[12px] border border-[#DCE4EE] bg-[#F6F8FB] p-3.5 space-y-2.5 shadow-subtle">
                    <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-1.5">
                      <span className="text-xs font-bold text-[#0B1F3A]">EAMCET Examination</span>
                      <Award className="w-3.5 h-3.5 text-[#1E4D8F]" />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-[#64748B] block text-[10px]">Score</span>
                        <span className="font-semibold text-[#0B1F3A] text-sm">
                          {details.eamcet_score != null ? details.eamcet_score : 'Not provided'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#64748B] block text-[10px]">State Rank</span>
                        <span className="font-mono text-[#172B4D]">
                          {details.eamcet_rank != null ? `#${details.eamcet_rank}` : 'Not provided'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-[#64748B] block text-[10px]">Year</span>
                          <span className="text-[#172B4D]">{details.eamcet_year != null ? details.eamcet_year : 'Not provided'}</span>
                        </div>
                        <div>
                          <span className="text-[#64748B] block text-[10px]">Attempts</span>
                          <span className="text-[#172B4D]">{details.eamcet_attempts != null ? details.eamcet_attempts : 'Not provided'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* IPE EXAM CARD */}
                  <div className="rounded-[12px] border border-[#DCE4EE] bg-[#F6F8FB] p-3.5 space-y-2.5 shadow-subtle">
                    <div className="flex items-center justify-between border-b border-[#DCE4EE] pb-1.5">
                      <span className="text-xs font-bold text-[#0B1F3A]">IPE (Intermediate)</span>
                      <Award className="w-3.5 h-3.5 text-[#1E4D8F]" />
                    </div>

                    <div className="space-y-2 text-xs">
                      <div>
                        <span className="text-[#64748B] block text-[10px]">Total Marks</span>
                        <span className="font-semibold text-[#0B1F3A] text-sm">
                          {details.ipe_marks != null ? details.ipe_marks : 'Not provided'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#64748B] block text-[10px]">Percentage</span>
                        <span className="font-mono text-[#172B4D]">
                          {details.ipe_percentage != null ? `${details.ipe_percentage}%` : 'Not provided'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div>
                          <span className="text-[#64748B] block text-[10px]">Year</span>
                          <span className="text-[#172B4D]">{details.ipe_year != null ? details.ipe_year : 'Not provided'}</span>
                        </div>
                        <div>
                          <span className="text-[#64748B] block text-[10px]">Attempts</span>
                          <span className="text-[#172B4D]">{details.ipe_attempts != null ? details.ipe_attempts : 'Not provided'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 3: LEAD STATUS & DISCUSSION NOTES */}
              <div className="rounded-[12px] border border-[#DCE4EE] bg-white p-4 space-y-2.5 shadow-subtle text-xs">
                <span className="text-xs font-bold text-[#0B1F3A] uppercase tracking-wider block">
                  Lead Source & Discussion Notes
                </span>
                <div className="text-[11px] text-[#64748B]">
                  Lead Source: <strong className="text-[#172B4D]">{details.source}</strong>
                </div>
                <p className="p-3 rounded-[8px] bg-[#F6F8FB] border border-[#DCE4EE] text-[#172B4D] leading-relaxed whitespace-pre-line">
                  {details.notes || 'No discussion points or notes recorded yet.'}
                </p>
              </div>

              {/* SECTION 4: ZERO-EXPOSURE PROTOCOL ACTIVE */}
              <div className="rounded-[10px] bg-[#EAF2FB] border border-[#C7DCF3] p-3 text-[11px] text-[#1E4D8F] flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-[#1E4D8F] shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">ENCRIX Zero-Exposure Security Active</span>
                  <p className="mt-0.5 text-[#172B4D]">
                    Student mobile contact numbers are stored exclusively inside the encrypted server telephony vault. Outbound calls bridge automatically through the server-side gateway without delivering customer phone digits to telecaller clients.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

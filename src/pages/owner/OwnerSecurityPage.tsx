import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { SecurityEvent } from '@/types';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Lock,
  Download,
  EyeOff,
  UserX,
  FileCheck,
} from 'lucide-react';

export const OwnerSecurityPage: React.FC = () => {
  const { profile, organization } = useAuth();
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const loadData = () => {
    if (!profile) return;
    setSecurityEvents(db.getSecurityEvents(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'SECURITY_EVENT_RAISED') {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  // Authorized Owner export (strictly for owner/admin compliance, never telecallers)
  const handleOwnerExport = () => {
    if (!profile) return;
    setIsExporting(true);

    try {
      const leads = db.getLeads(profile);
      const csvContent =
        'data:text/csv;charset=utf-8,' +
        ['LeadCode,Name,Phone,Email,Status,Source,CreatedAt']
          .concat(
            leads.map(
              (l) =>
                `"${l.lead_code}","${l.name}","${l.phone}","${l.email || ''}","${l.status}","${l.source}","${l.created_at}"`
            )
          )
          .join('\n');

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `encrix_compliance_export_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      db.logActivity({
        organization_id: profile.organization_id,
        user_id: profile.id,
        user_name: profile.full_name,
        user_role: profile.role,
        action: 'EXPORT_ATTEMPT',
        entity_type: 'compliance_export',
        metadata: { authorized: true, count: leads.length },
      });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Security & Data Loss Prevention</h1>
            <span className="text-[11px] font-semibold text-[#16845B] bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
              Zero-Trust Guard
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Real-time anomaly monitoring, velocity alert heuristics, export protection and statutory compliance.
          </p>
        </div>

        <button
          onClick={handleOwnerExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-3.5 py-2 bg-white hover:bg-[#F6F8FB] text-[#172B4D] text-xs font-semibold rounded-[10px] border border-[#DCE4EE] transition-colors shadow-sm"
        >
          <Download className="w-3.5 h-3.5 text-[#1E4D8F]" />
          <span>Authorized Audit Export</span>
        </button>
      </div>

      {/* SECTION 13: 4 SECURITY CONTROLS CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* DATA PROTECTION */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B1F3A]">
              <EyeOff className="w-4 h-4 text-[#1E4D8F]" />
              <span>DATA PROTECTION</span>
            </div>
            <span className="bg-emerald-50 text-[#16845B] border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-semibold">
              Active
            </span>
          </div>
          <ul className="text-xs text-[#64748B] space-y-1.5 list-disc list-inside">
            <li>Masking enabled</li>
            <li>Phone protection active</li>
            <li>Export lock enabled</li>
          </ul>
        </div>

        {/* TENANT ISOLATION */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B1F3A]">
              <ShieldCheck className="w-4 h-4 text-[#16845B]" />
              <span>TENANT ISOLATION</span>
            </div>
            <span className="bg-emerald-50 text-[#16845B] border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-semibold">
              Protected
            </span>
          </div>
          <ul className="text-xs text-[#64748B] space-y-1.5 list-disc list-inside">
            <li>PostgreSQL RLS enforced</li>
            <li>Cross-org queries blocked</li>
            <li>Organization scope sealed</li>
          </ul>
        </div>

        {/* CALL SECURITY */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B1F3A]">
              <Lock className="w-4 h-4 text-[#0B1F3A]" />
              <span>CALL SECURITY</span>
            </div>
            <span className="bg-emerald-50 text-[#16845B] border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-semibold">
              Active
            </span>
          </div>
          <ul className="text-xs text-[#64748B] space-y-1.5 list-disc list-inside">
            <li>Virtual gateway routing</li>
            <li>Browser audio capture blocked</li>
            <li>Statutory consent advisory</li>
          </ul>
        </div>

        {/* AUDIT LOG */}
        <div className="p-5 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-bold text-[#0B1F3A]">
              <FileCheck className="w-4 h-4 text-[#1E4D8F]" />
              <span>AUDIT LOG</span>
            </div>
            <span className="bg-emerald-50 text-[#16845B] border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-semibold">
              Operational
            </span>
          </div>
          <ul className="text-xs text-[#64748B] space-y-1.5 list-disc list-inside">
            <li>Append-only storage</li>
            <li>Tamper-resistant log stream</li>
            <li>Real-time event dispatch</li>
          </ul>
        </div>
      </div>

      {/* LIVE SECURITY INCIDENTS / ALERTS */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#DCE4EE] flex items-center justify-between bg-[#F6F8FB]/50">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#C53030]" />
            <h2 className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider">
              Security Events & Telemetry Alerts ({securityEvents.length})
            </h2>
          </div>
          <span className="text-[11px] text-[#64748B]">Heuristic Anomaly Detector</span>
        </div>

        <div className="divide-y divide-[#DCE4EE]">
          {securityEvents.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              No security anomalies detected. System posture is optimal.
            </div>
          ) : (
            securityEvents.map((evt) => (
              <div key={evt.id} className="p-4 hover:bg-[#F6F8FB]/60 transition-colors space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${
                        evt.severity === 'CRITICAL' || evt.severity === 'HIGH'
                          ? 'bg-rose-50 text-[#C53030] border-rose-200'
                          : evt.severity === 'MEDIUM'
                          ? 'bg-amber-50 text-[#B7791F] border-amber-200'
                          : 'bg-blue-50 text-[#1E4D8F] border-blue-200'
                      }`}
                    >
                      {evt.severity}
                    </span>
                    <span className="font-semibold text-[#172B4D] text-xs">{evt.event_type}</span>
                  </div>

                  <span className="text-[11px] text-[#64748B] font-mono">
                    {formatRelativeTime(evt.created_at)}
                  </span>
                </div>

                <p className="text-xs text-[#172B4D]">{evt.description}</p>

                {evt.metadata && (
                  <div className="text-[11px] font-mono text-[#64748B] bg-[#F6F8FB] p-2 rounded-[8px] border border-[#DCE4EE]">
                    Metadata: {JSON.stringify(evt.metadata)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

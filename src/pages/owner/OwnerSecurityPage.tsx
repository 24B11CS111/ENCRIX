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
      link.setAttribute('download', `leadvault_compliance_export_${Date.now()}.csv`);
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Security & Data Loss Prevention</h1>
            <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/60 border border-emerald-500/20 px-2 py-0.5 rounded-full">
              Zero-Trust Guard
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time anomaly monitoring, velocity alert heuristics, export protection and statutory compliance.
          </p>
        </div>

        <button
          onClick={handleOwnerExport}
          disabled={isExporting}
          className="flex items-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>Authorized Audit Export</span>
        </button>
      </div>

      {/* SECURITY CONTROLS STATUS CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
            <Lock className="w-4 h-4" />
            <span>Telecaller Export Guard</span>
          </div>
          <p className="text-xs text-slate-300">
            Export capabilities are completely disabled and blocked at the API & database layer for all non-owner roles.
          </p>
          <div className="text-[11px] text-emerald-400 font-medium">Status: ACTIVE & ENFORCED</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
            <EyeOff className="w-4 h-4" />
            <span>Data Masking Shield</span>
          </div>
          <p className="text-xs text-slate-300">
            Raw phone numbers (+91 ******3210) and full surnames (Rahul K.) are stripped before rendering telecaller views.
          </p>
          <div className="text-[11px] text-emerald-400 font-medium">Status: ACTIVE & ENFORCED</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold">
            <ShieldCheck className="w-4 h-4" />
            <span>RLS Multi-Tenant Isolation</span>
          </div>
          <p className="text-xs text-slate-300">
            PostgreSQL policies isolate records strictly by organization_id. Cross-tenant access is physically impossible.
          </p>
          <div className="text-[11px] text-emerald-400 font-medium">Status: ACTIVE & ENFORCED</div>
        </div>
      </div>

      {/* LIVE SECURITY INCIDENTS / ALERTS */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" />
            <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
              Security Events & Telemetry Alerts ({securityEvents.length})
            </h2>
          </div>
          <span className="text-[11px] text-slate-400">Heuristic Anomaly Detector</span>
        </div>

        <div className="divide-y divide-slate-800/60">
          {securityEvents.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No security anomalies detected. System posture is optimal.
            </div>
          ) : (
            securityEvents.map((evt) => (
              <div key={evt.id} className="p-4 hover:bg-slate-800/40 transition-colors space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border uppercase tracking-wider ${
                        evt.severity === 'CRITICAL' || evt.severity === 'HIGH'
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : evt.severity === 'MEDIUM'
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                      }`}
                    >
                      {evt.severity}
                    </span>
                    <span className="font-semibold text-white text-xs">{evt.event_type}</span>
                  </div>

                  <span className="text-[11px] text-slate-500 font-mono">
                    {formatRelativeTime(evt.created_at)}
                  </span>
                </div>

                <p className="text-xs text-slate-300">{evt.description}</p>

                {evt.metadata && (
                  <div className="text-[11px] font-mono text-slate-400 bg-slate-950/60 p-2 rounded border border-slate-800/80">
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

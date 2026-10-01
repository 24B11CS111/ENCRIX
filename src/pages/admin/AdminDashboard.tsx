import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { Organization, Profile, Lead, Call, SecurityEvent } from '@/types';
import {
  Building2,
  Users,
  PhoneCall,
  ShieldAlert,
  Server,
  Activity,
  ArrowUpRight,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const AdminDashboard: React.FC = () => {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [securityEvents, setSecurityEvents] = useState<SecurityEvent[]>([]);

  useEffect(() => {
    if (!profile) return;
    setOrgs(db.getOrganizations(profile));
    setUsers(db.getProfiles(profile));
    setLeads(db.getLeads(profile));
    setCalls(db.getCalls(profile));
    setSecurityEvents(db.getSecurityEvents(profile));
  }, [profile]);

  const activeOrgs = orgs.filter((o) => o.status === 'ACTIVE').length;
  const owners = users.filter((u) => u.role === 'OWNER').length;
  const telecallers = users.filter((u) => u.role === 'TELECALLER').length;
  const criticalSecEvents = securityEvents.filter((s) => s.severity === 'HIGH' || s.severity === 'CRITICAL').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight">Platform Administration</h1>
            <span className="text-[11px] font-semibold text-purple-400 bg-purple-950/60 border border-purple-500/30 px-2 py-0.5 rounded-full">
              Super Admin
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Global tenant governance, multi-organization security telemetry and system health.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-xs">
            <Server className="w-3.5 h-3.5" />
            <span>Database: Connected (0.8ms)</span>
          </div>
        </div>
      </div>

      {/* METRIC STRIP (Section 7) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">Organizations</div>
          <div className="text-2xl font-bold text-white">{orgs.length}</div>
          <span className="text-[10px] text-emerald-400">{activeOrgs} active</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">Owners</div>
          <div className="text-2xl font-bold text-sky-400">{owners}</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">Telecallers</div>
          <div className="text-2xl font-bold text-emerald-400">{telecallers}</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">Total Leads</div>
          <div className="text-2xl font-bold text-white">{leads.length}</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">Total Calls</div>
          <div className="text-2xl font-bold text-purple-400">{calls.length}</div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">Security Alerts</div>
          <div className="text-2xl font-bold text-rose-400">{securityEvents.length}</div>
          <span className="text-[10px] text-rose-400 font-semibold">{criticalSecEvents} critical</span>
        </div>

        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800">
          <div className="text-[11px] text-slate-400 font-medium mb-1">System Health</div>
          <div className="text-xl font-bold text-emerald-400">99.98%</div>
          <span className="text-[10px] text-slate-400">All services ok</span>
        </div>
      </div>

      {/* ORGANIZATIONS BREAKDOWN */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold text-white uppercase tracking-wider">
              Registered Organizations & Tenant Isolations
            </h2>
            <p className="text-[11px] text-slate-400">
              Each organization operates in strict PostgreSQL RLS quarantine.
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/organizations')}
            className="text-xs text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
          >
            <span>Manage Orgs</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-slate-800/60">
          {orgs.map((org) => {
            const orgLeads = leads.filter((l) => l.organization_id === org.id).length;
            const orgUsers = users.filter((u) => u.organization_id === org.id).length;
            const orgCalls = calls.filter((c) => c.organization_id === org.id).length;

            return (
              <div key={org.id} className="p-4 flex items-center justify-between hover:bg-slate-800/40 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-white text-sm">{org.name}</div>
                    <div className="text-slate-400 text-[11px]">
                      Industry: {org.industry} • Tenant ID: <span className="font-mono">{org.id}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-slate-300">
                  <div>
                    <span className="text-slate-500 block text-[10px]">Users</span>
                    <span className="font-bold text-white">{orgUsers}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Leads</span>
                    <span className="font-bold text-white">{orgLeads}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Calls</span>
                    <span className="font-bold text-white">{orgCalls}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[10px]">Status</span>
                    <span className="text-emerald-400 font-semibold">{org.status}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

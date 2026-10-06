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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Platform Administration</h1>
            <span className="text-[11px] font-semibold text-[#1E4D8F] bg-[#EAF2FB] border border-blue-200 px-2.5 py-0.5 rounded-full">
              Super Admin
            </span>
          </div>
          <p className="text-xs text-[#64748B] mt-1">
            Global tenant governance, multi-organization security telemetry and system health.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-emerald-50 border border-emerald-200 text-[#16845B] text-xs font-medium shadow-sm">
            <Server className="w-3.5 h-3.5" />
            <span>Database: Connected (0.8ms)</span>
          </div>
        </div>
      </div>

      {/* METRIC STRIP (Section 7) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">Organizations</div>
          <div className="text-2xl font-bold text-[#0B1F3A]">{orgs.length}</div>
          <span className="text-[10px] text-[#16845B] font-medium">{activeOrgs} active</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">Owners</div>
          <div className="text-2xl font-bold text-[#1E4D8F]">{owners}</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">Telecallers</div>
          <div className="text-2xl font-bold text-[#16845B]">{telecallers}</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">Total Leads</div>
          <div className="text-2xl font-bold text-[#0B1F3A]">{leads.length}</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">Total Calls</div>
          <div className="text-2xl font-bold text-[#1E4D8F]">{calls.length}</div>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">Security Alerts</div>
          <div className="text-2xl font-bold text-[#C53030]">{securityEvents.length}</div>
          <span className="text-[10px] text-[#C53030] font-semibold">{criticalSecEvents} critical</span>
        </div>

        <div className="p-4 rounded-[12px] bg-white border border-[#DCE4EE] shadow-sm">
          <div className="text-[11px] text-[#64748B] font-medium mb-1">System Health</div>
          <div className="text-xl font-bold text-[#16845B]">99.98%</div>
          <span className="text-[10px] text-[#64748B]">All services ok</span>
        </div>
      </div>

      {/* ORGANIZATIONS BREAKDOWN */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="p-4 border-b border-[#DCE4EE] flex items-center justify-between bg-[#F6F8FB]/50">
          <div>
            <h2 className="text-xs font-semibold text-[#0B1F3A] uppercase tracking-wider">
              Registered Organizations & Tenant Isolations
            </h2>
            <p className="text-[11px] text-[#64748B]">
              Each organization operates in strict PostgreSQL RLS quarantine.
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/organizations')}
            className="text-xs text-[#1E4D8F] hover:text-[#0B1F3A] font-semibold flex items-center gap-1 transition-colors"
          >
            <span>Manage Orgs</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="divide-y divide-[#DCE4EE]">
          {orgs.map((org) => {
            const orgLeads = leads.filter((l) => l.organization_id === org.id).length;
            const orgUsers = users.filter((u) => u.organization_id === org.id).length;
            const orgCalls = calls.filter((c) => c.organization_id === org.id).length;

            return (
              <div key={org.id} className="p-4 flex items-center justify-between hover:bg-[#F6F8FB]/60 text-xs transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-[8px] bg-[#EAF2FB] border border-blue-200 text-[#1E4D8F] flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="font-bold text-[#0B1F3A] text-sm">{org.name}</div>
                    <div className="text-[#64748B] text-[11px]">
                      Industry: {org.industry} • Tenant ID: <span className="font-mono text-[#172B4D]">{org.id}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-6 text-[#172B4D]">
                  <div>
                    <span className="text-[#64748B] block text-[10px]">Users</span>
                    <span className="font-bold text-[#0B1F3A]">{orgUsers}</span>
                  </div>
                  <div>
                    <span className="text-[#64748B] block text-[10px]">Leads</span>
                    <span className="font-bold text-[#0B1F3A]">{orgLeads}</span>
                  </div>
                  <div>
                    <span className="text-[#64748B] block text-[10px]">Calls</span>
                    <span className="font-bold text-[#0B1F3A]">{orgCalls}</span>
                  </div>
                  <div>
                    <span className="text-[#64748B] block text-[10px]">Status</span>
                    <span className="text-[#16845B] font-semibold">{org.status}</span>
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

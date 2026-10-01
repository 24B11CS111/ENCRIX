import React, { useState, useEffect } from 'react';
import { useAuth } from '@/features/auth/AuthContext';
import { db } from '@/services/supabase/db';
import { FollowUp, Profile } from '@/types';
import { formatDateTime, formatRelativeTime } from '@/lib/utils';
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  Phone,
  User,
} from 'lucide-react';
import { PriorityBadge } from '@/components/common/PriorityBadge';

export const OwnerFollowUpsPage: React.FC = () => {
  const { profile } = useAuth();
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [activeTab, setActiveTab] = useState<'TODAY' | 'UPCOMING' | 'OVERDUE' | 'COMPLETED'>('TODAY');

  const loadData = () => {
    if (!profile) return;
    setFollowUps(db.getFollowUps(profile));
  };

  useEffect(() => {
    loadData();

    const unsubscribe = db.subscribe(({ type }) => {
      if (type === 'FOLLOWUP_CREATED' || type === 'FOLLOWUP_UPDATED' || type === 'CALL_OUTCOME_SAVED') {
        loadData();
      }
    });

    return () => unsubscribe();
  }, [profile]);

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const todayFollowUps = followUps.filter((f) => {
    const d = new Date(f.scheduled_at);
    return f.status === 'PENDING' && d >= startOfToday && d <= endOfToday;
  });

  const overdueFollowUps = followUps.filter((f) => {
    const d = new Date(f.scheduled_at);
    return f.status === 'PENDING' && d < startOfToday;
  });

  const upcomingFollowUps = followUps.filter((f) => {
    const d = new Date(f.scheduled_at);
    return f.status === 'PENDING' && d > endOfToday;
  });

  const completedFollowUps = followUps.filter((f) => f.status === 'COMPLETED');

  const currentList =
    activeTab === 'TODAY'
      ? todayFollowUps
      : activeTab === 'OVERDUE'
      ? overdueFollowUps
      : activeTab === 'UPCOMING'
      ? upcomingFollowUps
      : completedFollowUps;

  const handleMarkComplete = (id: string) => {
    if (!profile) return;
    db.completeFollowUp(id, profile);
    loadData();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Organization Follow-Up Queue</h1>
          <p className="text-xs text-slate-400 mt-1">
            Monitor scheduled callbacks, intake consultations, and prevent lead pipeline leakage.
          </p>
        </div>
      </div>

      {/* TABS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setActiveTab('TODAY')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeTab === 'TODAY'
              ? 'bg-slate-900 border-emerald-500 shadow-md'
              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold text-white">Today's Queue</span>
            <Clock className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400">{todayFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('OVERDUE')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeTab === 'OVERDUE'
              ? 'bg-slate-900 border-rose-500 shadow-md'
              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold text-rose-400">Overdue</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-rose-400">{overdueFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('UPCOMING')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeTab === 'UPCOMING'
              ? 'bg-slate-900 border-blue-500 shadow-md'
              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold text-white">Upcoming</span>
            <Calendar className="w-4 h-4 text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-blue-400">{upcomingFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('COMPLETED')}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeTab === 'COMPLETED'
              ? 'bg-slate-900 border-slate-500 shadow-md'
              : 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold text-white">Completed</span>
            <CheckCircle className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-bold text-slate-300">{completedFollowUps.length}</div>
        </button>
      </div>

      {/* FOLLOW-UPS LIST */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="divide-y divide-slate-800/60">
          {currentList.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No follow-ups in this category.
            </div>
          ) : (
            currentList.map((fup) => (
              <div
                key={fup.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-emerald-400">
                      {fup.lead_code || 'LV-Lead'}
                    </span>
                    <span className="text-sm font-semibold text-white">{fup.lead_name || 'Customer'}</span>
                    <PriorityBadge priority={fup.priority} />
                  </div>

                  <p className="text-xs text-slate-300 bg-slate-950/40 px-3 py-1.5 rounded border border-slate-800/80">
                    {fup.notes || 'Scheduled customer follow-up'}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-0.5">
                    <span className="flex items-center gap-1 font-mono text-slate-400">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {formatDateTime(fup.scheduled_at)}
                    </span>
                    <span>Assigned Agent: {fup.assigned_to}</span>
                  </div>
                </div>

                {fup.status === 'PENDING' && (
                  <button
                    onClick={() => handleMarkComplete(fup.id)}
                    className="self-start sm:self-center px-3 py-1.5 bg-emerald-950 border border-emerald-500/40 hover:bg-emerald-600 hover:text-white text-emerald-400 text-xs font-medium rounded-lg transition-all"
                  >
                    Mark Complete
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

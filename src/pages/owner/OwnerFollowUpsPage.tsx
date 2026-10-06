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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#DCE4EE] pb-5">
        <div>
          <h1 className="text-xl font-bold text-[#0B1F3A] tracking-tight">Organization Follow-Up Queue</h1>
          <p className="text-xs text-[#64748B] mt-1">
            Monitor scheduled callbacks, intake consultations, and prevent lead pipeline leakage.
          </p>
        </div>
      </div>

      {/* TABS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <button
          onClick={() => setActiveTab('TODAY')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'TODAY'
              ? 'bg-white border-[#0B1F3A] ring-1 ring-[#0B1F3A] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Today's Queue</span>
            <Clock className="w-4 h-4 text-[#16845B]" />
          </div>
          <div className="text-2xl font-bold text-[#16845B]">{todayFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('OVERDUE')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'OVERDUE'
              ? 'bg-white border-[#C53030] ring-1 ring-[#C53030] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#C53030]">Overdue</span>
            <AlertTriangle className="w-4 h-4 text-[#C53030]" />
          </div>
          <div className="text-2xl font-bold text-[#C53030]">{overdueFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('UPCOMING')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'UPCOMING'
              ? 'bg-white border-[#1E4D8F] ring-1 ring-[#1E4D8F] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Upcoming</span>
            <Calendar className="w-4 h-4 text-[#1E4D8F]" />
          </div>
          <div className="text-2xl font-bold text-[#1E4D8F]">{upcomingFollowUps.length}</div>
        </button>

        <button
          onClick={() => setActiveTab('COMPLETED')}
          className={`p-4 rounded-[12px] border text-left transition-all ${
            activeTab === 'COMPLETED'
              ? 'bg-white border-[#64748B] ring-1 ring-[#64748B] shadow-sm'
              : 'bg-white border-[#DCE4EE] hover:border-[#CBD5E1] shadow-sm'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-[#64748B] mb-1">
            <span className="font-semibold text-[#172B4D]">Completed</span>
            <CheckCircle className="w-4 h-4 text-[#64748B]" />
          </div>
          <div className="text-2xl font-bold text-[#64748B]">{completedFollowUps.length}</div>
        </button>
      </div>

      {/* FOLLOW-UPS LIST */}
      <div className="rounded-[12px] border border-[#DCE4EE] bg-white overflow-hidden shadow-sm">
        <div className="divide-y divide-[#DCE4EE]">
          {currentList.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#64748B]">
              No follow-ups in this category.
            </div>
          ) : (
            currentList.map((fup) => (
              <div
                key={fup.id}
                className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[#F6F8FB]/60 transition-colors"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-[#1E4D8F]">
                      {fup.lead_code || 'ENC-Lead'}
                    </span>
                    <span className="text-sm font-semibold text-[#172B4D]">{fup.lead_name || 'Customer'}</span>
                    <PriorityBadge priority={fup.priority} />
                  </div>

                  <p className="text-xs text-[#172B4D] bg-[#F6F8FB] px-3 py-1.5 rounded-[8px] border border-[#DCE4EE]">
                    {fup.notes || 'Scheduled customer follow-up'}
                  </p>

                  <div className="flex items-center gap-4 text-[11px] text-[#64748B] pt-0.5">
                    <span className="flex items-center gap-1 font-mono text-[#64748B]">
                      <Clock className="w-3 h-3 text-[#64748B]" />
                      {formatDateTime(fup.scheduled_at)}
                    </span>
                    <span>Assigned Agent: {fup.assigned_to}</span>
                  </div>
                </div>

                {fup.status === 'PENDING' && (
                  <button
                    onClick={() => handleMarkComplete(fup.id)}
                    className="self-start sm:self-center px-3 py-1.5 bg-white border border-[#DCE4EE] hover:bg-[#F6F8FB] text-[#172B4D] text-xs font-medium rounded-[8px] transition-all shadow-sm"
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

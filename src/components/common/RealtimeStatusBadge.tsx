import React, { useState, useEffect } from 'react';
import { realtimeManager, RealtimeConnectionStatus } from '@/services/realtime/realtimeManager';
import { Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';

export const RealtimeStatusBadge: React.FC = () => {
  const [status, setStatus] = useState<RealtimeConnectionStatus>(realtimeManager.getStatus());

  useEffect(() => {
    const unsub = realtimeManager.onStatusChange((newStatus) => {
      setStatus(newStatus);
    });
    return () => unsub();
  }, []);

  const getBadgeConfig = () => {
    switch (status) {
      case 'LIVE':
      case 'CONNECTED':
        return {
          bg: 'bg-[#EAF2FB]',
          border: 'border-[#C7DCF3]',
          text: 'text-[#1E4D8F]',
          dot: 'bg-[#1E4D8F]',
          label: 'CONNECTED',
          title: 'Connected to CRM Realtime Stream',
          icon: <Wifi className="w-3 h-3 text-[#1E4D8F]" />,
        };
      case 'RECONNECTING':
        return {
          bg: 'bg-[#FEF6E7]',
          border: 'border-[#F9E2B6]',
          text: 'text-[#B4690E]',
          dot: 'bg-[#B4690E]',
          label: 'RECONNECTING',
          title: 'Reconnecting to real-time service...',
          icon: <RefreshCw className="w-3 h-3 text-[#B4690E] animate-spin" />,
        };
      case 'OFFLINE':
      default:
        return {
          bg: 'bg-[#FEECEB]',
          border: 'border-[#F8C8C6]',
          text: 'text-[#C53030]',
          dot: 'bg-[#C53030]',
          label: 'OFFLINE',
          title: 'Real-time connection offline. Click to reconnect.',
          icon: <WifiOff className="w-3 h-3 text-[#C53030]" />,
        };
    }
  };

  const config = getBadgeConfig();

  return (
    <button
      type="button"
      onClick={() => {
        if (status === 'OFFLINE' || status === 'RECONNECTING') {
          realtimeManager.reconnect();
        }
      }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${config.bg} ${config.border} ${config.text} ${
        status === 'OFFLINE' ? 'cursor-pointer hover:opacity-80' : 'cursor-default'
      }`}
      title={config.title}
    >
      {config.icon}
      <span className="tracking-wider">{config.label}</span>
    </button>
  );
};

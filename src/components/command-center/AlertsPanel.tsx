'use client';
import { CommandCenterAlert } from '@/lib/types';
import { Bell, AlertTriangle, Info, AlertOctagon } from 'lucide-react';

interface Props {
    alerts: CommandCenterAlert[];
}

const SEVERITY_CONFIG = {
    critical: { icon: AlertOctagon, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', dot: 'bg-red-400' },
    warning: { icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', dot: 'bg-amber-400' },
    info: { icon: Info, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/20', dot: 'bg-sky-400' },
};

export default function AlertsPanel({ alerts }: Props) {
    if (!alerts.length) {
        return (
            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2 mb-3">
                    <Bell size={16} className="text-indigo-400" />
                    Alerts
                </h3>
                <p className="text-xs text-slate-500">No active alerts — all systems nominal.</p>
            </div>
        );
    }

    const criticalCount = alerts.filter(a => a.severity === 'critical').length;
    const warningCount = alerts.filter(a => a.severity === 'warning').length;

    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Bell size={16} className="text-indigo-400" />
                    Alerts
                    <span className="ml-1 px-2 py-0.5 text-[10px] font-semibold bg-red-500/15 text-red-400 rounded-full">
                        {alerts.length}
                    </span>
                </h3>
                <div className="flex gap-2">
                    {criticalCount > 0 && (
                        <span className="text-[10px] font-medium text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">
                            {criticalCount} critical
                        </span>
                    )}
                    {warningCount > 0 && (
                        <span className="text-[10px] font-medium text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                            {warningCount} warning
                        </span>
                    )}
                </div>
            </div>

            <div className="space-y-2 max-h-[350px] overflow-y-auto">
                {alerts.map((alert) => {
                    const cfg = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
                    const Icon = cfg.icon;
                    const timeAgo = getTimeAgo(alert.created_at);

                    return (
                        <div key={alert.id} className={`flex items-start gap-3 p-3 rounded-xl border ${cfg.bg}`}>
                            <Icon size={14} className={`${cfg.color} mt-0.5 shrink-0`} />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <p className="text-xs font-semibold text-white">{alert.title}</p>
                                    <span className="text-[10px] text-slate-500">{timeAgo}</span>
                                </div>
                                <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">{alert.message}</p>
                            </div>
                            <div className={`w-1.5 h-1.5 rounded-full ${cfg.dot} mt-1.5 shrink-0 animate-pulse`} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function getTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

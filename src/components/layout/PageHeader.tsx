import { RefreshCw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
    title: string;
    subtitle?: string;
    icon?: LucideIcon;
    iconColor?: string;
    badge?: React.ReactNode;
    loading?: boolean;
    onRefresh?: () => void;
    actions?: React.ReactNode;
}

export default function PageHeader({
    title, subtitle, icon: Icon, iconColor = 'text-indigo-400',
    badge, loading, onRefresh, actions,
}: PageHeaderProps) {
    return (
        <div className="flex items-center justify-between">
            <div>
                <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
                    {Icon && <Icon size={24} className={iconColor} />}
                    {title}
                    {badge}
                </h1>
                {subtitle && <p className="text-sm text-slate-500 mt-1">{subtitle}</p>}
            </div>
            <div className="flex items-center gap-3">
                {actions}
                {onRefresh && (
                    <button
                        onClick={onRefresh}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                )}
            </div>
        </div>
    );
}

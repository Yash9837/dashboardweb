'use client';
import { CommandCenterKPI, RevenueState } from '@/lib/types';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Props {
    kpis: CommandCenterKPI[];
    state: RevenueState;
}

function formatValue(kpi: CommandCenterKPI, state: RevenueState): string {
    const raw = state === 'live' ? kpi.live_value : kpi.locked_value;
    if (kpi.format === 'currency') {
        const formatted = raw >= 100000
            ? `${(raw / 100000).toFixed(1)}L`
            : raw >= 1000
                ? `${(raw / 1000).toFixed(1)}K`
                : raw.toFixed(0);
        return `${kpi.prefix || ''}${formatted}`;
    }
    if (kpi.format === 'percent') {
        return `${raw.toFixed(1)}${kpi.suffix || '%'}`;
    }
    return raw >= 1000 ? `${(raw / 1000).toFixed(1)}K` : raw.toFixed(0);
}

export default function RevenueStateCards({ kpis, state }: Props) {
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {kpis.map((kpi, i) => {
                const change = state === 'live' ? kpi.live_change : kpi.locked_change;
                const isActiveSkus = kpi.label === 'Active SKUs';
                const isUp = change > 0;
                const isDown = change < 0;
                const isNeutral = change === 0;
                const invertedMetrics = ['Return Rate', 'Blended TACOS'];
                const isInverted = invertedMetrics.includes(kpi.label);
                const changeColor = isActiveSkus
                    ? (change > 0 ? 'text-amber-400' : 'text-emerald-400')
                    : isNeutral
                        ? 'text-slate-500'
                        : (isUp && !isInverted) || (isDown && isInverted)
                            ? 'text-emerald-400'
                            : 'text-red-400';

                // Color accents for different KPI types
                const accents = [
                    'from-indigo-500/20 to-indigo-600/5',
                    'from-emerald-500/20 to-emerald-600/5',
                    'from-cyan-500/20 to-cyan-600/5',
                    'from-violet-500/20 to-violet-600/5',
                    'from-amber-500/20 to-amber-600/5',
                    'from-rose-500/20 to-rose-600/5',
                    'from-sky-500/20 to-sky-600/5',
                    'from-orange-500/20 to-orange-600/5',
                ];
                const dotColors = [
                    'bg-indigo-400', 'bg-emerald-400', 'bg-cyan-400', 'bg-violet-400',
                    'bg-amber-400', 'bg-rose-400', 'bg-sky-400', 'bg-orange-400',
                ];

                return (
                    <div
                        key={i}
                        className={`
              relative overflow-hidden rounded-2xl p-5
              bg-gradient-to-br ${accents[i % accents.length]}
              border border-white/[0.06] backdrop-blur-sm
              hover:border-white/[0.12] transition-all duration-300
              group
            `}
                    >
                        {/* Subtle glow dot */}
                        <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${dotColors[i % dotColors.length]} opacity-60`} />

                        <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
                            {kpi.label}
                        </p>
                        <p className="text-2xl font-bold text-white tracking-tight mb-2">
                            {formatValue(kpi, state)}
                        </p>
                        <div className={`flex items-center gap-1 text-xs font-medium ${changeColor}`}>
                            {isActiveSkus ? (
                                <span>{change > 0 ? `${change} at risk` : 'No at-risk SKUs'}</span>
                            ) : (
                                <>
                                    {isUp ? <TrendingUp size={12} /> : isDown ? <TrendingDown size={12} /> : <Minus size={12} />}
                                    <span>{isUp ? '+' : ''}{change}{kpi.format === 'percent' ? 'pp' : '%'} vs prev period</span>
                                </>
                            )}
                        </div>

                        {/* State indicator */}
                        <div className="absolute bottom-3 right-3">
                            <span className={`text-[10px] font-semibold uppercase tracking-widest ${state === 'live' ? 'text-emerald-500/50' : 'text-indigo-500/50'
                                }`}>
                                {state}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

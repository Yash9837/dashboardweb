'use client';

import { useMemo } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts';
import type { WaterfallStep } from '@/lib/revenue-types';

interface Props {
    data: WaterfallStep[];
}

function formatCurrency(n: number): string {
    if (n === 0) return '₹0';
    const abs = Math.abs(n);
    const formatted = abs >= 100000
        ? `₹${(abs / 100000).toFixed(2)}L`
        : abs >= 1000
            ? `₹${(abs / 1000).toFixed(1)}K`
            : `₹${abs.toFixed(0)}`;
    return n < 0 ? `-${formatted}` : formatted;
}

export default function RevenueWaterfallChart({ data }: Props) {
    const chartData = useMemo(() => {
        return data.map(step => {
            const isNet = step.type === 'net';
            return {
                name: step.name,
                // For the waterfall effect: invisible base + visible bar
                invisible: isNet ? 0 : Math.min(step.start ?? 0, step.end ?? 0),
                bar: isNet ? step.value : Math.abs((step.end ?? 0) - (step.start ?? 0)),
                value: step.value,
                type: step.type,
                isNegative: step.value < 0,
            };
        });
    }, [data]);

    if (!data.length) return null;

    const colorMap: Record<string, string> = {
        revenue: '#22c55e',
        deduction: '#ef4444',
        tax: '#f59e0b',
        refund: '#f97316',
        net: '#6366f1',
    };

    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-1">Revenue Waterfall</h3>
            <p className="text-[11px] text-slate-500 mb-4">How your gross revenue becomes net settlement</p>
            <div className="h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 20, right: 20, bottom: 60, left: 20 }}>
                        <XAxis
                            dataKey="name"
                            tick={{ fill: '#94a3b8', fontSize: 10 }}
                            angle={-35}
                            textAnchor="end"
                            height={80}
                            axisLine={{ stroke: '#1e293b' }}
                            tickLine={false}
                        />
                        <YAxis
                            tick={{ fill: '#64748b', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v: number) => formatCurrency(v)}
                        />
                        <Tooltip
                            content={({ payload }) => {
                                if (!payload?.length) return null;
                                const d = payload[0]?.payload;
                                if (!d) return null;
                                return (
                                    <div className="bg-[#1e293b] border border-white/10 rounded-lg p-3 shadow-xl">
                                        <p className="text-xs font-medium text-white mb-1">{d.name}</p>
                                        <p className={`text-sm font-bold ${d.value >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {formatCurrency(d.value)}
                                        </p>
                                    </div>
                                );
                            }}
                        />
                        <ReferenceLine y={0} stroke="#334155" strokeDasharray="3 3" />
                        {/* Invisible base for waterfall effect */}
                        <Bar dataKey="invisible" stackId="a" fill="transparent" />
                        {/* Visible bar */}
                        <Bar dataKey="bar" stackId="a" radius={[3, 3, 0, 0]}>
                            {chartData.map((entry, idx) => (
                                <Cell
                                    key={idx}
                                    fill={colorMap[entry.type] || '#6366f1'}
                                    fillOpacity={entry.type === 'net' ? 1 : 0.8}
                                />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-2">
                {[
                    { label: 'Revenue', color: '#22c55e' },
                    { label: 'Fees', color: '#ef4444' },
                    { label: 'Taxes', color: '#f59e0b' },
                    { label: 'Refunds', color: '#f97316' },
                    { label: 'Net Settlement', color: '#6366f1' },
                ].map(l => (
                    <div key={l.label} className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
                        <span className="text-[10px] text-slate-500">{l.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

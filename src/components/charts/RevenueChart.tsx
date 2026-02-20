'use client';
import { useState } from 'react';
import {
    ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend
} from 'recharts';

interface RevenueDataPoint {
    date: string;
    amazon: number;
    shopify: number;
    walmart: number;
    total: number;
    orders: number;
    profit: number;
}

const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-[#1a2035] border border-white/10 rounded-xl p-3 shadow-2xl min-w-[160px]">
            <p className="text-xs text-slate-400 mb-2 font-medium">{label}</p>
            {payload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center justify-between gap-4 text-sm py-0.5">
                    <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="text-slate-300">{entry.name}</span>
                    </div>
                    <span className="text-white font-semibold">
                        {entry.name === 'Orders'
                            ? entry.value
                            : `₹${(entry.value / 1000).toFixed(1)}K`}
                    </span>
                </div>
            ))}
        </div>
    );
};

type ViewMode = 'revenue' | 'profit' | 'orders';

export default function RevenueChart({
    data,
    granularity = 'daily',
}: {
    data: RevenueDataPoint[];
    granularity?: 'daily' | 'weekly' | 'monthly';
}) {
    const [view, setView] = useState<ViewMode>('revenue');

    const granularityLabel = granularity === 'daily' ? 'Daily' : granularity === 'weekly' ? 'Weekly' : 'Monthly';

    if (!data || data.length === 0) {
        return (
            <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
                <h3 className="text-white font-semibold text-lg">Revenue Trend</h3>
                <p className="text-sm text-slate-500 mt-0.5 mb-8">{granularityLabel} revenue over time</p>
                <div className="flex items-center justify-center h-[280px] text-slate-500 text-sm">
                    No revenue data available yet
                </div>
            </div>
        );
    }

    const views: { key: ViewMode; label: string }[] = [
        { key: 'revenue', label: 'Revenue' },
        { key: 'profit', label: 'Profit' },
        { key: 'orders', label: 'Orders' },
    ];

    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h3 className="text-white font-semibold text-lg">
                        {view === 'revenue' ? 'Revenue Trend' : view === 'profit' ? 'Profit Trend' : 'Order Volume'}
                    </h3>
                    <p className="text-sm text-slate-500 mt-0.5">{granularityLabel} breakdown</p>
                </div>
                <div className="flex items-center gap-1 bg-white/5 rounded-xl p-1">
                    {views.map(v => (
                        <button
                            key={v.key}
                            onClick={() => setView(v.key)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${view === v.key ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white'
                                }`}
                        >
                            {v.label}
                        </button>
                    ))}
                </div>
            </div>

            <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                    <defs>
                        <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis
                        yAxisId="left"
                        tick={{ fill: '#64748b', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => view === 'orders' ? v : `₹${v / 1000}K`}
                    />
                    {view === 'revenue' && (
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            tick={{ fill: '#64748b', fontSize: 10 }}
                            axisLine={false}
                            tickLine={false}
                        />
                    )}
                    <Tooltip content={<CustomTooltip />} />

                    {view === 'revenue' && (
                        <>
                            <Area
                                yAxisId="left"
                                type="monotone"
                                dataKey="total"
                                name="Revenue"
                                stroke="#6366f1"
                                fill="url(#revenueGrad)"
                                strokeWidth={2.5}
                            />
                            <Bar
                                yAxisId="right"
                                dataKey="orders"
                                name="Orders"
                                fill="#6366f1"
                                fillOpacity={0.15}
                                radius={[4, 4, 0, 0]}
                                barSize={20}
                            />
                        </>
                    )}

                    {view === 'profit' && (
                        <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="profit"
                            name="Gross Profit"
                            stroke="#22c55e"
                            fill="url(#profitGrad)"
                            strokeWidth={2.5}
                        />
                    )}

                    {view === 'orders' && (
                        <Bar
                            yAxisId="left"
                            dataKey="orders"
                            name="Orders"
                            fill="#6366f1"
                            fillOpacity={0.6}
                            radius={[6, 6, 0, 0]}
                            barSize={28}
                        />
                    )}
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
}

'use client';
import { WaterfallItem } from '@/lib/types';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts';

interface Props {
    data: WaterfallItem[];
}

const COLORS = {
    revenue: '#22c55e',
    deduction: '#ef4444',
    net: '#6366f1',
};

export default function ProfitWaterfallChart({ data }: Props) {
    // Build waterfall bars with invisible base + visible segment
    let cumulative = 0;
    const chartData = data.map((item) => {
        const start = item.type === 'revenue' ? 0 : item.type === 'net' ? 0 : cumulative;
        const end = item.type === 'net' ? item.value : start + item.value;

        if (item.type === 'revenue') {
            cumulative = item.value;
        } else if (item.type === 'deduction') {
            cumulative += item.value; // value is negative
        }

        return {
            name: item.name,
            type: item.type,
            invisible: item.type === 'deduction' ? Math.max(0, cumulative) : 0,
            visible: item.type === 'deduction' ? Math.abs(item.value) : item.value,
            value: item.value,
        };
    });

    const formatVal = (v: number) => {
        if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
        if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(0)}K`;
        return `₹${v.toFixed(0)}`;
    };

    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-white mb-1">Profit Waterfall</h3>
            <p className="text-xs text-slate-500 mb-4">Gross Revenue → Net Contribution breakdown</p>

            <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} barCategoryGap="20%">
                        <XAxis
                            dataKey="name"
                            tick={{ fontSize: 10, fill: '#94a3b8' }}
                            axisLine={false}
                            tickLine={false}
                            interval={0}
                            angle={-20}
                            textAnchor="end"
                            height={60}
                        />
                        <YAxis
                            tick={{ fontSize: 10, fill: '#64748b' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={formatVal}
                        />
                        <Tooltip
                            contentStyle={{
                                background: '#1e293b',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '12px',
                                color: '#e2e8f0',
                                fontSize: '12px',
                            }}
                            formatter={(value: any, name: any) => {
                                if (name === 'invisible') return [null, null];
                                return [formatVal(Number(value || 0)), 'Amount'];
                            }}
                        />
                        <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
                        {/* Invisible base bar for waterfall effect */}
                        <Bar dataKey="invisible" stackId="stack" fill="transparent" />
                        {/* Visible bar */}
                        <Bar dataKey="visible" stackId="stack" radius={[4, 4, 0, 0]}>
                            {chartData.map((entry, i) => (
                                <Cell key={i} fill={COLORS[entry.type as keyof typeof COLORS]} fillOpacity={0.85} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}

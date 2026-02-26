'use client';
import { BreakdownItem, FinancialSummary } from '@/lib/types';

interface Props {
    summary: FinancialSummary;
    netContributionBreakdown: BreakdownItem[];
    totalProfitBreakdown: BreakdownItem[];
}

function formatCurrency(value: number): string {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    if (abs >= 100000) return `${sign}₹${(abs / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(1)}K`;
    return `${sign}₹${abs.toFixed(0)}`;
}

function BreakdownBlock({ title, subtitle, items }: { title: string; subtitle: string; items: BreakdownItem[] }) {
    return (
        <div className="bg-[#0f172a]/70 border border-white/[0.06] rounded-xl p-4">
            <h4 className="text-sm font-semibold text-white">{title}</h4>
            <p className="text-xs text-slate-500 mt-0.5 mb-3">{subtitle}</p>
            <div className="space-y-2">
                {items.map((item) => {
                    const color = item.kind === 'positive'
                        ? 'text-emerald-400'
                        : item.kind === 'negative'
                            ? 'text-red-400'
                            : 'text-indigo-300';
                    const rowClass = item.kind === 'total'
                        ? 'font-semibold border-t border-white/10 pt-2 mt-2'
                        : '';

                    return (
                        <div key={item.label} className={`flex items-center justify-between text-xs ${rowClass}`}>
                            <span className="text-slate-300">{item.label}</span>
                            <span className={`${color} tabular-nums`}>{formatCurrency(item.value)}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default function FinancialBreakdownPanel({ summary, netContributionBreakdown, totalProfitBreakdown }: Props) {
    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-white mb-1">Financial Breakdown</h3>
            <p className="text-xs text-slate-500 mb-4">Net Contribution and Total Profit components</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider">Total Fees</p>
                    <p className="text-lg font-semibold text-red-400 mt-1">{formatCurrency(-summary.total_fees)}</p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3">
                    <p className="text-[11px] text-slate-500 uppercase tracking-wider">Total Profit</p>
                    <p className={`text-lg font-semibold mt-1 ${summary.total_profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatCurrency(summary.total_profit)}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <BreakdownBlock
                    title="Net Contribution Breakdown"
                    subtitle="Gross revenue minus fees, costs, refunds and ad spend"
                    items={netContributionBreakdown}
                />
                <BreakdownBlock
                    title="Total Profit Breakdown"
                    subtitle="Net contribution adjusted by internal expenses"
                    items={totalProfitBreakdown}
                />
            </div>
        </div>
    );
}

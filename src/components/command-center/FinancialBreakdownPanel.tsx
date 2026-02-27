'use client';
import { BreakdownItem, FinancialSummary } from '@/lib/types';
import Link from 'next/link';

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
            <p className="text-xs font-semibold text-white mb-0.5">{title}</p>
            <p className="text-[10px] text-slate-500 mb-3">{subtitle}</p>
            <div className="space-y-2">
                {items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between">
                        <span className="text-xs text-slate-400">{item.label}</span>
                        <span className={`text-xs font-medium ${item.value > 0 ? 'text-emerald-400'
                                : item.value < 0 ? 'text-red-400'
                                    : 'text-white font-semibold'
                            }`}>
                            {formatCurrency(item.value)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function FinancialBreakdownPanel({ summary, netContributionBreakdown, totalProfitBreakdown }: Props) {
    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm font-semibold text-white">Financial Breakdown</h3>
                <Link href="/command-center/financials"
                    className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
                    View Details →
                </Link>
            </div>
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

            <div className="space-y-3">
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

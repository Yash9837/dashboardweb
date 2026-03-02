'use client';

import { useState } from 'react';
import { ArrowUpDown, ChevronDown, ChevronUp, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import type { SKURevenueSummary } from '@/lib/revenue-types';

interface Props {
    data: SKURevenueSummary[];
}

function formatExact(n: number): string {
    if (n === 0) return '₹0.00';
    const prefix = n < 0 ? '-' : '';
    return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

type SortField = 'net_settlement' | 'gross_revenue' | 'total_fees' | 'refund_amount' | 'total_orders' | 'margin_percent' | 'return_rate' | 'ad_spend';

export default function SKUPerformancePanel({ data }: Props) {
    const [sortBy, setSortBy] = useState<SortField>('net_settlement');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [expandedSku, setExpandedSku] = useState<string | null>(null);

    const sorted = [...data].sort((a, b) => {
        const aVal = a[sortBy];
        const bVal = b[sortBy];
        return sortDir === 'desc' ? (bVal as number) - (aVal as number) : (aVal as number) - (bVal as number);
    });

    const handleSort = (field: SortField) => {
        if (sortBy === field) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir('desc');
        }
    };

    const SortHeader = ({ field, label, className = '' }: { field: SortField; label: string; className?: string }) => (
        <div
            className={`flex items-center gap-1 cursor-pointer hover:text-white transition-colors ${className}`}
            onClick={() => handleSort(field)}
        >
            {label}
            <ArrowUpDown size={9} className={sortBy === field ? 'text-indigo-400' : ''} />
        </div>
    );

    if (!data.length) {
        return (
            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-8 text-center">
                <p className="text-sm text-slate-500">No SKU data available</p>
            </div>
        );
    }

    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/5">
                <h3 className="text-sm font-semibold text-white">SKU Revenue Performance</h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                    Per-SKU revenue breakdown with margin analysis · {data.length} SKUs
                </p>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-12 gap-2 px-4 py-2.5 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                <div className="col-span-3">SKU / Product</div>
                <SortHeader field="total_orders" label="Orders" className="col-span-1 text-center" />
                <SortHeader field="gross_revenue" label="Gross Rev" className="col-span-1 text-right" />
                <SortHeader field="total_fees" label="Total Fees" className="col-span-1 text-right" />
                <SortHeader field="refund_amount" label="Refunds" className="col-span-1 text-right" />
                <SortHeader field="ad_spend" label="Ad Spend" className="col-span-1 text-right" />
                <SortHeader field="net_settlement" label="Net Rev" className="col-span-1 text-right" />
                <SortHeader field="margin_percent" label="Margin" className="col-span-1 text-right" />
                <SortHeader field="return_rate" label="Return %" className="col-span-1 text-right" />
                <div className="col-span-1 text-center">Health</div>
            </div>

            {/* Table Body */}
            <div className="max-h-[500px] overflow-y-auto">
                {sorted.map(s => {
                    const isExpanded = expandedSku === s.sku;
                    const marginHealth = s.margin_percent >= 20 ? 'good' : s.margin_percent >= 10 ? 'warn' : 'bad';
                    const returnHealth = s.return_rate <= 5 ? 'good' : s.return_rate <= 15 ? 'warn' : 'bad';
                    const overallHealth = marginHealth === 'bad' || returnHealth === 'bad' ? 'bad'
                        : marginHealth === 'warn' || returnHealth === 'warn' ? 'warn' : 'good';

                    return (
                        <div key={s.sku}>
                            <div
                                className="grid grid-cols-12 gap-2 px-4 py-3 items-center hover:bg-white/[0.02] cursor-pointer border-b border-white/[0.03] transition-colors"
                                onClick={() => setExpandedSku(isExpanded ? null : s.sku)}
                            >
                                <div className="col-span-3 flex items-center gap-2 min-w-0">
                                    {isExpanded
                                        ? <ChevronUp size={12} className="text-slate-500 shrink-0" />
                                        : <ChevronDown size={12} className="text-slate-500 shrink-0" />
                                    }
                                    <div className="min-w-0">
                                        <p className="text-xs font-mono text-slate-300 truncate">{s.sku}</p>
                                        <p className="text-[10px] text-slate-600 truncate">{s.product_name}</p>
                                    </div>
                                </div>
                                <div className="col-span-1 text-center text-xs text-slate-300">
                                    {s.total_orders}
                                    <span className="text-[9px] text-slate-600 ml-0.5">({s.total_units}u)</span>
                                </div>
                                <div className="col-span-1 text-right text-xs font-medium text-emerald-400">
                                    {formatCurrency(s.gross_revenue)}
                                </div>
                                <div className="col-span-1 text-right text-xs font-medium text-red-400">
                                    {formatCurrency(s.total_fees)}
                                </div>
                                <div className="col-span-1 text-right text-xs text-amber-400">
                                    {s.refund_amount > 0 ? formatCurrency(s.refund_amount) : '—'}
                                </div>
                                <div className="col-span-1 text-right text-xs text-orange-400">
                                    {s.ad_spend > 0 ? formatCurrency(s.ad_spend) : '—'}
                                </div>
                                <div className={`col-span-1 text-right text-xs font-bold ${s.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {formatCurrency(s.net_settlement)}
                                </div>
                                <div className={`col-span-1 text-right text-xs font-medium ${marginHealth === 'good' ? 'text-emerald-400' : marginHealth === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>
                                    {s.margin_percent.toFixed(1)}%
                                </div>
                                <div className={`col-span-1 text-right text-xs ${returnHealth === 'good' ? 'text-slate-400' : returnHealth === 'warn' ? 'text-amber-400' : 'text-red-400'}`}>
                                    {s.return_rate.toFixed(1)}%
                                    {s.rto_count > 0 && <span className="text-[9px] text-red-500 ml-0.5">({s.rto_count} RTO)</span>}
                                </div>
                                <div className="col-span-1 flex items-center justify-center">
                                    {overallHealth === 'good' && <TrendingUp size={14} className="text-emerald-400" />}
                                    {overallHealth === 'warn' && <AlertTriangle size={14} className="text-amber-400" />}
                                    {overallHealth === 'bad' && <TrendingDown size={14} className="text-red-400" />}
                                </div>
                            </div>

                            {/* Expanded Detail */}
                            {isExpanded && (
                                <div className="bg-[#0d1117] border-l-2 border-indigo-500/30 px-6 py-4">
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        {/* Revenue Breakdown */}
                                        <div>
                                            <h4 className="text-[10px] font-semibold text-emerald-400 uppercase tracking-wider mb-2">Revenue</h4>
                                            <div className="space-y-1">
                                                <Row label="Product Sales" value={formatExact(s.product_sales)} color="text-emerald-400" />
                                                <Row label="Shipping Credits" value={formatExact(s.shipping_credits)} />
                                                <Row label="Gift Wrap" value={formatExact(s.gift_wrap_credits)} />
                                                {s.promotional_rebates !== 0 && (
                                                    <Row label="Promotions" value={formatExact(s.promotional_rebates)} color="text-amber-400" />
                                                )}
                                                <div className="border-t border-white/5 pt-1">
                                                    <Row label="Gross Revenue" value={formatExact(s.gross_revenue)} color="text-emerald-400" bold />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Fees Breakdown */}
                                        <div>
                                            <h4 className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-2">Fees</h4>
                                            <div className="space-y-1">
                                                <Row label="Referral Fee" value={formatExact(s.referral_fee)} color="text-red-400" />
                                                <Row label="FBA Fee" value={formatExact(s.fba_fee)} color="text-red-400" />
                                                <Row label="Closing Fee" value={formatExact(s.closing_fee)} color="text-red-400" />
                                                {s.easy_ship_fee > 0 && <Row label="Easy Ship Fee" value={formatExact(s.easy_ship_fee)} color="text-red-400" />}
                                                {s.other_fees > 0 && <Row label="Other Fees" value={formatExact(s.other_fees)} color="text-red-400" />}
                                                <div className="border-t border-white/5 pt-1">
                                                    <Row label="Total Fees" value={formatExact(s.total_fees)} color="text-red-400" bold />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Returns */}
                                        <div>
                                            <h4 className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider mb-2">Returns & Taxes</h4>
                                            <div className="space-y-1">
                                                <Row label="Refund Amount" value={formatExact(s.refund_amount)} color="text-amber-400" />
                                                <Row label="Refund Orders" value={String(s.refund_count)} />
                                                <Row label="RTO Orders" value={String(s.rto_count)} />
                                                <Row label="Return Rate" value={`${s.return_rate.toFixed(1)}%`} />
                                                <div className="border-t border-white/5 pt-1">
                                                    <Row label="Total Taxes" value={formatExact(s.total_taxes)} color="text-orange-400" />
                                                </div>
                                            </div>
                                        </div>

                                        {/* Net Settlement */}
                                        <div>
                                            <h4 className="text-[10px] font-semibold text-indigo-400 uppercase tracking-wider mb-2">Settlement</h4>
                                            <div className="space-y-1">
                                                <Row label="Ad Spend" value={formatExact(s.ad_spend)} color="text-orange-400" />
                                                <Row label="Avg/Order" value={formatExact(s.avg_revenue_per_order)} />
                                                <div className="border-t border-white/5 pt-1">
                                                    <Row label="Net Settlement" value={formatExact(s.net_settlement)} color={s.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'} bold />
                                                    <Row label="Margin" value={`${s.margin_percent.toFixed(1)}%`} color={s.margin_percent >= 20 ? 'text-emerald-400' : s.margin_percent >= 10 ? 'text-amber-400' : 'text-red-400'} bold />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Row({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">{label}</span>
            <span className={`text-[10px] tabular-nums ${bold ? 'font-semibold' : 'font-medium'} ${color || 'text-slate-400'}`}>
                {value}
            </span>
        </div>
    );
}

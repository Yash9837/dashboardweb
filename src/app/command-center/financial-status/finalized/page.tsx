'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import OrderDetailPanel from '@/components/revenue-calculator/OrderDetailPanel';
import type { OrderRevenueRecord } from '@/lib/revenue-types';
import {
    Lock, Shield, ArrowLeft, Search, ChevronDown, ChevronUp, ChevronLeft,
    ChevronRight, ArrowUpDown, RefreshCw, Download, IndianRupee, TrendingDown,
    RotateCcw, Package, Loader2, AlertTriangle, CheckCircle2, Calendar,
    ShoppingCart, Truck, ArrowLeftRight, Zap,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface ClosedSummary {
    total_orders: number;
    total_units: number;
    gross_revenue: number;
    total_product_sales: number;
    total_shipping_credits: number;
    total_promotional_rebates: number;
    total_amazon_fees: number;
    total_referral_fees: number;
    total_closing_fees: number;
    total_fba_fees: number;
    total_easy_ship_fees: number;
    total_weight_handling: number;
    total_technology_fees: number;
    total_other_charges: number;
    total_shipping_chargeback: number;
    total_storage_fees: number;
    total_adjustment_fees: number;
    total_other_fees: number;
    total_gst: number;
    total_tcs: number;
    total_tds: number;
    total_taxes: number;
    total_refund_impact: number;
    total_refund_amount: number;
    returned_orders: number;
    rto_orders: number;
    customer_returns: number;
    total_ad_spend: number;
    net_settlement: number;
}

interface LifecycleData {
    total_orders: number;
    OPEN: number;
    DELIVERED_PENDING_SETTLEMENT: number;
    FINANCIALLY_CLOSED: number;
    settled_count: number;
    closure_rate: number;
    settlement_rate: number;
    finalized_till_date: string | null;
    finalized_revenue: number;
    finalized_order_count: number;
}

interface FinalizedSummary extends ClosedSummary {}

interface FSResponse {
    success: boolean;
    records: OrderRevenueRecord[];
    summary: ClosedSummary;
    finalizedSummary: FinalizedSummary | null;
    lifecycle: LifecycleData;
    distribution: Record<string, number>;
    pagination: { page: number; pageSize: number; totalRecords: number; totalPages: number };
    dateRange: { start: string; end: string; filtered: boolean };
}

// ── Formatters ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
    if (n === 0) return '₹0';
    const abs = Math.abs(n);
    const formatted = abs >= 100000
        ? `₹${(abs / 100000).toFixed(2)}L`
        : abs >= 1000
            ? `₹${(abs / 1000).toFixed(1)}K`
            : `₹${abs.toFixed(0)}`;
    return n < 0 ? `-${formatted}` : formatted;
}

function fmtExact(n: number): string {
    if (n === 0) return '₹0.00';
    const prefix = n < 0 ? '-' : '';
    return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch { return dateStr; }
}

// ── Badges ───────────────────────────────────────────────────────────────────

function FinancialStatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; icon: any; style: string }> = {
        OPEN: { label: 'Open', icon: Lock, style: 'bg-slate-500/15 text-slate-400 border-slate-500/20' },
        DELIVERED_PENDING_SETTLEMENT: { label: 'Pending', icon: Lock, style: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
        FINANCIALLY_CLOSED: { label: 'Closed', icon: Lock, style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    };
    const c = config[status] || config.OPEN;
    const Icon = c.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${c.style}`}>
            <Icon size={10} />{c.label}
        </span>
    );
}

function StatusBadge({ status, returnType }: { status: string; returnType: string | null }) {
    if (returnType === 'RTO') return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-500/10 text-red-400 border border-red-500/20">RTO</span>;
    if (returnType === 'Customer Return') return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Return</span>;
    const map: Record<string, string> = {
        Delivered: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        Shipped: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        Cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
        Pending: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return <span className={`px-2 py-0.5 text-[10px] font-medium rounded-full border ${map[status] || map.Pending}`}>{status}</span>;
}

function TxnTypeBadge({ types }: { types: string[] }) {
    const colorMap: Record<string, string> = {
        Order: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        Refund: 'bg-red-500/10 text-red-400 border-red-500/20',
        ShippingServices: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        Adjustment: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        Chargeback: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
        Retrocharge: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
    };
    const iconMap: Record<string, any> = {
        Order: ShoppingCart, Refund: RotateCcw, ShippingServices: Truck,
        Adjustment: ArrowLeftRight, Chargeback: AlertTriangle, Retrocharge: Zap,
    };
    return (
        <div className="flex flex-wrap gap-0.5 justify-center">
            {types.slice(0, 2).map(t => {
                const Icon = iconMap[t] || Package;
                return (
                    <span key={t} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full border ${colorMap[t] || 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                        <Icon size={8} />{t.replace('Services', '')}
                    </span>
                );
            })}
            {types.length > 2 && <span className="text-[9px] text-slate-500">+{types.length - 2}</span>}
        </div>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function FinalizedFiguresPage() {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [search, setSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<string>('order_date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    const isAllTime = !startDate && !endDate;

    // Fetch with status=finalized — the API will filter to orders on/before finalizedTillDate
    const queryStr = useMemo(() => {
        const p = new URLSearchParams();
        if (startDate) p.set('startDate', startDate);
        if (endDate) p.set('endDate', endDate);
        p.set('status', 'finalized');
        if (search) p.set('search', search);
        p.set('page', String(currentPage));
        p.set('pageSize', '50');
        return p.toString();
    }, [startDate, endDate, search, currentPage]);

    const { data, loading, error, refresh } = useFetch<FSResponse>(
        `/api/command-center/financial-status-detail?${queryStr}`, [queryStr]
    );

    const records = data?.records || [];
    const summary = data?.summary;
    const lifecycle = data?.lifecycle;
    const pagination = data?.pagination;
    const finalizedSummary = data?.finalizedSummary;

    // Use finalizedSummary if available (more accurate), otherwise fall back to summary
    const displaySummary = finalizedSummary || summary;

    // Client-side sort
    const sortedRecords = useMemo(() => {
        const sorted = [...records];
        sorted.sort((a: any, b: any) => {
            let aVal: any, bVal: any;
            if (sortBy === 'net_settlement') { aVal = a.calculations?.net_settlement ?? 0; bVal = b.calculations?.net_settlement ?? 0; }
            else if (sortBy === 'gross_revenue') { aVal = a.calculations?.gross_revenue ?? 0; bVal = b.calculations?.gross_revenue ?? 0; }
            else if (sortBy === 'total_fees') { aVal = a.calculations?.total_fees ?? 0; bVal = b.calculations?.total_fees ?? 0; }
            else if (sortBy === 'refund_amount') { aVal = a.return_details?.total_refund_impact ?? 0; bVal = b.return_details?.total_refund_impact ?? 0; }
            else if (sortBy === 'total_taxes') { aVal = a.taxes?.total ?? 0; bVal = b.taxes?.total ?? 0; }
            else { aVal = a[sortBy]; bVal = b[sortBy]; }
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [records, sortBy, sortDir]);

    // Group sorted records by order_id
    const groupedRecords = useMemo(() => {
        const groups: { orderId: string; items: OrderRevenueRecord[] }[] = [];
        let currentGroup: { orderId: string; items: OrderRevenueRecord[] } | null = null;
        for (const r of sortedRecords) {
            if (!currentGroup || currentGroup.orderId !== r.order_id) {
                currentGroup = { orderId: r.order_id, items: [r] };
                groups.push(currentGroup);
            } else {
                currentGroup.items.push(r);
            }
        }
        return groups;
    }, [sortedRecords]);

    const handleSort = (field: string) => {
        if (sortBy === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        else { setSortBy(field); setSortDir('desc'); }
    };

    const handleExportCSV = () => {
        if (!records.length) return;
        const headers = [
            'Order ID', 'SKU', 'ASIN', 'Product Name', 'Qty',
            'Order Date', 'Delivery Date', 'Status', 'Financial Status',
            'Product Sales', 'Shipping Credits',
            'Referral Fee', 'Closing Fee', 'FBA Fee', 'Easy Ship Fee', 'Weight Handling', 'Total Amazon Fees',
            'Shipping Chargeback', 'Total Other Charges',
            'GST', 'TCS', 'TDS', 'Total Taxes',
            'Is Returned', 'Return Type', 'Refund Amount', 'Total Refund Impact',
            'Gross Revenue', 'Net Settlement',
            'Settlement Status', 'Return Deadline', 'Closed At',
            'Transaction Types',
        ];
        const rows = records.map(r => [
            r.order_id, r.sku, r.asin, `"${r.product_name}"`, r.quantity,
            fmtDate(r.order_date), fmtDate(r.delivery_date), r.order_status, r.financial_status,
            r.product_sales, r.shipping_credits,
            r.amazon_fees.referral_fee, r.amazon_fees.closing_fee, r.amazon_fees.fba_fee, r.amazon_fees.easy_ship_fee, r.amazon_fees.weight_handling_fee, r.amazon_fees.total,
            r.other_charges.shipping_chargeback, r.other_charges.total,
            r.taxes.gst, r.taxes.tcs, r.taxes.tds, r.taxes.total,
            r.return_details.is_returned ? 'Yes' : 'No', r.return_details.return_type || '', r.return_details.refund_amount, r.return_details.total_refund_impact,
            r.calculations.gross_revenue, r.calculations.net_settlement,
            r.settlement_status, fmtDate(r.return_deadline), fmtDate(r.financial_closed_at),
            r.transaction_types.join('; '),
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `finalized-orders-${startDate || 'all'}-to-${endDate || 'now'}-till-${lifecycle?.finalized_till_date || 'unknown'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const finalizedDate = lifecycle?.finalized_till_date;
    const finalizedDateFormatted = finalizedDate
        ? new Date(finalizedDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
        : '—';

    return (
        <DashboardLayout>
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <Link href="/command-center/financial-status"
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-white/5 border border-white/10 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-all">
                        <ArrowLeft size={14} />
                        Back
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                            <Lock size={22} className="text-emerald-400" />
                            Solid Figures
                            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                <Shield size={10} />
                                Finalized
                            </span>
                        </h1>
                        <p className="text-sm text-slate-500 mt-1">
                            All figures below are <span className="text-emerald-400 font-medium">final &amp; immutable</span> — every order on these dates is financially closed
                            {data?.dateRange && (
                                isAllTime
                                    ? ' · All Time'
                                    : ` · ${data.dateRange.start} → ${data.dateRange.end}`
                            )}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Date Range Filter */}
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => { setStartDate(''); setEndDate(''); setCurrentPage(1); }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all border ${isAllTime
                                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 shadow-sm'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white hover:bg-white/10'
                            }`}>
                            All Time
                        </button>
                        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-2.5 py-1">
                            <Calendar size={12} className="text-slate-500" />
                            <input type="date" value={startDate}
                                onChange={e => { setStartDate(e.target.value); setCurrentPage(1); }}
                                className="bg-transparent text-xs text-slate-300 outline-none w-[110px] [color-scheme:dark]" />
                            <span className="text-[10px] text-slate-600">to</span>
                            <input type="date" value={endDate}
                                onChange={e => { setEndDate(e.target.value); setCurrentPage(1); }}
                                className="bg-transparent text-xs text-slate-300 outline-none w-[110px] [color-scheme:dark]" />
                        </div>
                    </div>

                    <button onClick={() => refresh()} disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button onClick={handleExportCSV} disabled={!records.length}
                        className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-sm text-indigo-400 hover:bg-indigo-500/20 transition-all disabled:opacity-50">
                        <Download size={14} />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <AlertTriangle size={18} className="text-red-400 shrink-0" />
                    <p className="text-sm text-red-400">{error}</p>
                    <button onClick={() => refresh()} className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg bg-red-500/10">Retry</button>
                </div>
            )}

            {/* ── Hero Card: Finalized Date + Net Settlement ── */}
            {lifecycle && lifecycle.finalized_till_date && (
                <div className="bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border border-emerald-500/20 rounded-xl p-6">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-5">
                            <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center">
                                <Shield size={28} className="text-emerald-400" />
                            </div>
                            <div>
                                <p className="text-[10px] font-medium text-emerald-500 uppercase tracking-wider mb-1">Payments Finalized Till</p>
                                <p className="text-3xl font-bold text-emerald-400">{finalizedDateFormatted}</p>
                                <p className="text-xs text-slate-500 mt-1">
                                    <span className="text-emerald-400 font-semibold">{lifecycle.finalized_order_count}</span> orders &middot;
                                    All revenue on and before this date is <span className="text-emerald-400">solid &amp; final</span>
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Net Settlement</p>
                            <p className={`text-3xl font-bold ${(displaySummary?.net_settlement ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fmtExact(displaySummary?.net_settlement ?? 0)}
                            </p>
                            <p className="text-[10px] text-slate-500 mt-1">
                                Gross: {fmtExact(displaySummary?.gross_revenue ?? 0)} &middot; {displaySummary?.total_units ?? 0} units
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Quick Stats Bar ── */}
            {displaySummary && displaySummary.total_orders > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                        { label: 'Orders', value: displaySummary.total_orders.toLocaleString('en-IN'), sub: `${displaySummary.total_units} units`, color: 'text-white', icon: Package },
                        { label: 'Gross Revenue', value: fmt(displaySummary.gross_revenue), sub: 'Product Sales + Shipping', color: 'text-emerald-400', icon: IndianRupee },
                        { label: 'Total Fees', value: fmt(displaySummary.total_amazon_fees + displaySummary.total_other_charges), sub: `${displaySummary.gross_revenue > 0 ? ((displaySummary.total_amazon_fees + displaySummary.total_other_charges) / displaySummary.gross_revenue * 100).toFixed(1) : '0'}% of gross`, color: 'text-red-400', icon: TrendingDown },
                        { label: 'Total Taxes', value: fmt(displaySummary.total_taxes), sub: `GST + TCS + TDS`, color: 'text-orange-400', icon: IndianRupee },
                        { label: 'Refund Impact', value: fmt(displaySummary.total_refund_impact), sub: `${displaySummary.returned_orders} returns`, color: 'text-amber-400', icon: RotateCcw },
                    ].map(card => {
                        const Icon = card.icon;
                        return (
                            <div key={card.label} className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-4">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Icon size={12} className="text-slate-500" />
                                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{card.label}</p>
                                </div>
                                <p className={`text-xl font-bold ${card.color}`}>{card.value}</p>
                                <p className="text-[9px] text-slate-600 mt-0.5">{card.sub}</p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── 4 Detail Cards: Revenue, Fees, Taxes, Returns ── */}
            {displaySummary && displaySummary.total_orders > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    {/* Revenue & Net */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <IndianRupee size={14} className="text-emerald-400" />
                            Revenue Summary
                        </h3>
                        <div className="space-y-2.5">
                            {[
                                { label: 'Product Sales', value: displaySummary.total_product_sales, color: 'text-emerald-400' },
                                { label: 'Shipping Credits', value: displaySummary.total_shipping_credits, color: 'text-emerald-400' },
                                { label: 'Promotional Rebates', value: displaySummary.total_promotional_rebates, color: 'text-amber-400' },
                            ].filter(f => f.value !== 0).map(f => (
                                <div key={f.label} className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-400">{f.label}</span>
                                    <span className={`text-[11px] font-medium tabular-nums ${f.color}`}>{fmtExact(f.value)}</span>
                                </div>
                            ))}
                            <div className="border-t border-white/5 pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-white">Gross Revenue</span>
                                    <span className="text-sm font-bold text-emerald-400">{fmtExact(displaySummary.gross_revenue)}</span>
                                </div>
                            </div>
                            <div className="border-t border-white/10 pt-3 mt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white">Net Settlement</span>
                                    <span className={`text-lg font-bold ${displaySummary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {fmtExact(displaySummary.net_settlement)}
                                    </span>
                                </div>
                                <p className="text-[9px] text-slate-600 mt-0.5 text-right">
                                    {displaySummary.total_orders} orders · {displaySummary.total_units} units
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Amazon Fees */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <TrendingDown size={14} className="text-red-400" />
                            Amazon Fees
                        </h3>
                        <div className="space-y-2">
                            {[
                                { label: 'Referral Fees', value: displaySummary.total_referral_fees },
                                { label: 'Closing Fees', value: displaySummary.total_closing_fees },
                                { label: 'FBA Fees', value: displaySummary.total_fba_fees },
                                { label: 'Easy Ship Fees', value: displaySummary.total_easy_ship_fees },
                                { label: 'Weight Handling', value: displaySummary.total_weight_handling },
                                { label: 'Technology Fees', value: displaySummary.total_technology_fees },
                                { label: 'Shipping Chargeback', value: displaySummary.total_shipping_chargeback },
                                { label: 'Storage Fees', value: displaySummary.total_storage_fees },
                                { label: 'Adjustment Fees', value: displaySummary.total_adjustment_fees },
                                { label: 'Other Fees', value: displaySummary.total_other_fees },
                            ].filter(f => f.value > 0).map(fee => {
                                const pct = displaySummary.gross_revenue > 0 ? (fee.value / displaySummary.gross_revenue * 100) : 0;
                                return (
                                    <div key={fee.label}>
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] text-slate-400">{fee.label}</span>
                                            <span className="text-[11px] font-medium text-red-400 tabular-nums">{fmtExact(fee.value)}</span>
                                        </div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <div className="flex-1 h-0.5 bg-white/5 rounded-full overflow-hidden">
                                                <div className="h-full bg-red-500/40 rounded-full" style={{ width: `${Math.min(100, pct * 2)}%` }} />
                                            </div>
                                            <span className="text-[9px] text-slate-600">{pct.toFixed(1)}%</span>
                                        </div>
                                    </div>
                                );
                            })}
                            <div className="border-t border-white/5 pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-white">Total Fees</span>
                                    <span className="text-sm font-bold text-red-400">
                                        {fmtExact(displaySummary.total_amazon_fees + displaySummary.total_other_charges)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Taxes */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <IndianRupee size={14} className="text-orange-400" />
                            Taxes
                        </h3>
                        <div className="space-y-3">
                            {[
                                { label: 'GST', value: displaySummary.total_gst, desc: 'Goods & Services Tax' },
                                { label: 'TCS', value: displaySummary.total_tcs, desc: 'Tax Collected at Source' },
                                { label: 'TDS', value: displaySummary.total_tds, desc: 'Tax Deducted at Source' },
                            ].map(tax => (
                                <div key={tax.label}>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <span className="text-[11px] text-slate-300 font-medium">{tax.label}</span>
                                            <p className="text-[9px] text-slate-600">{tax.desc}</p>
                                        </div>
                                        <span className="text-[11px] font-medium text-orange-400 tabular-nums">{fmtExact(tax.value)}</span>
                                    </div>
                                </div>
                            ))}
                            <div className="border-t border-white/5 pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-white">Total Taxes</span>
                                    <span className="text-sm font-bold text-orange-400">{fmtExact(displaySummary.total_taxes)}</span>
                                </div>
                                {displaySummary.gross_revenue > 0 && (
                                    <p className="text-[9px] text-slate-600 mt-0.5 text-right">
                                        {(displaySummary.total_taxes / displaySummary.gross_revenue * 100).toFixed(1)}% of gross revenue
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Returns & Refunds */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <RotateCcw size={14} className="text-amber-400" />
                            Returns & Refunds
                        </h3>
                        <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">Returned Orders</span>
                                <span className="text-[11px] font-medium text-amber-400">{displaySummary.returned_orders}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">RTOs</span>
                                <span className="text-[11px] font-medium text-red-400">{displaySummary.rto_orders}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">Customer Returns</span>
                                <span className="text-[11px] font-medium text-amber-400">{displaySummary.customer_returns}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">Refund Amount</span>
                                <span className="text-[11px] font-medium text-amber-400 tabular-nums">{fmtExact(displaySummary.total_refund_amount)}</span>
                            </div>
                            <div className="border-t border-white/5 pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-white">Total Refund Impact</span>
                                    <span className="text-sm font-bold text-amber-400">{fmtExact(displaySummary.total_refund_impact)}</span>
                                </div>
                                {displaySummary.total_orders > 0 && (
                                    <p className="text-[9px] text-slate-600 mt-0.5 text-right">
                                        Return rate: {(displaySummary.returned_orders / displaySummary.total_orders * 100).toFixed(1)}%
                                    </p>
                                )}
                            </div>
                            {displaySummary.total_ad_spend > 0 && (
                                <div className="border-t border-white/5 pt-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-slate-400">Ad Spend</span>
                                        <span className="text-[11px] font-medium text-violet-400 tabular-nums">{fmtExact(displaySummary.total_ad_spend)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Revenue Breakdown Formula ── */}
            {displaySummary && displaySummary.total_orders > 0 && (
                <div className="bg-[#111827]/80 border border-emerald-500/10 rounded-xl p-5">
                    <h3 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
                        <Lock size={12} className="text-emerald-400" />
                        Revenue Breakdown (Finalized — Solid Figures)
                    </h3>
                    <div className="bg-white/[0.02] border border-emerald-500/10 rounded-xl p-4 font-mono text-[11px] space-y-1">
                        <div className="flex justify-between">
                            <span className="text-emerald-400">  Gross Revenue</span>
                            <span className="text-emerald-400 font-semibold">{fmtExact(displaySummary.gross_revenue)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-red-400">- Amazon Fees</span>
                            <span className="text-red-400">{fmtExact(displaySummary.total_amazon_fees)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-red-400">- Other Charges</span>
                            <span className="text-red-400">{fmtExact(displaySummary.total_other_charges)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-orange-400">- Taxes</span>
                            <span className="text-orange-400">{fmtExact(displaySummary.total_taxes)}</span>
                        </div>
                        {displaySummary.total_refund_impact > 0 && (
                            <div className="flex justify-between">
                                <span className="text-amber-400">- Refund Impact</span>
                                <span className="text-amber-400">{fmtExact(displaySummary.total_refund_impact)}</span>
                            </div>
                        )}
                        {displaySummary.total_ad_spend > 0 && (
                            <div className="flex justify-between">
                                <span className="text-violet-400">- Ad Spend</span>
                                <span className="text-violet-400">{fmtExact(displaySummary.total_ad_spend)}</span>
                            </div>
                        )}
                        {displaySummary.total_promotional_rebates !== 0 && (
                            <div className="flex justify-between">
                                <span className="text-amber-400">+ Promotions</span>
                                <span className="text-amber-400">{fmtExact(displaySummary.total_promotional_rebates)}</span>
                            </div>
                        )}
                        <div className="border-t border-emerald-500/20 pt-2 mt-2 flex justify-between items-center">
                            <span className={`font-bold text-sm ${displaySummary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                = Net Settlement
                            </span>
                            <span className={`font-bold text-lg ${displaySummary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fmtExact(displaySummary.net_settlement)}
                            </span>
                        </div>
                    </div>
                    <p className="text-[9px] mt-2 text-center text-emerald-600">
                        🔒 These figures are FINAL — all settlements closed and disbursed. Your solid revenue till {finalizedDateFormatted}.
                    </p>
                </div>
            )}

            {/* ── Search Bar + Count ── */}
            {!loading && records.length > 0 && (
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                            <CheckCircle2 size={14} className="text-emerald-400" />
                            <span className="text-emerald-400 font-semibold">{pagination?.totalRecords || records.length}</span>
                            <span>finalized order items</span>
                        </div>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input type="text" value={search}
                            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                            placeholder="Search order ID or SKU..."
                            className="pl-9 pr-4 py-2 w-[260px] bg-white/5 border border-white/10 rounded-xl text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/30 transition-colors" />
                    </div>
                </div>
            )}

            {/* ── Loading ── */}
            {loading && !records.length && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={18} className="animate-spin text-emerald-400" />
                    <span className="text-sm text-slate-400 ml-3">Loading finalized orders...</span>
                </div>
            )}

            {/* ── Order Table ── */}
            {!loading && records.length > 0 && (
                <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl overflow-hidden">
                    {/* Table Header */}
                    <div className="grid grid-cols-[2.5fr_0.6fr_1fr_1fr_0.8fr_0.8fr_1fr_1fr_0.8fr_0.9fr] gap-2 px-4 py-3 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                        <div className="flex items-center gap-1 cursor-pointer hover:text-white" onClick={() => handleSort('order_id')}>
                            Order / Product <ArrowUpDown size={10} />
                        </div>
                        <div className="text-center cursor-pointer hover:text-white" onClick={() => handleSort('quantity')}>
                            Qty <ArrowUpDown size={10} className="inline" />
                        </div>
                        <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('gross_revenue')}>
                            Gross Rev <ArrowUpDown size={10} className="inline" />
                        </div>
                        <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('total_fees')}>
                            Fees <ArrowUpDown size={10} className="inline" />
                        </div>
                        <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('total_taxes')}>
                            Taxes <ArrowUpDown size={10} className="inline" />
                        </div>
                        <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('refund_amount')}>
                            Refund <ArrowUpDown size={10} className="inline" />
                        </div>
                        <div className="text-right cursor-pointer hover:text-white" onClick={() => handleSort('net_settlement')}>
                            Net <ArrowUpDown size={10} className="inline" />
                        </div>
                        <div className="text-center">Status</div>
                        <div className="text-center">Finance</div>
                        <div className="text-center">Type</div>
                    </div>

                    {/* Table Body */}
                    <div className="max-h-[600px] overflow-y-auto">
                        {groupedRecords.map((group) => {
                            const isMultiItem = group.items.length > 1;
                            const orderTotal = isMultiItem ? {
                                qty: group.items.reduce((s, r) => s + r.quantity, 0),
                                gross: group.items.reduce((s, r) => s + r.calculations.gross_revenue, 0),
                                fees: group.items.reduce((s, r) => s + r.calculations.total_fees, 0),
                                taxes: group.items.reduce((s, r) => s + r.taxes.total, 0),
                                refund: group.items.reduce((s, r) => s + r.return_details.total_refund_impact, 0),
                                net: group.items.reduce((s, r) => s + r.calculations.net_settlement, 0),
                            } : null;

                            return (
                                <div key={group.orderId} className={isMultiItem ? 'border-b border-white/[0.06]' : ''}>
                                    {/* Multi-item: Order header row */}
                                    {isMultiItem && (
                                        <div className="grid grid-cols-[2.5fr_0.6fr_1fr_1fr_0.8fr_0.8fr_1fr_1fr_0.8fr_0.9fr] gap-2 px-4 py-2.5 items-center bg-white/[0.02] border-b border-white/[0.04]">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <Package size={12} className="text-indigo-400 shrink-0" />
                                                <div className="min-w-0">
                                                    <p className="text-xs font-mono text-white font-semibold truncate">{group.orderId}</p>
                                                    <p className="text-[10px] text-indigo-400">{group.items.length} items in this order</p>
                                                </div>
                                            </div>
                                            <div className="text-center text-xs text-white font-semibold">{orderTotal!.qty}</div>
                                            <div className="text-right text-xs font-semibold text-emerald-400">{fmtExact(orderTotal!.gross)}</div>
                                            <div className="text-right text-xs font-semibold text-red-400">{orderTotal!.fees > 0 ? fmtExact(orderTotal!.fees) : '—'}</div>
                                            <div className="text-right text-xs font-semibold text-orange-400">{orderTotal!.taxes > 0 ? fmtExact(orderTotal!.taxes) : '—'}</div>
                                            <div className="text-right text-xs font-semibold text-amber-400">{orderTotal!.refund > 0 ? fmtExact(orderTotal!.refund) : '—'}</div>
                                            <div className={`text-right text-xs font-bold ${orderTotal!.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtExact(orderTotal!.net)}</div>
                                            <div className="text-center">
                                                <StatusBadge status={group.items[0].order_status} returnType={group.items[0].return_details.return_type} />
                                            </div>
                                            <div className="text-center">
                                                <FinancialStatusBadge status={group.items[0].financial_status} />
                                            </div>
                                            <div className="text-center">
                                                <TxnTypeBadge types={group.items[0].transaction_types} />
                                            </div>
                                        </div>
                                    )}

                                    {/* Item rows */}
                                    {group.items.map((r, idx) => {
                                        const key = `${r.order_id}|${r.sku}`;
                                        const isExpanded = expandedRow === key;
                                        const calc = r.calculations;
                                        return (
                                            <div key={key}>
                                                <div className={`grid grid-cols-[2.5fr_0.6fr_1fr_1fr_0.8fr_0.8fr_1fr_1fr_0.8fr_0.9fr] gap-2 px-4 py-3 items-center hover:bg-white/[0.02] cursor-pointer border-b border-white/[0.03] transition-colors ${isMultiItem ? 'pl-8' : ''}`}
                                                    onClick={() => setExpandedRow(isExpanded ? null : key)}>
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        {isMultiItem ? (
                                                            <span className="flex items-center gap-1">
                                                                <span className="text-[10px] text-slate-600 shrink-0 w-3 text-center">{idx + 1}.</span>
                                                                {isExpanded ? <ChevronUp size={10} className="text-slate-600 shrink-0" /> : <ChevronDown size={10} className="text-slate-600 shrink-0" />}
                                                            </span>
                                                        ) : (
                                                            isExpanded ? <ChevronUp size={12} className="text-slate-500 shrink-0" /> : <ChevronDown size={12} className="text-slate-500 shrink-0" />
                                                        )}
                                                        <div className="min-w-0">
                                                            {!isMultiItem && (
                                                                <p className="text-xs font-mono text-slate-300 truncate">{r.order_id}</p>
                                                            )}
                                                            <p className={`text-[10px] truncate ${isMultiItem ? 'text-slate-300' : 'text-slate-600'}`}>
                                                                <span className="text-slate-500">{r.sku}</span> · {r.product_name}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-center text-xs text-slate-300">{r.quantity}</div>
                                                    <div className="text-right text-xs font-medium text-emerald-400">{fmtExact(calc.gross_revenue)}</div>
                                                    <div className="text-right text-xs font-medium text-red-400">{calc.total_fees > 0 ? fmtExact(calc.total_fees) : '—'}</div>
                                                    <div className="text-right text-xs text-orange-400">{r.taxes.total > 0 ? fmtExact(r.taxes.total) : '—'}</div>
                                                    <div className="text-right text-xs text-amber-400">{r.return_details.total_refund_impact > 0 ? fmtExact(r.return_details.total_refund_impact) : '—'}</div>
                                                    <div className={`text-right text-xs font-bold ${calc.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtExact(calc.net_settlement)}</div>
                                                    {!isMultiItem ? (
                                                        <>
                                                            <div className="text-center">
                                                                <StatusBadge status={r.order_status} returnType={r.return_details.return_type} />
                                                            </div>
                                                            <div className="text-center">
                                                                <FinancialStatusBadge status={r.financial_status} />
                                                            </div>
                                                            <div className="text-center">
                                                                <TxnTypeBadge types={r.transaction_types} />
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <div />
                                                            <div />
                                                            <div className="text-center">
                                                                <TxnTypeBadge types={r.transaction_types} />
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                                {isExpanded && <OrderDetailPanel record={r} />}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>

                    {/* Pagination */}
                    {pagination && pagination.totalPages > 1 && (
                        <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
                            <span className="text-xs text-slate-500">
                                Showing {((pagination.page - 1) * pagination.pageSize) + 1}–{Math.min(pagination.page * pagination.pageSize, pagination.totalRecords)} of {pagination.totalRecords}
                            </span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={pagination.page <= 1}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-all">
                                    <ChevronLeft size={12} /> Prev
                                </button>
                                <span className="text-xs text-slate-400 tabular-nums">{pagination.page} / {pagination.totalPages}</span>
                                <button onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))} disabled={pagination.page >= pagination.totalPages}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-all">
                                    Next <ChevronRight size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Empty State ── */}
            {!loading && records.length === 0 && !error && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Lock size={48} className="text-slate-700 mb-4" />
                    <h2 className="text-lg font-semibold text-white mb-2">No Finalized Orders Yet</h2>
                    <p className="text-sm text-slate-500 mb-5 max-w-md">
                        {search
                            ? 'No finalized orders match your search. Try a different order ID or SKU.'
                            : 'No orders have been fully finalized yet. The finalized-till date requires all orders on a given day to be financially closed.'}
                    </p>
                    <Link href="/command-center/financial-status"
                        className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-slate-300 text-sm font-medium rounded-xl hover:bg-white/10 transition-all">
                        <ArrowLeft size={14} />
                        Back to Financial Status
                    </Link>
                </div>
            )}

            {/* Footer */}
            <div className="text-center py-4 border-t border-white/5">
                <p className="text-xs text-slate-600">
                    🔒 Solid Figures · Orders finalized till {finalizedDateFormatted} · All settlements closed &amp; disbursed
                </p>
            </div>
        </DashboardLayout>
    );
}

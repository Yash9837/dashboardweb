'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import OrderDetailPanel from '@/components/revenue-calculator/OrderDetailPanel';
import type { OrderRevenueRecord } from '@/lib/revenue-types';
import {
    Lock, Unlock, Clock, Shield, CheckCircle2, AlertTriangle, Search,
    ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowUpDown,
    RefreshCw, Download, Calendar, IndianRupee, TrendingDown, RotateCcw,
    Package, Loader2, Zap, Play, History, Filter, CloudDownload,
    ShoppingCart, Truck, ArrowLeftRight, FileText, Eye,
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
    // Closure timeline
    earliest_delivery: string | null;
    earliest_eligible_date: string | null;
    days_until_first_eligible: number;
    refunded_count: number;
    eligible_for_closure: number;
    // Finalized till date
    finalized_till_date: string | null;
    finalized_revenue: number;
    finalized_order_count: number;
}

interface RunResult {
    id: string;
    run_type: string;
    started_at: string;
    completed_at: string;
    orders_processed: number;
    orders_closed: number;
    orders_promoted: number;
    errors: string[];
    duration_ms: number;
}

interface FSResponse {
    success: boolean;
    records: OrderRevenueRecord[];
    summary: ClosedSummary;
    lifecycle: LifecycleData;
    distribution: Record<string, number>;
    pagination: { page: number; pageSize: number; totalRecords: number; totalPages: number };
    dateRange: { start: string; end: string; filtered: boolean };
}

interface StatsResponse {
    success: boolean;
    stats: any;
    runs: RunResult[];
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_TABS = [
    { key: 'FINANCIALLY_CLOSED', label: '🔒 Financially Closed', icon: Lock, solid: true },
    { key: 'DELIVERED_PENDING_SETTLEMENT', label: 'Pending (Return Window)', icon: Clock, solid: false },
    { key: 'all', label: 'All Settled', icon: Shield, solid: false },
];

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

function fmtDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

function fmtAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// ── Badges ───────────────────────────────────────────────────────────────────

function FinancialStatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; icon: any; style: string }> = {
        OPEN: { label: 'Open', icon: Unlock, style: 'bg-slate-500/15 text-slate-400 border-slate-500/20' },
        DELIVERED_PENDING_SETTLEMENT: { label: 'Pending', icon: Clock, style: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
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

export default function FinancialStatusPage() {
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [statusFilter, setStatusFilter] = useState('FINANCIALLY_CLOSED');
    const [search, setSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<string>('order_date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [detecting, setDetecting] = useState(false);
    const [detectResult, setDetectResult] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<string | null>(null);
    const [showRuns, setShowRuns] = useState(false);

    const isAllTime = !startDate && !endDate;

    // Build query — only send dates if user picked them
    const queryStr = useMemo(() => {
        const p = new URLSearchParams();
        if (startDate) p.set('startDate', startDate);
        if (endDate) p.set('endDate', endDate);
        p.set('status', statusFilter);
        if (search) p.set('search', search);
        p.set('page', String(currentPage));
        p.set('pageSize', '50');
        return p.toString();
    }, [startDate, endDate, statusFilter, search, currentPage]);

    const { data, loading, error, refresh } = useFetch<FSResponse>(
        `/api/command-center/financial-status-detail?${queryStr}`, [queryStr]
    );

    const { data: statsData, refresh: refreshStats } = useFetch<StatsResponse>(
        '/api/command-center/financial-status-detail?action=stats', []
    );

    const records = data?.records || [];
    const summary = data?.summary;
    const lifecycle = data?.lifecycle;
    const pagination = data?.pagination;
    const runs = statsData?.runs || [];

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

    // Group sorted records by order_id for visual grouping
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

    const handleDetect = async () => {
        setDetecting(true);
        setDetectResult(null);
        try {
            const res = await fetch('/api/command-center/financial-status-detail', { method: 'POST' });
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            const r = json.result;
            setDetectResult(
                `✅ Detection complete in ${fmtDuration(r.duration_ms)} — ${r.orders_processed} processed, ${r.orders_promoted} promoted, ${r.orders_closed} closed`
            );
            setTimeout(() => { refresh(); refreshStats(); }, 500);
        } catch (err: any) {
            setDetectResult(`❌ Error: ${err.message}`);
        } finally {
            setDetecting(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const res = await fetch('/api/command-center/sync?period=730d', { method: 'POST' });
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            const c = json.counts || {};
            setSyncResult(
                `✅ Amazon Sync complete in ${(json.duration_ms / 1000).toFixed(1)}s — ` +
                `${c.orders || 0} orders, ${c.financial_events || 0} events, ` +
                `${c.settlement_groups || 0} settlement groups synced` +
                (c.lifecycle ? `, ${c.lifecycle.orders_closed} newly closed` : '') +
                (json.warnings?.length ? ` · ⚠ ${json.warnings.length} warning(s)` : '')
            );
            // Refresh page data after sync
            setTimeout(() => { refresh(); refreshStats(); }, 500);
        } catch (err: any) {
            setSyncResult(`❌ Sync Error: ${err.message}`);
        } finally {
            setSyncing(false);
        }
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
        a.href = url; a.download = `financial-status-${startDate || 'all'}-to-${endDate || 'now'}-${statusFilter}.csv`;
        a.click(); URL.revokeObjectURL(url);
    };

    return (
        <DashboardLayout>
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Lock size={22} className="text-emerald-400" />
                        Financial Status
                        {statusFilter === 'FINANCIALLY_CLOSED' ? (
                            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                                <Lock size={10} />
                                Solid Figures
                            </span>
                        ) : (
                            <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-amber-500/10 text-amber-400 border-amber-500/20">
                                <AlertTriangle size={10} />
                                May Change
                            </span>
                        )}
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        {statusFilter === 'FINANCIALLY_CLOSED'
                            ? 'Settlement closed + disbursed = solid, final revenue'
                            : 'Showing orders awaiting settlement/disbursement — figures may change'}
                        {data?.dateRange && (
                            isAllTime
                                ? ' · All Time'
                                : ` · ${data.dateRange.start} → ${data.dateRange.end}`
                        )}
                    </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Date Range Selector */}
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

                    {/* Sync from Amazon */}
                    <button onClick={handleSync} disabled={syncing || detecting}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-xl text-sm text-blue-400 hover:bg-blue-500/20 transition-all disabled:opacity-50">
                        {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
                        {syncing ? 'Syncing...' : 'Sync Amazon'}
                    </button>

                    {/* Detect Button */}
                    <button onClick={handleDetect} disabled={detecting || syncing}
                        className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50">
                        {detecting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                        {detecting ? 'Detecting...' : 'Run Detection'}
                    </button>

                    <button onClick={() => setShowRuns(!showRuns)}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all">
                        <History size={14} />
                        Runs
                    </button>

                    <button onClick={() => refresh()} disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>

                    <button onClick={handleExportCSV} disabled={!records.length}
                        className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-sm text-indigo-400 hover:bg-indigo-500/20 transition-all disabled:opacity-50">
                        <Download size={14} />
                        CSV
                    </button>
                </div>
            </div>

            {/* Sync result banner */}
            {syncResult && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-xs font-medium ${syncResult.startsWith('❌')
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                    }`}>
                    <CloudDownload size={12} />{syncResult}
                    <button onClick={() => setSyncResult(null)} className="ml-auto text-slate-500 hover:text-white">✕</button>
                </div>
            )}

            {/* Detection result banner */}
            {detectResult && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-xs font-medium ${detectResult.startsWith('❌')
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    }`}>
                    <Zap size={12} />{detectResult}
                    <button onClick={() => setDetectResult(null)} className="ml-auto text-slate-500 hover:text-white">✕</button>
                </div>
            )}

            {/* Error banner */}
            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <AlertTriangle size={18} className="text-red-400 shrink-0" />
                    <p className="text-sm text-red-400">{error}</p>
                    <button onClick={() => refresh()} className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg bg-red-500/10">Retry</button>
                </div>
            )}

            {/* ── Run History Panel ── */}
            {showRuns && runs.length > 0 && (
                <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-4">
                    <h3 className="text-xs font-semibold text-white mb-3 flex items-center gap-2">
                        <History size={14} className="text-indigo-400" />
                        Recent Detection Runs
                    </h3>
                    <div className="space-y-2 max-h-[200px] overflow-y-auto">
                        {runs.map((run, i) => (
                            <div key={run.id || i} className="flex items-center gap-4 p-2.5 bg-white/[0.02] border border-white/5 rounded-lg">
                                <span className={`px-2 py-0.5 text-[9px] font-semibold rounded-full border ${run.run_type === 'manual' ? 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'}`}>
                                    {run.run_type}
                                </span>
                                <span className="text-[11px] text-slate-400">{fmtAgo(run.started_at)}</span>
                                <span className="text-[11px] text-slate-300">{run.orders_processed} processed</span>
                                <span className="text-[11px] text-amber-400">{run.orders_promoted} promoted</span>
                                <span className="text-[11px] text-emerald-400">{run.orders_closed} closed</span>
                                <span className="text-[11px] text-slate-500 ml-auto">{fmtDuration(run.duration_ms)}</span>
                                {run.errors?.length > 0 && (
                                    <span className="text-[10px] text-red-400">⚠ {run.errors.length} errors</span>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Lifecycle Overview Cards ── */}
            {lifecycle && (
                <>
                    {/* Finalized Till Date — Hero Card */}
                    {lifecycle.finalized_till_date && (
                        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5 flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
                                    <Shield size={20} className="text-emerald-400" />
                                </div>
                                <div>
                                    <p className="text-[10px] font-medium text-emerald-500 uppercase tracking-wider">Payments Finalized Till</p>
                                    <p className="text-xl font-bold text-emerald-400">
                                        {new Date(lifecycle.finalized_till_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                    </p>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                        {lifecycle.finalized_order_count} orders &middot; Revenue till this date is solid &amp; final
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="text-right">
                                    <p className="text-[10px] text-slate-500">Finalized Revenue</p>
                                    <p className="text-lg font-bold text-emerald-400">
                                        ₹{lifecycle.finalized_revenue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                    </p>
                                </div>
                                <Link
                                    href="/command-center/financial-status/finalized"
                                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-500/15 border border-emerald-500/25 rounded-lg text-emerald-400 hover:bg-emerald-500/25 transition whitespace-nowrap"
                                >
                                    <Lock size={13} />
                                    Solid Figures
                                </Link>
                                <Link
                                    href="/command-center/financial-status/blockers"
                                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-amber-500/15 border border-amber-500/25 rounded-lg text-amber-400 hover:bg-amber-500/25 transition whitespace-nowrap"
                                >
                                    <Eye size={13} />
                                    Blockers
                                </Link>
                            </div>
                        </div>
                    )}
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        {[
                            { label: 'Total Orders', value: lifecycle.total_orders, color: 'text-white', icon: Package, sub: `${lifecycle.settlement_rate}% settled` },
                            { label: 'Open', value: lifecycle.OPEN, color: 'text-slate-400', icon: Unlock, sub: 'No financial events' },
                            { label: 'Pending Settlement', value: lifecycle.DELIVERED_PENDING_SETTLEMENT, color: 'text-amber-400', icon: Clock, sub: 'Awaiting disbursement' },
                            { label: 'Financially Closed', value: lifecycle.FINANCIALLY_CLOSED, color: 'text-emerald-400', icon: Lock, sub: 'Settled & disbursed' },
                            { label: 'Closure Rate', value: lifecycle.closure_rate, color: lifecycle.closure_rate > 50 ? 'text-emerald-400' : 'text-amber-400', icon: CheckCircle2, sub: 'Of all orders', isPercent: true },
                        ].map(card => {
                            const Icon = card.icon;
                            return (
                                <div key={card.label} className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-4">
                                    <div className="flex items-center gap-1.5 mb-2">
                                        <Icon size={12} className="text-slate-500" />
                                        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{card.label}</p>
                                    </div>
                                    <p className={`text-xl font-bold ${card.color}`}>
                                        {(card as any).isPercent ? `${card.value}%` : card.value.toLocaleString('en-IN')}
                                    </p>
                                    <p className="text-[9px] text-slate-600 mt-0.5">{card.sub}</p>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {/* ── Settled Orders Summary: Fees / Taxes / Refunds / Net ── */}
            {summary && summary.total_orders > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                    {/* Revenue & Net */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <IndianRupee size={14} className="text-emerald-400" />
                            Revenue Summary
                        </h3>
                        <div className="space-y-2.5">
                            {[
                                { label: 'Product Sales', value: summary.total_product_sales, color: 'text-emerald-400' },
                                { label: 'Shipping Credits', value: summary.total_shipping_credits, color: 'text-emerald-400' },
                                { label: 'Promotional Rebates', value: summary.total_promotional_rebates, color: 'text-amber-400' },
                            ].filter(f => f.value !== 0).map(f => (
                                <div key={f.label} className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-400">{f.label}</span>
                                    <span className={`text-[11px] font-medium tabular-nums ${f.color}`}>{fmtExact(f.value)}</span>
                                </div>
                            ))}
                            <div className="border-t border-white/5 pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-white">Gross Revenue</span>
                                    <span className="text-sm font-bold text-emerald-400">{fmtExact(summary.gross_revenue)}</span>
                                </div>
                            </div>
                            <div className="border-t border-white/10 pt-3 mt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-white">Net Settlement</span>
                                    <span className={`text-lg font-bold ${summary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {fmtExact(summary.net_settlement)}
                                    </span>
                                </div>
                                <p className="text-[9px] text-slate-600 mt-0.5 text-right">
                                    {summary.total_orders} orders · {summary.total_units} units
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
                                { label: 'Referral Fees', value: summary.total_referral_fees },
                                { label: 'Closing Fees', value: summary.total_closing_fees },
                                { label: 'FBA Fees', value: summary.total_fba_fees },
                                { label: 'Easy Ship Fees', value: summary.total_easy_ship_fees },
                                { label: 'Weight Handling', value: summary.total_weight_handling },
                                { label: 'Technology Fees', value: summary.total_technology_fees },
                                { label: 'Shipping Chargeback', value: summary.total_shipping_chargeback },
                                { label: 'Storage Fees', value: summary.total_storage_fees },
                                { label: 'Adjustment Fees', value: summary.total_adjustment_fees },
                                { label: 'Other Fees', value: summary.total_other_fees },
                            ].filter(f => f.value > 0).map(fee => {
                                const pct = summary.gross_revenue > 0 ? (fee.value / summary.gross_revenue * 100) : 0;
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
                                        {fmtExact(summary.total_amazon_fees + summary.total_other_charges)}
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
                                { label: 'GST', value: summary.total_gst, desc: 'Goods & Services Tax' },
                                { label: 'TCS', value: summary.total_tcs, desc: 'Tax Collected at Source' },
                                { label: 'TDS', value: summary.total_tds, desc: 'Tax Deducted at Source' },
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
                                    <span className="text-sm font-bold text-orange-400">{fmtExact(summary.total_taxes)}</span>
                                </div>
                                {summary.gross_revenue > 0 && (
                                    <p className="text-[9px] text-slate-600 mt-0.5 text-right">
                                        {(summary.total_taxes / summary.gross_revenue * 100).toFixed(1)}% of gross revenue
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
                                <span className="text-[11px] font-medium text-amber-400">{summary.returned_orders}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">RTOs</span>
                                <span className="text-[11px] font-medium text-red-400">{summary.rto_orders}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">Customer Returns</span>
                                <span className="text-[11px] font-medium text-amber-400">{summary.customer_returns}</span>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-400">Refund Amount</span>
                                <span className="text-[11px] font-medium text-amber-400 tabular-nums">{fmtExact(summary.total_refund_amount)}</span>
                            </div>
                            <div className="border-t border-white/5 pt-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] font-semibold text-white">Total Refund Impact</span>
                                    <span className="text-sm font-bold text-amber-400">{fmtExact(summary.total_refund_impact)}</span>
                                </div>
                                {summary.total_orders > 0 && (
                                    <p className="text-[9px] text-slate-600 mt-0.5 text-right">
                                        Return rate: {(summary.returned_orders / summary.total_orders * 100).toFixed(1)}%
                                    </p>
                                )}
                            </div>
                            {summary.total_ad_spend > 0 && (
                                <div className="border-t border-white/5 pt-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] text-slate-400">Ad Spend</span>
                                        <span className="text-[11px] font-medium text-violet-400 tabular-nums">{fmtExact(summary.total_ad_spend)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Settled Net Formula Box ── */}
            {summary && summary.total_orders > 0 && (
                <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                    <h3 className="text-xs font-semibold text-white mb-3">
                        Revenue Breakdown {statusFilter === 'FINANCIALLY_CLOSED' ? '(Closed Orders — Solid Figures)' : '(Settled Orders — May Change)'}
                    </h3>
                    <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 font-mono text-[11px] space-y-1">
                        <div className="flex justify-between">
                            <span className="text-emerald-400">  Gross Revenue</span>
                            <span className="text-emerald-400 font-semibold">{fmtExact(summary.gross_revenue)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-red-400">- Amazon Fees</span>
                            <span className="text-red-400">{fmtExact(summary.total_amazon_fees)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-red-400">- Other Charges</span>
                            <span className="text-red-400">{fmtExact(summary.total_other_charges)}</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-orange-400">- Taxes</span>
                            <span className="text-orange-400">{fmtExact(summary.total_taxes)}</span>
                        </div>
                        {summary.total_refund_impact > 0 && (
                            <div className="flex justify-between">
                                <span className="text-amber-400">- Refund Impact</span>
                                <span className="text-amber-400">{fmtExact(summary.total_refund_impact)}</span>
                            </div>
                        )}
                        {summary.total_ad_spend > 0 && (
                            <div className="flex justify-between">
                                <span className="text-violet-400">- Ad Spend</span>
                                <span className="text-violet-400">{fmtExact(summary.total_ad_spend)}</span>
                            </div>
                        )}
                        {summary.total_promotional_rebates !== 0 && (
                            <div className="flex justify-between">
                                <span className="text-amber-400">+ Promotions</span>
                                <span className="text-amber-400">{fmtExact(summary.total_promotional_rebates)}</span>
                            </div>
                        )}
                        <div className="border-t border-white/10 pt-2 mt-2 flex justify-between items-center">
                            <span className={`font-bold text-sm ${summary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                = Net Settlement
                            </span>
                            <span className={`font-bold text-lg ${summary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {fmtExact(summary.net_settlement)}
                            </span>
                        </div>
                    </div>
                    <p className={`text-[9px] mt-2 text-center ${statusFilter === 'FINANCIALLY_CLOSED' ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {statusFilter === 'FINANCIALLY_CLOSED'
                            ? '🔒 These figures are FINAL — all settlements closed and disbursed. Your solid revenue.'
                            : '⚠ These figures may still change — orders are awaiting settlement closure or disbursement.'}
                    </p>
                </div>
            )}

            {/* ── Status Filter Tabs ── */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5 flex-1">
                    {STATUS_TABS.map(tab => {
                        const Icon = tab.icon;
                        const count = lifecycle
                            ? tab.key === 'all'
                                ? (lifecycle.DELIVERED_PENDING_SETTLEMENT + lifecycle.FINANCIALLY_CLOSED)
                                : lifecycle[tab.key as keyof LifecycleData] as number
                            : 0;
                        return (
                            <button key={tab.key}
                                onClick={() => { setStatusFilter(tab.key); setCurrentPage(1); }}
                                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg transition-all ${statusFilter === tab.key
                                    ? 'bg-emerald-500/20 text-emerald-400 shadow-sm'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}>
                                <Icon size={12} />
                                {tab.label}
                                <span className="text-[9px] text-slate-600 ml-1">({count})</span>
                            </button>
                        );
                    })}
                </div>

                {/* Search */}
                <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input type="text" value={search}
                        onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                        placeholder="Search order ID or SKU..."
                        className="pl-9 pr-4 py-2 w-[240px] bg-white/5 border border-white/10 rounded-xl text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/30 transition-colors" />
                </div>
            </div>

            {/* ── Warning Banner for non-closed tabs ── */}
            {statusFilter !== 'FINANCIALLY_CLOSED' && !loading && records.length > 0 && (
                <div className="flex items-center gap-2 p-3 rounded-xl text-xs font-medium bg-amber-500/10 border border-amber-500/20 text-amber-400">
                    <AlertTriangle size={14} className="shrink-0" />
                    <div>
                        <span className="font-semibold">⚠ These figures may still change.</span>
                        {' '}Orders in &quot;{statusFilter === 'all' ? 'All Settled' : 'Pending Settlement'}&quot; are still awaiting settlement closure or disbursement.
                        Switch to <button onClick={() => { setStatusFilter('FINANCIALLY_CLOSED'); setCurrentPage(1); }} className="underline font-bold text-emerald-400 hover:text-emerald-300">🔒 Financially Closed</button> for solid, immutable figures.
                    </div>
                </div>
            )}

            {/* ── Loading ── */}
            {loading && !records.length && (
                <div className="flex items-center justify-center py-20">
                    <Loader2 size={18} className="animate-spin text-slate-400" />
                    <span className="text-sm text-slate-400 ml-3">Loading {statusFilter === 'FINANCIALLY_CLOSED' ? 'closed' : 'settled'} orders...</span>
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
                            // Order-level totals for multi-item orders
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
                    <h2 className="text-lg font-semibold text-white mb-2">
                        {search ? 'No Matching Orders' : 'No Closed Orders in This Period'}
                    </h2>
                    <p className="text-sm text-slate-500 mb-5 max-w-md">
                        {search
                            ? 'No orders match your search. Try a different order ID or SKU.'
                            : statusFilter === 'FINANCIALLY_CLOSED'
                                ? isAllTime
                                    ? 'No orders have been financially closed yet. Run detection to close eligible orders.'
                                    : 'No closed orders in this date range. Try clearing the date filter.'
                                : 'No orders found with this status for the selected range.'}
                    </p>
                    <div className="flex items-center gap-3">
                        {statusFilter === 'FINANCIALLY_CLOSED' && !isAllTime && (
                            <button onClick={() => { setStartDate(''); setEndDate(''); setCurrentPage(1); }}
                                className="flex items-center gap-2 px-4 py-2.5 bg-white/5 border border-white/10 text-slate-300 text-sm font-medium rounded-xl hover:bg-white/10 transition-all">
                                <Calendar size={14} />
                                Show All Time
                            </button>
                        )}
                        <button onClick={handleDetect} disabled={detecting}
                            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50">
                            {detecting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                            Run Detection
                        </button>
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="text-center py-4 border-t border-white/5">
                <p className="text-xs text-slate-600">
                    Financial Status · Closed Order Detection · DeliveryDate + 30 days + No Refund = Closed ·
                    Your solid, final revenue figures
                </p>
            </div>
        </DashboardLayout>
    );
}

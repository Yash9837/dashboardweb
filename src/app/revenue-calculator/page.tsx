'use client';
import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import OrderDetailPanel from '@/components/revenue-calculator/OrderDetailPanel';
import SKUPerformancePanel from '@/components/revenue-calculator/SKUPerformancePanel';
import SettlementTimeline from '@/components/revenue-calculator/SettlementTimeline';
import RevenueWaterfallChart from '@/components/revenue-calculator/RevenueWaterfallChart';
import type { RevenueCalculatorResponse, RevenueTab, OrderRevenueRecord } from '@/lib/revenue-types';
import {
    Calculator, Search, ChevronDown, ChevronUp, Calendar, RefreshCw,
    Download, ArrowUpDown, Package, IndianRupee, TrendingDown,
    RotateCcw, AlertTriangle, ChevronLeft, ChevronRight, Filter,
    BarChart3, Layers, CreditCard, ShoppingCart, Truck, ArrowLeftRight,
    Zap, FileText, Lock, Unlock, Clock, CheckCircle2, Shield,
} from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────

const PERIODS = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
    { key: 'custom', label: 'Custom' },
];

const STATUS_FILTERS = [
    { key: 'all', label: 'All Orders' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'shipped', label: 'Shipped' },
    { key: 'returned', label: 'Returned' },
    { key: 'rto', label: 'RTO' },
    { key: 'customer_return', label: 'Customer Return' },
    { key: 'cancelled', label: 'Cancelled' },
];

const TXN_TYPE_FILTERS = [
    { key: 'all', label: 'All Types' },
    { key: 'Order', label: 'Orders' },
    { key: 'Refund', label: 'Refunds' },
    { key: 'ShippingServices', label: 'Shipping' },
    { key: 'ServiceFee', label: 'Service Fee' },
    { key: 'Adjustment', label: 'Adjustment' },
    { key: 'Chargeback', label: 'Chargeback' },
    { key: 'Retrocharge', label: 'Retrocharge' },
];

const TABS: { key: RevenueTab; label: string; icon: any }[] = [
    { key: 'orders', label: 'Order Ledger', icon: FileText },
    { key: 'sku-summary', label: 'SKU Performance', icon: Layers },
    { key: 'waterfall', label: 'Revenue Waterfall', icon: BarChart3 },
    { key: 'settlements', label: 'Settlements', icon: CreditCard },
];

// ── Formatters ───────────────────────────────────────────────────────────────

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

function formatExact(n: number): string {
    if (n === 0) return '₹0.00';
    const prefix = n < 0 ? '-' : '';
    return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

// ── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, returnType }: { status: string; returnType: string | null }) {
    if (returnType === 'RTO') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
                <Truck size={10} /> RTO
            </span>
        );
    }
    if (returnType === 'Customer Return') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                <RotateCcw size={10} /> Return
            </span>
        );
    }
    const styles: Record<string, string> = {
        Shipped: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
        Delivered: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        Cancelled: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
        Pending: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
    };
    const style = styles[status] || 'bg-slate-500/15 text-slate-400 border-slate-500/20';
    return (
        <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold rounded-full border ${style}`}>
            {status}
        </span>
    );
}

// ── Transaction Type Badge ───────────────────────────────────────────────────

function TxnTypeBadge({ types }: { types: string[] }) {
    const colorMap: Record<string, string> = {
        Order: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        Refund: 'bg-red-500/10 text-red-400 border-red-500/20',
        ShippingServices: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
        ServiceFee: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
        Adjustment: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        Chargeback: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
        Retrocharge: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
    };
    const iconMap: Record<string, any> = {
        Order: ShoppingCart,
        Refund: RotateCcw,
        ShippingServices: Truck,
        ServiceFee: Zap,
        Adjustment: ArrowLeftRight,
        Chargeback: AlertTriangle,
        Retrocharge: ArrowLeftRight,
    };

    return (
        <div className="flex flex-wrap gap-1">
            {types.slice(0, 2).map(t => {
                const Icon = iconMap[t] || Package;
                return (
                    <span key={t} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-medium rounded-full border ${colorMap[t] || 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                        <Icon size={8} />{t.replace('Services', '')}
                    </span>
                );
            })}
            {types.length > 2 && (
                <span className="text-[9px] text-slate-500">+{types.length - 2}</span>
            )}
        </div>
    );
}

// ── Financial Status Badge ───────────────────────────────────────────────────

function FinancialStatusBadge({ status }: { status: string }) {
    const config: Record<string, { label: string; icon: any; style: string }> = {
        OPEN: {
            label: 'Open',
            icon: Unlock,
            style: 'bg-slate-500/15 text-slate-400 border-slate-500/20',
        },
        DELIVERED_PENDING_SETTLEMENT: {
            label: 'Pending Settlement',
            icon: Clock,
            style: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
        },
        FINANCIALLY_CLOSED: {
            label: 'Closed',
            icon: Lock,
            style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        },
    };
    const c = config[status] || config.OPEN;
    const Icon = c.icon;
    return (
        <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-semibold rounded-full border ${c.style}`}>
            <Icon size={8} />{c.label}
        </span>
    );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function RevenueCalculatorPage() {
    const [period, setPeriod] = useState('30d');
    const [customStart, setCustomStart] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [txnTypeFilter, setTxnTypeFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedRow, setExpandedRow] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState<string>('order_date');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
    const [activeTab, setActiveTab] = useState<RevenueTab>('orders');

    // Build query string
    const queryStr = useMemo(() => {
        const params = new URLSearchParams();
        if (period === 'custom') {
            params.set('startDate', customStart);
            params.set('endDate', customEnd);
        } else {
            params.set('period', period);
        }
        if (search) params.set('search', search);
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (txnTypeFilter !== 'all') params.set('txnType', txnTypeFilter);
        params.set('page', String(currentPage));
        params.set('pageSize', '50');
        params.set('tab', activeTab);
        return params.toString();
    }, [period, customStart, customEnd, search, statusFilter, txnTypeFilter, currentPage, activeTab]);

    const { data, loading, error, refresh } = useFetch<RevenueCalculatorResponse>(
        `/api/revenue-calculator?${queryStr}`, [queryStr]
    );

    // Settlement sync handler — triggers the command-center sync and then refreshes data
    const handleSettlementSync = async () => {
        const periodParam = period === 'custom' ? '90d' : period;
        const res = await fetch(`/api/command-center/sync?period=${periodParam}`, { method: 'POST' });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Sync failed (${res.status})`);
        }
        // Refresh the revenue calculator data after sync completes
        setTimeout(() => refresh(), 500);
    };

    const records = data?.records || [];
    const summary = data?.summary;
    const pagination = data?.pagination;

    // Client-side sort
    const sortedRecords = useMemo(() => {
        const sorted = [...records];
        sorted.sort((a: any, b: any) => {
            let aVal: any, bVal: any;
            // Handle nested sort keys
            if (sortBy === 'net_settlement') {
                aVal = a.calculations?.net_settlement ?? 0;
                bVal = b.calculations?.net_settlement ?? 0;
            } else if (sortBy === 'gross_revenue') {
                aVal = a.calculations?.gross_revenue ?? 0;
                bVal = b.calculations?.gross_revenue ?? 0;
            } else if (sortBy === 'total_fees') {
                aVal = a.calculations?.total_fees ?? 0;
                bVal = b.calculations?.total_fees ?? 0;
            } else if (sortBy === 'refund_amount') {
                aVal = a.return_details?.total_refund_impact ?? 0;
                bVal = b.return_details?.total_refund_impact ?? 0;
            } else if (sortBy === 'total_taxes') {
                aVal = a.taxes?.total ?? 0;
                bVal = b.taxes?.total ?? 0;
            } else {
                aVal = a[sortBy];
                bVal = b[sortBy];
            }
            if (typeof aVal === 'string') aVal = aVal.toLowerCase();
            if (typeof bVal === 'string') bVal = bVal.toLowerCase();
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [records, sortBy, sortDir]);

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDir('desc');
        }
    };

    const handleExportCSV = () => {
        if (!records.length) return;
        const headers = [
            'Order ID', 'SKU', 'ASIN', 'Product Name', 'Quantity',
            'Order Date', 'Shipment Date', 'Delivery Date', 'Status', 'Fulfillment',
            'Product Sales', 'Shipping Credits', 'Gift Wrap Credits',
            'Promotional Rebates',
            'GST', 'TCS', 'TDS', 'Total Taxes',
            'Referral Fee', 'Closing Fee', 'FBA Fee', 'Easy Ship Fee', 'Weight Handling Fee', 'Technology Fee', 'Total Amazon Fees',
            'Shipping Chargeback', 'Adjustment Fees', 'Storage Fees', 'Other Fees', 'Total Other Charges',
            'Is Returned', 'Return Type', 'Refund Amount', 'Refund Commission', 'Return Processing Fee', 'Total Refund Impact',
            'Ad Spend',
            'Gross Revenue', 'Total Fees', 'Net Settlement',
            'Transaction Types',
            'Financial Status', 'Return Deadline', 'Settlement Status', 'Closed At',
        ];
        const rows = records.map((r: OrderRevenueRecord) => [
            r.order_id, r.sku, r.asin, `"${r.product_name}"`, r.quantity,
            formatDate(r.order_date), formatDate(r.shipment_date), formatDate(r.delivery_date), r.order_status, r.fulfillment_channel,
            r.product_sales, r.shipping_credits, r.gift_wrap_credits,
            r.promotional_rebates,
            r.taxes.gst, r.taxes.tcs, r.taxes.tds, r.taxes.total,
            r.amazon_fees.referral_fee, r.amazon_fees.closing_fee, r.amazon_fees.fba_fee, r.amazon_fees.easy_ship_fee, r.amazon_fees.weight_handling_fee, r.amazon_fees.technology_fee, r.amazon_fees.total,
            r.other_charges.shipping_chargeback, r.other_charges.adjustment_fees, r.other_charges.storage_fees, r.other_charges.other_fees, r.other_charges.total,
            r.return_details.is_returned ? 'Yes' : 'No', r.return_details.return_type || '', r.return_details.refund_amount, r.return_details.refund_commission, r.return_details.return_processing_fee, r.return_details.total_refund_impact,
            r.ad_spend,
            r.calculations.gross_revenue, r.calculations.total_fees, r.calculations.net_settlement,
            r.transaction_types.join('; '),
            r.financial_status, formatDate(r.return_deadline), r.settlement_status, formatDate(r.financial_closed_at),
        ]);
        const csv = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `revenue-calculator-${period}-${activeTab}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <DashboardLayout>
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Calculator size={22} className="text-indigo-400" />
                        Revenue Calculator
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        True net revenue per order &amp; SKU — fees, taxes, refunds, RTO, advertising, settlements
                        {data?.period && ` · ${data.period.start} → ${data.period.end}`}
                    </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Period Selector */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                        {PERIODS.map(p => (
                            <button
                                key={p.key}
                                onClick={() => { setPeriod(p.key); setCurrentPage(1); }}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${period === p.key
                                    ? 'bg-indigo-500/20 text-indigo-400 shadow-sm'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {p.key === 'custom' && <Calendar size={10} className="inline mr-1" />}
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {period === 'custom' && (
                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
                            <input type="date" value={customStart} onChange={e => { setCustomStart(e.target.value); setCurrentPage(1); }}
                                className="bg-transparent text-xs text-slate-300 border-none outline-none [color-scheme:dark]" />
                            <span className="text-slate-500 text-xs">→</span>
                            <input type="date" value={customEnd} onChange={e => { setCustomEnd(e.target.value); setCurrentPage(1); }}
                                className="bg-transparent text-xs text-slate-300 border-none outline-none [color-scheme:dark]" />
                        </div>
                    )}

                    <button onClick={() => refresh()} disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50">
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>

                    <button onClick={handleExportCSV} disabled={!records.length}
                        className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-sm text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50">
                        <Download size={14} />
                        Export CSV
                    </button>
                </div>
            </div>

            {/* ── Summary Cards ── */}
            {summary && (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                    {[
                        { label: 'Orders', value: summary.total_orders, format: 'number' as const, icon: Package, color: 'text-white' },
                        { label: 'Units Sold', value: summary.total_units, format: 'number' as const, icon: Package, color: 'text-slate-300' },
                        { label: 'Gross Revenue', value: summary.gross_revenue, format: 'currency' as const, icon: IndianRupee, color: 'text-emerald-400' },
                        { label: 'Amazon Fees', value: summary.total_amazon_fees, format: 'currency' as const, icon: TrendingDown, color: 'text-red-400' },
                        { label: 'Total Refunds', value: summary.total_refund_impact, format: 'currency' as const, icon: RotateCcw, color: 'text-amber-400' },
                        { label: 'Total Taxes', value: summary.total_taxes, format: 'currency' as const, icon: IndianRupee, color: 'text-orange-400' },
                        { label: 'Net Settlement', value: summary.net_settlement, format: 'currency' as const, icon: IndianRupee, color: summary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400' },
                        { label: 'Return Rate', value: summary.return_rate, format: 'percent' as const, icon: AlertTriangle, color: summary.return_rate > 10 ? 'text-red-400' : 'text-slate-300' },
                    ].map(card => {
                        const Icon = card.icon;
                        return (
                            <div key={card.label} className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-4">
                                <div className="flex items-center gap-1.5 mb-2">
                                    <Icon size={12} className="text-slate-500" />
                                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{card.label}</p>
                                </div>
                                <p className={`text-lg font-bold ${card.color}`}>
                                    {card.format === 'currency' ? formatCurrency(card.value)
                                        : card.format === 'percent' ? `${card.value}%`
                                            : card.value.toLocaleString('en-IN')}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── Order Lifecycle Stats Banner ── */}
            {data?.lifecycle_stats && data.lifecycle_stats.total_orders > 0 && (
                <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Shield size={14} className="text-indigo-400" />
                            <h3 className="text-xs font-semibold text-white">Order Financial Lifecycle</h3>
                            <span className="text-[10px] text-slate-500">(Industry-standard Closed Order Detection)</span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                            Closure Rate: <span className={`font-bold ${data.lifecycle_stats.closure_rate > 50 ? 'text-emerald-400' : 'text-amber-400'}`}>
                                {data.lifecycle_stats.closure_rate}%
                            </span>
                        </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                        {[
                            { label: 'Open', value: data.lifecycle_stats.open, icon: Unlock, color: 'text-slate-400', bg: 'bg-slate-500/10' },
                            { label: 'Pending (30d Window)', value: data.lifecycle_stats.delivered_pending_settlement, icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10' },
                            { label: 'Financially Closed', value: data.lifecycle_stats.financially_closed, icon: Lock, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                        ].map(s => {
                            const Icon = s.icon;
                            const pct = data.lifecycle_stats!.total_orders > 0
                                ? Math.round((s.value / data.lifecycle_stats!.total_orders) * 100)
                                : 0;
                            return (
                                <div key={s.label} className={`${s.bg} border border-white/5 rounded-lg p-3`}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <Icon size={10} className={s.color} />
                                        <span className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <span className={`text-lg font-bold ${s.color}`}>{s.value}</span>
                                        <span className="text-[10px] text-slate-600">{pct}%</span>
                                    </div>
                                    <div className="h-1 bg-white/5 rounded-full overflow-hidden mt-1.5">
                                        <div className={`h-full rounded-full ${s.bg.replace('/10', '/40')}`} style={{ width: `${Math.max(2, pct)}%` }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── Fee Breakdown + Tax + Return Summary ── */}
            {summary && summary.total_amazon_fees > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* Amazon Fees Breakdown */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <TrendingDown size={14} className="text-red-400" />
                            Amazon Fees
                        </h3>
                        <div className="space-y-2.5">
                            {[
                                { label: 'Referral Fees', value: summary.total_referral_fees },
                                { label: 'FBA Fees', value: summary.total_fba_fees },
                                { label: 'Closing Fees', value: summary.total_closing_fees },
                                { label: 'Easy Ship Fees', value: summary.total_easy_ship_fees },
                                { label: 'Weight Handling', value: summary.total_weight_handling },
                                { label: 'Technology Fees', value: summary.total_technology_fees },
                                { label: 'Shipping Chargeback', value: summary.total_shipping_chargeback },
                                { label: 'Storage Fees', value: summary.total_storage_fees },
                                { label: 'Other Fees', value: summary.total_other_fees },
                            ].filter(f => f.value > 0).map(fee => {
                                const pct = summary.gross_revenue > 0 ? (fee.value / summary.gross_revenue * 100) : 0;
                                return (
                                    <div key={fee.label}>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[11px] text-slate-400">{fee.label}</span>
                                            <span className="text-[11px] font-medium text-red-400 tabular-nums">{formatExact(fee.value)}</span>
                                        </div>
                                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-red-500/40 rounded-full" style={{ width: `${Math.min(100, pct * 2)}%` }} />
                                        </div>
                                        <p className="text-[9px] text-slate-600 mt-0.5">{pct.toFixed(1)}% of revenue</p>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Tax Breakdown */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <IndianRupee size={14} className="text-orange-400" />
                            Tax Breakdown
                        </h3>
                        <div className="space-y-4">
                            {[
                                { label: 'GST (IGST/CGST/SGST)', value: summary.total_gst, desc: 'Goods & Services Tax on fees' },
                                { label: 'TCS', value: summary.total_tcs, desc: 'Tax Collected at Source (1%)' },
                                { label: 'TDS', value: summary.total_tds, desc: 'Tax Deducted at Source' },
                            ].filter(t => t.value > 0).map(tax => (
                                <div key={tax.label} className="bg-white/[0.03] border border-white/5 rounded-lg p-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-[11px] font-medium text-slate-300">{tax.label}</p>
                                            <p className="text-[9px] text-slate-600 mt-0.5">{tax.desc}</p>
                                        </div>
                                        <p className="text-sm font-semibold text-orange-400 tabular-nums">{formatExact(tax.value)}</p>
                                    </div>
                                </div>
                            ))}
                            <div className="border-t border-white/5 pt-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-white">Total Taxes</span>
                                    <span className="text-sm font-bold text-orange-400">{formatExact(summary.total_taxes)}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Return Summary */}
                    <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                        <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                            <RotateCcw size={14} className="text-amber-400" />
                            Return Details
                        </h3>
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 text-center">
                                    <p className="text-[10px] text-slate-500 uppercase">Customer Returns</p>
                                    <p className="text-lg font-bold text-amber-400">{summary.customer_returns}</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/5 rounded-lg p-3 text-center">
                                    <p className="text-[10px] text-slate-500 uppercase">RTO</p>
                                    <p className="text-lg font-bold text-red-400">{summary.rto_orders}</p>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-500">Refund Amount</span>
                                    <span className="text-[11px] font-medium text-amber-400 tabular-nums">{formatExact(summary.total_refund_amount)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-500">Refund Commission</span>
                                    <span className="text-[11px] font-medium text-amber-400 tabular-nums">{formatExact(summary.total_refund_commission)}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[11px] text-slate-500">Return Processing</span>
                                    <span className="text-[11px] font-medium text-red-400 tabular-nums">{formatExact(summary.total_return_processing)}</span>
                                </div>
                                <div className="border-t border-white/5 pt-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-white">Total Refund Impact</span>
                                        <span className="text-sm font-bold text-amber-400">{formatExact(summary.total_refund_impact)}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between bg-white/[0.03] border border-white/5 rounded-lg p-3">
                                <span className="text-[11px] text-slate-400">Return Rate</span>
                                <span className={`text-sm font-bold ${summary.return_rate > 10 ? 'text-red-400' : summary.return_rate > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    {summary.return_rate}%
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Transaction Type Counts ── */}
            {summary && summary.transaction_type_counts && Object.keys(summary.transaction_type_counts).length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                    {Object.entries(summary.transaction_type_counts).map(([type, count]) => {
                        const colors: Record<string, string> = {
                            Order: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                            Refund: 'bg-red-500/10 text-red-400 border-red-500/20',
                            ShippingServices: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                            ServiceFee: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
                            Adjustment: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                            Chargeback: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
                            Retrocharge: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
                        };
                        return (
                            <span key={type} className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-full border ${colors[type] || 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                                {type}: <span className="font-bold">{count}</span>
                            </span>
                        );
                    })}
                </div>
            )}

            {/* ── Tabs ── */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
                {TABS.map(t => {
                    const Icon = t.icon;
                    return (
                        <button
                            key={t.key}
                            onClick={() => { setActiveTab(t.key); setCurrentPage(1); }}
                            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg transition-all ${activeTab === t.key
                                ? 'bg-indigo-500/20 text-indigo-400 shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            <Icon size={14} />
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* ── Filters & Search (for Orders tab) ── */}
            {activeTab === 'orders' && (
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Search */}
                    <div className="relative flex-1 max-w-xs">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                        <input
                            type="text"
                            placeholder="Search order ID, SKU, ASIN, product..."
                            value={search}
                            onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
                            className="w-full pl-9 pr-3 py-2 text-sm bg-white/5 border border-white/10 rounded-xl text-slate-300 outline-none focus:border-indigo-500/30 placeholder:text-slate-600"
                        />
                    </div>

                    {/* Status Filter */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                        <Filter size={12} className="text-slate-500 ml-2 mr-1" />
                        {STATUS_FILTERS.map(f => (
                            <button
                                key={f.key}
                                onClick={() => { setStatusFilter(f.key); setCurrentPage(1); }}
                                className={`px-2 py-1.5 text-[10px] font-medium rounded-lg transition-all ${statusFilter === f.key
                                    ? 'bg-indigo-500/20 text-indigo-400'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {/* Transaction Type Filter */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                        <Zap size={12} className="text-slate-500 ml-2 mr-1" />
                        {TXN_TYPE_FILTERS.slice(0, 5).map(f => (
                            <button
                                key={f.key}
                                onClick={() => { setTxnTypeFilter(f.key); setCurrentPage(1); }}
                                className={`px-2 py-1.5 text-[10px] font-medium rounded-lg transition-all ${txnTypeFilter === f.key
                                    ? 'bg-indigo-500/20 text-indigo-400'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {f.label}
                            </button>
                        ))}
                    </div>

                    {pagination && (
                        <span className="text-xs text-slate-500 ml-auto">
                            {pagination.totalRecords} records · Page {pagination.page} of {pagination.totalPages}
                        </span>
                    )}
                </div>
            )}

            {/* ── Error ── */}
            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
                    Error: {error}
                </div>
            )}

            {/* ── Loading ── */}
            {loading && (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-400 mr-3" />
                    Calculating revenue...
                </div>
            )}

            {/* ══════════════════════════════════════════════════════════════ */}
            {/* TAB CONTENT                                                    */}
            {/* ══════════════════════════════════════════════════════════════ */}

            {!loading && activeTab === 'orders' && records.length > 0 && (
                <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
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
                        {sortedRecords.map((r: OrderRevenueRecord) => {
                            const key = `${r.order_id}|${r.sku}`;
                            const isExpanded = expandedRow === key;
                            const calc = r.calculations;

                            return (
                                <div key={key}>
                                    <div
                                        className="grid grid-cols-[2.5fr_0.6fr_1fr_1fr_0.8fr_0.8fr_1fr_1fr_0.8fr_0.9fr] gap-2 px-4 py-3 items-center hover:bg-white/[0.02] cursor-pointer border-b border-white/[0.03] transition-colors"
                                        onClick={() => setExpandedRow(isExpanded ? null : key)}
                                    >
                                        <div className="flex items-center gap-2 min-w-0">
                                            {isExpanded ? <ChevronUp size={12} className="text-slate-500 shrink-0" /> : <ChevronDown size={12} className="text-slate-500 shrink-0" />}
                                            <div className="min-w-0">
                                                <p className="text-xs font-mono text-slate-300 truncate">{r.order_id}</p>
                                                <p className="text-[10px] text-slate-600 truncate">{r.sku} · {r.product_name}</p>
                                            </div>
                                        </div>
                                        <div className="text-center text-xs text-slate-300">{r.quantity}</div>
                                        <div className="text-right text-xs font-medium text-emerald-400">
                                            {formatExact(calc.gross_revenue)}
                                        </div>
                                        <div className="text-right text-xs font-medium text-red-400">
                                            {calc.total_fees > 0 ? formatExact(calc.total_fees) : '—'}
                                        </div>
                                        <div className="text-right text-xs text-orange-400">
                                            {r.taxes.total > 0 ? formatExact(r.taxes.total) : '—'}
                                        </div>
                                        <div className="text-right text-xs text-amber-400">
                                            {r.return_details.total_refund_impact > 0 ? formatExact(r.return_details.total_refund_impact) : '—'}
                                        </div>
                                        <div className={`text-right text-xs font-bold ${calc.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {formatExact(calc.net_settlement)}
                                        </div>
                                        <div className="text-center">
                                            <StatusBadge status={r.order_status} returnType={r.return_details.return_type} />
                                        </div>
                                        <div className="text-center">
                                            <FinancialStatusBadge status={r.financial_status} />
                                        </div>
                                        <div className="text-center">
                                            <TxnTypeBadge types={r.transaction_types} />
                                        </div>
                                    </div>

                                    {/* Expanded Detail Panel */}
                                    {isExpanded && <OrderDetailPanel record={r} />}
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
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={pagination.page <= 1}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-all"
                                >
                                    <ChevronLeft size={12} /> Prev
                                </button>
                                <span className="text-xs text-slate-400 tabular-nums">
                                    {pagination.page} / {pagination.totalPages}
                                </span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(pagination.totalPages, p + 1))}
                                    disabled={pagination.page >= pagination.totalPages}
                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-400 hover:text-white disabled:opacity-30 transition-all"
                                >
                                    Next <ChevronRight size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── SKU Performance Tab ── */}
            {!loading && activeTab === 'sku-summary' && (
                <SKUPerformancePanel data={data?.sku_summary || []} />
            )}

            {/* ── Waterfall Tab ── */}
            {!loading && activeTab === 'waterfall' && (
                <div className="space-y-6">
                    <RevenueWaterfallChart data={data?.waterfall || []} />

                    {/* Formula Reference */}
                    {summary && (
                        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5">
                            <h3 className="text-sm font-semibold text-white mb-3">Revenue Calculation Formula</h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 font-mono text-[11px] space-y-1">
                                    <p className="text-emerald-400 font-semibold mb-2">Gross Revenue</p>
                                    <p className="text-slate-400">  Product Sales    {formatExact(summary.total_product_sales)}</p>
                                    <p className="text-slate-400">+ Shipping Credits {formatExact(summary.total_shipping_credits)}</p>
                                    <p className="text-slate-400">+ Gift Wrap        {formatExact(summary.total_gift_wrap)}</p>
                                    <p className="text-emerald-400 border-t border-white/5 pt-1 font-semibold">= {formatExact(summary.gross_revenue)}</p>
                                </div>
                                <div className="bg-white/[0.02] border border-white/5 rounded-xl p-4 font-mono text-[11px] space-y-1">
                                    <p className="text-red-400 font-semibold mb-2">Total Deductions</p>
                                    <p className="text-slate-400">  Amazon Fees      {formatExact(summary.total_amazon_fees)}</p>
                                    <p className="text-slate-400">+ Other Charges    {formatExact(summary.total_other_charges)}</p>
                                    <p className="text-slate-400">+ Taxes            {formatExact(summary.total_taxes)}</p>
                                    <p className="text-slate-400">+ Promotions       {formatExact(Math.abs(summary.total_promotional_rebates))}</p>
                                    <p className="text-slate-400">+ Refund Impact    {formatExact(summary.total_refund_impact)}</p>
                                    <p className="text-slate-400">+ Ad Spend         {formatExact(summary.total_ad_spend)}</p>
                                    <p className="text-red-400 border-t border-white/5 pt-1 font-semibold">
                                        = {formatExact(summary.total_amazon_fees + summary.total_other_charges + summary.total_taxes + Math.abs(summary.total_promotional_rebates) + summary.total_refund_impact + summary.total_ad_spend)}
                                    </p>
                                </div>
                            </div>
                            <div className="mt-4 bg-indigo-500/5 border border-indigo-500/10 rounded-xl p-4 text-center">
                                <p className="text-xs text-slate-400">Net Settlement Amount (Exact Revenue Credited to Seller)</p>
                                <p className={`text-2xl font-bold mt-1 ${summary.net_settlement >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {formatExact(summary.net_settlement)}
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* ── Settlements Tab ── */}
            {!loading && activeTab === 'settlements' && (
                <SettlementTimeline data={data?.settlements || []} onSync={handleSettlementSync} />
            )}

            {/* Empty State */}
            {!loading && activeTab === 'orders' && records.length === 0 && !error && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <Calculator size={48} className="text-slate-700 mb-4" />
                    <h2 className="text-lg font-semibold text-white mb-2">No Revenue Data</h2>
                    <p className="text-sm text-slate-500 mb-4 max-w-md">
                        {search || statusFilter !== 'all' || txnTypeFilter !== 'all'
                            ? 'No records match your current filters. Try adjusting your search, status, or transaction type filter.'
                            : 'Sync your Amazon data from the Command Center to populate revenue calculations.'}
                    </p>
                    <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 max-w-lg text-left">
                        <p className="text-[11px] text-slate-500 uppercase tracking-wider mb-2">Supported Transaction Types</p>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="flex items-center gap-2">
                                <ShoppingCart size={12} className="text-emerald-400" />
                                <span className="text-slate-400">Order — Revenue + Fees</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <RotateCcw size={12} className="text-red-400" />
                                <span className="text-slate-400">Refund — Reverses order</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Truck size={12} className="text-blue-400" />
                                <span className="text-slate-400">Shipping Services</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <Zap size={12} className="text-violet-400" />
                                <span className="text-slate-400">Service Fee — Ads, storage</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <ArrowLeftRight size={12} className="text-amber-400" />
                                <span className="text-slate-400">Adjustment — Corrections</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <AlertTriangle size={12} className="text-orange-400" />
                                <span className="text-slate-400">Chargeback — Disputes</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="text-center py-4 border-t border-white/5">
                <p className="text-xs text-slate-600">
                    Revenue Calculator · Per-Order/SKU Net Revenue · Orders + Finances + Settlement APIs ·
                    Supports Order, Refund, Shipping Services, Service Fee, Adjustment, Chargeback, Retrocharge
                </p>
            </div>
        </DashboardLayout>
    );
}

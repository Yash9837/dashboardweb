'use client';
import { useMemo, useState } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Cell,
} from 'recharts';
import {
    Lock, TrendingUp, PackageCheck, Wallet,
    ChevronDown, ChevronUp, Search, CheckCircle2,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ClosedOrder {
    order_id: string;
    sku: string;
    delivery_date: string;
    settlement_date: string;
    posted_date: string | null;
    gross_amount: number;
    fees: number;
    refund_amount: number;
    net_settled: number;
    status: 'CLOSED';
}

interface ClosedSummary {
    total_closed_revenue: number;
    total_closed_orders: number;
    total_fees_on_closed: number;
    total_refunds_on_closed: number;
    net_settled_revenue: number;
    cutoff_date: string;
}

interface MonthlyBucket {
    month: string;
    month_key: string;
    revenue: number;
    orders: number;
    net: number;
}

interface Props {
    summary: ClosedSummary;
    monthly: MonthlyBucket[];
    orders: ClosedOrder[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
    if (n >= 10_00_000) return `₹${(n / 10_00_000).toFixed(2)}Cr`;
    if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)}L`;
    if (n >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`;
    return `₹${n.toLocaleString('en-IN')}`;
}

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

type SortKey = 'settlement_date' | 'gross_amount' | 'net_settled' | 'refund_amount';

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ClosedSettlementDashboard({ summary, monthly, orders }: Props) {
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState<SortKey>('settlement_date');
    const [sortAsc, setSortAsc] = useState(false);
    const [page, setPage] = useState(0);
    const PAGE_SIZE = 15;

    // Filter + sort
    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        const list = q
            ? orders.filter(o =>
                o.order_id.toLowerCase().includes(q) ||
                o.sku.toLowerCase().includes(q)
            )
            : orders;

        return [...list].sort((a, b) => {
            const va = a[sortKey] ?? '';
            const vb = b[sortKey] ?? '';
            if (va < vb) return sortAsc ? -1 : 1;
            if (va > vb) return sortAsc ? 1 : -1;
            return 0;
        });
    }, [orders, search, sortKey, sortAsc]);

    const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
    const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    function toggleSort(key: SortKey) {
        if (sortKey === key) setSortAsc(p => !p);
        else { setSortKey(key); setSortAsc(false); }
    }

    const SortIcon = ({ k }: { k: SortKey }) =>
        sortKey === k
            ? sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />
            : <ChevronDown size={11} className="opacity-20" />;

    // ── KPI hero cards ──────────────────────────────────────────────────────
    const heroCards = [
        {
            label: 'Total Settled Revenue',
            value: fmt(summary.total_closed_revenue),
            sub: `${summary.total_closed_orders} closed orders`,
            icon: <TrendingUp size={18} />,
            accent: 'from-emerald-500/20 to-emerald-600/5',
            dot: 'bg-emerald-400',
            border: 'border-emerald-500/20',
        },
        {
            label: 'Net Settled (After Fees)',
            value: fmt(summary.net_settled_revenue),
            sub: `Fees deducted: ${fmt(summary.total_fees_on_closed)}`,
            icon: <Wallet size={18} />,
            accent: 'from-indigo-500/20 to-indigo-600/5',
            dot: 'bg-indigo-400',
            border: 'border-indigo-500/20',
        },
        {
            label: 'Closed Orders',
            value: summary.total_closed_orders.toLocaleString('en-IN'),
            sub: `Refunded: ${fmt(summary.total_refunds_on_closed)}`,
            icon: <PackageCheck size={18} />,
            accent: 'from-violet-500/20 to-violet-600/5',
            dot: 'bg-violet-400',
            border: 'border-violet-500/20',
        },
    ];

    const isEmpty = orders.length === 0;

    return (
        <div className="space-y-6">
            {/* ── Section Header ─────────────────────────────────────────── */}
            <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                    <Lock size={16} className="text-emerald-400" />
                </div>
                <div>
                    <h2 className="text-base font-bold text-white tracking-tight">
                        Closed Settlement — Locked Revenue
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Orders where <span className="text-slate-400 font-medium">DeliveryDate + 30 days &lt; Today</span> · Return window permanently closed · Revenue irreversibly settled
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <CheckCircle2 size={12} className="text-emerald-400" />
                    <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">
                        Settled as of {fmtDate(summary.cutoff_date)}
                    </span>
                </div>
            </div>

            {/* ── Hero KPI Cards ─────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {heroCards.map((c) => (
                    <div
                        key={c.label}
                        className={`relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br ${c.accent} border ${c.border} backdrop-blur-sm`}
                    >
                        <div className={`absolute top-3 right-3 w-2 h-2 rounded-full ${c.dot} opacity-60`} />
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-slate-400">{c.icon}</span>
                            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{c.label}</p>
                        </div>
                        <p className="text-2xl font-bold text-white tracking-tight mb-1">{c.value}</p>
                        <p className="text-xs text-slate-500">{c.sub}</p>
                        <div className="absolute bottom-3 right-3">
                            <span className="text-[10px] font-semibold uppercase tracking-widest text-emerald-500/50">CLOSED</span>
                        </div>
                    </div>
                ))}
            </div>

            {/* ── Monthly Bar Chart ──────────────────────────────────────── */}
            {monthly.length > 0 && (
                <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
                    <h3 className="text-sm font-semibold text-white mb-1">Settlement by Month</h3>
                    <p className="text-xs text-slate-500 mb-5">Gross settled revenue · grouped by settlement date (DeliveryDate + 30 days)</p>
                    <div className="h-[220px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={monthly} barCategoryGap="35%">
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
                                <XAxis
                                    dataKey="month"
                                    tick={{ fontSize: 11, fill: '#64748b' }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    tick={{ fontSize: 10, fill: '#64748b' }}
                                    axisLine={false}
                                    tickLine={false}
                                    tickFormatter={(v) =>
                                        v >= 100000 ? `${(v / 100000).toFixed(0)}L`
                                            : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
                                />
                                <Tooltip
                                    cursor={{ fill: 'rgba(255,255,255,0.03)' }}
                                    contentStyle={{
                                        background: '#1e293b',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: '12px',
                                        color: '#e2e8f0',
                                        fontSize: '12px',
                                    }}
                                    formatter={(value: any, name?: string) => [
                                        `₹${Number(value).toLocaleString('en-IN')}`,
                                        name === 'revenue' ? 'Gross Revenue' : 'Net Settled',
                                    ]}
                                />
                                <Bar dataKey="revenue" radius={[6, 6, 0, 0]} maxBarSize={40} name="Revenue">
                                    {monthly.map((_, i) => (
                                        <Cell key={i} fill="#22c55e" fillOpacity={0.7} />
                                    ))}
                                </Bar>
                                <Bar dataKey="net" radius={[6, 6, 0, 0]} maxBarSize={40} name="Net">
                                    {monthly.map((_, i) => (
                                        <Cell key={i} fill="#6366f1" fillOpacity={0.7} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    {/* Legend */}
                    <div className="flex items-center gap-5 mt-3 justify-end">
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500/70" />
                            <span className="text-[11px] text-slate-400">Gross Revenue</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm bg-indigo-500/70" />
                            <span className="text-[11px] text-slate-400">Net Settled</span>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Orders Table ───────────────────────────────────────────── */}
            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
                {/* Table header */}
                <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-white/[0.06]">
                    <div>
                        <h3 className="text-sm font-semibold text-white">Closed Orders</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{filtered.length} orders · {fmt(summary.total_closed_revenue)} locked</p>
                    </div>
                    {/* Search */}
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2 w-56">
                        <Search size={13} className="text-slate-500 shrink-0" />
                        <input
                            type="text"
                            placeholder="Search order ID, SKU..."
                            value={search}
                            onChange={e => { setSearch(e.target.value); setPage(0); }}
                            className="bg-transparent text-xs text-slate-300 placeholder-slate-600 outline-none w-full"
                        />
                    </div>
                </div>

                {isEmpty ? (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                        <PackageCheck size={40} className="text-slate-700 mb-3" />
                        <p className="text-sm font-medium text-slate-400">No closed orders yet</p>
                        <p className="text-xs text-slate-600 mt-1 max-w-xs">
                            Orders appear here once their delivery date is more than 30 days in the past. Sync your Amazon data to populate.
                        </p>
                    </div>
                ) : (
                    <>
                        {/* Table */}
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead>
                                    <tr className="border-b border-white/[0.04]">
                                        {[
                                            { label: 'Order ID', key: null, cls: 'pl-6' },
                                            { label: 'SKU', key: null, cls: '' },
                                            { label: 'Delivered', key: 'settlement_date' as SortKey, cls: '' },
                                            { label: 'Settlement Date', key: 'settlement_date' as SortKey, cls: '' },
                                            { label: 'Gross', key: 'gross_amount' as SortKey, cls: 'text-right' },
                                            { label: 'Fees', key: null, cls: 'text-right' },
                                            { label: 'Refund', key: 'refund_amount' as SortKey, cls: 'text-right' },
                                            { label: 'Net Settled', key: 'net_settled' as SortKey, cls: 'text-right pr-6' },
                                            { label: 'Status', key: null, cls: 'text-center' },
                                        ].map((col) => (
                                            <th
                                                key={col.label}
                                                onClick={() => col.key && toggleSort(col.key)}
                                                className={`py-3 px-3 font-semibold text-slate-500 uppercase tracking-wider text-[10px] whitespace-nowrap ${col.cls} ${col.key ? 'cursor-pointer hover:text-slate-300 transition-colors select-none' : ''}`}
                                            >
                                                <span className="flex items-center gap-1 justify-start">
                                                    {col.label}
                                                    {col.key && <SortIcon k={col.key} />}
                                                </span>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((o, i) => (
                                        <tr
                                            key={`${o.order_id}-${i}`}
                                            className="border-b border-white/[0.03] hover:bg-white/[0.025] transition-colors group"
                                        >
                                            {/* Order ID */}
                                            <td className="py-3 pl-6 pr-3">
                                                <span className="font-mono text-[11px] text-slate-400 group-hover:text-slate-300 transition-colors">
                                                    {o.order_id.length > 19 ? o.order_id.slice(0, 19) + '…' : o.order_id}
                                                </span>
                                            </td>
                                            {/* SKU */}
                                            <td className="py-3 px-3">
                                                <span className="font-medium text-slate-300">{o.sku}</span>
                                            </td>
                                            {/* Delivered */}
                                            <td className="py-3 px-3 text-slate-400 whitespace-nowrap">{fmtDate(o.delivery_date)}</td>
                                            {/* Settlement Date */}
                                            <td className="py-3 px-3 whitespace-nowrap">
                                                <span className="text-emerald-400 font-medium">{fmtDate(o.settlement_date)}</span>
                                            </td>
                                            {/* Gross */}
                                            <td className="py-3 px-3 text-right font-medium text-white tabular-nums">{fmt(o.gross_amount)}</td>
                                            {/* Fees */}
                                            <td className="py-3 px-3 text-right text-red-400/80 tabular-nums">
                                                {o.fees > 0 ? `−${fmt(o.fees)}` : '—'}
                                            </td>
                                            {/* Refund */}
                                            <td className="py-3 px-3 text-right text-amber-400/80 tabular-nums">
                                                {o.refund_amount > 0 ? `−${fmt(o.refund_amount)}` : '—'}
                                            </td>
                                            {/* Net Settled */}
                                            <td className="py-3 pl-3 pr-6 text-right font-bold tabular-nums">
                                                <span className={o.net_settled >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                                                    {fmt(o.net_settled)}
                                                </span>
                                            </td>
                                            {/* Status */}
                                            <td className="py-3 px-3 text-center">
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[10px] font-semibold text-emerald-400 uppercase tracking-wider">
                                                    <Lock size={8} />
                                                    Closed
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {pageCount > 1 && (
                            <div className="flex items-center justify-between px-6 py-3 border-t border-white/[0.04]">
                                <p className="text-xs text-slate-500">
                                    Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                                </p>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setPage(p => Math.max(0, p - 1))}
                                        disabled={page === 0}
                                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-white/5 border border-white/10 rounded-lg disabled:opacity-30 transition-all"
                                    >
                                        ← Prev
                                    </button>
                                    {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => {
                                        const pg = pageCount <= 5 ? i : Math.max(0, Math.min(page - 2, pageCount - 5)) + i;
                                        return (
                                            <button
                                                key={pg}
                                                onClick={() => setPage(pg)}
                                                className={`w-8 h-7 text-xs rounded-lg border transition-all ${pg === page
                                                    ? 'bg-indigo-500/20 border-indigo-500/30 text-indigo-400'
                                                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'
                                                    }`}
                                            >{pg + 1}</button>
                                        );
                                    })}
                                    <button
                                        onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                                        disabled={page >= pageCount - 1}
                                        className="px-3 py-1.5 text-xs text-slate-400 hover:text-white bg-white/5 border border-white/10 rounded-lg disabled:opacity-30 transition-all"
                                    >
                                        Next →
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

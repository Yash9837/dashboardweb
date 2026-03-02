'use client';
import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import { ArrowLeft, AlertTriangle, Info, TrendingDown, ChevronDown, ChevronUp, Search, Calendar } from 'lucide-react';
import Link from 'next/link';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

const PERIODS = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
];

function formatCurrency(n: number): string {
    const abs = Math.abs(n);
    const formatted = abs >= 100000
        ? `₹${(abs / 100000).toFixed(1)}L`
        : abs >= 1000
            ? `₹${(abs / 1000).toFixed(1)}K`
            : `₹${abs.toFixed(0)}`;
    return n < 0 ? `-${formatted}` : formatted;
}

function formatExact(n: number): string {
    return `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const SEVERITY_STYLES = {
    info: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', icon: Info },
    warning: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', icon: AlertTriangle },
    critical: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', icon: TrendingDown },
};

export default function FinancialDetailsPage() {
    const [period, setPeriod] = useState('30d');
    const [customStart, setCustomStart] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
    const [useCustom, setUseCustom] = useState(false);
    const [skuSearch, setSkuSearch] = useState('');
    const [expandedSku, setExpandedSku] = useState<string | null>(null);
    const [expandedDay, setExpandedDay] = useState<string | null>(null);
    const [feeSkuSearch, setFeeSkuSearch] = useState('');

    const dateQuery = useMemo(() => {
        if (useCustom) return `startDate=${customStart}&endDate=${customEnd}`;
        return `period=${period}`;
    }, [useCustom, period, customStart, customEnd]);

    const { data, loading, error } = useFetch<any>(
        `/api/command-center/financial-details?${dateQuery}`, [dateQuery]
    );

    const filteredSkus = useMemo(() => {
        if (!data?.sku_breakdown) return [];
        if (!skuSearch) return data.sku_breakdown;
        const q = skuSearch.toLowerCase();
        return data.sku_breakdown.filter((s: any) =>
            s.sku.toLowerCase().includes(q) || s.title.toLowerCase().includes(q)
        );
    }, [data?.sku_breakdown, skuSearch]);

    return (
        <DashboardLayout>
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/command-center"
                    className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-400 hover:text-white hover:border-white/20 transition-all">
                    <ArrowLeft size={14} />
                    Back
                </Link>
                <div>
                    <h1 className="text-xl font-bold text-white">Financial Deep Dive</h1>
                    <p className="text-xs text-slate-500 mt-0.5">
                        Detailed breakdown of every fee, refund, and revenue event
                        {data?.period && ` · ${data.period.start} to ${data.period.end}`}
                    </p>
                </div>
            </div>

            {/* Period Controls */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                    {PERIODS.map(p => (
                        <button key={p.key}
                            onClick={() => { setPeriod(p.key); setUseCustom(false); }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${!useCustom && period === p.key
                                ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                            {p.label}
                        </button>
                    ))}
                    <button onClick={() => setUseCustom(true)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${useCustom
                            ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                        Custom
                    </button>
                </div>
                {useCustom && (
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
                        <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                            className="bg-transparent text-xs text-slate-300 border-none outline-none [color-scheme:dark]" />
                        <span className="text-slate-500 text-xs">→</span>
                        <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                            className="bg-transparent text-xs text-slate-300 border-none outline-none [color-scheme:dark]" />
                    </div>
                )}
                {data && (
                    <span className="text-xs text-slate-500">{data.total_events} events</span>
                )}
            </div>

            {loading && (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-400 mr-3" />
                    Loading financial data...
                </div>
            )}

            {error && <div className="text-red-400 text-sm py-4">Error: {error}</div>}

            {data && !loading && (
                <div className="space-y-6">
                    {/* ── Root Cause Insights ── */}
                    {data.insights?.length > 0 && (
                        <div className="space-y-3">
                            <h2 className="text-sm font-semibold text-white uppercase tracking-wider mb-2">📊 Root Cause Insights</h2>
                            {data.insights.map((insight: any, i: number) => {
                                const s = SEVERITY_STYLES[insight.severity as keyof typeof SEVERITY_STYLES] || SEVERITY_STYLES.info;
                                const Icon = s.icon;
                                return (
                                    <div key={i} className={`${s.bg} border ${s.border} rounded-xl p-5`}>
                                        <div className="flex gap-3 mb-3">
                                            <Icon size={18} className={`${s.text} shrink-0 mt-0.5`} />
                                            <p className={`text-sm font-semibold ${s.text}`}>{insight.title}</p>
                                        </div>
                                        <p className="text-xs text-slate-300 leading-relaxed mb-3">{insight.reason}</p>
                                        {insight.details?.length > 0 && (
                                            <div className="bg-black/20 rounded-lg p-3 space-y-1.5">
                                                {insight.details.map((d: any, j: number) => (
                                                    <div key={j} className="flex items-start justify-between gap-2">
                                                        <span className="text-[11px] text-slate-400 min-w-0 break-words">{d.label}</span>
                                                        <span className="text-[11px] font-medium text-slate-200 shrink-0">{d.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* ── Category Summary ── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                            { key: 'shipment', label: 'Gross Revenue', color: 'emerald' },
                            { key: 'fee', label: 'Amazon Fees', color: 'red' },
                            { key: 'refund', label: 'Refunds', color: 'amber' },
                            { key: 'adjustment', label: 'Adjustments', color: 'blue' },
                        ].map(cat => {
                            const d = data.summary[cat.key];
                            return (
                                <div key={cat.key} className={`bg-white/[0.03] border border-white/10 rounded-xl p-4`}>
                                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{cat.label}</p>
                                    <p className={`text-xl font-bold mt-1 ${d ? (d.total >= 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-600'}`}>
                                        {d ? formatExact(d.total) : '₹0.00'}
                                    </p>
                                    <p className="text-[10px] text-slate-500 mt-1">{d?.count || 0} events</p>
                                </div>
                            );
                        })}
                    </div>

                    {/* ── Fee Type Breakdown ── */}
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                        <h2 className="text-sm font-semibold text-white mb-4">Fee Type Breakdown</h2>
                        <div className="space-y-2">
                            {Object.entries(data.fee_breakdown || {}).sort((a: any, b: any) => a[1].total - b[1].total).map(([type, info]: any) => {
                                const pct = data.summary?.shipment?.total
                                    ? Math.round(Math.abs(info.total) / data.summary.shipment.total * 100)
                                    : 0;
                                return (
                                    <div key={type} className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
                                        <div className="flex items-center justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm font-medium text-white">{type}</span>
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-red-500/10 text-red-400 rounded-full">
                                                        {pct}% of revenue
                                                    </span>
                                                </div>
                                                <p className="text-[11px] text-slate-500 mt-0.5">{info.description}</p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-sm font-semibold text-red-400">{formatExact(info.total)}</p>
                                                <p className="text-[10px] text-slate-500">{info.count} events</p>
                                            </div>
                                        </div>
                                        {/* Visual bar */}
                                        <div className="mt-2 h-1 bg-white/5 rounded-full overflow-hidden">
                                            <div className="h-full bg-red-500/40 rounded-full"
                                                style={{ width: `${Math.min(100, pct)}%` }} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* ── MFNPostageFee per-SKU Summary ── */}
                    {data.mfn_postage_by_sku?.length > 0 && (
                        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                            <div className="mb-4">
                                <h2 className="text-sm font-semibold text-white">📦 FBM Postage (MFNPostageFee) by SKU</h2>
                                <p className="text-[10px] text-slate-500 mt-0.5">
                                    Total shipping label costs per SKU — sorted by highest postage spend
                                </p>
                            </div>

                            {/* Table Header */}
                            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-white/5">
                                <div className="col-span-4">SKU</div>
                                <div className="col-span-2 text-right">Postage Total</div>
                                <div className="col-span-1 text-right">Events</div>
                                <div className="col-span-1 text-right">Units</div>
                                <div className="col-span-2 text-right">Per Unit</div>
                                <div className="col-span-2 text-right">% of Rev</div>
                            </div>

                            {/* Rows */}
                            <div className="max-h-[400px] overflow-y-auto">
                                {data.mfn_postage_by_sku.map((s: any) => {
                                    const maxPostage = data.mfn_postage_by_sku[0]?.postage_total || 1;
                                    const barWidth = Math.min(100, (s.postage_total / maxPostage) * 100);
                                    return (
                                        <div key={s.sku} className="border-b border-white/[0.03]">
                                            <div className="grid grid-cols-12 gap-2 px-3 py-2.5 items-center hover:bg-white/[0.02] transition-colors">
                                                <div className="col-span-4 min-w-0">
                                                    <p className="text-xs font-mono text-slate-300 truncate">{s.sku}</p>
                                                    <p className="text-[10px] text-slate-600 truncate">{s.title}</p>
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    <span className="text-xs font-semibold text-orange-400">
                                                        ₹{s.postage_total.toLocaleString('en-IN')}
                                                    </span>
                                                </div>
                                                <div className="col-span-1 text-right text-xs text-slate-400">{s.event_count}</div>
                                                <div className="col-span-1 text-right text-xs text-slate-400">{s.units || '—'}</div>
                                                <div className="col-span-2 text-right">
                                                    <span className="text-xs text-slate-300">
                                                        {s.postage_per_unit > 0 ? `₹${s.postage_per_unit.toLocaleString('en-IN')}` : '—'}
                                                    </span>
                                                </div>
                                                <div className="col-span-2 text-right">
                                                    <span className={`text-xs font-medium ${s.pct_of_revenue > 15 ? 'text-red-400' : s.pct_of_revenue > 8 ? 'text-amber-400' : 'text-slate-300'}`}>
                                                        {s.pct_of_revenue > 0 ? `${s.pct_of_revenue}%` : '—'}
                                                    </span>
                                                </div>
                                            </div>
                                            {/* Visual bar */}
                                            <div className="mx-3 mb-1 h-0.5 bg-white/5 rounded-full overflow-hidden">
                                                <div className="h-full bg-orange-500/40 rounded-full transition-all"
                                                    style={{ width: `${barWidth}%` }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Totals Row */}
                            <div className="grid grid-cols-12 gap-2 px-3 py-3 items-center border-t-2 border-orange-500/20 bg-white/[0.03] mt-1">
                                <div className="col-span-4 text-xs font-bold text-white uppercase tracking-wider">
                                    Total ({data.mfn_postage_by_sku.length} SKUs)
                                </div>
                                <div className="col-span-2 text-right text-xs font-bold text-orange-400">
                                    ₹{data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.postage_total, 0).toLocaleString('en-IN')}
                                </div>
                                <div className="col-span-1 text-right text-xs font-bold text-white">
                                    {data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.event_count, 0)}
                                </div>
                                <div className="col-span-1 text-right text-xs font-bold text-white">
                                    {data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.units, 0)}
                                </div>
                                <div className="col-span-2 text-right text-xs font-bold text-slate-300">
                                    {(() => {
                                        const totalUnits = data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.units, 0);
                                        const totalPostage = data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.postage_total, 0);
                                        return totalUnits > 0 ? `₹${Math.round(totalPostage / totalUnits * 100 / 100).toLocaleString('en-IN')} avg` : '—';
                                    })()}
                                </div>
                                <div className="col-span-2 text-right text-xs font-bold text-slate-300">
                                    {(() => {
                                        const totalRev = data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.revenue, 0);
                                        const totalPostage = data.mfn_postage_by_sku.reduce((s: number, r: any) => s + r.postage_total, 0);
                                        return totalRev > 0 ? `${Math.round(totalPostage / totalRev * 10000) / 100}%` : '—';
                                    })()}
                                </div>
                            </div>
                        </div>
                    )}
                    {data.fee_by_day_sku?.length > 0 && (
                        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <h2 className="text-sm font-semibold text-white">Amazon Fees by Day & SKU</h2>
                                    <p className="text-[10px] text-slate-500 mt-0.5">Click a day to see which SKUs incurred fees and the exact fee types</p>
                                </div>
                                <div className="relative">
                                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                    <input type="text" placeholder="Filter SKU..."
                                        value={feeSkuSearch} onChange={e => setFeeSkuSearch(e.target.value)}
                                        className="pl-7 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-300 outline-none focus:border-indigo-500/30 w-36" />
                                </div>
                            </div>

                            <div className="space-y-1 max-h-[600px] overflow-y-auto">
                                {data.fee_by_day_sku.map((day: any) => {
                                    const filteredDaySkus = feeSkuSearch
                                        ? day.skus.filter((s: any) => s.sku.toLowerCase().includes(feeSkuSearch.toLowerCase()) || s.title.toLowerCase().includes(feeSkuSearch.toLowerCase()))
                                        : day.skus;
                                    if (feeSkuSearch && filteredDaySkus.length === 0) return null;
                                    const isExpanded = expandedDay === day.date;
                                    return (
                                        <div key={day.date}>
                                            <div
                                                className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-white/[0.03] cursor-pointer transition-colors"
                                                onClick={() => setExpandedDay(isExpanded ? null : day.date)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    {isExpanded ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
                                                    <Calendar size={14} className="text-slate-500" />
                                                    <span className="text-sm font-medium text-white">{day.date}</span>
                                                    <span className="text-[10px] text-slate-500">{filteredDaySkus.length} SKUs</span>
                                                </div>
                                                <span className="text-sm font-semibold text-red-400">₹{day.total.toLocaleString('en-IN')}</span>
                                            </div>

                                            {isExpanded && (
                                                <div className="ml-8 border-l-2 border-red-500/20 space-y-0.5 pb-2">
                                                    {filteredDaySkus.map((sku: any) => (
                                                        <div key={sku.sku} className="pl-4 py-2 hover:bg-white/[0.02] rounded-r-lg transition-colors">
                                                            <div className="flex items-center justify-between mb-1">
                                                                <div className="min-w-0 flex-1">
                                                                    <p className="text-xs font-mono text-slate-300 truncate">{sku.sku}</p>
                                                                    <p className="text-[10px] text-slate-600 truncate">{sku.title}</p>
                                                                </div>
                                                                <span className="text-xs font-semibold text-red-400 shrink-0 ml-2">₹{sku.total.toLocaleString('en-IN')}</span>
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                                {Object.entries(sku.fees).sort((a: any, b: any) => b[1] - a[1]).map(([feeType, amt]: any) => (
                                                                    <span key={feeType} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 bg-red-500/10 border border-red-500/10 text-red-300 rounded-full">
                                                                        {feeType}: ₹{amt.toLocaleString('en-IN')}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* ── Daily Timeline Chart ── */}
                    {data.daily_timeline?.length > 1 && (
                        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                            <h2 className="text-sm font-semibold text-white mb-4">Daily Revenue vs Fees vs Refunds</h2>
                            <div className="h-64">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data.daily_timeline}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }}
                                            tickFormatter={(v: string) => v.slice(5)} />
                                        <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }}
                                            tickFormatter={(v: number) => `₹${Math.abs(v) >= 1000 ? (v / 1000).toFixed(0) + 'K' : v}`} />
                                        <Tooltip
                                            contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                                            formatter={(value: any, name?: string) => [`₹${Math.abs(Number(value)).toLocaleString('en-IN')}`, name || '']}
                                        />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                        <Bar dataKey="revenue" name="Revenue" fill="#34d399" radius={[2, 2, 0, 0]} />
                                        <Bar dataKey="fees" name="Fees" fill="#f87171" radius={[2, 2, 0, 0]} />
                                        <Bar dataKey="refunds" name="Refunds" fill="#fbbf24" radius={[2, 2, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* ── Per-SKU Breakdown ── */}
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-white">Per-SKU Financial Breakdown</h2>
                            <div className="relative">
                                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input
                                    type="text" placeholder="Search SKU or title..."
                                    value={skuSearch} onChange={e => setSkuSearch(e.target.value)}
                                    className="pl-7 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-300 outline-none focus:border-indigo-500/30 w-48"
                                />
                            </div>
                        </div>

                        {/* Table Header */}
                        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-white/5">
                            <div className="col-span-4">SKU / Title</div>
                            <div className="col-span-2 text-right">Revenue</div>
                            <div className="col-span-1 text-right">Units</div>
                            <div className="col-span-2 text-right">Fees</div>
                            <div className="col-span-1 text-right">Refunds</div>
                            <div className="col-span-2 text-right">Net</div>
                        </div>

                        {/* SKU Rows */}
                        <div className="max-h-[500px] overflow-y-auto">
                            {filteredSkus.map((s: any) => (
                                <div key={s.sku}>
                                    <div
                                        className="grid grid-cols-12 gap-2 px-3 py-2.5 items-center hover:bg-white/[0.02] cursor-pointer border-b border-white/[0.03] transition-colors"
                                        onClick={() => setExpandedSku(expandedSku === s.sku ? null : s.sku)}
                                    >
                                        <div className="col-span-4 flex items-center gap-2">
                                            {expandedSku === s.sku ? <ChevronUp size={12} className="text-slate-500" /> : <ChevronDown size={12} className="text-slate-500" />}
                                            <div className="min-w-0">
                                                <p className="text-xs font-mono text-slate-400 truncate">{s.sku}</p>
                                                <p className="text-[10px] text-slate-600 truncate">{s.title}</p>
                                            </div>
                                        </div>
                                        <div className="col-span-2 text-right text-xs font-medium text-emerald-400">
                                            {s.revenue > 0 ? formatExact(s.revenue) : '—'}
                                        </div>
                                        <div className="col-span-1 text-right text-xs text-slate-400">{s.units || '—'}</div>
                                        <div className="col-span-2 text-right text-xs font-medium text-red-400">
                                            {s.fees !== 0 ? formatExact(s.fees) : '—'}
                                        </div>
                                        <div className="col-span-1 text-right text-xs text-amber-400">
                                            {s.refunds !== 0 ? formatExact(Math.abs(s.refunds)) : '—'}
                                        </div>
                                        <div className={`col-span-2 text-right text-xs font-semibold ${s.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                            {formatExact(s.net)}
                                        </div>
                                    </div>

                                    {/* Expanded Detail */}
                                    {expandedSku === s.sku && (
                                        <div className="bg-white/[0.02] border-l-2 border-indigo-500/30 px-5 py-3 text-xs space-y-1">
                                            <div className="flex justify-between text-slate-400">
                                                <span>Gross Revenue</span>
                                                <span className="text-emerald-400">{formatExact(s.revenue)}</span>
                                            </div>
                                            <div className="flex justify-between text-slate-400">
                                                <span>Amazon Fees</span>
                                                <span className="text-red-400">{formatExact(s.fees)}</span>
                                            </div>
                                            <div className="flex justify-between text-slate-400">
                                                <span>Refunds</span>
                                                <span className="text-amber-400">{formatExact(s.refunds)}</span>
                                            </div>
                                            <div className="border-t border-white/5 pt-1 flex justify-between font-semibold">
                                                <span className="text-slate-300">Net after Fees & Refunds</span>
                                                <span className={s.net >= 0 ? 'text-emerald-400' : 'text-red-400'}>{formatExact(s.net)}</span>
                                            </div>
                                            {s.revenue > 0 && (
                                                <div className="flex justify-between text-slate-500 pt-1">
                                                    <span>Fee % of Revenue</span>
                                                    <span>{Math.round(Math.abs(s.fees) / s.revenue * 100)}%</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {filteredSkus.length === 0 && (
                            <p className="text-center text-slate-500 text-xs py-8">No SKUs found</p>
                        )}
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}

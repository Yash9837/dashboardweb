'use client';
import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import {
    RefreshCw, Loader2, Megaphone, Eye, MousePointerClick,
    IndianRupee, TrendingUp, Percent, Target, BarChart3,
    ArrowUpRight, ArrowDownRight, Minus,
} from 'lucide-react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    ResponsiveContainer, Tooltip, Legend,
} from 'recharts';

const PERIODS = [
    { key: '7d', label: '7 Days' },
    { key: '14d', label: '14 Days' },
    { key: '30d', label: '30 Days' },
    { key: '60d', label: '60 Days' },
];

// ─── Utility formatters ──────────────────────────────────────────────────────

function fmtCurrency(v: number) {
    if (v >= 100000) return `₹${(v / 100000).toFixed(2)}L`;
    if (v >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
    return `₹${v.toFixed(2)}`;
}

function fmtNumber(v: number) {
    if (v >= 100000) return `${(v / 100000).toFixed(1)}L`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toLocaleString('en-IN');
}

function fmtPercent(v: number) {
    return `${v.toFixed(2)}%`;
}

// ─── KPI Card ────────────────────────────────────────────────────────────────

interface KpiProps {
    label: string;
    value: string;
    subtitle?: string;
    icon: React.ReactNode;
    color: string;
    gradient: string;
}

function KpiCard({ label, value, subtitle, icon, color, gradient }: KpiProps) {
    return (
        <div className="relative overflow-hidden bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5 group hover:border-white/10 transition-all duration-300">
            {/* Glow */}
            <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-[0.07] group-hover:opacity-[0.12] transition-opacity ${gradient}`} />
            <div className="flex items-start justify-between relative z-10">
                <div>
                    <p className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold mb-2">{label}</p>
                    <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
                    {subtitle && <p className="text-[10px] text-slate-500 mt-1">{subtitle}</p>}
                </div>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${gradient} bg-opacity-10`}>
                    {icon}
                </div>
            </div>
        </div>
    );
}

// ─── Campaign Row ────────────────────────────────────────────────────────────

function CampaignStatusBadge({ state }: { state: string }) {
    const styles: Record<string, string> = {
        ENABLED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        PAUSED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        ARCHIVED: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    };
    return (
        <span className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full border ${styles[state] || styles.ARCHIVED}`}>
            {state}
        </span>
    );
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-[#1e293b] border border-white/10 rounded-xl p-3 shadow-2xl">
            <p className="text-xs text-slate-400 mb-2 font-medium">{label}</p>
            {payload.map((p: any) => (
                <div key={p.dataKey} className="flex items-center gap-2 text-xs">
                    <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                    <span className="text-slate-400">{p.name}:</span>
                    <span className="text-white font-semibold">
                        {p.dataKey.includes('spend') || p.dataKey.includes('sales')
                            ? fmtCurrency(p.value) : fmtNumber(p.value)}
                    </span>
                </div>
            ))}
        </div>
    );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AdvertisingPage() {
    const [period, setPeriod] = useState('30d');
    const [skuSort, setSkuSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'spend', dir: 'desc' });

    const { data, loading, error, refresh } = useFetch<any>(
        `/api/command-center/ads?period=${period}`, [period]
    );

    const summary = data?.summary;
    const daily = data?.daily || [];
    const campaigns = data?.campaigns || [];

    const sortedSkus = useMemo(() => {
        const skus = [...(data?.by_sku || [])];
        skus.sort((a: any, b: any) => {
            const av = a[skuSort.key] || 0;
            const bv = b[skuSort.key] || 0;
            return skuSort.dir === 'desc' ? bv - av : av - bv;
        });
        return skus;
    }, [data?.by_sku, skuSort]);

    const handleSkuSort = (key: string) => {
        setSkuSort(prev => ({
            key,
            dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc',
        }));
    };

    const SortArrow = ({ col }: { col: string }) => {
        if (skuSort.key !== col) return <Minus size={10} className="text-slate-600" />;
        return skuSort.dir === 'desc'
            ? <ArrowDownRight size={10} className="text-indigo-400" />
            : <ArrowUpRight size={10} className="text-indigo-400" />;
    };

    return (
        <DashboardLayout>
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Megaphone size={22} className="text-orange-400" />
                        Advertising
                        <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border bg-orange-500/10 text-orange-400 border-orange-500/20">
                            Sponsored Products
                        </span>
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Amazon Ads performance · Profile {data?.dateRange ? `${data.dateRange.start} → ${data.dateRange.end}` : ''}
                    </p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Period Selector */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                        {PERIODS.map(p => (
                            <button
                                key={p.key}
                                onClick={() => setPeriod(p.key)}
                                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${period === p.key
                                        ? 'bg-orange-500/20 text-orange-400 shadow-sm'
                                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }`}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={refresh}
                        disabled={loading}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* ── Loading ─────────────────────────────────────────── */}
            {loading && !summary && (
                <div className="flex items-center justify-center py-20">
                    <div className="flex flex-col items-center gap-3 text-slate-400">
                        <Loader2 size={24} className="animate-spin text-orange-400" />
                        <span className="text-sm">Fetching ads data from Amazon...</span>
                        <span className="text-xs text-slate-600">Reports may take 30-60s to generate</span>
                    </div>
                </div>
            )}

            {/* ── Error ──────────────────────────────────────────── */}
            {error && (
                <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <div className="text-sm text-red-400">{error}</div>
                    <button onClick={refresh} className="ml-auto text-xs text-red-400 font-medium px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20">
                        Retry
                    </button>
                </div>
            )}

            {/* ── Content ────────────────────────────────────────── */}
            {summary && (
                <>
                    {/* ── Hero KPI Cards ────────────────────────────── */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KpiCard
                            label="Impressions"
                            value={fmtNumber(summary.impressions)}
                            subtitle="Ad views"
                            icon={<Eye size={18} className="text-blue-400" />}
                            color="text-blue-400"
                            gradient="bg-blue-500"
                        />
                        <KpiCard
                            label="Clicks"
                            value={fmtNumber(summary.clicks)}
                            subtitle={`CTR ${fmtPercent(summary.ctr)}`}
                            icon={<MousePointerClick size={18} className="text-cyan-400" />}
                            color="text-cyan-400"
                            gradient="bg-cyan-500"
                        />
                        <KpiCard
                            label="Ad Spend"
                            value={fmtCurrency(summary.spend)}
                            subtitle={`CPC ${fmtCurrency(summary.cpc)}`}
                            icon={<IndianRupee size={18} className="text-orange-400" />}
                            color="text-orange-400"
                            gradient="bg-orange-500"
                        />
                        <KpiCard
                            label="Sales from Ads"
                            value={fmtCurrency(summary.sales)}
                            subtitle={`${summary.orders} orders`}
                            icon={<TrendingUp size={18} className="text-emerald-400" />}
                            color="text-emerald-400"
                            gradient="bg-emerald-500"
                        />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <KpiCard
                            label="ACoS"
                            value={fmtPercent(summary.acos)}
                            subtitle="Advertising Cost of Sales"
                            icon={<Percent size={18} className="text-rose-400" />}
                            color={summary.acos > 30 ? 'text-rose-400' : summary.acos > 15 ? 'text-amber-400' : 'text-emerald-400'}
                            gradient="bg-rose-500"
                        />
                        <KpiCard
                            label="RoAS"
                            value={`${summary.roas}x`}
                            subtitle="Return on Ad Spend"
                            icon={<TrendingUp size={18} className="text-violet-400" />}
                            color={summary.roas >= 3 ? 'text-emerald-400' : summary.roas >= 1.5 ? 'text-amber-400' : 'text-rose-400'}
                            gradient="bg-violet-500"
                        />
                        <KpiCard
                            label="CTR"
                            value={fmtPercent(summary.ctr)}
                            subtitle="Click-Through Rate"
                            icon={<Target size={18} className="text-sky-400" />}
                            color="text-sky-400"
                            gradient="bg-sky-500"
                        />
                        <KpiCard
                            label="CPC"
                            value={fmtCurrency(summary.cpc)}
                            subtitle="Cost per Click"
                            icon={<MousePointerClick size={18} className="text-amber-400" />}
                            color="text-amber-400"
                            gradient="bg-amber-500"
                        />
                    </div>

                    {/* ── Daily Trend Charts ────────────────────────── */}
                    {daily.length > 0 && (
                        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {/* Spend vs Sales */}
                            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
                                <h3 className="text-sm font-semibold text-white mb-1">Spend vs Sales</h3>
                                <p className="text-xs text-slate-500 mb-4">Daily ad spend and attributed sales</p>
                                <div className="h-[280px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <AreaChart data={daily}>
                                            <defs>
                                                <linearGradient id="gradSpend" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#f97316" stopOpacity={0.3} />
                                                    <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
                                                </linearGradient>
                                                <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                                                    <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                            <XAxis
                                                dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }}
                                                axisLine={false} tickLine={false}
                                                tickFormatter={(v) => v.slice(5)}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 10, fill: '#64748b' }}
                                                axisLine={false} tickLine={false}
                                                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
                                            />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                                            <Area type="monotone" dataKey="spend" stroke="#f97316" fill="url(#gradSpend)" strokeWidth={2} name="Spend" />
                                            <Area type="monotone" dataKey="sales" stroke="#22c55e" fill="url(#gradSales)" strokeWidth={2} name="Sales" />
                                        </AreaChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            {/* Impressions & Clicks */}
                            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
                                <h3 className="text-sm font-semibold text-white mb-1">Impressions & Clicks</h3>
                                <p className="text-xs text-slate-500 mb-4">Daily traffic volume</p>
                                <div className="h-[280px]">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={daily}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                            <XAxis
                                                dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }}
                                                axisLine={false} tickLine={false}
                                                tickFormatter={(v) => v.slice(5)}
                                            />
                                            <YAxis
                                                tick={{ fontSize: 10, fill: '#64748b' }}
                                                axisLine={false} tickLine={false}
                                                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
                                            />
                                            <Tooltip content={<ChartTooltip />} />
                                            <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }} />
                                            <Bar dataKey="impressions" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Impressions" opacity={0.7} />
                                            <Bar dataKey="clicks" fill="#06b6d4" radius={[4, 4, 0, 0]} name="Clicks" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Campaigns Table ───────────────────────────── */}
                    {campaigns.length > 0 && (
                        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
                            <div className="p-5 border-b border-white/[0.06]">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <BarChart3 size={16} className="text-orange-400" />
                                    Campaign Performance
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">{campaigns.length} campaigns</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-slate-500 uppercase tracking-wider border-b border-white/[0.04]">
                                            <th className="text-left py-3 px-4 font-semibold">Campaign</th>
                                            <th className="text-center py-3 px-3 font-semibold">Status</th>
                                            <th className="text-right py-3 px-3 font-semibold">Budget</th>
                                            <th className="text-right py-3 px-3 font-semibold">Impressions</th>
                                            <th className="text-right py-3 px-3 font-semibold">Clicks</th>
                                            <th className="text-right py-3 px-3 font-semibold">Spend</th>
                                            <th className="text-right py-3 px-3 font-semibold">Sales</th>
                                            <th className="text-right py-3 px-3 font-semibold">ACoS</th>
                                            <th className="text-right py-3 px-3 font-semibold">RoAS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {campaigns.map((c: any) => (
                                            <tr key={c.campaignId} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                                                <td className="py-3 px-4">
                                                    <p className="text-white font-medium truncate max-w-[200px]">{c.name}</p>
                                                    <p className="text-slate-600 text-[10px]">{c.targetingType}</p>
                                                </td>
                                                <td className="py-3 px-3 text-center">
                                                    <CampaignStatusBadge state={c.state} />
                                                </td>
                                                <td className="py-3 px-3 text-right text-slate-300 tabular-nums">{c.budget ? fmtCurrency(c.budget) : '—'}</td>
                                                <td className="py-3 px-3 text-right text-slate-300 tabular-nums">{fmtNumber(c.impressions)}</td>
                                                <td className="py-3 px-3 text-right text-slate-300 tabular-nums">{fmtNumber(c.clicks)}</td>
                                                <td className="py-3 px-3 text-right text-orange-400 font-medium tabular-nums">{fmtCurrency(c.spend)}</td>
                                                <td className="py-3 px-3 text-right text-emerald-400 font-medium tabular-nums">{fmtCurrency(c.sales)}</td>
                                                <td className="py-3 px-3 text-right tabular-nums">
                                                    <span className={c.acos > 30 ? 'text-rose-400' : c.acos > 15 ? 'text-amber-400' : 'text-emerald-400'}>
                                                        {fmtPercent(c.acos)}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 text-right text-violet-400 tabular-nums">{c.roas}x</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── Per-SKU Ads Table ──────────────────────────── */}
                    {sortedSkus.length > 0 && (
                        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
                            <div className="p-5 border-b border-white/[0.06]">
                                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                                    <Target size={16} className="text-cyan-400" />
                                    Ads Spend by SKU
                                </h3>
                                <p className="text-xs text-slate-500 mt-0.5">{sortedSkus.length} advertised products · Click headers to sort</p>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="text-slate-500 uppercase tracking-wider border-b border-white/[0.04]">
                                            <th className="text-left py-3 px-4 font-semibold">SKU / ASIN</th>
                                            {[
                                                { key: 'impressions', label: 'Impressions' },
                                                { key: 'clicks', label: 'Clicks' },
                                                { key: 'spend', label: 'Spend' },
                                                { key: 'sales', label: 'Sales' },
                                                { key: 'acos', label: 'ACoS' },
                                                { key: 'roas', label: 'RoAS' },
                                                { key: 'ctr', label: 'CTR' },
                                                { key: 'cpc', label: 'CPC' },
                                            ].map(col => (
                                                <th
                                                    key={col.key}
                                                    onClick={() => handleSkuSort(col.key)}
                                                    className="text-right py-3 px-3 font-semibold cursor-pointer hover:text-slate-300 transition-colors select-none"
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        {col.label} <SortArrow col={col.key} />
                                                    </span>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedSkus.map((s: any, i: number) => (
                                            <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                                                <td className="py-3 px-4">
                                                    <p className="text-white font-medium">{s.sku}</p>
                                                    {s.asin && <p className="text-slate-600 text-[10px]">{s.asin}</p>}
                                                </td>
                                                <td className="py-3 px-3 text-right text-slate-300 tabular-nums">{fmtNumber(s.impressions)}</td>
                                                <td className="py-3 px-3 text-right text-slate-300 tabular-nums">{fmtNumber(s.clicks)}</td>
                                                <td className="py-3 px-3 text-right text-orange-400 font-medium tabular-nums">{fmtCurrency(s.spend)}</td>
                                                <td className="py-3 px-3 text-right text-emerald-400 font-medium tabular-nums">{fmtCurrency(s.sales)}</td>
                                                <td className="py-3 px-3 text-right tabular-nums">
                                                    <span className={s.acos > 30 ? 'text-rose-400' : s.acos > 15 ? 'text-amber-400' : 'text-emerald-400'}>
                                                        {fmtPercent(s.acos)}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-3 text-right text-violet-400 tabular-nums">{s.roas}x</td>
                                                <td className="py-3 px-3 text-right text-sky-400 tabular-nums">{fmtPercent(s.ctr)}</td>
                                                <td className="py-3 px-3 text-right text-amber-400 tabular-nums">{fmtCurrency(s.cpc)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* ── Empty states ────────────────────────────────── */}
                    {sortedSkus.length === 0 && campaigns.length === 0 && daily.length === 0 && (
                        <div className="text-center py-12 text-slate-500">
                            <Megaphone size={48} className="mx-auto mb-4 text-slate-700" />
                            <p className="text-sm">No advertising data for this period</p>
                            <p className="text-xs mt-1">Try selecting a different date range</p>
                        </div>
                    )}

                    {/* ── Footer ──────────────────────────────────────── */}
                    <div className="text-center py-4 border-t border-white/5">
                        <p className="text-xs text-slate-600">
                            Amazon Advertising · Sponsored Products v3 · Profile {process.env.NEXT_PUBLIC_ADS_PROFILE_ID || '3418921143532297'}
                        </p>
                    </div>
                </>
            )}
        </DashboardLayout>
    );
}

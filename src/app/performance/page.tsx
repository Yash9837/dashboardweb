'use client';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import { useFetch } from '@/hooks/useFetch';
import { formatCurrency, formatNumber } from '@/lib/utils';
import {
    Zap, Trophy, AlertTriangle, TrendingUp, TrendingDown, PackageX,
    DollarSign, BarChart3, Megaphone, ExternalLink, Crown,
    ArrowDownRight, Package, Clock, Layers, PieChart as PieIcon,
    Target, Activity, ShoppingBag, Percent, Eye
} from 'lucide-react';
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, CartesianGrid, ComposedChart, Line, Area,
    RadialBarChart, RadialBar, Legend
} from 'recharts';

/* ───────────────────── Constants ───────────────────── */

const PERIODS = [
    { label: '30D', value: 30 },
    { label: '60D', value: 60 },
    { label: '90D', value: 90 },
];

const SEVERITY_STYLES: Record<string, string> = {
    critical: 'bg-red-500/10 text-red-400 border border-red-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
};

const PIE_COLORS = ['#6366f1', '#1e293b'];

const CHART_COLORS = [
    '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#3b82f6',
];

function truncate(str: string, len: number) {
    return str.length > len ? str.slice(0, len) + '…' : str;
}

/* ───────────────────── Custom Tooltip ───────────────── */

function PerformanceTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-[#0f1629] border border-white/10 rounded-xl p-3 shadow-2xl backdrop-blur-xl">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
            {payload.map((entry: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                    <div className="w-2 h-2 rounded-full" style={{ background: entry.color }} />
                    <span className="text-slate-400 text-xs">{entry.name}:</span>
                    <span className="text-white font-semibold">
                        {entry.name === 'Units' ? formatNumber(entry.value) : formatCurrency(entry.value)}
                    </span>
                </div>
            ))}
        </div>
    );
}

/* ───────────────────── KPI Card ────────────────────── */

interface KpiCardProps {
    label: string;
    value: string;
    subtitle?: string;
    icon: React.ElementType;
    gradient: string;
    iconBg: string;
}

function KpiCard({ label, value, subtitle, icon: Icon, gradient, iconBg }: KpiCardProps) {
    return (
        <div className="relative group bg-[#111827]/80 border border-white/5 rounded-2xl p-5 overflow-hidden hover:border-white/10 transition-all duration-300">
            {/* Gradient accent */}
            <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 ${gradient}`} />
            <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                    <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center`}>
                        <Icon size={18} />
                    </div>
                </div>
                <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
                <p className="text-xs text-slate-500 mt-1">{label}</p>
                {subtitle && <p className="text-[10px] text-slate-600 mt-0.5">{subtitle}</p>}
            </div>
        </div>
    );
}

/* ───────────────────── Spotlight Card ──────────────── */

function SpotlightCard({
    label, title, revenue, period, icon: Icon, accentColor, bgGlow, image,
}: {
    label: string; title: string; revenue: number; period: number;
    icon: React.ElementType; accentColor: string; bgGlow: string; image?: string | null;
}) {
    return (
        <div className="relative bg-[#111827]/80 border border-white/5 rounded-2xl p-6 overflow-hidden group hover:border-white/10 transition-all duration-300">
            {/* Background glow */}
            <div className={`absolute -top-20 -right-20 w-40 h-40 rounded-full blur-3xl opacity-20 group-hover:opacity-30 transition-opacity ${bgGlow}`} />
            <div className="relative z-10 flex items-start gap-4">
                {image ? (
                    <img src={image} alt={title} className="w-14 h-14 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0" />
                ) : (
                    <div className={`w-14 h-14 rounded-xl ${accentColor.replace('text-', 'bg-').replace('400', '500/15')} flex items-center justify-center shrink-0`}>
                        <Icon size={24} className={accentColor} />
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] uppercase tracking-wider font-semibold ${accentColor}`}>{label}</span>
                    </div>
                    <p className="text-sm font-semibold text-white truncate">{title}</p>
                    <div className="mt-3 flex items-baseline gap-2">
                        <p className={`text-3xl font-bold ${accentColor}`}>{formatCurrency(revenue)}</p>
                    </div>
                    <p className="text-[10px] text-slate-600 mt-1">Revenue in last {period} days</p>
                </div>
            </div>
        </div>
    );
}

/* ───────────────────── Section Header ──────────────── */

function SectionHeader({ icon: Icon, title, subtitle, iconColor = 'text-indigo-400', children }: {
    icon: React.ElementType; title: string; subtitle?: string; iconColor?: string; children?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center`}>
                    <Icon size={16} className={iconColor} />
                </div>
                <div>
                    <h3 className="text-white font-semibold text-sm">{title}</h3>
                    {subtitle && <p className="text-[10px] text-slate-600">{subtitle}</p>}
                </div>
            </div>
            {children}
        </div>
    );
}

/* ───────────────────── Main Page ───────────────────── */

export default function PerformancePage() {
    const [period, setPeriod] = useState(30);
    const { data, loading, error, refresh } = useFetch<any>(
        `/api/performance?period=${period}`,
        [period],
    );

    const kpis = data?.kpis;
    const topProducts = data?.topProducts || [];
    const deadStock30d = data?.deadStock30d || [];
    const deadStock60d = data?.deadStock60d || [];
    const topProductsChart = data?.topProductsChart || [];
    const revenueDistribution = data?.revenueDistribution || [];
    const meta = data?.meta;

    const [deadStockTab, setDeadStockTab] = useState<30 | 60>(30);
    const activeDeadStock = deadStockTab === 30 ? deadStock30d : deadStock60d;

    // Compute additional chart data
    const totalRevenue = topProducts.reduce((s: number, p: any) => s + (p.totalRevenue || 0), 0);
    const totalUnits = topProducts.reduce((s: number, p: any) => s + (p.totalUnits || 0), 0);

    // Revenue per product for radial chart
    const radialData = topProducts.slice(0, 5).map((p: any, i: number) => ({
        name: truncate(p.title, 20),
        value: p.totalRevenue,
        fill: CHART_COLORS[i],
    }));

    // Cumulative revenue curve data
    const cumulativeData = topProducts.reduce((acc: any[], p: any, i: number) => {
        const prev = acc.length > 0 ? acc[acc.length - 1].cumulative : 0;
        acc.push({
            rank: `#${i + 1}`,
            name: truncate(p.title, 18),
            revenue: p.totalRevenue,
            cumulative: prev + p.totalRevenue,
            cumulativePct: totalRevenue > 0 ? Math.round(((prev + p.totalRevenue) / totalRevenue) * 100) : 0,
        });
        return acc;
    }, []);

    // Dead stock severity summary
    const criticalCount = activeDeadStock.filter((p: any) => p.severity === 'critical').length;
    const warningCount = activeDeadStock.filter((p: any) => p.severity === 'warning').length;
    const deadStockTotalValue = activeDeadStock.reduce((s: number, p: any) => s + (p.estimatedValue || 0), 0);

    const periodActions = (
        <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
            {PERIODS.map((p) => (
                <button
                    key={p.value}
                    onClick={() => setPeriod(p.value)}
                    className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${period === p.value
                            ? 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20'
                            : 'text-slate-500 hover:text-white hover:bg-white/5'
                        }`}
                >
                    {p.label}
                </button>
            ))}
        </div>
    );

    if (error && !data) {
        return (
            <DashboardLayout>
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <AlertTriangle size={32} className="text-red-400" />
                    <p className="text-red-400 font-medium">Error: {error}</p>
                    <button onClick={refresh} className="text-sm text-indigo-400 hover:text-indigo-300 transition-colors">
                        Try again
                    </button>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <PageHeader
                title="Performance"
                subtitle={`Product performance & dead-stock analysis · ${period}-day window`}
                icon={Zap}
                iconColor="text-amber-400"
                loading={loading}
                onRefresh={refresh}
                actions={periodActions}
            />

            {loading && !data ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                    <div className="relative w-12 h-12">
                        <div className="absolute inset-0 rounded-full border-2 border-indigo-500/20" />
                        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-indigo-500 animate-spin" />
                    </div>
                    <p className="text-sm text-slate-500">Analyzing product performance…</p>
                </div>
            ) : (
                <div className="space-y-5">

                    {/* ─── KPI Cards ──────────────────────── */}
                    {kpis && (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                            <KpiCard
                                label="Products Sold"
                                value={formatNumber(kpis.totalProductsSold)}
                                subtitle={`From ${meta?.ordersEnriched || 0} orders`}
                                icon={ShoppingBag}
                                gradient="bg-gradient-to-br from-indigo-500/5 to-transparent"
                                iconBg="bg-indigo-500/15 text-indigo-400"
                            />
                            <KpiCard
                                label="Total Revenue"
                                value={formatCurrency(totalRevenue)}
                                subtitle={`${formatNumber(totalUnits)} units`}
                                icon={DollarSign}
                                gradient="bg-gradient-to-br from-emerald-500/5 to-transparent"
                                iconBg="bg-emerald-500/15 text-emerald-400"
                            />
                            <KpiCard
                                label="Best Seller"
                                value={formatCurrency(kpis.bestSellerRevenue)}
                                subtitle={truncate(kpis.bestSellerName, 22)}
                                icon={Crown}
                                gradient="bg-gradient-to-br from-amber-500/5 to-transparent"
                                iconBg="bg-amber-500/15 text-amber-400"
                            />
                            <KpiCard
                                label="Top 10 Share"
                                value={`${kpis.revenueConcentrationTop10}%`}
                                subtitle="Revenue concentration"
                                icon={Target}
                                gradient="bg-gradient-to-br from-violet-500/5 to-transparent"
                                iconBg="bg-violet-500/15 text-violet-400"
                            />
                            <KpiCard
                                label="Dead Stock"
                                value={formatNumber(kpis.deadStockCount30d)}
                                subtitle={`${kpis.deadStockCount60d} over 60 days`}
                                icon={PackageX}
                                gradient="bg-gradient-to-br from-red-500/5 to-transparent"
                                iconBg="bg-red-500/15 text-red-400"
                            />
                            <KpiCard
                                label="Capital Tied Up"
                                value={formatCurrency(kpis.deadStockValue)}
                                subtitle="In unsold inventory"
                                icon={AlertTriangle}
                                gradient="bg-gradient-to-br from-orange-500/5 to-transparent"
                                iconBg="bg-orange-500/15 text-orange-400"
                            />
                        </div>
                    )}

                    {/* ─── Best & Worst Performer Spotlight ── */}
                    {kpis && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SpotlightCard
                                label="🏆 Best Performer"
                                title={kpis.bestSellerName}
                                revenue={kpis.bestSellerRevenue}
                                period={period}
                                icon={Crown}
                                accentColor="text-emerald-400"
                                bgGlow="bg-emerald-500"
                                image={topProducts[0]?.image}
                            />
                            <SpotlightCard
                                label="⚠️ Needs Attention"
                                title={kpis.worstPerformerName}
                                revenue={kpis.worstPerformerRevenue}
                                period={period}
                                icon={ArrowDownRight}
                                accentColor="text-red-400"
                                bgGlow="bg-red-500"
                                image={topProducts[topProducts.length - 1]?.image}
                            />
                        </div>
                    )}

                    {/* ─── Charts Row 1: Revenue + Distribution ── */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                        {/* Revenue by Product - Composed Chart */}
                        <div className="lg:col-span-3 bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                            <SectionHeader
                                icon={BarChart3}
                                title="Revenue by Product"
                                subtitle="Top 10 products with revenue and units"
                                iconColor="text-indigo-400"
                            />
                            {topProductsChart.length > 0 ? (
                                <ResponsiveContainer width="100%" height={340}>
                                    <ComposedChart data={topProductsChart} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                        <XAxis
                                            dataKey="name"
                                            tick={{ fontSize: 9, fill: '#64748b' }}
                                            axisLine={false}
                                            tickLine={false}
                                            interval={0}
                                            angle={-20}
                                            textAnchor="end"
                                            height={60}
                                        />
                                        <YAxis
                                            yAxisId="revenue"
                                            tick={{ fontSize: 10, fill: '#64748b' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                                        />
                                        <YAxis
                                            yAxisId="units"
                                            orientation="right"
                                            tick={{ fontSize: 10, fill: '#64748b' }}
                                            axisLine={false}
                                            tickLine={false}
                                        />
                                        <Tooltip content={<PerformanceTooltip />} />
                                        <Bar yAxisId="revenue" dataKey="revenue" fill="#6366f1" radius={[6, 6, 0, 0]} barSize={28} name="Revenue" />
                                        <Line yAxisId="units" dataKey="units" stroke="#06b6d4" strokeWidth={2} dot={{ r: 4, fill: '#06b6d4', strokeWidth: 0 }} name="Units" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="flex items-center justify-center h-[340px] text-slate-600 text-sm">No product data</div>
                            )}
                        </div>

                        {/* Revenue Distribution Donut */}
                        <div className="lg:col-span-2 bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                            <SectionHeader
                                icon={PieIcon}
                                title="Revenue Split"
                                subtitle="Top 10 vs rest of catalog"
                                iconColor="text-violet-400"
                            />
                            {revenueDistribution.length > 0 ? (
                                <>
                                    <ResponsiveContainer width="100%" height={220}>
                                        <PieChart>
                                            <Pie
                                                data={revenueDistribution}
                                                dataKey="value"
                                                nameKey="name"
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={90}
                                                innerRadius={55}
                                                paddingAngle={3}
                                                strokeWidth={0}
                                            >
                                                {revenueDistribution.map((_: any, i: number) => (
                                                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip content={<PerformanceTooltip />} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                    <div className="space-y-3 mt-2">
                                        {revenueDistribution.map((item: any, i: number) => {
                                            const pct = totalRevenue > 0 ? Math.round((item.value / totalRevenue) * 100) : 0;
                                            return (
                                                <div key={item.name} className="flex items-center gap-3">
                                                    <div className="w-3 h-3 rounded" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                                    <div className="flex-1">
                                                        <div className="flex items-center justify-between">
                                                            <span className="text-xs text-slate-400">{item.name}</span>
                                                            <span className="text-xs text-white font-semibold">{formatCurrency(item.value)}</span>
                                                        </div>
                                                        <div className="mt-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full rounded-full transition-all duration-700"
                                                                style={{ width: `${pct}%`, background: PIE_COLORS[i % PIE_COLORS.length] }}
                                                            />
                                                        </div>
                                                    </div>
                                                    <span className="text-[10px] text-slate-600 font-mono w-8 text-right">{pct}%</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            ) : (
                                <div className="flex items-center justify-center h-[220px] text-slate-600 text-sm">No data</div>
                            )}
                        </div>
                    </div>

                    {/* ─── Charts Row 2: Cumulative Revenue Curve ── */}
                    {cumulativeData.length > 0 && (
                        <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                            <SectionHeader
                                icon={Activity}
                                title="Cumulative Revenue Curve"
                                subtitle="Pareto-style analysis — how quickly your top products account for total revenue"
                                iconColor="text-cyan-400"
                            />
                            <ResponsiveContainer width="100%" height={280}>
                                <ComposedChart data={cumulativeData} margin={{ top: 5, right: 30, bottom: 5, left: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                    <XAxis
                                        dataKey="rank"
                                        tick={{ fontSize: 11, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        yAxisId="revenue"
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`}
                                    />
                                    <YAxis
                                        yAxisId="pct"
                                        orientation="right"
                                        tick={{ fontSize: 10, fill: '#64748b' }}
                                        axisLine={false}
                                        tickLine={false}
                                        tickFormatter={(v) => `${v}%`}
                                        domain={[0, 100]}
                                    />
                                    <Tooltip content={<PerformanceTooltip />} />
                                    <Bar yAxisId="revenue" dataKey="revenue" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} name="Revenue" opacity={0.7} />
                                    <Line yAxisId="pct" dataKey="cumulativePct" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#10b981', strokeWidth: 0 }} name="Cumulative %" />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* ─── Top Products Table ──────────────── */}
                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                        <SectionHeader
                            icon={Trophy}
                            title="Top Performing Products"
                            subtitle={meta ? `${meta.ordersEnriched} orders analyzed across ${meta.totalListingsAnalyzed} listings` : undefined}
                            iconColor="text-amber-400"
                        />
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/[0.06]">
                                        {['#', 'Product', 'ASIN', 'Revenue', 'Share', 'Units', 'Orders', 'Avg Price'].map((h) => (
                                            <th key={h} className={`py-3 px-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 ${['Revenue', 'Share', 'Units', 'Orders', 'Avg Price'].includes(h) ? 'text-right' : 'text-left'
                                                }`}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {topProducts.map((p: any, i: number) => {
                                        const share = totalRevenue > 0 ? ((p.totalRevenue / totalRevenue) * 100).toFixed(1) : '0';
                                        return (
                                            <tr key={p.asin} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group">
                                                <td className="py-3.5 px-3">
                                                    <span className={`text-xs font-bold ${i < 3 ? 'text-amber-400' : 'text-slate-600'
                                                        }`}>
                                                        {i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}
                                                    </span>
                                                </td>
                                                <td className="py-3.5 px-3">
                                                    <div className="flex items-center gap-3">
                                                        {p.image ? (
                                                            <img
                                                                src={p.image}
                                                                alt={p.title}
                                                                className="w-10 h-10 rounded-xl object-cover bg-white/5 border border-white/10 shrink-0 group-hover:border-white/20 transition-colors"
                                                            />
                                                        ) : (
                                                            <div className="w-10 h-10 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center shrink-0">
                                                                <Package size={14} className="text-slate-700" />
                                                            </div>
                                                        )}
                                                        <div className="min-w-0">
                                                            <p className="text-white text-sm font-medium truncate max-w-[280px] group-hover:text-indigo-300 transition-colors">
                                                                {p.title}
                                                            </p>
                                                            <p className="text-[10px] text-slate-600 mt-0.5">{p.sku}{p.brand ? ` · ${p.brand}` : ''}</p>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-3 text-[11px] text-slate-500 font-mono">{p.asin}</td>
                                                <td className="py-3.5 px-3 text-right">
                                                    <span className="text-emerald-400 font-bold">{formatCurrency(p.totalRevenue)}</span>
                                                </td>
                                                <td className="py-3.5 px-3 text-right">
                                                    <div className="inline-flex items-center gap-1.5">
                                                        <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${share}%` }} />
                                                        </div>
                                                        <span className="text-[10px] text-slate-500 font-mono w-9 text-right">{share}%</span>
                                                    </div>
                                                </td>
                                                <td className="py-3.5 px-3 text-right text-white font-medium">{formatNumber(p.totalUnits)}</td>
                                                <td className="py-3.5 px-3 text-right text-slate-400">{p.orderCount}</td>
                                                <td className="py-3.5 px-3 text-right text-slate-400">{formatCurrency(p.avgPrice)}</td>
                                            </tr>
                                        );
                                    })}
                                    {topProducts.length === 0 && (
                                        <tr>
                                            <td colSpan={8} className="text-center py-12 text-slate-600">No product data available</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* ─── Dead Stock Section ──────────────── */}
                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-red-500/10 flex items-center justify-center">
                                    <PackageX size={16} className="text-red-400" />
                                </div>
                                <div>
                                    <h3 className="text-white font-semibold text-sm">Dead Stock — Zero Orders</h3>
                                    <p className="text-[10px] text-slate-600">Products with inventory but no sales</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                {/* Summary badges */}
                                <div className="hidden md:flex items-center gap-2">
                                    <span className="text-[10px] bg-red-500/10 text-red-400 border border-red-500/20 px-2 py-1 rounded-lg font-medium">
                                        🔴 {criticalCount} Critical
                                    </span>
                                    <span className="text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-1 rounded-lg font-medium">
                                        🟡 {warningCount} Warning
                                    </span>
                                    <span className="text-[10px] bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-1 rounded-lg font-medium">
                                        💰 {formatCurrency(deadStockTotalValue)} tied up
                                    </span>
                                </div>
                                {/* Tab toggle */}
                                <div className="flex items-center gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1">
                                    {([30, 60] as const).map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setDeadStockTab(t)}
                                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${deadStockTab === t
                                                    ? 'bg-red-500/15 text-red-400 shadow'
                                                    : 'text-slate-500 hover:text-white hover:bg-white/5'
                                                }`}
                                        >
                                            {t}D
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-white/[0.06]">
                                        {['Product', 'SKU', 'Stock Qty', 'Value Tied', 'Last Order', 'Channel', 'Severity'].map((h) => (
                                            <th key={h} className={`py-3 px-3 text-[10px] uppercase tracking-wider font-semibold text-slate-600 ${['Stock Qty', 'Value Tied'].includes(h) ? 'text-right' : ['Last Order', 'Channel', 'Severity'].includes(h) ? 'text-center' : 'text-left'
                                                }`}>
                                                {h}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {activeDeadStock.slice(0, 20).map((p: any) => (
                                        <tr key={p.sku} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors group">
                                            <td className="py-3 px-3">
                                                <div className="flex items-center gap-3">
                                                    {p.image ? (
                                                        <img src={p.image} alt={p.title} className="w-8 h-8 rounded-lg object-cover bg-white/5 border border-white/10 shrink-0" />
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-center shrink-0">
                                                            <Package size={12} className="text-slate-700" />
                                                        </div>
                                                    )}
                                                    <span className="text-white text-sm truncate max-w-[200px] group-hover:text-red-300 transition-colors">{p.title}</span>
                                                </div>
                                            </td>
                                            <td className="py-3 px-3 text-[11px] text-slate-500 font-mono">{p.sku}</td>
                                            <td className="py-3 px-3 text-right">
                                                <span className="text-white font-bold">{p.stock}</span>
                                                <span className="text-[10px] text-slate-600 ml-1">units</span>
                                            </td>
                                            <td className="py-3 px-3 text-right text-rose-400 font-bold">{formatCurrency(p.estimatedValue)}</td>
                                            <td className="py-3 px-3 text-center">
                                                {p.daysSinceLastOrder !== null ? (
                                                    <span className="inline-flex items-center gap-1 text-xs text-slate-400 bg-white/[0.03] px-2 py-1 rounded-lg">
                                                        <Clock size={10} />
                                                        {p.daysSinceLastOrder}d ago
                                                    </span>
                                                ) : (
                                                    <span className="text-[10px] text-slate-700 bg-white/[0.02] px-2 py-1 rounded-lg">Never sold</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-3 text-center">
                                                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg ${p.fulfillmentChannel === 'FBA'
                                                        ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                                        : 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                                    }`}>
                                                    {p.fulfillmentChannel}
                                                </span>
                                            </td>
                                            <td className="py-3 px-3 text-center">
                                                <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-lg ${SEVERITY_STYLES[p.severity] || ''}`}>
                                                    {p.severity === 'critical' ? '🔴 Critical' : '🟡 Warning'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {activeDeadStock.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="text-center py-12">
                                                <div className="flex flex-col items-center gap-2">
                                                    <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                                        <TrendingUp size={20} className="text-emerald-400" />
                                                    </div>
                                                    <p className="text-sm text-slate-400">No dead stock found — all products are selling!</p>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                            {activeDeadStock.length > 20 && (
                                <p className="text-[10px] text-slate-600 text-center mt-3">
                                    Showing top 20 of {activeDeadStock.length} dead stock items (sorted by value tied up)
                                </p>
                            )}
                        </div>
                    </div>

                    {/* ─── Ads Performance Section ─────────── */}
                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl overflow-hidden">
                        {/* Gradient header bar */}
                        <div className="h-1 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500" />
                        <div className="p-6">
                            <div className="flex items-start gap-5">
                                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/10 flex items-center justify-center shrink-0">
                                    <Megaphone size={24} className="text-violet-400" />
                                </div>
                                <div className="flex-1">
                                    <h3 className="text-white font-semibold text-base mb-1">Advertising Performance</h3>
                                    <p className="text-xs text-slate-500 leading-relaxed mb-5 max-w-xl">
                                        Connect your <span className="text-violet-400 font-medium">Amazon Ads API</span> to unlock
                                        real-time advertising metrics. This requires separate OAuth credentials from SP-API.
                                    </p>

                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                                        {[
                                            { label: 'Ad Spend', icon: DollarSign, desc: 'Total advertising spend' },
                                            { label: 'ACoS', icon: Percent, desc: 'Advertising cost of sale' },
                                            { label: 'ROAS', icon: TrendingUp, desc: 'Return on ad spend' },
                                            { label: 'Impressions', icon: Eye, desc: 'Total ad impressions' },
                                        ].map((m) => (
                                            <div
                                                key={m.label}
                                                className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4 text-center group hover:border-violet-500/20 transition-all"
                                            >
                                                <m.icon size={18} className="text-slate-700 mx-auto mb-2 group-hover:text-violet-500 transition-colors" />
                                                <p className="text-lg font-bold text-slate-700">—</p>
                                                <p className="text-[10px] text-slate-600 font-medium mt-0.5">{m.label}</p>
                                                <p className="text-[9px] text-slate-700 mt-0.5">{m.desc}</p>
                                            </div>
                                        ))}
                                    </div>

                                    <a
                                        href="https://advertising.amazon.com/API/docs/en-us/get-started/overview"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-xl hover:bg-violet-500/15 hover:border-violet-500/30 transition-all"
                                    >
                                        Connect Amazon Ads API
                                        <ExternalLink size={12} />
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}

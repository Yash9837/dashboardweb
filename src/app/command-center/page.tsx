'use client';
import { useState, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import RevenueStateCards from '@/components/command-center/RevenueStateCards';
import ProfitWaterfallChart from '@/components/command-center/ProfitWaterfallChart';
import FinancialBreakdownPanel from '@/components/command-center/FinancialBreakdownPanel';
import SKUPerformanceTable from '@/components/command-center/SKUPerformanceTable';
import InventoryRiskPanel from '@/components/command-center/InventoryRiskPanel';
import AlertsPanel from '@/components/command-center/AlertsPanel';
import { RevenueState, RevenueStateBreakdown } from '@/lib/types';
import {
    RefreshCw, AlertCircle, Loader2, CloudDownload, Zap,
    Lock, Radio, Shield, Calendar,
} from 'lucide-react';
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';

const PERIODS = [
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
    { key: '90d', label: '90D' },
    { key: 'custom', label: 'Custom' },
];

export default function CommandCenterPage() {
    const [period, setPeriod] = useState('30d');
    const [revenueState, setRevenueState] = useState<RevenueState>('live');
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<string | null>(null);

    // Custom date range state
    const today = new Date().toISOString().split('T')[0];
    const [customStart, setCustomStart] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 7);
        return d.toISOString().split('T')[0];
    });
    const [customEnd, setCustomEnd] = useState(today);

    // Build query string based on period or custom dates
    const dateQuery = useMemo(() => {
        if (period === 'custom') {
            return `startDate=${customStart}&endDate=${customEnd}`;
        }
        return `period=${period}`;
    }, [period, customStart, customEnd]);

    const { data: metricsData, loading: metricsLoading, error: metricsError, refresh: refreshMetrics } =
        useFetch<any>(`/api/command-center/metrics?${dateQuery}`, [dateQuery]);

    const { data: skuData, loading: skuLoading, refresh: refreshSkus } =
        useFetch<any>(`/api/command-center/sku-performance?${dateQuery}`, [dateQuery]);

    const { data: alertsData, loading: alertsLoading, refresh: refreshAlerts } =
        useFetch<any>('/api/command-center/alerts');

    const handleRefresh = async () => {
        await Promise.all([refreshMetrics(), refreshSkus(), refreshAlerts()]);
    };

    const handleSync = async () => {
        setSyncing(true);
        setSyncResult(null);
        try {
            const res = await fetch(`/api/command-center/sync?period=${period}`, { method: 'POST' });
            const json = await res.json();
            if (json.error) throw new Error(json.error);
            const type = json.sync_type === 'incremental' ? '⚡ Incremental' : '🔄 Full';
            const c = json.counts;
            const warnings = Array.isArray(json.warnings) ? json.warnings : [];
            const warningNote = warnings.length > 0 ? ` · ⚠ ${warnings.join(' | ')}` : '';
            setSyncResult(
                `${type} sync done in ${(json.duration_ms / 1000).toFixed(1)}s — ` +
                `${c.skus} SKUs · ${c.orders} orders · ${c.financial_events} events · ${c.inventory_snapshots} inventory` +
                warningNote
            );
            await handleRefresh();
        } catch (err: any) {
            setSyncResult(`Error: ${err.message}`);
        } finally {
            setSyncing(false);
        }
    };

    // Revenue breakdown donut data
    const breakdown: RevenueStateBreakdown = metricsData?.revenue_breakdown || { pending: 0, at_risk: 0, locked: 0, refunded: 0 };
    const donutData = [
        { name: 'Locked', value: breakdown.locked, color: '#22c55e' },
        { name: 'At-Risk', value: breakdown.at_risk, color: '#f59e0b' },
        { name: 'Pending', value: breakdown.pending, color: '#6366f1' },
        { name: 'Refunded', value: breakdown.refunded, color: '#ef4444' },
    ].filter(d => d.value > 0);

    const hasData = metricsData?.kpis?.length > 0;
    const inventoryData = (skuData?.skus || [])
        .filter((s: any) => s.inventory)
        .map((s: any) => ({
            sku: s.sku,
            title: s.title,
            available_units: s.inventory.available_units,
            avg_daily_sales_7d: 0,
            days_inventory: s.inventory.days_inventory,
            risk_status: s.inventory.risk_status,
        }));

    return (
        <DashboardLayout>
            {/* ── Header ─────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                        <Shield size={22} className="text-indigo-400" />
                        Command Center
                        <span className={`flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full border ${revenueState === 'live'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                            }`}>
                            {revenueState === 'live' ? <Radio size={10} className="animate-pulse" /> : <Lock size={10} />}
                            {revenueState === 'live' ? 'Live Metrics' : 'Locked Metrics'}
                        </span>
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">Dual-state financial intelligence · Event-driven ledger</p>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    {/* Revenue State Toggle */}
                    <div className="flex items-center bg-white/5 border border-white/10 rounded-xl p-0.5">
                        <button
                            onClick={() => setRevenueState('live')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${revenueState === 'live'
                                ? 'bg-emerald-500/20 text-emerald-400 shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            <Radio size={12} />
                            LIVE
                        </button>
                        <button
                            onClick={() => setRevenueState('locked')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${revenueState === 'locked'
                                ? 'bg-indigo-500/20 text-indigo-400 shadow-sm'
                                : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            <Lock size={12} />
                            LOCKED
                        </button>
                    </div>

                    {/* Period Selector */}
                    <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                        {PERIODS.map(p => (
                            <button
                                key={p.key}
                                onClick={() => setPeriod(p.key)}
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

                    {/* Custom Date Inputs */}
                    {period === 'custom' && (
                        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5">
                            <input
                                type="date"
                                value={customStart}
                                onChange={e => setCustomStart(e.target.value)}
                                className="bg-transparent text-xs text-slate-300 border-none outline-none cursor-pointer [color-scheme:dark]"
                            />
                            <span className="text-slate-500 text-xs">→</span>
                            <input
                                type="date"
                                value={customEnd}
                                max={today}
                                onChange={e => setCustomEnd(e.target.value)}
                                className="bg-transparent text-xs text-slate-300 border-none outline-none cursor-pointer [color-scheme:dark]"
                            />
                        </div>
                    )}

                    <button
                        onClick={handleRefresh}
                        disabled={metricsLoading}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={metricsLoading ? 'animate-spin' : ''} />
                        Refresh
                    </button>

                    {/* Sync Amazon Data */}
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="flex items-center gap-2 px-3 py-2 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-sm text-indigo-400 hover:bg-indigo-500/20 transition-all disabled:opacity-50"
                    >
                        {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
                        {syncing ? 'Syncing...' : 'Sync Amazon'}
                    </button>
                </div>
            </div>

            {/* Sync result banner */}
            {syncResult && (
                <div className={`flex items-center gap-2 p-3 rounded-xl text-xs font-medium ${syncResult.startsWith('Error')
                    ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                    : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                    }`}>
                    <Zap size={12} />
                    {syncResult}
                    <button onClick={() => setSyncResult(null)} className="ml-auto text-slate-500 hover:text-white">✕</button>
                </div>
            )}

            {/* Error Banner */}
            {metricsError && (
                <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                    <AlertCircle size={18} className="text-red-400 shrink-0" />
                    <div>
                        <p className="text-sm text-red-400 font-medium">Failed to load Command Center data</p>
                        <p className="text-xs text-red-400/60 mt-0.5">{metricsError}</p>
                    </div>
                    <button onClick={handleRefresh} className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg bg-red-500/10">
                        Retry
                    </button>
                </div>
            )}

            {/* Loading State */}
            {metricsLoading && !hasData && (
                <div className="flex items-center justify-center py-20">
                    <div className="flex items-center gap-3 text-slate-400">
                        <Loader2 size={18} className="animate-spin" />
                        <span className="text-sm">Loading Command Center...</span>
                    </div>
                </div>
            )}

            {/* ── KPI Cards ──────────────────────────────────────── */}
            {hasData && (
                <>
                    <RevenueStateCards kpis={metricsData.kpis} state={revenueState} />

                    {/* ── Charts Row ───────────────────────────────────── */}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        {/* Revenue Trend */}
                        <div className="xl:col-span-2 bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
                            <h3 className="text-sm font-semibold text-white mb-1">Revenue Trend</h3>
                            <p className="text-xs text-slate-500 mb-4">Live vs Locked revenue · {period} view</p>
                            <div className="h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={metricsData.daily_trends}>
                                        <defs>
                                            <linearGradient id="gradLive" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                                                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                                            </linearGradient>
                                            <linearGradient id="gradLocked" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="0%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                                        <XAxis
                                            dataKey="date"
                                            tick={{ fontSize: 10, fill: '#64748b' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => v.slice(5)}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 10, fill: '#64748b' }}
                                            axisLine={false}
                                            tickLine={false}
                                            tickFormatter={(v) => v >= 100000 ? `${(v / 100000).toFixed(0)}L` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : v}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                background: '#1e293b',
                                                border: '1px solid rgba(255,255,255,0.1)',
                                                borderRadius: '12px',
                                                color: '#e2e8f0',
                                                fontSize: '12px',
                                            }}
                                            formatter={(value: number | string | undefined) => [`₹${Number(value || 0).toLocaleString('en-IN')}`, '']}
                                        />
                                        <Area type="monotone" dataKey="revenue_live" stroke="#22c55e" fill="url(#gradLive)" strokeWidth={2} name="Live Revenue" />
                                        <Area type="monotone" dataKey="revenue_locked" stroke="#6366f1" fill="url(#gradLocked)" strokeWidth={2} name="Locked Revenue" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Revenue State Donut */}
                        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-6">
                            <h3 className="text-sm font-semibold text-white mb-1">Revenue States</h3>
                            <p className="text-xs text-slate-500 mb-4">Pending · At-Risk · Locked · Refunded</p>
                            <div className="h-[200px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={donutData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={55}
                                            outerRadius={80}
                                            paddingAngle={3}
                                            dataKey="value"
                                            strokeWidth={0}
                                        >
                                            {donutData.map((entry, i) => (
                                                <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                background: '#1e293b',
                                                border: '1px solid rgba(255,255,255,0.1)',
                                                borderRadius: '12px',
                                                color: '#e2e8f0',
                                                fontSize: '12px',
                                            }}
                                            formatter={(value: number | string | undefined) => [`₹${Number(value || 0).toLocaleString('en-IN')}`, '']}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            {/* Legend */}
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {donutData.map((d) => (
                                    <div key={d.name} className="flex items-center gap-2">
                                        <div className="w-2 h-2 rounded-full" style={{ background: d.color }} />
                                        <span className="text-[10px] text-slate-400">{d.name}</span>
                                        <span className="text-[10px] text-white font-medium ml-auto tabular-nums">
                                            ₹{d.value >= 100000 ? `${(d.value / 100000).toFixed(1)}L` : `${(d.value / 1000).toFixed(0)}K`}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* ── Waterfall Chart ───────────────────────────────── */}
                    <ProfitWaterfallChart data={metricsData.waterfall} />

                    {/* ── Net Contribution / Profit Breakdown ───────────── */}
                    {metricsData?.financial_summary && metricsData?.net_contribution_breakdown && metricsData?.total_profit_breakdown && (
                        <FinancialBreakdownPanel
                            summary={metricsData.financial_summary}
                            netContributionBreakdown={metricsData.net_contribution_breakdown}
                            totalProfitBreakdown={metricsData.total_profit_breakdown}
                        />
                    )}

                    {/* ── SKU Performance Table ─────────────────────────── */}
                    {!skuLoading && skuData?.skus && (
                        <SKUPerformanceTable skus={skuData.skus} state={revenueState} />
                    )}

                    {/* ── Bottom Row: Inventory Risk + Alerts ──────────── */}
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {inventoryData.length > 0 && (
                            <InventoryRiskPanel data={inventoryData} />
                        )}
                        {!alertsLoading && alertsData?.alerts && (
                            <AlertsPanel alerts={alertsData.alerts} />
                        )}
                    </div>
                </>
            )}

            {/* Empty state */}
            {!metricsLoading && !hasData && !metricsError && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <CloudDownload size={48} className="text-slate-700 mb-4" />
                    <h2 className="text-lg font-semibold text-white mb-2">No Command Center Data</h2>
                    <p className="text-sm text-slate-500 mb-4 max-w-md">
                        Sync your Amazon Seller Central data to populate the Command Center with real orders, inventory, and financial metrics.
                    </p>
                    <button
                        onClick={handleSync}
                        disabled={syncing}
                        className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-xl transition-all disabled:opacity-50"
                    >
                        {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
                        {syncing ? 'Syncing Amazon Data...' : 'Sync Amazon Data'}
                    </button>
                </div>
            )}

            {/* Footer */}
            <div className="text-center py-4 border-t border-white/5">
                <p className="text-xs text-slate-600">
                    Command Center · Event-driven Ledger Architecture · Dual Revenue States (LIVE / LOCKED)
                </p>
            </div>
        </DashboardLayout>
    );
}

'use client';
import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import { ArrowLeft, Lightbulb, Search, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const METRIC_CONFIG: Record<string, {
    title: string; subtitle: string; primaryField: string;
    columns: { key: string; label: string; format?: string }[];
    chartKey: string; chartColor: string;
}> = {
    revenue: {
        title: 'Revenue Details',
        subtitle: 'Per-SKU revenue breakdown with order counts and average selling price',
        primaryField: 'revenue',
        columns: [
            { key: 'revenue', label: 'Revenue', format: 'currency' },
            { key: 'units', label: 'Units Sold' },
            { key: 'avg_price', label: 'Avg Price', format: 'currency' },
            { key: 'order_count', label: 'Orders' },
            { key: 'fees', label: 'Fees', format: 'currency' },
        ],
        chartKey: 'revenue', chartColor: '#34d399',
    },
    'net-contribution': {
        title: 'Net Contribution Details',
        subtitle: 'Profit breakdown per SKU: Revenue − Fees − COGS − Shipping − Refunds',
        primaryField: 'net',
        columns: [
            { key: 'revenue', label: 'Revenue', format: 'currency' },
            { key: 'fees', label: 'Fees', format: 'currency' },
            { key: 'cogs', label: 'COGS', format: 'currency' },
            { key: 'refunds', label: 'Refunds', format: 'currency' },
            { key: 'net', label: 'Net', format: 'currency' },
            { key: 'margin', label: 'Margin %', format: 'pct' },
        ],
        chartKey: 'net', chartColor: '#818cf8',
    },
    'contribution-pct': {
        title: 'Contribution % Details',
        subtitle: 'Per-SKU margin analysis — what percentage of revenue is retained as profit',
        primaryField: 'margin',
        columns: [
            { key: 'revenue', label: 'Revenue', format: 'currency' },
            { key: 'margin', label: 'Margin %', format: 'pct' },
            { key: 'fees', label: 'Fees', format: 'currency' },
            { key: 'cogs', label: 'COGS', format: 'currency' },
            { key: 'net', label: 'Net', format: 'currency' },
        ],
        chartKey: 'net', chartColor: '#a78bfa',
    },
    'units-sold': {
        title: 'Units Sold Details',
        subtitle: 'Per-SKU volume breakdown with daily shipping trends',
        primaryField: 'units',
        columns: [
            { key: 'units', label: 'Units Sold' },
            { key: 'revenue', label: 'Revenue', format: 'currency' },
            { key: 'avg_price', label: 'Avg Price', format: 'currency' },
            { key: 'order_count', label: 'Orders' },
            { key: 'refund_units', label: 'Returned' },
            { key: 'return_rate', label: 'Return %', format: 'pct' },
        ],
        chartKey: 'units', chartColor: '#2dd4bf',
    },
    refunds: {
        title: 'Refund Details',
        subtitle: 'Per-SKU refund analysis — which products are being returned and why',
        primaryField: 'refunds',
        columns: [
            { key: 'refund_units', label: 'Units Returned' },
            { key: 'refunds', label: 'Refund Amount', format: 'currency' },
            { key: 'return_rate', label: 'Return %', format: 'pct' },
            { key: 'units', label: 'Units Sold' },
            { key: 'revenue', label: 'Revenue', format: 'currency' },
        ],
        chartKey: 'refunds', chartColor: '#f87171',
    },
    'inventory-value': {
        title: 'Inventory Value Details',
        subtitle: 'Per-SKU stock valuation and days of inventory remaining',
        primaryField: 'stock',
        columns: [
            { key: 'stock', label: 'In Stock' },
            { key: 'days_inv', label: 'Days Inv' },
            { key: 'avg_price', label: 'Unit Value', format: 'currency' },
            { key: 'units', label: 'Sold (period)' },
            { key: 'revenue', label: 'Revenue', format: 'currency' },
        ],
        chartKey: 'revenue', chartColor: '#fb923c',
    },
    'active-skus': {
        title: 'Active SKUs Details',
        subtitle: 'Inventory status per SKU with stock levels and sales velocity',
        primaryField: 'stock',
        columns: [
            { key: 'stock', label: 'In Stock' },
            { key: 'days_inv', label: 'Days Inv' },
            { key: 'units', label: 'Sold' },
            { key: 'revenue', label: 'Revenue', format: 'currency' },
            { key: 'return_rate', label: 'Return %', format: 'pct' },
        ],
        chartKey: 'units', chartColor: '#22d3ee',
    },
};

function fmt(value: number, format?: string): string {
    if (format === 'currency') {
        const sign = value < 0 ? '-' : '';
        return `${sign}₹${Math.abs(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
    }
    if (format === 'pct') return `${value}%`;
    return String(value);
}

function fmtShort(n: number): string {
    const abs = Math.abs(n);
    if (abs >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (abs >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${n.toFixed(0)}`;
}

const PERIODS = [
    { key: '7d', label: '7D' }, { key: '30d', label: '30D' }, { key: '90d', label: '90D' },
];

export default function KPIDetailPage() {
    const params = useParams();
    const metric = (params.metric as string) || 'revenue';
    const config = METRIC_CONFIG[metric] || METRIC_CONFIG.revenue;

    const [period, setPeriod] = useState('30d');
    const [customStart, setCustomStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0]; });
    const [customEnd, setCustomEnd] = useState(new Date().toISOString().split('T')[0]);
    const [useCustom, setUseCustom] = useState(false);
    const [skuSearch, setSkuSearch] = useState('');
    const [expandedSku, setExpandedSku] = useState<string | null>(null);
    const [sortKey, setSortKey] = useState(config.primaryField);
    const [sortAsc, setSortAsc] = useState(false);

    const dateQuery = useMemo(() => {
        if (useCustom) return `startDate=${customStart}&endDate=${customEnd}`;
        return `period=${period}`;
    }, [useCustom, period, customStart, customEnd]);

    const { data, loading, error } = useFetch<any>(
        `/api/command-center/kpi-detail?metric=${metric}&${dateQuery}`, [metric, dateQuery]
    );

    const filteredSkus = useMemo(() => {
        if (!data?.sku_breakdown) return [];
        let list = data.sku_breakdown;
        if (skuSearch) {
            const q = skuSearch.toLowerCase();
            list = list.filter((s: any) => s.sku.toLowerCase().includes(q) || s.title.toLowerCase().includes(q));
        }
        // For refunds, only show SKUs with refunds
        if (metric === 'refunds') list = list.filter((s: any) => s.refund_units > 0);
        // Sort
        list = [...list].sort((a: any, b: any) => {
            const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0;
            return sortAsc ? va - vb : vb - va;
        });
        return list;
    }, [data?.sku_breakdown, skuSearch, sortKey, sortAsc, metric]);

    const handleSort = (key: string) => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else { setSortKey(key); setSortAsc(false); }
    };

    return (
        <DashboardLayout>
            {/* Header */}
            <div className="flex items-center gap-4 mb-6">
                <Link href="/command-center"
                    className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-400 hover:text-white hover:border-white/20 transition-all">
                    <ArrowLeft size={14} /> Back
                </Link>
                <div>
                    <h1 className="text-xl font-bold text-white">{config.title}</h1>
                    <p className="text-xs text-slate-500 mt-0.5">{config.subtitle}</p>
                </div>
            </div>

            {/* Period Controls */}
            <div className="flex items-center gap-3 mb-6 flex-wrap">
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-0.5">
                    {PERIODS.map(p => (
                        <button key={p.key} onClick={() => { setPeriod(p.key); setUseCustom(false); }}
                            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${!useCustom && period === p.key
                                ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
                            {p.label}
                        </button>
                    ))}
                    <button onClick={() => setUseCustom(true)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${useCustom ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
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
            </div>

            {loading && (
                <div className="flex items-center justify-center py-20 text-slate-400">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-400 mr-3" />
                    Loading...
                </div>
            )}
            {error && <div className="text-red-400 text-sm py-4">Error: {error}</div>}

            {data && !loading && (
                <div className="space-y-6">
                    {/* Insights */}
                    {data.insights?.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {data.insights.map((ins: any, i: number) => (
                                <div key={i} className="bg-indigo-500/5 border border-indigo-500/15 rounded-xl p-4">
                                    <div className="flex items-center gap-2 mb-1.5">
                                        <Lightbulb size={14} className="text-indigo-400" />
                                        <p className="text-xs font-semibold text-indigo-400">{ins.title}</p>
                                    </div>
                                    <p className="text-xs text-slate-300 leading-relaxed">{ins.description}</p>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Daily Trend Chart */}
                    {data.daily_trend?.length > 1 && (
                        <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                            <h2 className="text-sm font-semibold text-white mb-4">Daily Trend</h2>
                            <div className="h-52">
                                <ResponsiveContainer width="100%" height="100%">
                                    {metric === 'units-sold' ? (
                                        <BarChart data={data.daily_trend}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                tickFormatter={(v: string) => v.slice(5)} />
                                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} />
                                            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
                                            <Bar dataKey={config.chartKey} fill={config.chartColor} radius={[3, 3, 0, 0]} />
                                        </BarChart>
                                    ) : (
                                        <AreaChart data={data.daily_trend}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                tickFormatter={(v: string) => v.slice(5)} />
                                            <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }}
                                                tickFormatter={(v: number) => fmtShort(v)} />
                                            <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                                                formatter={(v: any) => [`₹${Number(v).toLocaleString('en-IN')}`, config.chartKey]} />
                                            <defs>
                                                <linearGradient id="kpiGrad" x1="0" y1="0" x2="0" y2="1">
                                                    <stop offset="0%" stopColor={config.chartColor} stopOpacity={0.3} />
                                                    <stop offset="100%" stopColor={config.chartColor} stopOpacity={0} />
                                                </linearGradient>
                                            </defs>
                                            <Area type="monotone" dataKey={config.chartKey} stroke={config.chartColor}
                                                fill="url(#kpiGrad)" strokeWidth={2} />
                                        </AreaChart>
                                    )}
                                </ResponsiveContainer>
                            </div>
                        </div>
                    )}

                    {/* Per-SKU Table */}
                    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-sm font-semibold text-white">Per-SKU Breakdown</h2>
                            <div className="relative">
                                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input type="text" placeholder="Search..."
                                    value={skuSearch} onChange={e => setSkuSearch(e.target.value)}
                                    className="pl-7 pr-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-slate-300 outline-none focus:border-indigo-500/30 w-40" />
                            </div>
                        </div>

                        {/* Header */}
                        <div className="grid gap-2 px-3 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wider border-b border-white/5"
                            style={{ gridTemplateColumns: `3fr ${config.columns.map(() => '1fr').join(' ')}` }}>
                            <div>SKU</div>
                            {config.columns.map(col => (
                                <div key={col.key} className="text-right cursor-pointer hover:text-white transition-colors"
                                    onClick={() => handleSort(col.key)}>
                                    {col.label} {sortKey === col.key ? (sortAsc ? '↑' : '↓') : ''}
                                </div>
                            ))}
                        </div>

                        {/* Rows */}
                        <div className="max-h-[500px] overflow-y-auto">
                            {filteredSkus.map((s: any) => (
                                <div key={s.sku}>
                                    <div className="grid gap-2 px-3 py-2.5 items-center hover:bg-white/[0.02] cursor-pointer border-b border-white/[0.03] transition-colors"
                                        style={{ gridTemplateColumns: `3fr ${config.columns.map(() => '1fr').join(' ')}` }}
                                        onClick={() => setExpandedSku(expandedSku === s.sku ? null : s.sku)}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            {expandedSku === s.sku ? <ChevronUp size={12} className="text-slate-500 shrink-0" /> : <ChevronDown size={12} className="text-slate-500 shrink-0" />}
                                            <div className="min-w-0">
                                                <p className="text-xs font-mono text-slate-400 truncate">{s.sku}</p>
                                                <p className="text-[10px] text-slate-600 truncate">{s.title}</p>
                                            </div>
                                        </div>
                                        {config.columns.map(col => (
                                            <div key={col.key} className={`text-right text-xs ${col.format === 'currency' && s[col.key] < 0 ? 'text-red-400'
                                                : col.format === 'currency' && s[col.key] > 0 ? 'text-emerald-400'
                                                    : col.format === 'pct' && s[col.key] > 20 ? 'text-red-400'
                                                        : 'text-slate-300'
                                                }`}>
                                                {fmt(s[col.key] ?? 0, col.format)}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Expanded */}
                                    {expandedSku === s.sku && (
                                        <div className="bg-white/[0.02] border-l-2 border-indigo-500/30 px-5 py-3 text-xs space-y-1.5">
                                            <div className="flex justify-between"><span className="text-slate-500">Gross Revenue</span><span className="text-emerald-400">{fmt(s.revenue, 'currency')}</span></div>
                                            <div className="flex justify-between"><span className="text-slate-500">Amazon Fees</span><span className="text-red-400">{fmt(s.fees, 'currency')}</span></div>
                                            <div className="flex justify-between"><span className="text-slate-500">COGS</span><span className="text-slate-300">{fmt(s.cogs, 'currency')}{s.cogs === 0 ? ' (not set)' : ''}</span></div>
                                            <div className="flex justify-between"><span className="text-slate-500">Shipping & Packaging</span><span className="text-slate-300">{fmt(s.shipping, 'currency')}</span></div>
                                            <div className="flex justify-between"><span className="text-slate-500">Refunds</span><span className="text-amber-400">{fmt(s.refunds, 'currency')} ({s.refund_units} units)</span></div>
                                            <div className="border-t border-white/5 pt-1.5 flex justify-between font-semibold">
                                                <span className="text-slate-300">Net Contribution</span>
                                                <span className={s.net >= 0 ? 'text-emerald-400' : 'text-red-400'}>{fmt(s.net, 'currency')}</span>
                                            </div>
                                            <div className="flex justify-between pt-1 text-slate-500">
                                                <span>Margin</span><span>{s.margin}%</span>
                                            </div>
                                            <div className="flex justify-between text-slate-500">
                                                <span>Return Rate</span><span>{s.return_rate}%</span>
                                            </div>
                                            <div className="flex justify-between text-slate-500">
                                                <span>In Stock</span><span>{s.stock} units ({s.days_inv} days)</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Totals Row */}
                        {filteredSkus.length > 0 && (
                            <div className="grid gap-2 px-3 py-3 items-center border-t-2 border-indigo-500/20 bg-white/[0.03]"
                                style={{ gridTemplateColumns: `3fr ${config.columns.map(() => '1fr').join(' ')}` }}>
                                <div className="text-xs font-bold text-white uppercase tracking-wider">
                                    Total ({filteredSkus.length} SKUs)
                                </div>
                                {config.columns.map(col => {
                                    const total = filteredSkus.reduce((sum: number, s: any) => sum + (Number(s[col.key]) || 0), 0);
                                    const isAvg = col.key === 'avg_price' || col.key === 'margin' || col.key === 'return_rate' || col.key === 'days_inv';
                                    const displayVal = isAvg
                                        ? Math.round((total / filteredSkus.length) * 10) / 10
                                        : Math.round(total * 100) / 100;
                                    return (
                                        <div key={col.key} className={`text-right text-xs font-bold ${col.format === 'currency' && displayVal < 0 ? 'text-red-400'
                                                : col.format === 'currency' && displayVal > 0 ? 'text-emerald-400'
                                                    : 'text-white'
                                            }`}>
                                            {isAvg ? `avg ${fmt(displayVal, col.format)}` : fmt(displayVal, col.format)}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {filteredSkus.length === 0 && (
                            <p className="text-center text-slate-500 text-xs py-8">No data</p>
                        )}
                    </div>
                </div>
            )}
        </DashboardLayout>
    );
}

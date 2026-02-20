'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import StatsGrid from '@/components/cards/StatsGrid';
import ChartTooltip from '@/components/charts/ChartTooltip';
import { useFetch } from '@/hooks/useFetch';
import { formatCurrency } from '@/lib/utils';
import { BarChart3, DollarSign, TrendingUp, Package, ShoppingBag, MapPin } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function AnalyticsPage() {
    const { data, loading, error, refresh } = useFetch<any>('/api/orders?days=90');

    const orders = data?.orders || [];

    // Process data for charts
    const dailyRevenue = orders.reduce((acc: any, o: any) => {
        const day = new Date(o.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        const amt = parseFloat(o.amount?.replace(/[₹,]/g, '') || '0');
        acc[day] = (acc[day] || 0) + amt;
        return acc;
    }, {} as Record<string, number>);

    const revenueData = Object.entries(dailyRevenue)
        .map(([date, revenue]) => ({ date, revenue }))
        .slice(-14);

    // Top cities
    const cityRevenue = orders.reduce((acc: any, o: any) => {
        const city = o.city || 'Unknown';
        const amt = parseFloat(o.amount?.replace(/[₹,]/g, '') || '0');
        acc[city] = (acc[city] || 0) + amt;
        return acc;
    }, {} as Record<string, number>);

    const topCities = Object.entries(cityRevenue)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 5)
        .map(([name, value]) => ({ name, value: value as number }));

    // Order status distribution
    const statusDist = orders.reduce((acc: any, o: any) => {
        acc[o.status] = (acc[o.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    const statusData = Object.entries(statusDist).map(([name, value]) => ({ name, value }));

    const totalRevenue = orders.reduce((s: number, o: any) => s + parseFloat(o.amount?.replace(/[₹,]/g, '') || '0'), 0);
    const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;

    const statItems = [
        { label: 'Total Revenue (90d)', value: formatCurrency(totalRevenue), icon: DollarSign, color: 'text-emerald-400' },
        { label: 'Total Orders', value: orders.length, icon: ShoppingBag, color: 'text-indigo-400' },
        { label: 'Avg Order Value', value: formatCurrency(avgOrderValue), icon: TrendingUp, color: 'text-amber-400' },
        { label: 'Top City', value: topCities[0]?.name || '—', icon: MapPin, color: 'text-blue-400' },
    ];

    if (error) return <DashboardLayout><div className="text-red-400 text-center py-20">Error: {error}</div></DashboardLayout>;

    return (
        <DashboardLayout>
            <PageHeader
                title="Analytics"
                subtitle="Sales analytics and performance insights (last 90 days)"
                icon={BarChart3}
                iconColor="text-violet-400"
                loading={loading}
                onRefresh={refresh}
            />

            {loading ? (
                <div className="text-center text-slate-500 py-20">Loading analytics...</div>
            ) : (
                <>
                    <StatsGrid items={statItems} columns={4} />

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* Daily Revenue Chart */}
                        <div className="lg:col-span-2 bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                            <h3 className="text-white font-semibold mb-4">Daily Revenue</h3>
                            <ResponsiveContainer width="100%" height={280}>
                                <BarChart data={revenueData}>
                                    <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}
                                        tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                    <Tooltip content={<ChartTooltip />} />
                                    <Bar dataKey="revenue" fill="#6366f1" radius={[6, 6, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Order Status Pie */}
                        <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                            <h3 className="text-white font-semibold mb-4">Order Status</h3>
                            <ResponsiveContainer width="100%" height={200}>
                                <PieChart>
                                    <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%"
                                        outerRadius={80} innerRadius={40} paddingAngle={3}>
                                        {statusData.map((_, i) => (
                                            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="mt-2 space-y-1">
                                {statusData.map((s: any, i: number) => (
                                    <div key={s.name} className="flex items-center justify-between text-xs">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                                            <span className="text-slate-400 capitalize">{s.name}</span>
                                        </div>
                                        <span className="text-white font-medium">{s.value}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Top Cities */}
                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                        <h3 className="text-white font-semibold mb-4">Top Cities by Revenue</h3>
                        <div className="space-y-3">
                            {topCities.map((c: any, i) => (
                                <div key={c.name} className="flex items-center gap-4">
                                    <span className="text-xs text-slate-600 w-4">{i + 1}.</span>
                                    <span className="text-sm text-white flex-1">{c.name}</span>
                                    <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-500 rounded-full"
                                            style={{ width: `${(c.value / (topCities[0]?.value || 1)) * 100}%` }} />
                                    </div>
                                    <span className="text-sm text-slate-400">{formatCurrency(c.value)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </DashboardLayout>
    );
}

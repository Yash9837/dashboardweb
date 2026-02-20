'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import StatsGrid from '@/components/cards/StatsGrid';
import ChartTooltip from '@/components/charts/ChartTooltip';
import { useFetch } from '@/hooks/useFetch';
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, DollarSign, CalendarDays, ShoppingBag, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function SalesPage() {
    const { data, loading, error, refresh } = useFetch<any>('/api/orders?days=30');

    const orders = data?.orders || [];

    // Process daily sales
    const dailySales = orders.reduce((acc: any, o: any) => {
        const day = new Date(o.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        const amt = parseFloat(o.amount?.replace(/[₹,]/g, '') || '0');
        acc[day] = (acc[day] || 0) + amt;
        return acc;
    }, {} as Record<string, number>);

    const chartData = Object.entries(dailySales).map(([date, revenue]) => ({ date, revenue }));
    const totalRevenue = orders.reduce((s: number, o: any) => s + parseFloat(o.amount?.replace(/[₹,]/g, '') || '0'), 0);
    const avgDaily = chartData.length ? totalRevenue / chartData.length : 0;
    const avgOrderValue = orders.length ? totalRevenue / orders.length : 0;
    const bestDay = chartData.reduce((max: any, d: any) => (d.revenue > (max?.revenue || 0) ? d : max), null);

    const statItems = [
        { label: 'Total Revenue', value: formatCurrency(totalRevenue), icon: DollarSign, color: 'text-emerald-400' },
        { label: 'Total Orders', value: orders.length, icon: ShoppingBag, color: 'text-indigo-400' },
        { label: 'Avg Daily Revenue', value: formatCurrency(avgDaily), icon: CalendarDays, color: 'text-blue-400' },
        { label: 'Avg Order Value', value: formatCurrency(avgOrderValue), icon: TrendingUp, color: 'text-amber-400' },
    ];

    if (error) return <DashboardLayout><div className="text-red-400 text-center py-20">Error: {error}</div></DashboardLayout>;

    return (
        <DashboardLayout>
            <PageHeader
                title="Sales & Revenue"
                subtitle="Revenue trends and sales performance (last 30 days)"
                icon={TrendingUp}
                iconColor="text-emerald-400"
                loading={loading}
                onRefresh={refresh}
            />

            {loading ? (
                <div className="text-center text-slate-500 py-20">Loading sales data...</div>
            ) : (
                <>
                    <StatsGrid items={statItems} columns={4} />

                    {/* Daily Revenue Chart */}
                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-white font-semibold flex items-center gap-2">
                                <BarChart3 size={18} className="text-indigo-400" /> Daily Sales
                            </h3>
                            {bestDay && (
                                <span className="text-xs text-slate-500">
                                    Best day: <span className="text-emerald-400 font-medium">{bestDay.date}</span> ({formatCurrency(bestDay.revenue)})
                                </span>
                            )}
                        </div>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={chartData}>
                                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}
                                    tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}K`} />
                                <Tooltip content={<ChartTooltip />} />
                                <Bar dataKey="revenue" fill="#6366f1" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </DashboardLayout>
    );
}

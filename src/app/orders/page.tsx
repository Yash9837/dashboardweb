'use client';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import StatsGrid from '@/components/cards/StatsGrid';
import FilterTabs from '@/components/ui/FilterTabs';
import { useFetch } from '@/hooks/useFetch';
import { formatCurrency, formatDate, getStatusColor } from '@/lib/utils';
import { ShoppingBag, Package, Truck, Clock, Ban, Calendar } from 'lucide-react';

export default function OrdersPage() {
    const [days, setDays] = useState(30);
    const [statusFilter, setStatusFilter] = useState('all');
    const { data, loading, error, refresh } = useFetch<any>(`/api/orders?days=${days}`, [days]);

    const orders = data?.orders || [];
    const stats = data?.stats || {};

    const filteredOrders = statusFilter === 'all'
        ? orders
        : orders.filter((o: any) => o.status === statusFilter);

    const statItems = [
        { label: 'Total Orders', value: stats.total, icon: ShoppingBag, color: 'text-indigo-400' },
        { label: 'Delivered', value: stats.delivered, icon: Truck, color: 'text-emerald-400' },
        { label: 'Processing', value: stats.processing, icon: Package, color: 'text-amber-400' },
        { label: 'Pending', value: stats.pending, icon: Clock, color: 'text-slate-400' },
        { label: 'Cancelled', value: stats.cancelled, icon: Ban, color: 'text-red-400' },
        { label: 'Revenue', value: stats.revenue ? formatCurrency(stats.revenue) : '—', icon: ShoppingBag, color: 'text-indigo-400' },
    ];

    const filterTabs = [
        { key: 'all', label: 'All', count: orders.length },
        { key: 'delivered', label: 'Delivered', count: orders.filter((o: any) => o.status === 'delivered').length },
        { key: 'shipped', label: 'Shipped', count: orders.filter((o: any) => o.status === 'shipped').length },
        { key: 'processing', label: 'Processing', count: orders.filter((o: any) => o.status === 'processing').length },
        { key: 'pending', label: 'Pending', count: orders.filter((o: any) => o.status === 'pending').length },
        { key: 'cancelled', label: 'Cancelled', count: orders.filter((o: any) => o.status === 'cancelled').length },
    ];

    if (error) return <DashboardLayout><div className="text-red-400 text-center py-20">Error: {error}</div></DashboardLayout>;

    return (
        <DashboardLayout>
            <PageHeader
                title="Orders"
                subtitle="Track and manage your Amazon orders"
                icon={ShoppingBag}
                iconColor="text-indigo-400"
                loading={loading}
                onRefresh={refresh}
                actions={
                    <select
                        value={days}
                        onChange={e => setDays(Number(e.target.value))}
                        className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
                    >
                        {[7, 15, 30, 60, 90].map(d => (
                            <option key={d} value={d} className="bg-[#0f1419]">{d} days</option>
                        ))}
                    </select>
                }
            />

            {loading ? (
                <div className="text-center text-slate-500 py-20">Loading orders...</div>
            ) : (
                <>
                    <StatsGrid items={statItems} />

                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white">Order History</h2>
                            <FilterTabs tabs={filterTabs} activeKey={statusFilter} onChange={setStatusFilter} />
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/5">
                                        {['Order ID', 'Product', 'Date', 'Qty', 'Amount', 'Status', 'Channel'].map(h => (
                                            <th key={h} className="text-left text-xs text-slate-500 font-medium py-3 px-2">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredOrders.map((order: any) => {
                                        const firstProduct = order.products?.[0];
                                        const moreCount = (order.products?.length || 0) - 1;

                                        return (
                                            <tr key={order.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                                                <td className="py-3 px-2 text-sm text-white font-mono">{order.id}</td>
                                                <td className="py-3 px-2">
                                                    {firstProduct ? (
                                                        <div className="flex items-center gap-3 min-w-[200px]">
                                                            {firstProduct.image ? (
                                                                <img
                                                                    src={firstProduct.image}
                                                                    alt={firstProduct.title}
                                                                    className="w-10 h-10 rounded-lg object-cover border border-white/10 flex-shrink-0"
                                                                />
                                                            ) : (
                                                                <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                                                                    <Package className="w-4 h-4 text-slate-600" />
                                                                </div>
                                                            )}
                                                            <div className="min-w-0">
                                                                <p className="text-sm text-white truncate max-w-[200px]" title={firstProduct.title}>
                                                                    {firstProduct.title}
                                                                </p>
                                                                <p className="text-xs text-slate-500">
                                                                    {firstProduct.asin}
                                                                    {moreCount > 0 && (
                                                                        <span className="ml-2 text-indigo-400">+{moreCount} more</span>
                                                                    )}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <span className="text-sm text-slate-600">—</span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-2 text-sm text-slate-400">{formatDate(order.date)}</td>
                                                <td className="py-3 px-2 text-sm text-slate-400">{order.items}</td>
                                                <td className="py-3 px-2 text-sm text-white font-medium">{order.amount}</td>
                                                <td className="py-3 px-2">
                                                    <span className={`text-xs px-2 py-1 rounded-lg border ${getStatusColor(order.status)}`}>
                                                        {order.displayStatus}
                                                    </span>
                                                </td>
                                                <td className="py-3 px-2 text-sm text-slate-500">{order.channel || '—'}</td>
                                            </tr>
                                        );
                                    })}
                                    {filteredOrders.length === 0 && (
                                        <tr><td colSpan={7} className="text-center text-slate-600 py-8">No orders found</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}
        </DashboardLayout>
    );
}


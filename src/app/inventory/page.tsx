'use client';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import StatsGrid from '@/components/cards/StatsGrid';
import FilterTabs from '@/components/ui/FilterTabs';
import { useFetch } from '@/hooks/useFetch';
import { getStatusColor } from '@/lib/utils';
import { Package, Boxes, AlertTriangle, XCircle, ArrowUpDown, TrendingUp } from 'lucide-react';

const PAGE_SIZE = 25;

export default function InventoryPage() {
    const [statusFilter, setStatusFilter] = useState('all');
    const [page, setPage] = useState(1);
    const { data, loading, error, refresh } = useFetch<any>('/api/inventory?fulfillment=fbm');

    const items = data?.items || [];
    const stats = data?.stats || {};

    const filteredItems = statusFilter === 'all'
        ? items
        : items.filter((i: any) => i.status === statusFilter);
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
    const startIndex = (page - 1) * PAGE_SIZE;
    const paginatedItems = filteredItems.slice(startIndex, startIndex + PAGE_SIZE);
    const rangeStart = filteredItems.length === 0 ? 0 : startIndex + 1;
    const rangeEnd = Math.min(startIndex + PAGE_SIZE, filteredItems.length);

    useEffect(() => {
        setPage(1);
    }, [statusFilter, items.length]);

    useEffect(() => {
        if (page > totalPages) {
            setPage(totalPages);
        }
    }, [page, totalPages]);

    const statItems = [
        { label: 'Total SKUs', value: stats.totalSkus, icon: Boxes, color: 'text-indigo-400' },
        { label: 'Total Units', value: stats.totalUnits?.toLocaleString('en-IN'), icon: Package, color: 'text-emerald-400' },
        { label: 'FBA', value: stats.fbaCount, icon: TrendingUp, color: 'text-blue-400' },
        { label: 'FBM', value: stats.fbmCount, icon: ArrowUpDown, color: 'text-purple-400' },
        { label: 'Low Stock', value: stats.lowStock, icon: AlertTriangle, color: 'text-amber-400' },
        { label: 'Out of Stock', value: stats.outOfStock, icon: XCircle, color: 'text-red-400' },
    ];

    const filterTabs = [
        { key: 'all', label: 'All', count: items.length },
        { key: 'in-stock', label: 'In Stock', count: items.filter((i: any) => i.status === 'in-stock').length },
        { key: 'low-stock', label: 'Low Stock', count: items.filter((i: any) => i.status === 'low-stock').length },
        { key: 'out-of-stock', label: 'Out of Stock', count: items.filter((i: any) => i.status === 'out-of-stock').length },
    ];

    const handleFilterChange = (nextFilter: string) => {
        setStatusFilter(nextFilter);
        setPage(1);
    };

    if (error) return <DashboardLayout><div className="text-red-400 text-center py-20">Error: {error}</div></DashboardLayout>;

    return (
        <DashboardLayout>
            <PageHeader
                title="FBM Inventory"
                subtitle="Monitor your Fulfillment by Merchant inventory levels"
                icon={Package}
                iconColor="text-emerald-400"
                loading={loading}
                onRefresh={refresh}
            />

            {loading ? (
                <div className="text-center text-slate-500 py-20">Loading inventory...</div>
            ) : (
                <>
                    <StatsGrid items={statItems} />

                    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-white">Inventory Items</h2>
                            <FilterTabs tabs={filterTabs} activeKey={statusFilter} onChange={handleFilterChange} />
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="border-b border-white/5">
                                        {['Product', 'SKU', 'ASIN', 'Price', 'Stock', 'Channel', 'Status'].map(h => (
                                            <th key={h} className="text-left text-xs text-slate-500 font-medium py-3 px-2">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {paginatedItems.map((item: any, idx: number) => {
                                        const rowKey = item.sku || `${item.asin || 'no-asin'}-${item.fulfillmentChannel || 'unknown'}-${startIndex + idx}`;
                                        return (
                                            <tr key={rowKey} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                                            <td className="py-3 px-2">
                                                <div className="flex items-center gap-3 min-w-[200px]">
                                                    {item.image ? (
                                                        <img
                                                            src={item.image}
                                                            alt={item.name}
                                                            className="w-10 h-10 rounded-lg object-cover border border-white/10 flex-shrink-0"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                                                            <Package className="w-4 h-4 text-slate-600" />
                                                        </div>
                                                    )}
                                                    <div className="min-w-0">
                                                        <p className="text-sm text-white truncate max-w-[220px]" title={item.name}>
                                                            {item.name}
                                                        </p>
                                                        {item.brand && (
                                                            <p className="text-xs text-slate-500">{item.brand}</p>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="py-3 px-2 text-sm text-slate-400 font-mono text-xs">{item.sku}</td>
                                            <td className="py-3 px-2 text-sm text-indigo-400 font-mono text-xs">{item.asin}</td>
                                            <td className="py-3 px-2 text-sm text-white font-medium">{item.price ? `₹${item.price.toLocaleString('en-IN')}` : '—'}</td>
                                            <td className="py-3 px-2 text-sm text-white font-medium">{item.stock ?? 0}</td>
                                            <td className="py-3 px-2">
                                                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${(item.fulfillmentChannel || '').includes('FBA') || (item.fulfillmentChannel || '').includes('AMAZON')
                                                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                                                    }`}>
                                                    {(item.fulfillmentChannel || '').includes('FBA') || (item.fulfillmentChannel || '').includes('AMAZON') ? 'FBA' : 'FBM'}
                                                </span>
                                            </td>
                                            <td className="py-3 px-2">
                                                <span className={`text-xs px-2 py-1 rounded-lg border ${getStatusColor(item.status)}`}>
                                                    {item.status}
                                                </span>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    {paginatedItems.length === 0 && (
                                        <tr><td colSpan={8} className="text-center text-slate-600 py-8">No items found</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>

                        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <p className="text-xs text-slate-500">
                                Showing {rangeStart}-{rangeEnd} of {filteredItems.length} items
                            </p>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setPage(prev => Math.max(1, prev - 1))}
                                    disabled={page === 1}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Previous
                                </button>
                                <span className="text-xs text-slate-400 min-w-[100px] text-center">
                                    Page {page} of {totalPages}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
                                    disabled={page >= totalPages}
                                    className="px-3 py-1.5 text-xs rounded-lg border border-white/10 text-slate-300 hover:border-white/20 disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </DashboardLayout>
    );
}

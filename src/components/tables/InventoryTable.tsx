'use client';
import { getStatusColor } from '@/lib/utils';
import { AlertTriangle, Package } from 'lucide-react';

interface InventoryItem {
    sku: string;
    name: string;
    platform: string;
    stock: number;
    maxStock: number;
    status: string;
    asin?: string;
    fulfillableQty?: number;
    inboundQty?: number;
    reservedQty?: number;
}

export default function InventoryTable({ items }: { items: InventoryItem[] }) {
    if (!items || items.length === 0) {
        return (
            <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
                <h3 className="text-white font-semibold text-lg">FBA Inventory</h3>
                <p className="text-sm text-slate-500 mt-0.5 mb-4">No inventory data found</p>
                <div className="flex items-center justify-center h-40 text-sm text-slate-500">
                    No FBA inventory items
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h3 className="text-white font-semibold text-lg">FBA Inventory</h3>
                    <p className="text-sm text-slate-500 mt-0.5">{items.length} SKUs from Amazon FBA — live data</p>
                </div>
                <span className="flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-400 px-2 py-1 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    Live
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-white/5">
                            {['Product', 'SKU', 'ASIN', 'Fulfillable', 'Inbound', 'Reserved', 'Total', 'Status'].map(h => (
                                <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider first:pl-0 last:pr-0">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {items.map((item) => (
                            <tr key={item.sku} className="hover:bg-white/[0.02] transition-colors group">
                                <td className="py-3 px-3 first:pl-0">
                                    <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center shrink-0">
                                            <Package size={16} className="text-slate-500" />
                                        </div>
                                        <span className="text-sm text-slate-200 font-medium truncate max-w-[200px]">{item.name}</span>
                                    </div>
                                </td>
                                <td className="py-3 px-3 text-xs text-slate-400 font-mono">{item.sku}</td>
                                <td className="py-3 px-3 text-xs text-slate-400 font-mono">{item.asin || '—'}</td>
                                <td className="py-3 px-3 text-sm text-slate-300">{item.fulfillableQty ?? item.stock}</td>
                                <td className="py-3 px-3 text-sm text-slate-400">{item.inboundQty ?? 0}</td>
                                <td className="py-3 px-3 text-sm text-slate-400">{item.reservedQty ?? 0}</td>
                                <td className="py-3 px-3">
                                    <div className="flex items-center gap-3">
                                        <div className="w-16 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full rounded-full transition-all duration-500"
                                                style={{
                                                    width: `${Math.max((item.stock / item.maxStock) * 100, 2)}%`,
                                                    backgroundColor: item.status === 'in-stock' ? '#22c55e' : item.status === 'low-stock' ? '#f59e0b' : '#ef4444',
                                                }}
                                            />
                                        </div>
                                        <span className="text-xs text-slate-400 w-6">{item.stock}</span>
                                    </div>
                                </td>
                                <td className="py-3 px-3 last:pr-0">
                                    <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${getStatusColor(item.status)}`}>
                                        {item.status === 'in-stock' ? 'In Stock' : item.status === 'low-stock' ? 'Low Stock' : 'Out of Stock'}
                                    </span>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

interface LowStockAlertsProps {
    items: InventoryItem[];
    loading?: boolean;
    limit?: number;
}

export function LowStockAlerts({ items, loading = false, limit = 6 }: LowStockAlertsProps) {
    const alertItems = (items || [])
        .filter(i => i.status !== 'in-stock')
        .sort((a, b) => {
            if (a.status !== b.status) {
                if (a.status === 'out-of-stock') return -1;
                if (b.status === 'out-of-stock') return 1;
            }
            return a.stock - b.stock;
        });
    const visibleAlerts = alertItems.slice(0, limit);

    if (loading) {
        return (
            <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle size={18} className="text-amber-400" />
                    <h3 className="text-white font-semibold text-lg">Stock Alerts</h3>
                </div>
                <div className="space-y-3">
                    {Array.from({ length: 3 }).map((_, idx) => (
                        <div key={idx} className="h-16 rounded-xl bg-white/5 border border-white/10 animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (alertItems.length === 0) {
        return (
            <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle size={18} className="text-emerald-400" />
                    <h3 className="text-white font-semibold text-lg">Stock Alerts</h3>
                </div>
                <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15 text-center">
                    <p className="text-sm text-emerald-400">✅ All items are in stock</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
                <AlertTriangle size={18} className="text-amber-400" />
                <h3 className="text-white font-semibold text-lg">Stock Alerts</h3>
                <span className="ml-auto text-xs bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-medium">{alertItems.length} items</span>
            </div>

            <div className="space-y-3">
                {visibleAlerts.map(item => (
                    <div
                        key={item.sku || item.asin}
                        className={`p-3 rounded-xl border transition-colors ${item.stock === 0
                                ? 'bg-red-500/5 border-red-500/15 hover:border-red-500/30'
                                : 'bg-amber-500/5 border-amber-500/15 hover:border-amber-500/30'
                            }`}
                    >
                        <div className="flex items-center justify-between mb-2">
                            <p className="text-sm text-white font-medium truncate max-w-[200px]">{item.name}</p>
                            <span className={`text-xs font-bold ${item.stock === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                                {item.stock === 0 ? 'OUT OF STOCK' : `${item.stock} left`}
                            </span>
                        </div>
                        <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-700"
                                style={{
                                    width: `${Math.max((item.stock / item.maxStock) * 100, 2)}%`,
                                    backgroundColor: item.stock === 0 ? '#ef4444' : '#f59e0b',
                                }}
                            />
                        </div>
                        <div className="flex justify-between mt-1.5 text-xs text-slate-500">
                            <span>{item.sku} · {item.asin || ''}</span>
                            <span>{item.stock}/{item.maxStock}</span>
                        </div>
                    </div>
                ))}
            </div>

            {alertItems.length > visibleAlerts.length && (
                <p className="mt-3 text-xs text-slate-500 text-right">
                    Showing {visibleAlerts.length} of {alertItems.length} alerts
                </p>
            )}
        </div>
    );
}

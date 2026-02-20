'use client';
import { getStatusColor, formatDate, formatTime } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

interface Order {
    id: string;
    date: string;
    platform: string;
    customer: string;
    items: number;
    total: number;
    currency: string;
    status: string;
}

export default function OrdersTable({ orders }: { orders: Order[] }) {
    if (!orders || orders.length === 0) {
        return (
            <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
                <h3 className="text-white font-semibold text-lg">Recent Orders</h3>
                <p className="text-sm text-slate-500 mt-0.5 mb-4">Latest orders across all platforms</p>
                <div className="flex items-center justify-center h-40 text-sm text-slate-500">
                    No orders found
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
                <div>
                    <h3 className="text-white font-semibold text-lg">Recent Orders</h3>
                    <p className="text-sm text-slate-500 mt-0.5">Latest {orders.length} orders — live from Amazon</p>
                </div>
                <span className="flex items-center gap-1 text-xs bg-emerald-500/15 text-emerald-400 px-2 py-1 rounded-full font-medium">
                    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
                    Live Data
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-white/5">
                            {['Order ID', 'Date', 'Platform', 'Location', 'Items', 'Total', 'Status'].map(h => (
                                <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider first:pl-0 last:pr-0">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {orders.map((order) => (
                            <tr key={order.id} className="hover:bg-white/[0.02] transition-colors cursor-pointer group">
                                <td className="py-3 px-3 first:pl-0">
                                    <span className="text-sm text-indigo-400 font-mono group-hover:text-indigo-300 transition-colors">
                                        {order.id.length > 16 ? order.id.slice(0, 16) + '…' : order.id}
                                    </span>
                                </td>
                                <td className="py-3 px-3">
                                    <div>
                                        <p className="text-sm text-slate-300">{formatDate(order.date)}</p>
                                        <p className="text-xs text-slate-600">{formatTime(order.date)}</p>
                                    </div>
                                </td>
                                <td className="py-3 px-3">
                                    <span className="text-xs font-medium px-2 py-1 rounded-md bg-indigo-500/10 text-indigo-400">
                                        {order.platform}
                                    </span>
                                </td>
                                <td className="py-3 px-3 text-sm text-slate-300 max-w-[150px] truncate">{order.customer}</td>
                                <td className="py-3 px-3 text-sm text-slate-400 text-center">{order.items}</td>
                                <td className="py-3 px-3 text-sm text-white font-medium">₹{order.total.toFixed(0)}</td>
                                <td className="py-3 px-3 last:pr-0">
                                    <span className={`text-xs font-medium px-2.5 py-1 rounded-lg border ${getStatusColor(order.status)}`}>
                                        {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
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

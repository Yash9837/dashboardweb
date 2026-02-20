'use client';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Unplug } from 'lucide-react';

interface PlatformSale {
    name: string;
    value: number;
    color: string;
}

interface OrderStatus {
    status: string;
    count: number;
    color: string;
}

interface PlatformInfo {
    connected: boolean;
    error?: string;
}

const PieTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0];
    return (
        <div className="bg-[#1a2035] border border-white/10 rounded-xl p-3 shadow-2xl">
            <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.payload.color }} />
                <span className="text-sm text-white font-medium">{d.name}</span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
                {typeof d.value === 'number' && d.value > 1000 ? `₹${(d.value / 1000).toFixed(1)}K` : `${d.value}`}
            </p>
        </div>
    );
};

function NotConnectedBadge({ platform }: { platform: string }) {
    return (
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/50 border border-white/5 rounded-lg">
            <Unplug size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">{platform} — Not Connected</span>
        </div>
    );
}

export function PlatformPieChart({
    data,
    platforms,
}: {
    data: PlatformSale[];
    platforms: Record<string, PlatformInfo>;
}) {
    if (!data || !platforms) return null;
    const total = data.reduce((s, p) => s + p.value, 0);
    const filtered = data.filter(p => p.value > 0);
    const disconnected = Object.entries(platforms).filter(([, v]) => !v.connected);

    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <h3 className="text-white font-semibold text-lg mb-1">Sales by Platform</h3>
            <p className="text-sm text-slate-500 mb-4">Revenue distribution</p>

            {filtered.length > 0 ? (
                <div className="flex items-center gap-6">
                    <div className="w-[160px] h-[160px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={filtered} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="value" strokeWidth={0}>
                                    {filtered.map((e, i) => <Cell key={i} fill={e.color} />)}
                                </Pie>
                                <Tooltip content={<PieTooltip />} />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-3">
                        {filtered.map((p, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                                    <span className="text-sm text-slate-300">{p.name}</span>
                                </div>
                                <div className="text-right">
                                    <span className="text-sm text-white font-medium">₹{(p.value / 1000).toFixed(0)}K</span>
                                    <span className="text-xs text-slate-500 ml-2">{total > 0 ? ((p.value / total) * 100).toFixed(0) : 0}%</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex items-center justify-center h-[160px] text-sm text-slate-500">
                    No sales data available
                </div>
            )}

            {/* Show disconnected platforms */}
            {disconnected.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
                    {disconnected.map(([key]) => (
                        <NotConnectedBadge key={key} platform={key.charAt(0).toUpperCase() + key.slice(1)} />
                    ))}
                </div>
            )}
        </div>
    );
}

export function OrderStatusChart({ data }: { data: OrderStatus[] }) {
    const total = data.reduce((s, d) => s + d.count, 0);

    if (total === 0) {
        return (
            <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
                <h3 className="text-white font-semibold text-lg mb-1">Order Status</h3>
                <div className="flex items-center justify-center h-[160px] text-sm text-slate-500">
                    No order data available
                </div>
            </div>
        );
    }

    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <h3 className="text-white font-semibold text-lg mb-1">Order Status</h3>
            <p className="text-sm text-slate-500 mb-4">Distribution of {total} orders</p>

            <div className="flex items-center gap-6">
                <div className="w-[160px] h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                            <Pie data={data} cx="50%" cy="50%" innerRadius={48} outerRadius={72} dataKey="count" strokeWidth={0}>
                                {data.map((e, i) => <Cell key={i} fill={e.color} />)}
                            </Pie>
                            <Tooltip content={<PieTooltip />} />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                <div className="flex-1 space-y-2.5">
                    {data.map((d, i) => (
                        <div key={i} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                                <span className="text-sm text-slate-300">{d.status}</span>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="w-20 h-1.5 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full rounded-full transition-all duration-500"
                                        style={{ width: `${(d.count / total) * 100}%`, backgroundColor: d.color }}
                                    />
                                </div>
                                <span className="text-xs text-slate-400 w-8 text-right">{d.count}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

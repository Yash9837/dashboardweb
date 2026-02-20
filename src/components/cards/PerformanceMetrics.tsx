'use client';
import { Unplug, BarChart3, ArrowUpRight, Timer, Undo2, CheckCircle2 } from 'lucide-react';

interface PlatformInfo {
    connected: boolean;
    error?: string;
    lastSync?: string;
}

interface PlatformStats {
    totalOrders: number;
    totalRevenue: number;
    returnedOrders: number;
}

export default function PerformanceMetrics({
    platforms,
    stats,
}: {
    platforms: Record<string, PlatformInfo>;
    stats: PlatformStats;
}) {
    return (
        <div className="bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-6">
            <div className="flex items-center gap-2 mb-5">
                <BarChart3 size={18} className="text-indigo-400" />
                <h3 className="text-white font-semibold text-lg">Platform Status</h3>
            </div>

            <div className="space-y-4">
                {/* Amazon — connected */}
                {platforms.amazon?.connected && (
                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold px-2.5 py-1 rounded-lg bg-indigo-500/10 text-indigo-400">Amazon</span>
                                <CheckCircle2 size={14} className="text-emerald-400" />
                            </div>
                            <span className="text-white font-bold text-lg">₹{(stats.totalRevenue / 1000).toFixed(0)}K</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <ArrowUpRight size={14} className="text-emerald-400" />
                                    <span className="text-white font-semibold">{stats.totalOrders}</span>
                                </div>
                                <span className="text-xs text-slate-500">Orders</span>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <Timer size={14} className="text-indigo-400" />
                                    <span className="text-white font-semibold">—</span>
                                </div>
                                <span className="text-xs text-slate-500">Fulfilled</span>
                            </div>
                            <div className="text-center">
                                <div className="flex items-center justify-center gap-1 mb-1">
                                    <Undo2 size={14} className="text-red-400" />
                                    <span className="text-white font-semibold">{stats.returnedOrders}</span>
                                </div>
                                <span className="text-xs text-slate-500">Returns</span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Disconnected platforms */}
                {Object.entries(platforms).filter(([, v]) => !v.connected).map(([key, val]) => (
                    <div key={key} className="p-4 rounded-xl bg-white/[0.01] border border-dashed border-white/10">
                        <div className="flex items-center gap-3">
                            <Unplug size={18} className="text-slate-600" />
                            <div>
                                <p className="text-sm text-slate-400 font-medium">{key.charAt(0).toUpperCase() + key.slice(1)}</p>
                                <p className="text-xs text-slate-600 mt-0.5">{val.error || 'API not connected'}</p>
                            </div>
                            <button className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 font-medium px-3 py-1.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/15 transition-colors">
                                Connect
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

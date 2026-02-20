'use client';
import {
    TrendingUp, TrendingDown, Minus,
    IndianRupee, ShoppingCart, Package, PackageX, Warehouse, ListChecks,
    BarChart3, Percent, PackageCheck, XCircle
} from 'lucide-react';
import type { KPIData } from '@/lib/types';

const iconMap: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
    'indian-rupee': IndianRupee,
    'shopping-cart': ShoppingCart,
    'trending-up': TrendingUp,
    'package-x': PackageX,
    'warehouse': Warehouse,
    'list-checks': ListChecks,
    'bar-chart': BarChart3,
    'percent': Percent,
    'package-check': PackageCheck,
    'x-circle': XCircle,
};

const negativeIsGood = new Set(['package-x', 'x-circle', 'percent']);

export default function KPICard({ data }: { data: KPIData }) {
    const Icon = iconMap[data.icon] || Package;
    const TrendIcon = data.trend === 'up' ? TrendingUp : data.trend === 'down' ? TrendingDown : Minus;

    // For returns/cancellations/return rate: lower is better
    const isNegMetric = negativeIsGood.has(data.icon);
    const isPositive = isNegMetric ? data.change < 0 : data.change > 0;
    const effectiveTrendColor = data.change === 0 ? 'text-slate-400' : isPositive ? 'text-emerald-400' : 'text-red-400';
    const effectiveBg = data.change === 0 ? 'bg-slate-500/10' : isPositive ? 'bg-emerald-500/10' : 'bg-red-500/10';

    return (
        <div className="group relative bg-[#111827]/80 backdrop-blur-sm border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-all duration-300 hover:shadow-lg hover:shadow-indigo-500/5">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-indigo-500/5 to-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

            <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                    <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                        <Icon size={20} className="text-indigo-400" />
                    </div>
                    {data.change !== 0 && (
                        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium ${effectiveBg} ${effectiveTrendColor}`}>
                            <TrendIcon size={12} />
                            <span>{Math.abs(data.change)}%</span>
                        </div>
                    )}
                </div>

                <p className="text-sm text-slate-400 mb-1">{data.label}</p>
                <p className="text-2xl font-bold text-white tracking-tight">{data.value}</p>
                <p className="text-xs text-slate-500 mt-2">vs. previous period</p>
            </div>
        </div>
    );
}

export function KPICardSkeleton() {
    return (
        <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-5 animate-pulse">
            <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-white/5" />
                <div className="w-16 h-6 rounded-lg bg-white/5" />
            </div>
            <div className="h-3 w-24 bg-white/5 rounded mb-2" />
            <div className="h-7 w-32 bg-white/5 rounded" />
        </div>
    );
}

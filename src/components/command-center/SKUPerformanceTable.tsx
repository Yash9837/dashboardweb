'use client';
import { SKUMetric, RevenueState } from '@/lib/types';
import { ArrowUpDown } from 'lucide-react';
import { useState } from 'react';

interface Props {
    skus: SKUMetric[];
    state: RevenueState;
}

const PRIORITY_CONFIG = {
    scale: { label: 'Scale', color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
    volume_risk: { label: 'Volume Risk', color: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
    premium_niche: { label: 'Premium Niche', color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/20' },
    kill: { label: 'Kill', color: 'bg-red-500/15 text-red-400 border-red-500/20' },
};

type SortKey = 'revenue' | 'units' | 'margin' | 'tacos' | 'roas' | 'return_rate' | 'stock' | 'days_inv';

export default function SKUPerformanceTable({ skus, state }: Props) {
    const [sortKey, setSortKey] = useState<SortKey>('revenue');
    const [sortAsc, setSortAsc] = useState(false);

    const handleSort = (key: SortKey) => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else { setSortKey(key); setSortAsc(false); }
    };

    const sorted = [...skus].sort((a, b) => {
        let aVal = 0, bVal = 0;
        switch (sortKey) {
            case 'revenue': aVal = state === 'live' ? a.revenue_live : a.revenue_locked; bVal = state === 'live' ? b.revenue_live : b.revenue_locked; break;
            case 'units': aVal = state === 'live' ? a.units_sold_live : a.units_sold_locked; bVal = state === 'live' ? b.units_sold_live : b.units_sold_locked; break;
            case 'margin': aVal = a.margin_percent; bVal = b.margin_percent; break;
            case 'tacos': aVal = a.tacos; bVal = b.tacos; break;
            case 'roas': aVal = a.roas; bVal = b.roas; break;
            case 'return_rate': aVal = a.return_rate; bVal = b.return_rate; break;
            case 'stock': aVal = a.available_stock; bVal = b.available_stock; break;
            case 'days_inv': aVal = a.days_inventory; bVal = b.days_inventory; break;
        }
        return sortAsc ? aVal - bVal : bVal - aVal;
    });

    const fmt = (v: number) => v >= 100000 ? `₹${(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${(v / 1000).toFixed(1)}K` : `₹${v.toFixed(0)}`;

    const SortHeader = ({ label, sortKeyName }: { label: string; sortKeyName: SortKey }) => (
        <th
            className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider cursor-pointer hover:text-white transition-colors group"
            onClick={() => handleSort(sortKeyName)}
        >
            <span className="flex items-center gap-1">
                {label}
                <ArrowUpDown size={12} className={`opacity-0 group-hover:opacity-100 transition-opacity ${sortKey === sortKeyName ? 'opacity-100 text-indigo-400' : ''}`} />
            </span>
        </th>
    );

    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="p-5 border-b border-white/[0.06]">
                <h3 className="text-sm font-semibold text-white">SKU Performance</h3>
                <p className="text-xs text-slate-500 mt-0.5">Revenue, margins & priority classification</p>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="bg-white/[0.02]">
                        <tr>
                            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">SKU</th>
                            <SortHeader label="Revenue" sortKeyName="revenue" />
                            <SortHeader label="Sold" sortKeyName="units" />
                            <SortHeader label="Margin" sortKeyName="margin" />
                            <SortHeader label="TACOS" sortKeyName="tacos" />
                            <SortHeader label="ROAS" sortKeyName="roas" />
                            <SortHeader label="Return %" sortKeyName="return_rate" />
                            <SortHeader label="In Inventory" sortKeyName="stock" />
                            <SortHeader label="Days Inv" sortKeyName="days_inv" />
                            <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Priority</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {sorted.map((sku) => {
                            const revenue = state === 'live' ? sku.revenue_live : sku.revenue_locked;
                            const units = state === 'live' ? sku.units_sold_live : sku.units_sold_locked;
                            const priority = PRIORITY_CONFIG[sku.priority];

                            return (
                                <tr key={sku.sku} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="px-4 py-3">
                                        <p className="text-white font-medium truncate max-w-[200px]" title={sku.title}>{sku.title}</p>
                                        <p className="text-[10px] text-slate-500 mt-0.5 font-mono">{sku.sku}</p>
                                    </td>
                                    <td className="px-4 py-3 text-white font-medium tabular-nums">{fmt(revenue)}</td>
                                    <td className="px-4 py-3 text-slate-300 tabular-nums">{units.toLocaleString()}</td>
                                    <td className="px-4 py-3">
                                        <span className={`tabular-nums ${sku.margin_percent >= 20 ? 'text-emerald-400' : sku.margin_percent >= 10 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {sku.margin_percent.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`tabular-nums ${sku.tacos <= 15 ? 'text-emerald-400' : sku.tacos <= 30 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {sku.tacos.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`tabular-nums ${sku.roas >= 3 ? 'text-emerald-400' : sku.roas >= 1.5 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {sku.roas.toFixed(1)}x
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`tabular-nums ${sku.return_rate <= 5 ? 'text-emerald-400' : sku.return_rate <= 10 ? 'text-amber-400' : 'text-red-400'}`}>
                                            {sku.return_rate.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-slate-300 tabular-nums">
                                        {sku.available_stock.toLocaleString()}
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`tabular-nums ${sku.days_inventory <= 7 ? 'text-red-400' : sku.days_inventory <= 20 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                            {sku.days_inventory > 900 ? '∞' : `${Math.round(sku.days_inventory)}d`}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border ${priority.color}`}>
                                            {priority.label}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

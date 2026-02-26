'use client';
import { InventoryRisk } from '@/lib/types';
import { Package, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface Props {
    data: InventoryRisk[];
}

const RISK_CONFIG = {
    red: { label: 'Critical', icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', bar: 'bg-red-500' },
    yellow: { label: 'Warning', icon: AlertTriangle, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', bar: 'bg-amber-500' },
    green: { label: 'Healthy', icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', bar: 'bg-emerald-500' },
};

export default function InventoryRiskPanel({ data }: Props) {
    const redCount = data.filter(d => d.risk_status === 'red').length;
    const yellowCount = data.filter(d => d.risk_status === 'yellow').length;
    const greenCount = data.filter(d => d.risk_status === 'green').length;
    const total = data.length || 1;

    // Sort: red first, then yellow, then green
    const sorted = [...data].sort((a, b) => {
        const order = { red: 0, yellow: 1, green: 2 };
        return order[a.risk_status] - order[b.risk_status];
    });

    return (
        <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                        <Package size={16} className="text-indigo-400" />
                        Inventory Risk
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">Days of inventory by SKU</p>
                </div>
            </div>

            {/* Risk distribution bar */}
            <div className="flex rounded-full h-2 overflow-hidden mb-4">
                {redCount > 0 && <div className="bg-red-500 transition-all" style={{ width: `${(redCount / total) * 100}%` }} />}
                {yellowCount > 0 && <div className="bg-amber-500 transition-all" style={{ width: `${(yellowCount / total) * 100}%` }} />}
                {greenCount > 0 && <div className="bg-emerald-500 transition-all" style={{ width: `${(greenCount / total) * 100}%` }} />}
            </div>

            {/* Summary chips */}
            <div className="flex gap-3 mb-4">
                <span className="text-xs text-red-400 flex items-center gap-1"><XCircle size={10} /> {redCount} Critical</span>
                <span className="text-xs text-amber-400 flex items-center gap-1"><AlertTriangle size={10} /> {yellowCount} Warning</span>
                <span className="text-xs text-emerald-400 flex items-center gap-1"><CheckCircle2 size={10} /> {greenCount} Healthy</span>
            </div>

            {/* Items */}
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {sorted.map((item) => {
                    const cfg = RISK_CONFIG[item.risk_status];
                    const Icon = cfg.icon;
                    const barWidth = Math.min(100, (item.days_inventory / 30) * 100);

                    return (
                        <div key={item.sku} className={`flex items-center gap-3 p-3 rounded-xl border ${cfg.bg}`}>
                            <Icon size={14} className={cfg.color} />
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-white truncate">{item.title || item.sku}</p>
                                <div className="flex items-center gap-2 mt-1">
                                    <div className="flex-1 bg-white/5 rounded-full h-1.5">
                                        <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${barWidth}%` }} />
                                    </div>
                                    <span className="text-[10px] text-slate-400 tabular-nums whitespace-nowrap">
                                        {item.days_inventory.toFixed(0)}d · {item.available_units} units
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

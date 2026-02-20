import type { LucideIcon } from 'lucide-react';

interface StatItem {
    label: string;
    value: string | number | undefined;
    icon: LucideIcon;
    color: string;
}

interface StatsGridProps {
    items: StatItem[];
    columns?: number;
}

export default function StatsGrid({ items, columns = 6 }: StatsGridProps) {
    const gridCols: Record<number, string> = {
        3: 'grid-cols-1 md:grid-cols-3',
        4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4',
        6: 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6',
    };

    return (
        <div className={`grid ${gridCols[columns] ?? gridCols[6]} gap-4`}>
            {items.map((s) => (
                <div key={s.label} className="bg-[#111827]/80 border border-white/5 rounded-2xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                        <s.icon size={16} className={s.color} />
                        <p className="text-xs text-slate-500">{s.label}</p>
                    </div>
                    <p className="text-xl font-bold text-white">{s.value ?? '—'}</p>
                </div>
            ))}
        </div>
    );
}

/**
 * Shared Recharts tooltip with dark theme styling.
 * Used across analytics, sales, and revenue chart components.
 */
export default function ChartTooltip({ active, payload, label, valuePrefix = '₹' }: any) {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-[#1a2035] border border-white/10 rounded-xl p-3 shadow-2xl">
            <p className="text-xs text-slate-400 mb-1">{label}</p>
            {payload.map((entry: any, i: number) => (
                <p key={i} className="text-sm text-white font-medium">
                    {valuePrefix}{(entry.value / 1000).toFixed(1)}K
                </p>
            ))}
        </div>
    );
}

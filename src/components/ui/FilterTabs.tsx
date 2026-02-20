interface FilterTab {
    key: string;
    label: string;
    count?: number;
}

interface FilterTabsProps {
    tabs: FilterTab[];
    activeKey: string;
    onChange: (key: string) => void;
}

export default function FilterTabs({ tabs, activeKey, onChange }: FilterTabsProps) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            {tabs.map(tab => (
                <button
                    key={tab.key}
                    onClick={() => onChange(tab.key)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${activeKey === tab.key
                            ? 'bg-indigo-500/20 text-indigo-400'
                            : 'text-slate-500 hover:text-white bg-white/5'
                        }`}
                >
                    {tab.label}{tab.count !== undefined ? ` (${tab.count})` : ''}
                </button>
            ))}
        </div>
    );
}

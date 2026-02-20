'use client';
import { useState } from 'react';
import {
    Bell, Search, ChevronDown, Calendar, User, Download, LogOut, Loader2
} from 'lucide-react';
import type { DateRange, Platform } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';

const dateOptions: { label: string; value: DateRange }[] = [
    { label: 'Today', value: 'today' },
    { label: 'Last 7 Days', value: '7d' },
    { label: 'Last 30 Days', value: '30d' },
    { label: 'Last Quarter', value: '90d' },
    { label: 'This Year', value: '1y' },
];

const platformOptions: { label: string; value: Platform }[] = [
    { label: 'All Platforms', value: 'all' },
    { label: 'Amazon', value: 'amazon' },
    { label: 'Shopify', value: 'shopify' },
    { label: 'Walmart', value: 'walmart' },
];

export default function Header() {
    const { user, logout } = useAuth();
    const [dateRange, setDateRange] = useState<DateRange>('30d');
    const [platform, setPlatform] = useState<Platform>('all');
    const [showDateDrop, setShowDateDrop] = useState(false);
    const [showPlatDrop, setShowPlatDrop] = useState(false);
    const [showNotif, setShowNotif] = useState(false);
    const [signingOut, setSigningOut] = useState(false);

    const handleSignOut = async () => {
        setSigningOut(true);
        try {
            await logout();
        } finally {
            setSigningOut(false);
        }
    };

    return (
        <header className="sticky top-0 z-30 h-16 bg-[#0d1117]/80 backdrop-blur-xl border-b border-white/5 flex items-center justify-between px-6 gap-4">
            {/* Left: Search */}
            <div className="flex items-center gap-3 flex-1 max-w-md">
                <div className="relative w-full">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                        type="text"
                        placeholder="Search orders, SKUs, products..."
                        className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    />
                </div>
            </div>

            {/* Center: Filters */}
            <div className="flex items-center gap-2">
                {/* Date Range */}
                <div className="relative">
                    <button
                        onClick={() => { setShowDateDrop(!showDateDrop); setShowPlatDrop(false); }}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all"
                    >
                        <Calendar size={14} />
                        <span>{dateOptions.find(d => d.value === dateRange)?.label}</span>
                        <ChevronDown size={14} />
                    </button>
                    {showDateDrop && (
                        <div className="absolute right-0 top-full mt-1 w-44 bg-[#151b28] border border-white/10 rounded-xl shadow-2xl py-1 z-50">
                            {dateOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => { setDateRange(opt.value); setShowDateDrop(false); }}
                                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${dateRange === opt.value ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-300 hover:bg-white/5'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Platform Filter */}
                <div className="relative">
                    <button
                        onClick={() => { setShowPlatDrop(!showPlatDrop); setShowDateDrop(false); }}
                        className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all"
                    >
                        <span>{platformOptions.find(p => p.value === platform)?.label}</span>
                        <ChevronDown size={14} />
                    </button>
                    {showPlatDrop && (
                        <div className="absolute right-0 top-full mt-1 w-44 bg-[#151b28] border border-white/10 rounded-xl shadow-2xl py-1 z-50">
                            {platformOptions.map(opt => (
                                <button
                                    key={opt.value}
                                    onClick={() => { setPlatform(opt.value); setShowPlatDrop(false); }}
                                    className={`w-full text-left px-4 py-2 text-sm transition-colors ${platform === opt.value ? 'text-indigo-400 bg-indigo-500/10' : 'text-slate-300 hover:bg-white/5'
                                        }`}
                                >
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Export */}
                <button className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all">
                    <Download size={14} />
                    <span className="hidden lg:inline">Export</span>
                </button>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
                {/* Notification Bell */}
                <div className="relative">
                    <button
                        onClick={() => setShowNotif(!showNotif)}
                        className="relative p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                    >
                        <Bell size={18} />
                        <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
                    </button>
                    {showNotif && (
                        <div className="absolute right-0 top-full mt-1 w-80 bg-[#151b28] border border-white/10 rounded-xl shadow-2xl py-2 z-50">
                            <p className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notifications</p>
                            <div className="px-4 py-3 border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                                <p className="text-sm text-red-400 font-medium">Out of Stock Alert</p>
                                <p className="text-xs text-slate-500 mt-0.5">Brain Gain Math Games — 0 units remaining</p>
                            </div>
                            <div className="px-4 py-3 border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                                <p className="text-sm text-amber-400 font-medium">Low Stock Warning</p>
                                <p className="text-xs text-slate-500 mt-0.5">Gold Plated Beads Hoop Earrings — 8 units</p>
                            </div>
                            <div className="px-4 py-3 border-t border-white/5 hover:bg-white/5 transition-colors cursor-pointer">
                                <p className="text-sm text-indigo-400 font-medium">New Platform Active</p>
                                <p className="text-xs text-slate-500 mt-0.5">Shopify integration is syncing data</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Last Updated */}
                <span className="text-xs text-slate-600 hidden xl:block whitespace-nowrap">
                    {user?.email || 'Signed in'}
                </span>

                <button
                    onClick={handleSignOut}
                    disabled={signingOut}
                    className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-60"
                >
                    {signingOut ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
                    <span className="hidden lg:inline">{signingOut ? 'Signing out...' : 'Sign out'}</span>
                </button>

                {/* User Avatar */}
                <button className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center">
                    {user?.email
                        ? <span className="text-white text-xs font-bold">{user.email.charAt(0).toUpperCase()}</span>
                        : <User size={16} className="text-white" />
                    }
                </button>
            </div>
        </header>
    );
}

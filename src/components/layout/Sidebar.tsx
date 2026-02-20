'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard, BarChart3, DollarSign, Package, ShoppingCart,
    Plug, Settings, ChevronLeft, ChevronRight, Sun, Moon
} from 'lucide-react';

const navItems = [
    { label: 'Dashboard', href: '/', icon: LayoutDashboard },
    { label: 'Analytics', href: '/analytics', icon: BarChart3 },
    { label: 'Sales & Revenue', href: '/sales', icon: DollarSign },
    { label: 'Inventory', href: '/inventory', icon: Package },
    { label: 'Orders & Returns', href: '/orders', icon: ShoppingCart },
    { label: 'Integrations', href: '/integrations', icon: Plug },
    { label: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const [dark, setDark] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        const saved = window.localStorage.getItem('dashboard-theme');
        const useDark = saved === 'dark';
        setDark(useDark);
        document.documentElement.classList.toggle('dark', useDark);
    }, []);

    useEffect(() => {
        document.documentElement.classList.toggle('dark', dark);
        window.localStorage.setItem('dashboard-theme', dark ? 'dark' : 'light');
    }, [dark]);

    return (
        <aside
            className={`
        fixed top-0 left-0 z-40 h-screen flex flex-col
        bg-[#0a0e1a] border-r border-white/5
        transition-all duration-300 ease-in-out
        ${collapsed ? 'w-[72px]' : 'w-[260px]'}
      `}
        >
            {/* Logo */}
            <div className="flex items-center gap-3 px-5 h-16 border-b border-white/5 shrink-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-cyan-400 flex items-center justify-center shrink-0">
                    <span className="text-white font-bold text-sm">S</span>
                </div>
                {!collapsed && (
                    <span className="text-white font-semibold text-lg tracking-tight whitespace-nowrap">
                        SmartCommerce
                    </span>
                )}
            </div>

            {/* Nav Items */}
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
                {navItems.map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className={`
                flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                transition-all duration-200 group relative
                ${isActive
                                    ? 'bg-indigo-500/15 text-indigo-400'
                                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                                }
              `}
                            title={collapsed ? item.label : ''}
                        >
                            {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-indigo-500 rounded-r-full" />
                            )}
                            <Icon size={20} className="shrink-0" />
                            {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
                        </Link>
                    );
                })}
            </nav>

            {/* Bottom controls */}
            <div className="p-3 border-t border-white/5 space-y-2 shrink-0">
                {/* Theme toggle */}
                <button
                    onClick={() => setDark(!dark)}
                    className="flex items-center gap-3 w-full px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                    title={collapsed ? 'Toggle theme' : ''}
                >
                    {dark ? <Sun size={18} /> : <Moon size={18} />}
                    {!collapsed && <span>{dark ? 'Light Mode' : 'Dark Mode'}</span>}
                </button>

                {/* Collapse toggle */}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="flex items-center gap-3 w-full px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors"
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    {!collapsed && <span>Collapse</span>}
                </button>
            </div>
        </aside>
    );
}

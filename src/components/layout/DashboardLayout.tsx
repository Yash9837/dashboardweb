'use client';
import Sidebar from './Sidebar';
import Header from './Header';
import { Loader2 } from 'lucide-react';
import AuthScreen from '@/components/auth/AuthScreen';
import { useAuth } from '@/context/AuthContext';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
    const { user, loading } = useAuth();

    if (loading) {
        return (
            <div className="min-h-screen bg-[#080b14] flex items-center justify-center">
                <div className="flex items-center gap-2 text-slate-400">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm">Checking authentication...</span>
                </div>
            </div>
        );
    }

    if (!user) {
        return <AuthScreen />;
    }

    return (
        <div className="min-h-screen bg-[#080b14]">
            <Sidebar />
            <div className="ml-[260px] transition-all duration-300">
                <Header />
                <main className="p-6 space-y-6">
                    {children}
                </main>
            </div>
        </div>
    );
}

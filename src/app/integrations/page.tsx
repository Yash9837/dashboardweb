'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import { useFetch } from '@/hooks/useFetch';
import { Plug, CheckCircle2, Unplug } from 'lucide-react';

interface PlatformConfig {
    name: string;
    description: string;
    icon: string;
    connected: boolean;
    color: string;
    features: string[];
    apiEndpoint?: string;
}

export default function IntegrationsPage() {
    const { data, loading } = useFetch<any>('/api/dashboard');

    const platforms: PlatformConfig[] = [
        {
            name: 'Amazon',
            description: 'Amazon Selling Partner API (SP-API) — India Marketplace',
            icon: '🛒',
            connected: data?.platforms?.amazon?.connected ?? false,
            color: 'indigo',
            features: ['Orders & Returns', 'FBA Inventory', 'Financial Reports', 'Catalog & Listings'],
            apiEndpoint: 'sellingpartnerapi-eu.amazon.com',
        },
        {
            name: 'Shopify',
            description: 'Shopify Admin API — storefront and order management',
            icon: '🏪',
            connected: data?.platforms?.shopify?.connected ?? false,
            color: 'emerald',
            features: ['Orders', 'Products', 'Inventory', 'Customers'],
        },
        {
            name: 'Walmart',
            description: 'Walmart Marketplace API — US marketplace integration',
            icon: '🏬',
            connected: data?.platforms?.walmart?.connected ?? false,
            color: 'blue',
            features: ['Orders', 'Items', 'Inventory', 'Returns'],
        },
        {
            name: 'Flipkart',
            description: 'Flipkart Seller API — India marketplace integration',
            icon: '📦',
            connected: false,
            color: 'amber',
            features: ['Orders', 'Listings', 'Returns', 'Payments'],
        },
        {
            name: 'Meesho',
            description: 'Meesho Supplier API — Social commerce platform',
            icon: '🛍️',
            connected: false,
            color: 'pink',
            features: ['Orders', 'Products', 'Payments'],
        },
    ];

    return (
        <DashboardLayout>
            <PageHeader
                title="Platform Integrations"
                subtitle="Connect your e-commerce platforms to sync orders, inventory, and analytics"
                icon={Plug}
                iconColor="text-indigo-400"
            />

            {/* Summary */}
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    <span className="text-xs text-emerald-400 font-medium">{platforms.filter(p => p.connected).length} Connected</span>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-slate-500/10 border border-white/5 rounded-xl">
                    <Unplug size={14} className="text-slate-500" />
                    <span className="text-xs text-slate-400 font-medium">{platforms.filter(p => !p.connected).length} Available</span>
                </div>
            </div>

            {/* Platform Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {platforms.map(platform => (
                    <div key={platform.name}
                        className={`bg-[#111827]/80 border rounded-2xl p-6 transition-all duration-300 ${platform.connected ? 'border-emerald-500/20 hover:border-emerald-500/40' : 'border-white/5 hover:border-white/10'
                            }`}>
                        <div className="flex items-start justify-between mb-4">
                            <div className="flex items-center gap-3">
                                <span className="text-2xl">{platform.icon}</span>
                                <div>
                                    <h3 className="text-white font-semibold">{platform.name}</h3>
                                    <p className="text-xs text-slate-500 mt-0.5">{platform.description}</p>
                                </div>
                            </div>
                            {platform.connected ? (
                                <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg text-xs font-medium">
                                    <CheckCircle2 size={12} /> Connected
                                </span>
                            ) : (
                                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-xs font-medium transition-colors">
                                    <Plug size={12} /> Connect
                                </button>
                            )}
                        </div>

                        <div className="flex flex-wrap gap-2 mb-4">
                            {platform.features.map(f => (
                                <span key={f} className="text-[10px] px-2 py-1 rounded-md bg-white/5 text-slate-400">{f}</span>
                            ))}
                        </div>

                        {platform.connected && platform.apiEndpoint && (
                            <div className="pt-3 border-t border-white/5">
                                <p className="text-xs text-slate-500">
                                    Endpoint: <code className="text-indigo-400 bg-indigo-500/5 px-1.5 rounded">{platform.apiEndpoint}</code>
                                </p>
                                <p className="text-xs text-slate-600 mt-1">
                                    Last synced: {new Date().toLocaleString('en-IN')}
                                </p>
                            </div>
                        )}

                        {!platform.connected && (
                            <div className="pt-3 border-t border-white/5">
                                <p className="text-xs text-slate-600">
                                    API credentials not configured. Click &quot;Connect&quot; to set up this integration.
                                </p>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </DashboardLayout>
    );
}

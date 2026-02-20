'use client';
import DashboardLayout from '@/components/layout/DashboardLayout';
import PageHeader from '@/components/layout/PageHeader';
import { Settings as SettingsIcon, User, Bell, Shield, Database, Palette, Globe } from 'lucide-react';

export default function SettingsPage() {
    const sections = [
        {
            icon: User, title: 'Profile', desc: 'Manage your account details and preferences',
            fields: [
                { label: 'Display Name', value: 'Admin', type: 'text' },
                { label: 'Email', value: 'admin@smartcommerce.in', type: 'email' },
                { label: 'Role', value: 'Owner', type: 'text' },
            ],
        },
        {
            icon: Bell, title: 'Notifications', desc: 'Configure alerts and notification preferences',
            fields: [
                { label: 'Low Stock Alerts', value: true, type: 'toggle' },
                { label: 'Order Notifications', value: true, type: 'toggle' },
                { label: 'Revenue Reports', value: false, type: 'toggle' },
            ],
        },
        {
            icon: Database, title: 'Data & Sync', desc: 'Control data refresh and storage settings',
            fields: [
                { label: 'Auto-refresh Interval', value: '5 min', type: 'text' },
                { label: 'Data Retention', value: '90 days', type: 'text' },
                { label: 'Cache Enabled', value: true, type: 'toggle' },
            ],
        },
        {
            icon: Palette, title: 'Appearance', desc: 'Customize the dashboard look and feel',
            fields: [
                { label: 'Theme', value: 'Dark', type: 'text' },
                { label: 'Compact Mode', value: false, type: 'toggle' },
                { label: 'Currency', value: 'INR (₹)', type: 'text' },
            ],
        },
        {
            icon: Shield, title: 'Security', desc: 'Manage API keys and access controls',
            fields: [
                { label: 'Two-Factor Auth', value: false, type: 'toggle' },
                { label: 'API Key', value: '••••••••••••7b7', type: 'text' },
                { label: 'Session Timeout', value: '60 min', type: 'text' },
            ],
        },
        {
            icon: Globe, title: 'Marketplace', desc: 'Configure marketplace settings',
            fields: [
                { label: 'Primary Marketplace', value: 'Amazon India', type: 'text' },
                { label: 'Marketplace ID', value: 'A21TJRUUN4KGV', type: 'text' },
                { label: 'Region', value: 'EU (eu-west-1)', type: 'text' },
            ],
        },
    ];

    return (
        <DashboardLayout>
            <PageHeader
                title="Settings"
                subtitle="Manage your dashboard preferences"
                icon={SettingsIcon}
                iconColor="text-slate-400"
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {sections.map(section => (
                    <div key={section.title} className="bg-[#111827]/80 border border-white/5 rounded-2xl p-6 hover:border-white/10 transition-colors">
                        <div className="flex items-center gap-3 mb-4">
                            <div className="w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center">
                                <section.icon size={18} className="text-indigo-400" />
                            </div>
                            <div>
                                <h3 className="text-white font-semibold">{section.title}</h3>
                                <p className="text-xs text-slate-500">{section.desc}</p>
                            </div>
                        </div>
                        <div className="space-y-3">
                            {section.fields.map(field => (
                                <div key={field.label} className="flex items-center justify-between py-2 border-b border-white/[0.03] last:border-0">
                                    <span className="text-sm text-slate-400">{field.label}</span>
                                    {field.type === 'toggle' ? (
                                        <button className={`w-10 h-5 rounded-full transition-colors relative ${field.value ? 'bg-indigo-500' : 'bg-white/10'}`}>
                                            <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 transition-transform ${field.value ? 'left-[22px]' : 'left-0.5'}`} />
                                        </button>
                                    ) : (
                                        <span className="text-sm text-white font-medium">{String(field.value)}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </DashboardLayout>
    );
}

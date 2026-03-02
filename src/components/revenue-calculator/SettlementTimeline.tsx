'use client';

import { useState } from 'react';
import { Calendar, CreditCard, ArrowDownRight, ArrowUpRight, CheckCircle2, Clock, RefreshCw, Loader2, AlertCircle } from 'lucide-react';
import type { SettlementPeriod } from '@/lib/revenue-types';

interface Props {
    data: SettlementPeriod[];
    onSync?: () => Promise<void>;
}

function formatExact(n: number): string {
    if (n === 0) return '₹0.00';
    const prefix = n < 0 ? '-' : '';
    return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
        return new Date(dateStr).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
        });
    } catch {
        return dateStr;
    }
}

export default function SettlementTimeline({ data, onSync }: Props) {
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleSync = async () => {
        if (syncing) return;
        setSyncing(true);
        setSyncResult(null);
        try {
            if (onSync) {
                await onSync();
                setSyncResult({ success: true, message: 'Settlement sync complete! Data will refresh automatically.' });
            }
        } catch (err: any) {
            setSyncResult({ success: false, message: err.message || 'Sync failed' });
        } finally {
            setSyncing(false);
        }
    };

    if (!data.length) {
        return (
            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl p-8">
                <div className="text-center">
                    <CreditCard size={40} className="text-slate-700 mx-auto mb-3" />
                    <h3 className="text-sm font-semibold text-white mb-1">No Settlement Data</h3>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Settlement data will appear here once financial event groups are synced from the Amazon Finances API.
                        Each settlement maps to a payout cycle — typically every 14 days.
                    </p>

                    {/* Sync Button */}
                    <button
                        onClick={handleSync}
                        disabled={syncing || !onSync}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white text-xs font-semibold rounded-lg transition-all"
                    >
                        {syncing ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                Syncing Settlements...
                            </>
                        ) : (
                            <>
                                <RefreshCw size={14} />
                                Sync Settlements from Amazon
                            </>
                        )}
                    </button>

                    {syncResult && (
                        <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium ${
                            syncResult.success
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                : 'bg-red-500/15 text-red-400 border border-red-500/20'
                        }`}>
                            {syncResult.success ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                            {syncResult.message}
                        </div>
                    )}

                    <div className="mt-4 bg-white/[0.03] border border-white/5 rounded-lg p-3 max-w-sm mx-auto text-left">
                        <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">How Settlement Works</p>
                        <div className="space-y-1.5 text-[11px] text-slate-400">
                            <p>1. Orders → Financial Events are generated</p>
                            <p>2. Events are grouped into <span className="text-indigo-400">Financial Event Groups</span></p>
                            <p>3. Each group maps to a <span className="text-emerald-400">Settlement Period</span></p>
                            <p>4. Amazon transfers net payout to your bank</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const totalPayout = data.reduce((s, d) => s + d.net_payout, 0);
    const totalOrders = data.reduce((s, d) => s + d.order_count, 0);
    const totalRefunds = data.reduce((s, d) => s + d.refund_count, 0);
    const closedCount = data.filter(d => d.processing_status === 'Closed').length;

    return (
        <div className="space-y-4">
            {/* Header with Sync Button */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-white">Settlement Periods</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        {data.length} settlement{data.length !== 1 ? 's' : ''} found — Amazon payout cycles (~14 days each)
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {syncResult && (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                            syncResult.success ? 'text-emerald-400' : 'text-red-400'
                        }`}>
                            {syncResult.success ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />}
                            {syncResult.message}
                        </span>
                    )}
                    {onSync && (
                        <button
                            onClick={handleSync}
                            disabled={syncing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.06] hover:bg-white/[0.10] disabled:opacity-50 text-slate-300 text-[11px] font-medium rounded-lg border border-white/[0.06] transition-all"
                        >
                            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                            {syncing ? 'Syncing...' : 'Refresh'}
                        </button>
                    )}
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                    { label: 'Total Payouts', value: formatExact(totalPayout), color: 'text-emerald-400' },
                    { label: 'Settlements', value: `${closedCount}/${data.length}`, subLabel: 'closed', color: 'text-indigo-400' },
                    { label: 'Total Orders', value: totalOrders.toLocaleString('en-IN'), color: 'text-white' },
                    { label: 'Total Refunds', value: totalRefunds.toLocaleString('en-IN'), color: 'text-amber-400' },
                ].map(card => (
                    <div key={card.label} className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-4">
                        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{card.label}</p>
                        <p className={`text-lg font-bold ${card.color} mt-1`}>{card.value}</p>
                        {card.subLabel && <p className="text-[10px] text-slate-600">{card.subLabel}</p>}
                    </div>
                ))}
            </div>

            {/* Timeline */}
            <div className="bg-[#111827]/80 border border-white/[0.06] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5">
                    <h3 className="text-sm font-semibold text-white">Settlement Timeline</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                        Transaction → Financial Event Group → Settlement Payout
                    </p>
                </div>

                <div className="divide-y divide-white/[0.03]">
                    {data.map((s, idx) => {
                        const isClosed = s.processing_status === 'Closed';
                        return (
                            <div key={s.settlement_id} className="px-5 py-4 hover:bg-white/[0.02] transition-colors">
                                <div className="flex items-start gap-4">
                                    {/* Timeline indicator */}
                                    <div className="flex flex-col items-center pt-1">
                                        <div className={`w-3 h-3 rounded-full border-2 ${isClosed
                                            ? 'border-emerald-500 bg-emerald-500/20'
                                            : 'border-amber-500 bg-amber-500/20'
                                            }`} />
                                        {idx < data.length - 1 && (
                                            <div className="w-px h-full min-h-[40px] bg-white/5 mt-1" />
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-mono text-slate-300">{s.settlement_id}</span>
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${isClosed
                                                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
                                                    : 'bg-amber-500/15 text-amber-400 border-amber-500/20'
                                                    }`}>
                                                    {isClosed ? <CheckCircle2 size={10} /> : <Clock size={10} />}
                                                    {s.processing_status}
                                                </span>
                                            </div>
                                            <span className={`text-sm font-bold ${s.net_payout >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                                {formatExact(s.net_payout)}
                                            </span>
                                        </div>

                                        <div className="flex items-center gap-4 mt-2 text-[11px] text-slate-500">
                                            <span className="flex items-center gap-1">
                                                <Calendar size={10} />
                                                {formatDate(s.period_start)} → {formatDate(s.period_end)}
                                            </span>
                                            {s.fund_transfer_date && (
                                                <span className="flex items-center gap-1 text-emerald-500">
                                                    <CreditCard size={10} />
                                                    Paid: {formatDate(s.fund_transfer_date)}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-4 mt-2">
                                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                                <ArrowUpRight size={10} className="text-emerald-400" />
                                                {s.order_count} orders
                                            </span>
                                            <span className="flex items-center gap-1 text-[10px] text-slate-500">
                                                <ArrowDownRight size={10} className="text-red-400" />
                                                {s.refund_count} refunds
                                            </span>
                                            <span className="text-[10px] text-slate-600">
                                                Fees: {formatExact(s.fee_total)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

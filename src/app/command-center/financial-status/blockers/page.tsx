'use client';
import { useState, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import Link from 'next/link';
import {
  Shield, AlertTriangle, CheckCircle2, XCircle, Clock, ArrowLeft,
  Loader2, ChevronDown, ChevronRight, Package, Truck, IndianRupee,
  RotateCcw, Eye, EyeOff, Pause, RefreshCw, Calendar, FileText,
  Lock, Unlock, ExternalLink,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface BlockerOrder {
  order_id: string;
  order_date: string;
  financial_status: string;
  order_status: string;
  delivery_date: string | null;
  settlement_status: string;
  event_count: number;
  settlement_items_count: number;
  net_revenue: number;
  event_types: string[];
  event_dates: { min: string; max: string } | null;
  reason: string;
  reason_detail: string;
  override: {
    override_action: string;
    reason: string | null;
    overridden_at: string;
  } | null;
}

interface BlockerDay {
  date: string;
  total_orders: number;
  closed_orders: number;
  blockers: BlockerOrder[];
}

interface BlockersResponse {
  success: boolean;
  finalized_till_date: string | null;
  finalized_revenue: number;
  finalized_order_count: number;
  total_blockers: number;
  blocker_revenue: number;
  blocker_days: BlockerDay[];
  override_counts: { INCLUDE: number; EXCLUDE: number; DEFER: number };
  all_overrides: any[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return d; }
}

function fmtMoney(n: number): string {
  if (n === 0) return '₹0';
  const prefix = n < 0 ? '-' : '';
  return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function fmtMoneyExact(n: number): string {
  const prefix = n < 0 ? '-' : '';
  return `${prefix}₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysSince(d: string | null): number {
  if (!d) return 0;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ── Status Badges ────────────────────────────────────────────────────────────

function FinancialBadge({ status }: { status: string }) {
  const c: Record<string, { label: string; style: string; Icon: any }> = {
    OPEN: { label: 'Open', style: 'bg-slate-500/15 text-slate-400 border-slate-500/20', Icon: Unlock },
    DELIVERED_PENDING_SETTLEMENT: { label: 'Pending', style: 'bg-amber-500/15 text-amber-400 border-amber-500/20', Icon: Clock },
    FINANCIALLY_CLOSED: { label: 'Closed', style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20', Icon: Lock },
  };
  const cfg = c[status] || c.OPEN;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full border ${cfg.style}`}>
      <cfg.Icon size={10} />{cfg.label}
    </span>
  );
}

function OverrideBadge({ action }: { action: string }) {
  const c: Record<string, { label: string; style: string; Icon: any }> = {
    INCLUDE: { label: 'Included', style: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', Icon: CheckCircle2 },
    EXCLUDE: { label: 'Excluded', style: 'bg-red-500/20 text-red-400 border-red-500/30', Icon: XCircle },
    DEFER: { label: 'Deferred', style: 'bg-amber-500/20 text-amber-400 border-amber-500/30', Icon: Pause },
  };
  const cfg = c[action] || c.DEFER;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full border ${cfg.style}`}>
      <cfg.Icon size={10} />Override: {cfg.label}
    </span>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function BlockersPage() {
  const { data, loading, error, refresh } = useFetch<BlockersResponse>(
    '/api/command-center/financial-status-blockers', []
  );
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});
  const [showReasonFor, setShowReasonFor] = useState<string | null>(null);

  const toggleDay = (date: string) => {
    setExpandedDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
      return next;
    });
  };

  // Expand all days on first load
  const allExpanded = data?.blocker_days?.length
    ? data.blocker_days.every(d => expandedDays.has(d.date))
    : false;

  const toggleAll = () => {
    if (allExpanded) {
      setExpandedDays(new Set());
    } else {
      setExpandedDays(new Set((data?.blocker_days || []).map(d => d.date)));
    }
  };

  const handleOverride = useCallback(async (orderId: string, action: string) => {
    setActionLoading(orderId + action);
    try {
      const reason = reasonInputs[orderId] || undefined;
      const res = await fetch('/api/command-center/financial-status-blockers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, action, reason }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Failed: ${err.error}`);
      } else {
        setShowReasonFor(null);
        setReasonInputs(prev => { const n = { ...prev }; delete n[orderId]; return n; });
        refresh();
      }
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    }
    setActionLoading(null);
  }, [reasonInputs, refresh]);

  return (
    <DashboardLayout>
      <div className="space-y-5">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/command-center/financial-status"
              className="p-2 rounded-lg bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition"
            >
              <ArrowLeft size={16} className="text-slate-400" />
            </Link>
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                Finalized Revenue Blockers
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Orders blocking the &quot;Payments Finalized Till&quot; date — review and override
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleAll}
              className="px-3 py-1.5 text-xs bg-white/[0.04] border border-white/[0.06] rounded-lg text-slate-400 hover:bg-white/[0.08] transition"
            >
              {allExpanded ? 'Collapse All' : 'Expand All'}
            </button>
            <button
              onClick={() => refresh()}
              className="px-3 py-1.5 text-xs bg-white/[0.04] border border-white/[0.06] rounded-lg text-slate-400 hover:bg-white/[0.08] transition"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>

        {/* ── Loading / Error ── */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-slate-400" size={24} />
            <span className="ml-2 text-sm text-slate-500">Analyzing blocker orders…</span>
          </div>
        )}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-sm text-red-400">
            {error}
          </div>
        )}

        {data && !loading && (
          <>
            {/* ── Summary Cards ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <Shield size={12} className="text-emerald-400" />
                  <p className="text-[10px] font-medium text-emerald-500 uppercase">Finalized Till</p>
                </div>
                <p className="text-lg font-bold text-emerald-400">
                  {data.finalized_till_date ? fmtDate(data.finalized_till_date) : 'None'}
                </p>
                <p className="text-[9px] text-slate-500">{data.finalized_order_count} orders · {fmtMoney(data.finalized_revenue)}</p>
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <AlertTriangle size={12} className="text-amber-400" />
                  <p className="text-[10px] font-medium text-amber-500 uppercase">Blockers</p>
                </div>
                <p className="text-lg font-bold text-amber-400">{data.total_blockers}</p>
                <p className="text-[9px] text-slate-500">across {data.blocker_days.length} days · {fmtMoney(data.blocker_revenue)}</p>
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <CheckCircle2 size={12} className="text-blue-400" />
                  <p className="text-[10px] font-medium text-blue-500 uppercase">Overrides</p>
                </div>
                <p className="text-lg font-bold text-blue-400">
                  {data.override_counts.INCLUDE + data.override_counts.EXCLUDE + data.override_counts.DEFER}
                </p>
                <p className="text-[9px] text-slate-500">
                  {data.override_counts.INCLUDE} included · {data.override_counts.EXCLUDE} excluded · {data.override_counts.DEFER} deferred
                </p>
              </div>

              <div className="bg-violet-500/10 border border-violet-500/20 rounded-xl p-4">
                <div className="flex items-center gap-1.5 mb-1">
                  <IndianRupee size={12} className="text-violet-400" />
                  <p className="text-[10px] font-medium text-violet-500 uppercase">Blocked Revenue</p>
                </div>
                <p className="text-lg font-bold text-violet-400">{fmtMoney(data.blocker_revenue)}</p>
                <p className="text-[9px] text-slate-500">Revenue stuck behind blockers</p>
              </div>
            </div>

            {/* ── Quick Actions ── */}
            {data.total_blockers > 0 && (
              <div className="bg-amber-500/5 border border-amber-500/15 rounded-xl p-4">
                <p className="text-xs text-amber-400 font-medium mb-2">💡 Quick Actions</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      if (!confirm(`Include ALL ${data.total_blockers} blockers in finalized revenue? This treats them as finalized.`)) return;
                      setActionLoading('bulk-include');
                      for (const day of data.blocker_days) {
                        for (const b of day.blockers) {
                          await fetch('/api/command-center/financial-status-blockers', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ order_id: b.order_id, action: 'INCLUDE', reason: 'Bulk include — all blockers' }),
                          });
                        }
                      }
                      setActionLoading(null);
                      refresh();
                    }}
                    disabled={actionLoading === 'bulk-include'}
                    className="px-3 py-1.5 text-xs bg-emerald-500/15 border border-emerald-500/25 rounded-lg text-emerald-400 hover:bg-emerald-500/25 transition disabled:opacity-50"
                  >
                    {actionLoading === 'bulk-include' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                    <span className="ml-1">Include All ({data.total_blockers})</span>
                  </button>
                  <button
                    onClick={async () => {
                      // Include only "old" blockers (delivered 30+ days ago with events)
                      const eligible = data.blocker_days.flatMap(d =>
                        d.blockers.filter(b => b.event_count > 0 && daysSince(b.delivery_date) >= 25)
                      );
                      if (eligible.length === 0) { alert('No eligible orders (need events + delivered 25+ days ago)'); return; }
                      if (!confirm(`Include ${eligible.length} orders that have events and were delivered 25+ days ago?`)) return;
                      setActionLoading('bulk-safe');
                      for (const b of eligible) {
                        await fetch('/api/command-center/financial-status-blockers', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ order_id: b.order_id, action: 'INCLUDE', reason: 'Safe include — has events, delivered 25+ days ago' }),
                        });
                      }
                      setActionLoading(null);
                      refresh();
                    }}
                    disabled={!!actionLoading}
                    className="px-3 py-1.5 text-xs bg-blue-500/15 border border-blue-500/25 rounded-lg text-blue-400 hover:bg-blue-500/25 transition disabled:opacity-50"
                  >
                    <Shield size={12} />
                    <span className="ml-1">Safe Include (25+ days old with events)</span>
                  </button>
                </div>
              </div>
            )}

            {/* ── No Blockers ── */}
            {data.blocker_days.length === 0 && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-8 text-center">
                <CheckCircle2 size={32} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-emerald-400">No blockers!</p>
                <p className="text-xs text-slate-500 mt-1">All orders up to the latest date are finalized.</p>
              </div>
            )}

            {/* ── Blocker Days ── */}
            <div className="space-y-3">
              {data.blocker_days.map(day => {
                const isExpanded = expandedDays.has(day.date);
                const blockerCount = day.blockers.length;
                const blockerRevenue = day.blockers.reduce((s, b) => s + b.net_revenue, 0);

                return (
                  <div key={day.date} className="bg-[#111827]/80 border border-white/[0.06] rounded-xl overflow-hidden">
                    {/* Day Header */}
                    <button
                      onClick={() => toggleDay(day.date)}
                      className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                        <Calendar size={14} className="text-amber-400" />
                        <span className="text-sm font-semibold text-white">{fmtDate(day.date)}</span>
                        <span className="text-xs text-slate-500">
                          {day.total_orders} orders total · {day.closed_orders} closed
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          {blockerCount} blocker{blockerCount !== 1 ? 's' : ''}
                        </span>
                        <span className="text-xs text-slate-500">{fmtMoney(blockerRevenue)}</span>
                      </div>
                    </button>

                    {/* Expanded: Blocker Order Cards */}
                    {isExpanded && (
                      <div className="border-t border-white/[0.04] p-4 space-y-3">
                        {day.blockers.map(blocker => (
                          <div key={blocker.order_id} className="bg-[#0d1117] border border-white/[0.06] rounded-xl p-4">
                            {/* Order Header */}
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <div className="flex items-center gap-2 mb-1">
                                  <Package size={13} className="text-slate-400" />
                                  <span className="text-sm font-mono font-semibold text-white">{blocker.order_id}</span>
                                  <FinancialBadge status={blocker.financial_status} />
                                  {blocker.override && <OverrideBadge action={blocker.override.override_action} />}
                                  {blocker.event_count === 0 && blocker.net_revenue === 0 && (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold rounded-full bg-slate-500/15 text-slate-400 border border-slate-500/20">
                                      👻 No financial data
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                {blocker.net_revenue !== 0 ? (
                                  <>
                                    <p className="text-sm font-bold text-white">{fmtMoneyExact(blocker.net_revenue)}</p>
                                    <p className="text-[10px] text-slate-500">net revenue</p>
                                  </>
                                ) : (
                                  <>
                                    <p className="text-sm font-bold text-slate-500">₹0</p>
                                    <p className="text-[10px] text-slate-600">no charges yet</p>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Why is this blocking? — Plain English */}
                            <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 mb-3">
                              <p className="text-xs font-medium text-amber-400 mb-1">⚠ Why is this blocking?</p>
                              <p className="text-xs text-amber-300/80">{blocker.reason}</p>
                              {blocker.reason_detail && (
                                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">{blocker.reason_detail}</p>
                              )}
                            </div>

                            {/* Order Timeline — Clean visual */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                              <div>
                                <p className="text-[9px] text-slate-600 uppercase">Ordered</p>
                                <p className="text-xs text-slate-300">{fmtDate(blocker.order_date)}</p>
                              </div>
                              <div>
                                <p className="text-[9px] text-slate-600 uppercase">Delivered</p>
                                <p className="text-xs text-slate-300">
                                  {blocker.delivery_date
                                    ? <>{fmtDate(blocker.delivery_date)} <span className="text-slate-500">({daysSince(blocker.delivery_date)}d ago)</span></>
                                    : <span className="text-slate-500">Not yet</span>}
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] text-slate-600 uppercase">Amazon Charges Recorded</p>
                                <p className={`text-xs ${blocker.event_count > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {blocker.event_count > 0
                                    ? `✓ Yes (${blocker.event_count} entries)`
                                    : '✗ Not yet'}
                                </p>
                              </div>
                              <div>
                                <p className="text-[9px] text-slate-600 uppercase">Money Settled to Bank</p>
                                <p className={`text-xs ${blocker.settlement_items_count > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {blocker.settlement_items_count > 0
                                    ? `✓ Yes (${blocker.settlement_items_count} entries)`
                                    : '✗ Not yet'}
                                </p>
                              </div>
                            </div>

                            {/* Progress indicator */}
                            <div className="flex items-center gap-1 mb-3">
                              <div className={`h-1.5 flex-1 rounded-full ${blocker.order_status !== 'Cancelled' ? 'bg-emerald-500/40' : 'bg-red-500/40'}`} title="Order placed" />
                              <div className={`h-1.5 flex-1 rounded-full ${blocker.delivery_date ? 'bg-emerald-500/40' : 'bg-slate-700'}`} title="Delivered" />
                              <div className={`h-1.5 flex-1 rounded-full ${blocker.event_count > 0 ? 'bg-emerald-500/40' : 'bg-slate-700'}`} title="Charges recorded" />
                              <div className={`h-1.5 flex-1 rounded-full ${blocker.settlement_items_count > 0 ? 'bg-emerald-500/40' : 'bg-slate-700'}`} title="Settled" />
                              <p className="text-[9px] text-slate-600 ml-2">Order → Delivered → Charged → Settled</p>
                            </div>

                            {/* Override info */}
                            {blocker.override && (
                              <div className="bg-white/[0.02] rounded-lg p-2 mb-3 text-xs text-slate-500">
                                <span className="font-medium">Current override:</span> {blocker.override.override_action}
                                {blocker.override.reason && <span> — &quot;{blocker.override.reason}&quot;</span>}
                                <span className="ml-2 text-slate-600">({fmtDate(blocker.override.overridden_at)})</span>
                              </div>
                            )}

                            {/* Reason input (expandable) */}
                            {showReasonFor === blocker.order_id && (
                              <div className="mb-3">
                                <input
                                  type="text"
                                  placeholder="Optional: Add a reason for this override…"
                                  value={reasonInputs[blocker.order_id] || ''}
                                  onChange={e => setReasonInputs(prev => ({ ...prev, [blocker.order_id]: e.target.value }))}
                                  className="w-full px-3 py-1.5 text-xs bg-[#111827] border border-white/[0.08] rounded-lg text-white placeholder-slate-600 focus:outline-none focus:border-blue-500/30"
                                />
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => handleOverride(blocker.order_id, 'INCLUDE')}
                                disabled={!!actionLoading}
                                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-emerald-500/15 border border-emerald-500/25 rounded-lg text-emerald-400 hover:bg-emerald-500/25 transition disabled:opacity-50"
                              >
                                {actionLoading === blocker.order_id + 'INCLUDE'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <CheckCircle2 size={11} />}
                                Include in Revenue
                              </button>
                              <button
                                onClick={() => handleOverride(blocker.order_id, 'EXCLUDE')}
                                disabled={!!actionLoading}
                                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-red-500/15 border border-red-500/25 rounded-lg text-red-400 hover:bg-red-500/25 transition disabled:opacity-50"
                              >
                                {actionLoading === blocker.order_id + 'EXCLUDE'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <XCircle size={11} />}
                                Exclude
                              </button>
                              <button
                                onClick={() => handleOverride(blocker.order_id, 'DEFER')}
                                disabled={!!actionLoading}
                                className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-amber-500/15 border border-amber-500/25 rounded-lg text-amber-400 hover:bg-amber-500/25 transition disabled:opacity-50"
                              >
                                {actionLoading === blocker.order_id + 'DEFER'
                                  ? <Loader2 size={11} className="animate-spin" />
                                  : <Pause size={11} />}
                                Defer
                              </button>
                              {blocker.override && (
                                <button
                                  onClick={() => handleOverride(blocker.order_id, 'RESET')}
                                  disabled={!!actionLoading}
                                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-slate-500/15 border border-slate-500/25 rounded-lg text-slate-400 hover:bg-slate-500/25 transition disabled:opacity-50"
                                >
                                  {actionLoading === blocker.order_id + 'RESET'
                                    ? <Loader2 size={11} className="animate-spin" />
                                    : <RotateCcw size={11} />}
                                  Reset
                                </button>
                              )}
                              <button
                                onClick={() => setShowReasonFor(showReasonFor === blocker.order_id ? null : blocker.order_id)}
                                className="flex items-center gap-1 px-2 py-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition"
                              >
                                <FileText size={11} />
                                {showReasonFor === blocker.order_id ? 'Hide reason' : 'Add reason'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* ── Existing Overrides Summary ── */}
            {data.all_overrides.length > 0 && (
              <div className="bg-[#111827]/80 border border-white/[0.06] rounded-xl p-5">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <FileText size={14} className="text-blue-400" />
                  Active Overrides ({data.all_overrides.length})
                </h3>
                <div className="space-y-2">
                  {data.all_overrides.map((ov: any) => (
                    <div key={ov.amazon_order_id} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-slate-300">{ov.amazon_order_id}</span>
                        <OverrideBadge action={ov.override_action} />
                        {ov.reason && <span className="text-[10px] text-slate-500">&quot;{ov.reason}&quot;</span>}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-600">{fmtDate(ov.overridden_at)}</span>
                        <button
                          onClick={() => handleOverride(ov.amazon_order_id, 'RESET')}
                          disabled={!!actionLoading}
                          className="text-[10px] text-slate-500 hover:text-red-400 transition"
                        >
                          <XCircle size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

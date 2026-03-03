'use client';
import { useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import KPICard, { KPICardSkeleton } from '@/components/cards/KPICard';
import RevenueChart from '@/components/charts/RevenueChart';
import { PlatformPieChart, OrderStatusChart } from '@/components/charts/PieCharts';
import OrdersTable from '@/components/tables/OrdersTable';
import { LowStockAlerts } from '@/components/tables/InventoryTable';
import PerformanceMetrics from '@/components/cards/PerformanceMetrics';
import {
  Activity, RefreshCw, AlertCircle,
  IndianRupee, ShoppingCart, Package, TrendingUp, Percent,
  Eye, MousePointerClick, BarChart3, Target,
  Megaphone, DollarSign, Gauge,
  Warehouse, Clock, Archive, Undo2,
  Star, Award, Hash,
} from 'lucide-react';

const PERIODS = [
  { key: '1d', label: 'Today (IST)' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '1y', label: '1Y' },
];

// ─── Section Card Component ─────────────────────────────────────────────────

function SectionTitle({ title, subtitle, icon: Icon }: { title: string; subtitle?: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center">
        <Icon size={18} className="text-indigo-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, iconColor = 'text-indigo-400', subtitle }: {
  label: string; value: string | number; icon: React.ComponentType<{ size?: number; className?: string }>; iconColor?: string; subtitle?: string;
}) {
  return (
    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-4 hover:border-white/10 transition-all">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={iconColor} />
        <p className="text-xs text-slate-500">{label}</p>
      </div>
      <p className="text-xl font-bold text-white">{value}</p>
      {subtitle && <p className="text-xs text-slate-500 mt-1">{subtitle}</p>}
    </div>
  );
}

function MetricCardSkeleton() {
  return (
    <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-4 animate-pulse">
      <div className="h-3 w-20 bg-white/5 rounded mb-3" />
      <div className="h-6 w-28 bg-white/5 rounded" />
    </div>
  );
}

function formatINR(n: number): string {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

// ─── Main Dashboard Page ────────────────────────────────────────────────────

export default function DashboardPage() {
  const [period, setPeriod] = useState('30d');
  const { data, loading, error, refresh } = useFetch<any>(`/api/dashboard?period=${period}`);
  const { data: inventoryData, loading: inventoryLoading, refresh: refreshInventory } = useFetch<any>('/api/inventory?fulfillment=fbm');
  const [lastRefresh, setLastRefresh] = useState('');

  const handleRefresh = async () => {
    await Promise.all([refresh(), refreshInventory()]);
    setLastRefresh(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  };

  const stockAlertItems = inventoryData?.items || [];
  const bd = data?.businessDashboard;
  const tc = data?.trafficConversion;
  const ad = data?.advertisingMetrics;
  const sr = data?.salesRevenue;
  const inv = data?.inventoryMetrics;
  const skuPerf: any[] = data?.skuPerformance || [];

  return (
    <DashboardLayout>
      {/* ─── Page Title + Controls ──────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            Dashboard Overview
            {data?.platforms?.amazon?.connected && (
              <span className="flex items-center gap-1 text-xs font-medium bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded-full">
                <Activity size={10} className="animate-pulse" />
                Live
              </span>
            )}
          </h1>
          <p className="text-sm text-slate-500 mt-1">Real-time data from connected platforms</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${period === p.key
                  ? 'bg-indigo-500/20 text-indigo-400 shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {lastRefresh && <span className="text-xs text-slate-600">Last: {lastRefresh}</span>}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 hover:border-white/20 transition-all disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="flex items-center gap-3 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <AlertCircle size={18} className="text-red-400 shrink-0" />
          <div>
            <p className="text-sm text-red-400 font-medium">Failed to load dashboard data</p>
            <p className="text-xs text-red-400/60 mt-0.5">{error}</p>
          </div>
          <button onClick={handleRefresh} className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 1: Business Dashboard
         ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle title="Business Dashboard" subtitle="Key business performance metrics" icon={BarChart3} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => <KPICardSkeleton key={i} />)
          ) : data?.kpis ? (
            data.kpis.map((kpi: any, i: number) => <KPICard key={i} data={kpi} />)
          ) : null}
        </div>
        {/* Top Products + Ads Spend row */}
        {!loading && bd && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
            <div className="xl:col-span-2 bg-[#111827]/80 border border-white/5 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                <Award size={16} className="text-amber-400" /> Top Products
              </h3>
              {bd.topProducts?.length > 0 ? (
                <div className="space-y-2.5">
                  {bd.topProducts.map((p: any, i: number) => (
                    <div key={p.sku} className="flex items-center justify-between py-2 px-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-bold text-slate-500 w-5">#{i + 1}</span>
                        <div>
                          <p className="text-sm text-white font-medium truncate max-w-[280px]">{p.name}</p>
                          <p className="text-xs text-slate-500">{p.sku}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-white font-semibold">{formatINR(p.revenue)}</p>
                        <p className="text-xs text-slate-500">{p.unitsSold} units</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500 py-4 text-center">No product data for this period</p>
              )}
            </div>
            <MetricCard label="Ads Spend" value={formatINR(bd.adsSpend || 0)} icon={Megaphone} iconColor="text-purple-400" subtitle="Advertising API not connected" />
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 2: Traffic & Conversion (all zero for now)
         ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle title="Traffic & Conversion" subtitle="Session and page view metrics — requires Amazon Brand Analytics" icon={Eye} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <MetricCardSkeleton key={i} />)
          ) : (
            <>
              <MetricCard label="Sessions" value={tc?.sessions ?? 0} icon={Eye} iconColor="text-cyan-400" />
              <MetricCard label="Page Views" value={tc?.pageViews ?? 0} icon={Eye} iconColor="text-blue-400" />
              <MetricCard label="Conversion Rate" value={`${(tc?.conversionRate ?? 0).toFixed(1)}%`} icon={Percent} iconColor="text-emerald-400" subtitle="Unit Session %" />
              <MetricCard label="Detail Page Views" value={tc?.detailPageViews ?? 0} icon={MousePointerClick} iconColor="text-indigo-400" />
              <MetricCard label="State Wise Orders" value={tc?.stateWiseOrders?.length > 0 ? `${tc.stateWiseOrders.length} states` : '—'} icon={Target} iconColor="text-amber-400" />
            </>
          )}
        </div>
        {/* State Wise Orders breakdown */}
        {!loading && tc?.stateWiseOrders?.length > 0 && (
          <div className="mt-4 bg-[#111827]/80 border border-white/5 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
              <Target size={16} className="text-amber-400" /> State Wise Orders
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
              {tc.stateWiseOrders.slice(0, 18).map((s: any) => (
                <div key={s.state} className="flex items-center justify-between py-2 px-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <span className="text-sm text-slate-300 truncate">{s.state}</span>
                  <span className="text-sm text-white font-semibold ml-2">{s.count}</span>
                </div>
              ))}
            </div>
            {tc.stateWiseOrders.length > 18 && (
              <p className="text-xs text-slate-500 mt-2 text-right">+{tc.stateWiseOrders.length - 18} more states</p>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 3: Advertising Metrics (all zero for now)
         ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle title="Advertising Metrics" subtitle="Amazon PPC campaign data — Advertising API not connected" icon={Megaphone} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {loading ? (
            Array.from({ length: 8 }).map((_, i) => <MetricCardSkeleton key={i} />)
          ) : (
            <>
              <MetricCard label="Impressions" value={(ad?.impressions ?? 0).toLocaleString('en-IN')} icon={Eye} iconColor="text-blue-400" />
              <MetricCard label="Clicks" value={(ad?.clicks ?? 0).toLocaleString('en-IN')} icon={MousePointerClick} iconColor="text-cyan-400" />
              <MetricCard label="Spend" value={formatINR(ad?.spend ?? 0)} icon={DollarSign} iconColor="text-red-400" />
              <MetricCard label="Sales from Ads" value={formatINR(ad?.salesFromAds ?? 0)} icon={IndianRupee} iconColor="text-emerald-400" />
              <MetricCard label="ACoS" value={`${(ad?.acos ?? 0).toFixed(1)}%`} icon={Percent} iconColor="text-amber-400" subtitle="Ad Cost of Sales" />
              <MetricCard label="RoAS" value={(ad?.roas ?? 0).toFixed(2)} icon={TrendingUp} iconColor="text-emerald-400" subtitle="Return on Ad Spend" />
              <MetricCard label="CTR" value={`${(ad?.ctr ?? 0).toFixed(2)}%`} icon={Gauge} iconColor="text-indigo-400" subtitle="Click-Through Rate" />
              <MetricCard label="CPC" value={formatINR(ad?.cpc ?? 0)} icon={DollarSign} iconColor="text-purple-400" subtitle="Cost per Click" />
            </>
          )}
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 4: Sales & Revenue
         ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle title="Sales & Revenue" subtitle="Revenue trends, conversion, and inventory health" icon={IndianRupee} />
        {!loading && data && (
          <>
            {/* Revenue chart row */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-6">
              <div className="xl:col-span-2">
                <RevenueChart data={data.revenueChartData} granularity={data.granularity} />
              </div>
              <div className="space-y-6">
                <OrderStatusChart data={data.orderStatusData} />
                <PlatformPieChart data={data.platformSales} platforms={data.platforms} />
              </div>
            </div>
            {/* Quick metrics row */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4 mb-4">
              <MetricCard label="Revenue" value={formatINR(sr?.revenue ?? 0)} icon={IndianRupee} iconColor="text-emerald-400" />
              <MetricCard label="Orders" value={(sr?.orders ?? 0).toLocaleString('en-IN')} icon={ShoppingCart} iconColor="text-indigo-400" />
              <MetricCard label="Sessions" value={sr?.sessions ?? 0} icon={Eye} iconColor="text-cyan-400" />
              <MetricCard label="Conversion Rate" value={`${(sr?.conversionRate ?? 0).toFixed(1)}%`} icon={Percent} iconColor="text-emerald-400" />
              <MetricCard label="Inventory Days Left" value={sr?.inventoryDaysLeft === 999 ? '∞' : (sr?.inventoryDaysLeft ?? 0)} icon={Clock} iconColor="text-amber-400" />
              <MetricCard label="Slow Movers" value={sr?.slowMovers?.length ?? 0} icon={Archive} iconColor="text-red-400" />
              <MetricCard label="Top Products" value={sr?.topProducts?.length ?? 0} icon={Award} iconColor="text-amber-400" />
            </div>
            {/* Slow movers list */}
            {sr?.slowMovers?.length > 0 && (
              <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <Archive size={16} className="text-red-400" /> Slow Movers
                  <span className="text-xs text-slate-500 font-normal ml-1">— Items with inventory but no sales this period</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {sr.slowMovers.map((m: any) => (
                    <div key={m.sku} className="flex items-center justify-between py-2 px-3 rounded-xl bg-red-500/5 border border-red-500/10">
                      <div>
                        <p className="text-sm text-white font-medium truncate max-w-[200px]">{m.name}</p>
                        <p className="text-xs text-slate-500">{m.sku}</p>
                      </div>
                      <span className="text-xs text-amber-400 font-semibold">{m.stock} units</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 5: Inventory Metrics
         ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle title="Inventory Metrics" subtitle="Stock levels, aging, and fulfillment breakdown" icon={Warehouse} />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => <MetricCardSkeleton key={i} />)
          ) : (
            <>
              <MetricCard label="Available Inventory" value={(inv?.availableInventory ?? 0).toLocaleString('en-IN')} icon={Package} iconColor="text-emerald-400" subtitle={`${data?.stats?.totalSkus ?? 0} SKUs`} />
              <MetricCard label="Days of Inventory Left" value={inv?.daysOfInventoryLeft === 999 ? '∞' : (inv?.daysOfInventoryLeft ?? 0)} icon={Clock} iconColor="text-amber-400" subtitle="Based on current sales velocity" />
              <MetricCard label="Inventory Selling Type" value={`FBM: ${inv?.inventorySellingType?.fbm ?? 0}`} icon={Warehouse} iconColor="text-indigo-400" subtitle={`FBA: ${inv?.inventorySellingType?.fba ?? 0}`} />
              <MetricCard label="Aged Inventory" value={inv?.agedInventory ?? 0} icon={Archive} iconColor="text-red-400" subtitle="SKUs with stock but no sales" />
              <MetricCard label="Returns" value={inv?.returns ?? 0} icon={Undo2} iconColor="text-red-400" />
            </>
          )}
        </div>
        {!loading && data && (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <OrdersTable orders={data.recentOrders} />
            </div>
            <div className="space-y-6">
              <PerformanceMetrics
                platforms={data.platforms}
                stats={{
                  totalOrders: data.stats.totalOrders,
                  totalRevenue: data.stats.totalRevenue,
                  returnedOrders: data.orderStatusData.find((d: any) => d.status === 'Returned')?.count || 0,
                }}
              />
              <LowStockAlerts items={stockAlertItems} loading={inventoryLoading} limit={6} />
            </div>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          SECTION 6: Product / SKU Level Metrics
         ═══════════════════════════════════════════════════════════════ */}
      <div>
        <SectionTitle title="Product / SKU Level Metrics" subtitle="Per-product performance breakdown" icon={Package} />
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 bg-[#111827]/80 border border-white/5 rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : skuPerf.length > 0 ? (
          <div className="bg-[#111827]/80 border border-white/5 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/5">
                    {['#', 'Product', 'SKU', 'Revenue', 'Units Sold', 'Returns', 'Conv. Rate', 'Reviews', 'Rating', 'BSR'].map(h => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider first:pl-5 last:pr-5">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.03]">
                  {skuPerf.map((sku: any, i: number) => (
                    <tr key={sku.sku} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 pl-5 text-xs text-slate-500 font-bold">{i + 1}</td>
                      <td className="py-3 px-4">
                        <p className="text-sm text-white font-medium truncate max-w-[220px]">{sku.name}</p>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-400 font-mono">{sku.sku}</td>
                      <td className="py-3 px-4 text-sm text-emerald-400 font-semibold">{formatINR(sku.revenue)}</td>
                      <td className="py-3 px-4 text-sm text-white">{sku.unitsSold}</td>
                      <td className="py-3 px-4 text-sm text-red-400">{sku.returns}</td>
                      <td className="py-3 px-4 text-sm text-slate-400">{sku.conversionRate > 0 ? `${sku.conversionRate.toFixed(1)}%` : '—'}</td>
                      <td className="py-3 px-4 text-sm text-slate-400">
                        <span className="flex items-center gap-1">
                          <Hash size={12} className="text-slate-500" />
                          {sku.reviewsCount || '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-slate-400">
                        <span className="flex items-center gap-1">
                          <Star size={12} className="text-amber-400" />
                          {sku.starRating > 0 ? sku.starRating.toFixed(1) : '—'}
                        </span>
                      </td>
                      <td className="py-3 px-4 pr-5 text-sm text-slate-400">{sku.bsr > 0 ? `#${sku.bsr.toLocaleString('en-IN')}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="bg-[#111827]/80 border border-white/5 rounded-2xl p-8 text-center">
            <Package size={24} className="text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No SKU performance data for this period</p>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-center py-4 border-t border-white/5">
        <p className="text-xs text-slate-600">
          SmartCommerce Dashboard v2.0 · Data from Amazon SP-API · {data?.lastUpdated ? `Synced: ${new Date(data.lastUpdated).toLocaleString('en-IN')}` : ''}
        </p>
      </div>
    </DashboardLayout>
  );
}

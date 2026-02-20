'use client';
import { useState, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useFetch } from '@/hooks/useFetch';
import KPICard, { KPICardSkeleton } from '@/components/cards/KPICard';
import RevenueChart from '@/components/charts/RevenueChart';
import { PlatformPieChart, OrderStatusChart } from '@/components/charts/PieCharts';
import OrdersTable from '@/components/tables/OrdersTable';
import { LowStockAlerts } from '@/components/tables/InventoryTable';
import PerformanceMetrics from '@/components/cards/PerformanceMetrics';
import { Activity, RefreshCw, AlertCircle, Calendar } from 'lucide-react';

const PERIODS = [
  { key: '1d', label: 'Today (IST)' },
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: '1y', label: '1Y' },
];

export default function DashboardPage() {
  const [period, setPeriod] = useState('30d');
  const { data, loading, error, refresh } = useFetch<any>(`/api/dashboard?period=${period}`);
  const { data: inventoryData, loading: inventoryLoading, refresh: refreshInventory } = useFetch<any>('/api/inventory?fulfillment=fbm');
  const [lastRefresh, setLastRefresh] = useState('');

  const handleRefresh = async () => {
    await Promise.all([refresh(), refreshInventory()]);
    setLastRefresh(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  };

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
  };

  const stockAlertItems = inventoryData?.items || [];

  return (
    <DashboardLayout>
      {/* Page Title + Controls */}
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
          {/* Period Selector */}
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl p-1">
            {PERIODS.map(p => (
              <button
                key={p.key}
                onClick={() => handlePeriodChange(p.key)}
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
          <button
            onClick={handleRefresh}
            className="ml-auto text-xs text-red-400 hover:text-red-300 font-medium px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/15 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* KPI Cards — 2 rows of 4 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <KPICardSkeleton key={i} />)
          : data?.kpis?.map((kpi: any, i: number) => <KPICard key={i} data={kpi} />)
        }
      </div>

      {/* Charts & Tables */}
      {!loading && data && (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            <div className="xl:col-span-2">
              <RevenueChart data={data.revenueChartData} granularity={data.granularity} />
            </div>
            <div className="space-y-6">
              <OrderStatusChart data={data.orderStatusData} />
              <PlatformPieChart data={data.platformSales} platforms={data.platforms} />
            </div>
          </div>

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
        </>
      )}

      {/* Footer */}
      <div className="text-center py-4 border-t border-white/5">
        <p className="text-xs text-slate-600">
          SmartCommerce Dashboard v2.0 · Data from Amazon SP-API · {data?.lastUpdated ? `Synced: ${new Date(data.lastUpdated).toLocaleString('en-IN')}` : ''}
        </p>
      </div>
    </DashboardLayout>
  );
}

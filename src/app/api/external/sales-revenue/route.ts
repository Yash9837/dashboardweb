/**
 * External API: Sales & Revenue
 *
 * GET /api/external/sales-revenue?period=30d
 *
 * Returns: revenue, orders, sessions, conversionRate, slowMovers,
 *          inventoryDaysLeft, topProducts, revenueTrend (chart data),
 *          orderStatusDistribution
 */

import { fetchDashboardData, pctChange, trend } from '@/lib/dashboard-engine';
import { jsonResponse, errorResponse, optionsResponse, validateApiKey } from '@/lib/api-helpers';
import { getCached, setCache, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function OPTIONS() { return optionsResponse(); }

export async function GET(request: Request) {
    const authError = validateApiKey(request);
    if (authError) return authError;

    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';

        const cacheKey = `ext_sales_${period}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return jsonResponse(cached);

        const d = await fetchDashboardData(period);
        const c = d.current;
        const p = d.previous;

        const response = {
            success: true,
            period: d.period,
            days: d.days,
            granularity: d.granularity,
            metrics: {
                revenue:          { value: Math.round(c.totalRevenue), currency: 'INR', change: pctChange(c.totalRevenue, p.totalRevenue), trend: trend(c.totalRevenue, p.totalRevenue) },
                orders:           { value: c.totalOrders,              change: pctChange(c.totalOrders, p.totalOrders),                   trend: trend(c.totalOrders, p.totalOrders) },
                sessions:         { value: 0, note: 'Requires Brand Analytics' },
                conversionRate:   { value: 0, unit: '%', note: 'Requires Brand Analytics' },
                inventoryDaysLeft: { value: d.inventoryDaysLeft === 999 ? null : d.inventoryDaysLeft, unit: 'days', note: d.inventoryDaysLeft === 999 ? 'Infinite — no sales velocity' : undefined },
            },
            topProducts: d.topProducts.map(tp => ({
                sku: tp.sku, name: tp.name, asin: tp.asin,
                revenue: tp.revenue, unitsSold: tp.unitsSold,
            })),
            slowMovers: d.slowMovers.map(m => ({
                sku: m.sku, name: m.name, stock: m.stock,
            })),
            revenueTrend: d.revenueTrend,
            orderStatusDistribution: d.orderStatusDistribution,
            timestamp: new Date().toISOString(),
        };

        setCache(cacheKey, response, TTL.DASHBOARD);
        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}

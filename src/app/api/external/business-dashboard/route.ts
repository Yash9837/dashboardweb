/**
 * External API: Business Dashboard
 *
 * GET /api/external/business-dashboard?period=30d
 *
 * Returns: totalRevenue, grossProfit, totalOrders, unitsSold, avgOrderValue,
 *          returns, cancellations, returnRate, cancelRate, topProducts, adsSpend
 *          + % change vs previous period for all numeric metrics
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

        const cacheKey = `ext_business_${period}`;
        const cached = getCached<any>(cacheKey);
        if (cached) return jsonResponse(cached);

        const d = await fetchDashboardData(period);
        const c = d.current;
        const p = d.previous;

        const response = {
            success: true,
            period: d.period,
            days: d.days,
            metrics: {
                totalRevenue:    { value: Math.round(c.totalRevenue),     currency: 'INR', change: pctChange(c.totalRevenue, p.totalRevenue),     trend: trend(c.totalRevenue, p.totalRevenue) },
                grossProfit:     { value: Math.round(c.grossProfit),      currency: 'INR', change: pctChange(c.grossProfit, p.grossProfit),       trend: trend(c.grossProfit, p.grossProfit) },
                totalOrders:     { value: c.totalOrders,                  change: pctChange(c.totalOrders, p.totalOrders),                       trend: trend(c.totalOrders, p.totalOrders) },
                unitsSold:       { value: c.unitsSold,                    change: pctChange(c.unitsSold, p.unitsSold),                           trend: trend(c.unitsSold, p.unitsSold) },
                avgOrderValue:   { value: Math.round(c.avgOrderValue),    currency: 'INR', change: pctChange(c.avgOrderValue, p.avgOrderValue),   trend: trend(c.avgOrderValue, p.avgOrderValue) },
                returns:         { value: c.returnedOrders,               change: pctChange(c.returnedOrders, p.returnedOrders),                 trend: trend(c.returnedOrders, p.returnedOrders) },
                cancellations:   { value: c.canceledOrders,               change: pctChange(c.canceledOrders, p.canceledOrders),                 trend: trend(c.canceledOrders, p.canceledOrders) },
                returnRate:      { value: parseFloat(c.returnRate.toFixed(1)),   unit: '%', change: pctChange(c.returnRate, p.returnRate),       trend: trend(c.returnRate, p.returnRate) },
                cancelRate:      { value: parseFloat(c.cancelRate.toFixed(1)),   unit: '%', change: pctChange(c.cancelRate, p.cancelRate),       trend: trend(c.cancelRate, p.cancelRate) },
                adsSpend:        { value: 0, currency: 'INR', note: 'Advertising API not connected' },
            },
            topProducts: d.topProducts.map(p => ({
                sku: p.sku, name: p.name, asin: p.asin,
                revenue: p.revenue, unitsSold: p.unitsSold, returns: p.returns,
            })),
            timestamp: new Date().toISOString(),
        };

        setCache(cacheKey, response, TTL.DASHBOARD);
        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}

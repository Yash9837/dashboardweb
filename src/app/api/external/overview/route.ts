/**
 * External API: Overview (Combined)
 *
 * GET /api/external/overview?period=30d
 *
 * Returns ALL 6 dashboard sections in a single response,
 * plus recent orders and order status distribution.
 * Ideal for external apps that need a complete snapshot.
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

        const cacheKey = `ext_overview_${period}`;
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

            /* ── Section 1: Business Dashboard ────────────── */
            businessDashboard: {
                totalRevenue:   { value: Math.round(c.totalRevenue), currency: 'INR', change: pctChange(c.totalRevenue, p.totalRevenue), trend: trend(c.totalRevenue, p.totalRevenue) },
                grossProfit:    { value: Math.round(c.grossProfit), currency: 'INR' },
                totalOrders:    { value: c.totalOrders, change: pctChange(c.totalOrders, p.totalOrders), trend: trend(c.totalOrders, p.totalOrders) },
                unitsSold:      { value: c.unitsSold, change: pctChange(c.unitsSold, p.unitsSold), trend: trend(c.unitsSold, p.unitsSold) },
                avgOrderValue:  { value: Math.round(c.avgOrderValue), currency: 'INR' },
                returns:        { value: c.returnedOrders },
                cancellations:  { value: c.canceledOrders },
                returnRate:     { value: parseFloat(c.returnRate.toFixed(1)), unit: '%' },
                cancelRate:     { value: parseFloat(c.cancelRate.toFixed(1)), unit: '%' },
                adsSpend:       { value: 0, currency: 'INR', note: 'Advertising API not connected' },
                topProducts: d.topProducts.map(tp => ({ sku: tp.sku, name: tp.name, asin: tp.asin, revenue: tp.revenue, unitsSold: tp.unitsSold, returns: tp.returns })),
            },

            /* ── Section 2: Traffic & Conversion ──────────── */
            trafficConversion: {
                sessions:         { value: 0, note: 'Requires Brand Analytics' },
                pageViews:        { value: 0, note: 'Requires Brand Analytics' },
                conversionRate:   { value: 0, unit: '%', note: 'Requires Brand Analytics' },
                detailPageViews:  { value: 0, note: 'Requires Brand Analytics' },
                stateWiseOrders:  d.stateWiseOrders,
            },

            /* ── Section 3: Advertising ───────────────────── */
            advertising: {
                impressions:   { value: 0, note: 'Advertising API not connected' },
                clicks:        { value: 0 },
                spend:         { value: 0, currency: 'INR' },
                salesFromAds:  { value: 0, currency: 'INR' },
                acos:          { value: 0, unit: '%' },
                roas:          { value: 0 },
                ctr:           { value: 0, unit: '%' },
                cpc:           { value: 0, currency: 'INR' },
            },

            /* ── Section 4: Sales & Revenue ───────────────── */
            salesRevenue: {
                revenueTrend:              d.revenueTrend,
                orderStatusDistribution:   d.orderStatusDistribution,
                slowMovers:                d.slowMovers.map(m => ({ sku: m.sku, name: m.name, stock: m.stock })),
                inventoryDaysLeft:         d.inventoryDaysLeft === 999 ? null : d.inventoryDaysLeft,
            },

            /* ── Section 5: Inventory Metrics ─────────────── */
            inventory: {
                availableInventory: d.totalUnits,
                inventoryDaysLeft:  d.inventoryDaysLeft === 999 ? null : d.inventoryDaysLeft,
                sellingType:        { fba: 0, fbm: d.totalUnits },
                agedInventory:      d.agedInventoryCount,
                returnCount:        c.returnedOrders,
                totalSkus:          d.totalSkus,
                outOfStock:         d.outOfStockCount,
                lowStock:           d.lowStockCount,
                items: d.inventoryItems.map(i => ({
                    sku: i.sku, name: i.name, stock: i.stock,
                    fulfillableQty: i.fulfillableQty, inboundQty: i.inboundQty, reservedQty: i.reservedQty, status: i.status,
                })),
            },

            /* ── Section 6: SKU Performance ───────────────── */
            skuPerformance: {
                totalSkus: d.skuPerformance.length,
                items: d.skuPerformance.slice(0, 50).map(s => ({
                    sku: s.sku, name: s.name, asin: s.asin,
                    revenue: s.revenue, unitsSold: s.unitsSold, returns: s.returns,
                    conversionRate: s.conversionRate, reviews: s.reviewsCount,
                    rating: s.starRating, bsr: s.bsr,
                })),
                note: d.skuPerformance.length > 50 ? `Showing top 50 of ${d.skuPerformance.length}. Use /api/external/sku-performance for paginated access.` : undefined,
            },

            /* ── Recent Orders ────────────────────────────── */
            recentOrders: d.recentOrders.map(o => ({
                orderId: o.id, date: o.date, platform: o.platform,
                location: o.location, city: o.city, state: o.state,
                total: o.total, currency: o.currency, status: o.status, items: o.items,
            })),

            timestamp: new Date().toISOString(),
        };

        setCache(cacheKey, response, TTL.DASHBOARD);
        return jsonResponse(response);
    } catch (e: any) {
        return errorResponse(e.message);
    }
}

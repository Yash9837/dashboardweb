import { NextResponse } from 'next/server';
import {
    fetchAmazonOrders,
    fetchAmazonInventory,
    checkAmazonConnection,
    getShopifyStatus,
    getWalmartStatus,
} from '@/lib/amazon-client';
import { mapOrderStatus, formatINR } from '@/lib/utils';
import { getCached, setCache, getStale, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Period Helpers ──────────────────────────────────────────────────────────

const PERIODS: Record<string, number> = {
    '1d': 1,
    '7d': 7,
    '30d': 30,
    '90d': 90,
    '1y': 365,
};

const DASHBOARD_TIME_ZONE = process.env.DASHBOARD_TIMEZONE || 'Asia/Kolkata';
const DASHBOARD_CACHE_VERSION = 'v4';
const NOW_SAFETY_BUFFER_MS = 3 * 60 * 1000;

function getDatePartsInTimeZone(date: Date, timeZone: string): { year: number; month: number; day: number } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });

    const parts = formatter.formatToParts(date);
    const year = Number(parts.find(p => p.type === 'year')?.value);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    const day = Number(parts.find(p => p.type === 'day')?.value);

    return { year, month, day };
}

function getOffsetMinutesAt(date: Date, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
    }).formatToParts(date);

    const offsetText = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+00:00';
    if (offsetText === 'UTC' || offsetText === 'GMT') return 0;

    const match = offsetText.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return 0;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * (hours * 60 + minutes);
}

function buildZonedDate(
    dateParts: { year: number; month: number; day: number },
    timeZone: string,
    hour = 0,
    minute = 0,
    second = 0,
    millisecond = 0
): Date {
    const utcGuess = new Date(Date.UTC(
        dateParts.year,
        dateParts.month - 1,
        dateParts.day,
        hour,
        minute,
        second,
        millisecond
    ));

    const offsetMinutes = getOffsetMinutesAt(utcGuess, timeZone);
    return new Date(utcGuess.getTime() - offsetMinutes * 60 * 1000);
}

function getTodayAndPreviousWindow(now: Date, timeZone: string): {
    currentStart: Date;
    currentEnd: Date;
    previousStart: Date;
    previousEnd: Date;
} {
    const todayParts = getDatePartsInTimeZone(now, timeZone);
    const currentStart = buildZonedDate(todayParts, timeZone, 0, 0, 0, 0);
    const currentEnd = new Date(Math.max(currentStart.getTime() + 60 * 1000, now.getTime() - NOW_SAFETY_BUFFER_MS));

    const elapsedMs = Math.max(currentEnd.getTime() - currentStart.getTime(), 60 * 1000);
    const yesterdayReference = new Date(currentStart.getTime() - 12 * 60 * 60 * 1000);
    const yesterdayParts = getDatePartsInTimeZone(yesterdayReference, timeZone);
    const previousStart = buildZonedDate(yesterdayParts, timeZone, 0, 0, 0, 0);
    const previousEnd = new Date(previousStart.getTime() + elapsedMs);

    return { currentStart, currentEnd, previousStart, previousEnd };
}

function getGranularity(days: number): 'daily' | 'weekly' | 'monthly' {
    if (days <= 30) return 'daily';
    if (days <= 90) return 'weekly';
    return 'monthly';
}

function getGroupKey(date: Date, granularity: 'daily' | 'weekly' | 'monthly'): string {
    if (granularity === 'daily') {
        return date.toLocaleDateString('en-IN', { month: 'short', day: '2-digit', timeZone: DASHBOARD_TIME_ZONE });
    }
    if (granularity === 'weekly') {
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        return weekStart.toLocaleDateString('en-IN', { month: 'short', day: '2-digit', timeZone: DASHBOARD_TIME_ZONE });
    }
    return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: DASHBOARD_TIME_ZONE });
}

// ─── Metrics computation ─────────────────────────────────────────────────────

interface OrderMetrics {
    totalRevenue: number;
    totalOrders: number;
    pendingOrders: number;
    shippedOrders: number;
    deliveredOrders: number;
    canceledOrders: number;
    returnedOrders: number;
    unitsSold: number;
    avgOrderValue: number;
    returnRate: number;
    cancelRate: number;
    grossProfit: number;
}

const PROFIT_MARGIN = 0.30; // 30% default

function toAmount(value: unknown): number {
    const raw = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(raw) ? raw : 0;
}

function computeMetrics(orders: any[]): OrderMetrics {
    let totalRevenue = 0;
    let pendingOrders = 0;
    let shippedOrders = 0;
    let deliveredOrders = 0;
    let canceledOrders = 0;
    let returnedOrders = 0;
    let unitsSold = 0;

    for (const order of orders) {
        if (order.OrderTotal) {
            totalRevenue += toAmount(order?.OrderTotal?.Amount);
        }
        unitsSold += (order.NumberOfItemsShipped || 0) + (order.NumberOfItemsUnshipped || 0);

        switch (order.OrderStatus) {
            case 'Pending':
            case 'Unshipped':
                pendingOrders++;
                break;
            case 'Shipped':
                shippedOrders++;
                break;
            case 'Canceled':
                canceledOrders++;
                break;
        }

        if (order.EasyShipShipmentStatus === 'Delivered') deliveredOrders++;
        if (order.EasyShipShipmentStatus === 'ReturningToSeller' || order.EasyShipShipmentStatus === 'ReturnedToSeller') {
            returnedOrders++;
        }
    }

    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const returnRate = totalOrders > 0 ? (returnedOrders / totalOrders) * 100 : 0;
    const cancelRate = totalOrders > 0 ? (canceledOrders / totalOrders) * 100 : 0;
    const grossProfit = totalRevenue * PROFIT_MARGIN;

    return {
        totalRevenue, totalOrders, pendingOrders, shippedOrders, deliveredOrders,
        canceledOrders, returnedOrders, unitsSold, avgOrderValue, returnRate, cancelRate, grossProfit,
    };
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const period = searchParams.get('period') || '30d';
        const days = PERIODS[period] || 30;
        const forceRefresh = searchParams.get('refresh') === 'true';

        const cacheKey = `dashboard_${period}_${DASHBOARD_CACHE_VERSION}`;

        // 1. Try cache
        if (!forceRefresh) {
            const cached = getCached<any>(cacheKey);
            if (cached) {
                return NextResponse.json({ ...cached, source: 'cache' });
            }
        }

        // 2. Check connections
        const [amazonStatus, shopifyStatus, walmartStatus] = await Promise.all([
            checkAmazonConnection(),
            Promise.resolve(getShopifyStatus()),
            Promise.resolve(getWalmartStatus()),
        ]);

        let allOrders: any[] = [];
        let prevOrders: any[] = [];
        let inventory: any[] = [];
        let error: string | null = null;

        if (amazonStatus.connected) {
            try {
                if (period === '1d') {
                    // Align "Today" with calendar day in marketplace time zone (not rolling 24h).
                    const window = getTodayAndPreviousWindow(new Date(), DASHBOARD_TIME_ZONE);

                    const [currentBatch, prevBatch, inv] = await Promise.all([
                        fetchAmazonOrders({
                            createdAfter: window.currentStart.toISOString(),
                            // Avoid CreatedBefore for current day because Orders API requires
                            // this boundary to be sufficiently behind "now", and can reject
                            // otherwise with InvalidInput.
                        }),
                        fetchAmazonOrders({
                            createdAfter: window.previousStart.toISOString(),
                            createdBefore: window.previousEnd.toISOString(),
                        }),
                        fetchAmazonInventory(),
                    ]);

                    allOrders = currentBatch;
                    prevOrders = prevBatch;
                    inventory = inv;
                } else {
                    // For non-Today periods keep rolling-window behavior.
                    const [currentBatch, prevBatch, inv] = await Promise.all([
                        fetchAmazonOrders(days),
                        fetchAmazonOrders(days * 2).then(all => {
                            const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
                            return all.filter((o: any) => new Date(o.PurchaseDate) < cutoff);
                        }),
                        fetchAmazonInventory(),
                    ]);

                    allOrders = currentBatch;
                    prevOrders = prevBatch;
                    inventory = inv;
                }
            } catch (e: any) {
                error = e.message;
                console.error('Failed to fetch Amazon data:', e.message);

                const stale = getStale<any>(cacheKey);
                if (stale) {
                    return NextResponse.json({ ...stale, source: 'stale-cache', error });
                }

                const legacyStale = getStale<any>(`dashboard_${period}`);
                if (legacyStale) {
                    return NextResponse.json({ ...legacyStale, source: 'stale-cache-legacy', error });
                }

                return NextResponse.json({
                    error: `Failed to fetch Amazon data: ${e.message}`,
                }, { status: 502 });
            }
        }

        // Use all fetched orders as-is (SP-API already filtered by CreatedAfter)
        const currentOrders = allOrders;

        const current = computeMetrics(currentOrders);
        const prev = computeMetrics(prevOrders);

        // 4. Compute % change
        function pctChange(curr: number, previous: number): number {
            if (previous === 0) return curr > 0 ? 100 : 0;
            return Math.round(((curr - previous) / previous) * 100);
        }

        function trend(curr: number, previous: number): 'up' | 'down' | 'flat' {
            const change = pctChange(curr, previous);
            if (change > 0) return 'up';
            if (change < 0) return 'down';
            return 'flat';
        }

        // 5. Build KPIs
        const kpis = [
            {
                label: 'Total Revenue',
                value: formatINR(current.totalRevenue),
                change: pctChange(current.totalRevenue, prev.totalRevenue),
                trend: trend(current.totalRevenue, prev.totalRevenue),
                icon: 'indian-rupee',
            },
            {
                label: 'Gross Profit',
                value: formatINR(current.grossProfit),
                change: pctChange(current.grossProfit, prev.grossProfit),
                trend: trend(current.grossProfit, prev.grossProfit),
                icon: 'bar-chart',
            },
            {
                label: 'Total Orders',
                value: current.totalOrders.toLocaleString('en-IN'),
                change: pctChange(current.totalOrders, prev.totalOrders),
                trend: trend(current.totalOrders, prev.totalOrders),
                icon: 'shopping-cart',
            },
            {
                label: 'Avg Order Value',
                value: formatINR(current.avgOrderValue),
                change: pctChange(current.avgOrderValue, prev.avgOrderValue),
                trend: trend(current.avgOrderValue, prev.avgOrderValue),
                icon: 'trending-up',
            },
            {
                label: 'Units Ordered',
                value: current.unitsSold.toLocaleString('en-IN'),
                change: pctChange(current.unitsSold, prev.unitsSold),
                trend: trend(current.unitsSold, prev.unitsSold),
                icon: 'package-check',
            },
            {
                label: 'Returns',
                value: current.returnedOrders.toString(),
                change: pctChange(current.returnedOrders, prev.returnedOrders),
                trend: trend(current.returnedOrders, prev.returnedOrders),
                icon: 'package-x',
            },
            {
                label: 'Cancellations',
                value: current.canceledOrders.toString(),
                change: pctChange(current.canceledOrders, prev.canceledOrders),
                trend: trend(current.canceledOrders, prev.canceledOrders),
                icon: 'x-circle',
            },
            {
                label: 'Return Rate',
                value: `${current.returnRate.toFixed(1)}%`,
                change: pctChange(current.returnRate, prev.returnRate),
                trend: trend(current.returnRate, prev.returnRate),
                icon: 'percent',
            },
        ];

        // 6. Build revenue/orders trend chart
        const granularity = getGranularity(days);
        const trendMap: Record<string, { revenue: number; orders: number; profit: number }> = {};

        for (const order of currentOrders) {
            const date = new Date(order.PurchaseDate);
            const key = getGroupKey(date, granularity);
            if (!trendMap[key]) trendMap[key] = { revenue: 0, orders: 0, profit: 0 };
            trendMap[key].orders++;
            if (order.OrderTotal) {
                const amount = toAmount(order?.OrderTotal?.Amount);
                trendMap[key].revenue += amount;
                trendMap[key].profit += amount * PROFIT_MARGIN;
            }
        }

        const revenueChartData = Object.entries(trendMap)
            .map(([date, d]) => ({
                date,
                amazon: Math.round(d.revenue),
                shopify: 0,
                walmart: 0,
                total: Math.round(d.revenue),
                orders: d.orders,
                profit: Math.round(d.profit),
            }))
            .sort((a, b) => {
                // Parse dates for proper sorting
                const parseDate = (s: string) => {
                    try { return new Date(s).getTime(); } catch { return 0; }
                };
                return parseDate(a.date) - parseDate(b.date);
            });

        // 7. Order status distribution
        const orderStatusData = [
            { status: 'Delivered', count: current.deliveredOrders, color: '#22c55e' },
            { status: 'Shipped', count: current.shippedOrders - current.deliveredOrders, color: '#6366f1' },
            { status: 'Pending', count: current.pendingOrders, color: '#94a3b8' },
            { status: 'Returned', count: current.returnedOrders, color: '#ef4444' },
            { status: 'Cancelled', count: current.canceledOrders, color: '#64748b' },
        ].filter(d => d.count > 0);

        // 8. Recent orders
        const recentOrders = currentOrders.slice(0, 15).map((o: any) => ({
            id: o.AmazonOrderId,
            date: o.PurchaseDate,
            platform: 'Amazon',
            customer: o.ShippingAddress
                ? `${o.ShippingAddress.City || ''}, ${o.ShippingAddress.StateOrRegion || ''}`.replace(/^, /, '')
                : 'N/A',
            items: (o.NumberOfItemsShipped || 0) + (o.NumberOfItemsUnshipped || 0),
            total: toAmount(o?.OrderTotal?.Amount),
            currency: o.OrderTotal?.CurrencyCode || 'INR',
            status: mapOrderStatus(o),
        }));

        // 9. Inventory stats
        const inventoryItems = inventory.map((item: any) => ({
            sku: item.sellerSku || 'N/A',
            name: item.productName || 'Unknown',
            image: '',
            platform: 'Amazon',
            unitsSold: 0,
            revenue: 0,
            stock: item.totalQuantity || 0,
            maxStock: Math.max(item.totalQuantity || 0, 50),
            status: item.totalQuantity === 0 ? 'out-of-stock'
                : (item.inventoryDetails?.fulfillableQuantity || 0) < 10 ? 'low-stock'
                    : 'in-stock',
            asin: item.asin || '',
            fnSku: item.fnSku || '',
            fulfillableQty: item.inventoryDetails?.fulfillableQuantity || 0,
            inboundQty: (item.inventoryDetails?.inboundWorkingQuantity || 0) +
                (item.inventoryDetails?.inboundShippedQuantity || 0) +
                (item.inventoryDetails?.inboundReceivingQuantity || 0),
            reservedQty: item.inventoryDetails?.totalReservedQuantity || 0,
        }));

        const totalSkus = inventoryItems.length;
        const outOfStockCount = inventoryItems.filter((i: any) => i.status === 'out-of-stock').length;
        const lowStockCount = inventoryItems.filter((i: any) => i.status === 'low-stock').length;
        const totalUnits = inventoryItems.reduce((sum: number, i: any) => sum + i.stock, 0);

        // Platform sales
        const platformSales = [
            { name: 'Amazon', value: Math.round(current.totalRevenue), color: '#6366f1' },
        ];

        // 10. Build response
        const response = {
            platforms: {
                amazon: amazonStatus,
                shopify: shopifyStatus,
                walmart: walmartStatus,
            },
            period,
            granularity,
            kpis,
            revenueChartData,
            platformSales,
            orderStatusData,
            recentOrders,
            inventoryItems,
            stats: {
                totalRevenue: current.totalRevenue,
                totalOrders: current.totalOrders,
                avgOrderValue: current.avgOrderValue,
                returnRate: current.returnRate,
                cancelRate: current.cancelRate,
                grossProfit: current.grossProfit,
                unitsSold: current.unitsSold,
                totalSkus,
                outOfStockCount,
                lowStockCount,
                totalUnits,
            },
            lastUpdated: new Date().toISOString(),
            error,
        };

        // Cache the result
        setCache(cacheKey, response, TTL.DASHBOARD);

        return NextResponse.json(response);

    } catch (e: any) {
        console.error('Dashboard API error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

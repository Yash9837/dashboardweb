import { NextResponse } from 'next/server';
import {
    checkAmazonConnection,
    fetchAmazonOrders,
    fetchOrderItems,
    fetchAllListings,
    fetchAmazonInventory,
    fetchCatalogBatch,
} from '@/lib/amazon-client';
import { getCached, getStale, setCache, TTL } from '@/lib/cache';
import { formatINR } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const DEFAULT_ENRICH_LIMIT = process.env.VERCEL ? 75 : 200;
const DEFAULT_CONCURRENCY = process.env.VERCEL ? 4 : 6;
const DEFAULT_DELAY_MS = process.env.VERCEL ? 60 : 120;

interface ProductPerformance {
    asin: string;
    sku: string;
    title: string;
    brand: string | null;
    image: string | null;
    totalRevenue: number;
    totalUnits: number;
    orderCount: number;
    avgPrice: number;
    revenueFormatted: string;
}

interface DeadStockProduct {
    asin: string;
    sku: string;
    title: string;
    brand: string | null;
    image: string | null;
    stock: number;
    price: number;
    estimatedValue: number;
    lastOrderDate: string | null;
    daysSinceLastOrder: number | null;
    severity: 'critical' | 'warning';
    fulfillmentChannel: string;
}

interface PerformanceKPIs {
    totalProductsSold: number;
    bestSellerName: string;
    bestSellerRevenue: number;
    worstPerformerName: string;
    worstPerformerRevenue: number;
    revenueConcentrationTop10: number;
    deadStockCount30d: number;
    deadStockCount60d: number;
    deadStockValue: number;
}

interface PerformanceApiPayload {
    topProducts: ProductPerformance[];
    deadStock30d: DeadStockProduct[];
    deadStock60d: DeadStockProduct[];
    kpis: PerformanceKPIs;
    revenueDistribution: Array<{ name: string; value: number; color: string }>;
    topProductsChart: Array<{ name: string; revenue: number; units: number }>;
    meta: {
        period: number;
        totalOrdersAnalyzed: number;
        totalListingsAnalyzed: number;
        ordersEnriched: number;
    };
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

function toAmount(value: unknown): number {
    const raw = typeof value === 'number' ? value : parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(raw) ? raw : 0;
}

function readPositiveInt(value: string | undefined | null, fallback: number): number {
    if (!value) return fallback;
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchOrderItemsForOrders(
    orderIds: string[],
    concurrency: number,
    delayMs: number,
): Promise<Map<string, any[]>> {
    const results = new Map<string, any[]>();
    if (orderIds.length === 0) return results;

    let index = 0;
    const workers = Array.from({ length: Math.min(concurrency, orderIds.length) }, async () => {
        while (index < orderIds.length) {
            const currentOrderId = orderIds[index];
            index += 1;
            try {
                const items = await fetchOrderItems(currentOrderId);
                results.set(currentOrderId, items);
            } catch {
                results.set(currentOrderId, []);
            }
            if (delayMs > 0) await sleep(delayMs);
        }
    });

    await Promise.all(workers);
    return results;
}

function emptyKpis(): PerformanceKPIs {
    return {
        totalProductsSold: 0,
        bestSellerName: 'N/A',
        bestSellerRevenue: 0,
        worstPerformerName: 'N/A',
        worstPerformerRevenue: 0,
        revenueConcentrationTop10: 0,
        deadStockCount30d: 0,
        deadStockCount60d: 0,
        deadStockValue: 0,
    };
}

function emptyPayload(days: number): PerformanceApiPayload {
    return {
        topProducts: [],
        deadStock30d: [],
        deadStock60d: [],
        kpis: emptyKpis(),
        revenueDistribution: [],
        topProductsChart: [],
        meta: { period: days, totalOrdersAnalyzed: 0, totalListingsAnalyzed: 0, ordersEnriched: 0 },
    };
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const period = parseInt(searchParams.get('period') || '30', 10);
    const days = Math.min(Math.max(period, 7), 365);
    const forceRefresh = searchParams.get('refresh') === 'true';
    const cacheKey = `performance_v1_${days}d`;

    const enrichLimit = readPositiveInt(process.env.ORDERS_ENRICH_LIMIT, DEFAULT_ENRICH_LIMIT);
    const concurrency = readPositiveInt(process.env.ORDERS_ITEMS_CONCURRENCY, DEFAULT_CONCURRENCY);
    const delayMs = readPositiveInt(process.env.ORDERS_ITEMS_DELAY_MS, DEFAULT_DELAY_MS);

    try {
        if (!forceRefresh) {
            const cached = getCached<PerformanceApiPayload>(cacheKey);
            if (cached) {
                return NextResponse.json({
                    ...cached,
                    lastUpdated: new Date().toISOString(),
                    source: 'cache',
                });
            }
        }

        const status = await checkAmazonConnection();
        if (!status.connected) {
            const stale = getStale<PerformanceApiPayload>(cacheKey);
            if (stale) {
                return NextResponse.json({
                    ...stale,
                    lastUpdated: new Date().toISOString(),
                    source: 'stale-cache',
                });
            }
            return NextResponse.json({
                error: 'Amazon not connected',
                ...emptyPayload(days),
            }, { status: 503 });
        }

        // Step 1: Fetch all data sources in parallel
        const [rawOrders, listings, fbaInventory] = await Promise.all([
            fetchAmazonOrders(days),
            fetchAllListings().catch(() => []),
            fetchAmazonInventory().catch(() => []),
        ]);

        // Step 2: Enrich orders with item details
        const sortedOrders = [...rawOrders].sort((a: any, b: any) =>
            new Date(b.PurchaseDate).getTime() - new Date(a.PurchaseDate).getTime()
        );
        const ordersForEnrichment = sortedOrders.slice(0, enrichLimit);

        const orderItemsMap = await fetchOrderItemsForOrders(
            ordersForEnrichment.map((o: any) => o.AmazonOrderId),
            concurrency,
            delayMs,
        );

        // Step 3: Aggregate product performance by ASIN
        const allAsins = new Set<string>();
        const asinAggregation = new Map<string, {
            asin: string;
            sku: string;
            totalRevenue: number;
            totalUnits: number;
            orderCount: number;
            lastOrderDate: string;
        }>();

        for (const order of ordersForEnrichment) {
            const items = orderItemsMap.get(order.AmazonOrderId) || [];
            for (const item of items) {
                if (!item.ASIN) continue;
                allAsins.add(item.ASIN);

                const existing = asinAggregation.get(item.ASIN) || {
                    asin: item.ASIN,
                    sku: item.SellerSKU || '',
                    totalRevenue: 0,
                    totalUnits: 0,
                    orderCount: 0,
                    lastOrderDate: '',
                };

                const itemPrice = toAmount(item?.ItemPrice?.Amount);
                existing.totalRevenue += itemPrice;
                existing.totalUnits += item.QuantityOrdered || 1;
                existing.orderCount += 1;

                if (!existing.lastOrderDate || order.PurchaseDate > existing.lastOrderDate) {
                    existing.lastOrderDate = order.PurchaseDate;
                }

                asinAggregation.set(item.ASIN, existing);
            }
        }

        // Step 4: Fetch catalog details for all ASINs
        const catalogMap = await fetchCatalogBatch([...allAsins]);

        // Step 5: Build ranked top products list (top 20)
        const rankedProducts: ProductPerformance[] = [...asinAggregation.values()]
            .sort((a, b) => b.totalRevenue - a.totalRevenue)
            .slice(0, 20)
            .map(p => {
                const catalog = catalogMap.get(p.asin) || {};
                return {
                    asin: p.asin,
                    sku: p.sku,
                    title: catalog.title || 'Unknown Product',
                    brand: catalog.brand || null,
                    image: catalog.image || null,
                    totalRevenue: Math.round(p.totalRevenue),
                    totalUnits: p.totalUnits,
                    orderCount: p.orderCount,
                    avgPrice: p.totalUnits > 0 ? Math.round(p.totalRevenue / p.totalUnits) : 0,
                    revenueFormatted: formatINR(p.totalRevenue),
                };
            });

        // Step 6: Build dead stock lists
        const asinsWithOrders = new Set(asinAggregation.keys());
        const asinLastOrderDate = new Map<string, string>();
        for (const [asin, data] of asinAggregation) {
            asinLastOrderDate.set(asin, data.lastOrderDate);
        }

        const fbaMap = new Map<string, any>();
        for (const item of fbaInventory) {
            if (item.sellerSku) fbaMap.set(item.sellerSku, item);
        }

        const now = Date.now();
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
        const sixtyDaysAgo = now - 60 * 24 * 60 * 60 * 1000;

        const deadStock30d: DeadStockProduct[] = [];
        const deadStock60d: DeadStockProduct[] = [];
        const seenSkus = new Set<string>();

        for (const listing of listings) {
            const sku = listing['seller-sku'] || listing['sku'] || listing['Seller SKU'] || '';
            if (!sku || seenSkus.has(sku)) continue;
            seenSkus.add(sku);

            const asin = listing['asin1'] || listing['ASIN'] || listing['asin'] || '';
            const fba = fbaMap.get(sku);
            const catalog = asin ? (catalogMap.get(asin) || {}) : {};

            const stock = fba
                ? (fba.totalQuantity || fba.inventoryDetails?.fulfillableQuantity || 0)
                : parseInt(listing['quantity'] || listing['Quantity Available'] || '0', 10);
            const price = parseFloat(listing['price'] || listing['Price'] || '0') || 0;

            // Only include items that are still in stock (dead stock = in stock but not selling)
            if (stock <= 0) continue;

            const lastOrder = asin ? asinLastOrderDate.get(asin) : undefined;
            const lastOrderTime = lastOrder ? new Date(lastOrder).getTime() : 0;
            const daysSinceLast = lastOrder ? Math.floor((now - lastOrderTime) / (24 * 60 * 60 * 1000)) : null;

            const hasNoRecentOrders30d = !lastOrder || lastOrderTime < thirtyDaysAgo;
            const hasNoRecentOrders60d = !lastOrder || lastOrderTime < sixtyDaysAgo;

            if (!hasNoRecentOrders30d) continue;

            const product: DeadStockProduct = {
                asin,
                sku,
                title: (catalog as any).title || listing['item-name'] || listing['Product Name'] || 'Unknown',
                brand: (catalog as any).brand || null,
                image: (catalog as any).image || null,
                stock,
                price,
                estimatedValue: Math.round(stock * price),
                lastOrderDate: lastOrder || null,
                daysSinceLastOrder: daysSinceLast,
                severity: !lastOrder || (daysSinceLast !== null && daysSinceLast > 45) ? 'critical' : 'warning',
                fulfillmentChannel: fba ? 'FBA' : 'FBM',
            };

            deadStock30d.push(product);
            if (hasNoRecentOrders60d) deadStock60d.push(product);
        }

        // Sort by estimated value descending (most capital tied up first)
        deadStock30d.sort((a, b) => b.estimatedValue - a.estimatedValue);
        deadStock60d.sort((a, b) => b.estimatedValue - a.estimatedValue);

        // Step 7: Compute KPIs
        const totalRevenue = [...asinAggregation.values()].reduce((s, p) => s + p.totalRevenue, 0);
        const top10Revenue = rankedProducts.slice(0, 10).reduce((s, p) => s + p.totalRevenue, 0);

        const kpis: PerformanceKPIs = {
            totalProductsSold: asinAggregation.size,
            bestSellerName: rankedProducts[0]?.title || 'N/A',
            bestSellerRevenue: rankedProducts[0]?.totalRevenue || 0,
            worstPerformerName: rankedProducts.length > 1
                ? rankedProducts[rankedProducts.length - 1].title
                : 'N/A',
            worstPerformerRevenue: rankedProducts.length > 1
                ? rankedProducts[rankedProducts.length - 1].totalRevenue
                : 0,
            revenueConcentrationTop10: totalRevenue > 0
                ? Math.round((top10Revenue / totalRevenue) * 100)
                : 0,
            deadStockCount30d: deadStock30d.length,
            deadStockCount60d: deadStock60d.length,
            deadStockValue: deadStock30d.reduce((s, p) => s + p.estimatedValue, 0),
        };

        // Step 8: Build chart data
        const topProductsChart = rankedProducts.slice(0, 10).map(p => ({
            name: p.title.length > 30 ? p.title.slice(0, 30) + '...' : p.title,
            revenue: p.totalRevenue,
            units: p.totalUnits,
        }));

        const restRevenue = totalRevenue - top10Revenue;
        const revenueDistribution = [
            { name: 'Top 10 Products', value: Math.round(top10Revenue), color: '#6366f1' },
            { name: 'Other Products', value: Math.round(restRevenue), color: '#334155' },
        ];

        // Step 9: Build and cache response
        const payload: PerformanceApiPayload = {
            topProducts: rankedProducts,
            deadStock30d,
            deadStock60d,
            kpis,
            revenueDistribution,
            topProductsChart,
            meta: {
                period: days,
                totalOrdersAnalyzed: sortedOrders.length,
                totalListingsAnalyzed: listings.length,
                ordersEnriched: ordersForEnrichment.length,
            },
        };

        setCache(cacheKey, payload, TTL.PERFORMANCE);

        return NextResponse.json({
            ...payload,
            lastUpdated: new Date().toISOString(),
            source: 'api',
        });
    } catch (e: any) {
        const stale = getStale<PerformanceApiPayload>(cacheKey);
        if (stale) {
            return NextResponse.json({
                ...stale,
                lastUpdated: new Date().toISOString(),
                source: 'stale-cache',
                error: e.message,
            });
        }

        return NextResponse.json({
            error: e.message,
            ...emptyPayload(days),
        }, { status: 500 });
    }
}

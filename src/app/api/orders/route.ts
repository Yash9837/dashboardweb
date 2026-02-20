import { NextResponse } from 'next/server';
import { checkAmazonConnection, fetchAmazonOrders, fetchCatalogBatch, fetchOrderItems } from '@/lib/amazon-client';
import { getCached, getStale, setCache, TTL } from '@/lib/cache';
import { formatINR } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const CACHE_VERSION = 'v2';
const DEFAULT_DAYS = 30;
const DEFAULT_ORDER_ENRICH_LIMIT = process.env.VERCEL ? 75 : 200;
const DEFAULT_ITEMS_CONCURRENCY = process.env.VERCEL ? 4 : 6;
const DEFAULT_ITEMS_DELAY_MS = process.env.VERCEL ? 60 : 120;

interface EnrichedOrder {
    id: string;
    date: string;
    lastUpdate: string;
    status: string;
    displayStatus: string;
    rawStatus: string;
    easyShipStatus: string | null;
    fulfillmentChannel: string;
    channel: string;
    platform: string;
    customer: string;
    city: string;
    state: string;
    postalCode: string;
    items: number;
    itemsShipped: number;
    itemsUnshipped: number;
    total: number;
    amount: string;
    currency: string;
    orderType: string;
    isPrime: boolean;
    isBusinessOrder: boolean;
    paymentMethod: string;
    products: ProductInfo[];
}

interface ProductInfo {
    asin: string;
    sku: string;
    title: string;
    image: string | null;
    brand: string | null;
    quantity: number;
    price: number;
    currency: string;
}

interface OrdersStats {
    total: number;
    delivered: number;
    shipped: number;
    pending: number;
    processing: number;
    cancelled: number;
    revenue: number;
}

interface OrdersMeta {
    totalOrdersFetched: number;
    ordersEnriched: number;
    truncated: boolean;
}

interface OrdersApiPayload {
    orders: EnrichedOrder[];
    stats: OrdersStats;
    meta: OrdersMeta;
}

function readPositiveInt(value: string | undefined | null, fallback: number, min: number, max: number): number {
    if (!value) return fallback;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    if (parsed < min) return fallback;
    return Math.min(parsed, max);
}

function readOptionalPositiveInt(value: string | undefined | null, max: number): number | null {
    if (!value) return null;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1) return null;
    return Math.min(parsed, max);
}

function readNonNegativeInt(value: string | undefined | null, fallback: number, max: number): number {
    if (!value) return fallback;
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return Math.min(parsed, max);
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchOrderItemsForOrders(orderIds: string[], concurrency: number, delayMs: number): Promise<Map<string, any[]>> {
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

            if (delayMs > 0) {
                await sleep(delayMs);
            }
        }
    });

    await Promise.all(workers);
    return results;
}

function emptyStats(): OrdersStats {
    return {
        total: 0,
        delivered: 0,
        shipped: 0,
        pending: 0,
        processing: 0,
        cancelled: 0,
        revenue: 0,
    };
}

function emptyMeta(): OrdersMeta {
    return {
        totalOrdersFetched: 0,
        ordersEnriched: 0,
        truncated: false,
    };
}

function buildCacheKey(days: number, enrichLimit: number): string {
    return `orders_enriched_${CACHE_VERSION}_${days}d_${enrichLimit}`;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const days = readPositiveInt(searchParams.get('days'), DEFAULT_DAYS, 1, 365);
    const forceRefresh = searchParams.get('refresh') === 'true';
    const enrichLimit = readOptionalPositiveInt(searchParams.get('limit'), 500)
        ?? readPositiveInt(process.env.ORDERS_ENRICH_LIMIT, DEFAULT_ORDER_ENRICH_LIMIT, 1, 500);
    const itemConcurrency = readPositiveInt(process.env.ORDERS_ITEMS_CONCURRENCY, DEFAULT_ITEMS_CONCURRENCY, 1, 10);
    const itemDelayMs = readNonNegativeInt(process.env.ORDERS_ITEMS_DELAY_MS, DEFAULT_ITEMS_DELAY_MS, 1000);
    const cacheKey = buildCacheKey(days, enrichLimit);

    try {
        if (!forceRefresh) {
            const cached = getCached<OrdersApiPayload>(cacheKey);
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
            const stale = getStale<OrdersApiPayload>(cacheKey);
            if (stale) {
                return NextResponse.json({
                    ...stale,
                    lastUpdated: new Date().toISOString(),
                    source: 'stale-cache',
                });
            }
            return NextResponse.json({
                error: 'Amazon not connected',
                orders: [],
                stats: emptyStats(),
                meta: emptyMeta(),
            });
        }

        const rawOrders = await fetchAmazonOrders(days);
        const sortedOrders = [...rawOrders].sort((a: any, b: any) => (
            new Date(b.PurchaseDate).getTime() - new Date(a.PurchaseDate).getTime()
        ));
        const ordersForEnrichment = sortedOrders.slice(0, enrichLimit);

        const orderItemsMap = await fetchOrderItemsForOrders(
            ordersForEnrichment.map((order: any) => order.AmazonOrderId),
            itemConcurrency,
            itemDelayMs,
        );

        const allAsins = new Set<string>();
        for (const items of orderItemsMap.values()) {
            for (const item of items) {
                if (item.ASIN) allAsins.add(item.ASIN);
            }
        }
        const catalogMap = await fetchCatalogBatch([...allAsins]);

        const orders: EnrichedOrder[] = ordersForEnrichment.map((order: any) => {
            const total = order.OrderTotal ? parseFloat(order.OrderTotal.Amount) : 0;
            const mappedStatus = mapDisplayStatus(order);
            const orderItems = orderItemsMap.get(order.AmazonOrderId) || [];

            const products: ProductInfo[] = orderItems.map((item: any) => {
                const catalog = catalogMap.get(item.ASIN) || {};
                return {
                    asin: item.ASIN,
                    sku: item.SellerSKU,
                    title: item.Title || catalog.title || 'Unknown Product',
                    image: catalog.image || null,
                    brand: catalog.brand || null,
                    quantity: item.QuantityOrdered || 1,
                    price: item.ItemPrice ? parseFloat(item.ItemPrice.Amount) : 0,
                    currency: item.ItemPrice?.CurrencyCode || 'INR',
                };
            });

            return {
                id: order.AmazonOrderId,
                date: order.PurchaseDate,
                lastUpdate: order.LastUpdateDate,
                status: mappedStatus.toLowerCase(),
                displayStatus: mappedStatus,
                rawStatus: order.OrderStatus,
                easyShipStatus: order.EasyShipShipmentStatus || null,
                fulfillmentChannel: order.FulfillmentChannel,
                channel: order.SalesChannel || order.FulfillmentChannel || '—',
                platform: 'Amazon',
                customer: order.ShippingAddress
                    ? `${order.ShippingAddress.Name || ''}, ${order.ShippingAddress.City || ''}, ${order.ShippingAddress.StateOrRegion || ''}`.replace(/^, /, '')
                    : 'N/A',
                city: order.ShippingAddress?.City || '',
                state: order.ShippingAddress?.StateOrRegion || '',
                postalCode: order.ShippingAddress?.PostalCode || '',
                items: (order.NumberOfItemsShipped || 0) + (order.NumberOfItemsUnshipped || 0),
                itemsShipped: order.NumberOfItemsShipped || 0,
                itemsUnshipped: order.NumberOfItemsUnshipped || 0,
                total,
                amount: total > 0 ? formatINR(total) : '—',
                currency: order.OrderTotal?.CurrencyCode || 'INR',
                orderType: order.OrderType || 'StandardOrder',
                isPrime: order.IsPrime || false,
                isBusinessOrder: order.IsBusinessOrder || false,
                paymentMethod: order.PaymentMethod || 'Other',
                products,
            };
        });

        const payload: OrdersApiPayload = {
            orders,
            stats: computeStatsFromRaw(sortedOrders),
            meta: {
                totalOrdersFetched: sortedOrders.length,
                ordersEnriched: orders.length,
                truncated: sortedOrders.length > orders.length,
            },
        };

        setCache(cacheKey, payload, TTL.ORDERS);

        return NextResponse.json({
            ...payload,
            lastUpdated: new Date().toISOString(),
            source: 'api',
        });
    } catch (e: any) {
        const stale = getStale<OrdersApiPayload>(cacheKey);
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
            orders: [],
            stats: emptyStats(),
            meta: emptyMeta(),
        }, { status: 500 });
    }
}

function computeStatsFromRaw(orders: any[]): OrdersStats {
    const stats = emptyStats();

    for (const order of orders) {
        stats.total += 1;
        if (order.OrderTotal) {
            stats.revenue += parseFloat(order.OrderTotal.Amount);
        }

        const status = mapDisplayStatus(order).toLowerCase();
        if (status === 'delivered') stats.delivered += 1;
        else if (status === 'shipped') stats.shipped += 1;
        else if (status === 'processing') stats.processing += 1;
        else if (status === 'cancelled') stats.cancelled += 1;
        else stats.pending += 1;
    }

    return stats;
}

function mapDisplayStatus(order: any): string {
    if (order.OrderStatus === 'Canceled') return 'Cancelled';
    if (order.EasyShipShipmentStatus === 'Delivered') return 'Delivered';
    if (order.EasyShipShipmentStatus === 'ReturningToSeller' || order.EasyShipShipmentStatus === 'ReturnedToSeller') return 'Returned';
    if (order.OrderStatus === 'Shipped') return 'Shipped';
    if (order.OrderStatus === 'Unshipped') return 'Processing';
    return 'Pending';
}

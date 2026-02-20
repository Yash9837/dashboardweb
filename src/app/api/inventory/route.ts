import { NextResponse } from 'next/server';
import { checkAmazonConnection, fetchAllListings, fetchAmazonInventory, fetchCatalogBatch } from '@/lib/amazon-client';
import { getCached, getStale, setCache, TTL } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type FulfillmentFilter = 'fbm' | 'fba' | 'all';
const CACHE_KEY_PREFIX = 'inventory_all_products_v3';

interface InventoryProduct {
    sku: string;
    name: string;
    asin: string;
    fnSku: string;
    image: string | null;
    brand: string | null;
    platform: string;
    stock: number;
    maxStock: number;
    price: number;
    fulfillable: number;
    inbound: number;
    reserved: number;
    unfulfillable: number;
    fulfillmentChannel: string;
    status: string;
    listingStatus: string;
    lastUpdated: string;
}

interface InventoryStats {
    totalSkus: number;
    totalUnits: number;
    fulfillable: number;
    inbound: number;
    fbaCount: number;
    fbmCount: number;
    inStock: number;
    lowStock: number;
    outOfStock: number;
}

interface InventoryMeta {
    listingsCount: number;
    fbaCount: number;
    fulfillment: FulfillmentFilter;
    partialData: boolean;
}

interface InventoryApiPayload {
    items: InventoryProduct[];
    stats: InventoryStats;
    meta: InventoryMeta;
    warnings: string[];
}

function emptyStats(): InventoryStats {
    return {
        totalSkus: 0,
        totalUnits: 0,
        fulfillable: 0,
        inbound: 0,
        fbaCount: 0,
        fbmCount: 0,
        inStock: 0,
        lowStock: 0,
        outOfStock: 0,
    };
}

function emptyPayload(): InventoryApiPayload {
    return {
        items: [],
        stats: emptyStats(),
        meta: {
            listingsCount: 0,
            fbaCount: 0,
            fulfillment: 'fbm',
            partialData: false,
        },
        warnings: [],
    };
}

function resolveFulfillmentFilter(value: string | null): FulfillmentFilter {
    const raw = String(value || '').toLowerCase();
    if (raw === 'all' || raw === 'fba' || raw === 'fbm') return raw;
    return 'fbm';
}

function normalizeFulfillmentChannel(channel: unknown, hasFbaData = false): 'FBA' | 'FBM' {
    const raw = String(channel || '').toUpperCase().trim();
    if (raw.includes('MERCHANT') || raw.includes('FBM') || raw === 'DEFAULT') return 'FBM';
    if (raw.includes('FBA')) return 'FBA';
    if (raw.includes('AMAZON')) return hasFbaData ? 'FBA' : 'FBM';
    return hasFbaData ? 'FBA' : 'FBM';
}

function matchesFulfillment(channel: 'FBA' | 'FBM', filter: FulfillmentFilter): boolean {
    if (filter === 'all') return true;
    if (filter === 'fba') return channel === 'FBA';
    return channel === 'FBM';
}

function toNumber(v: unknown): number {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    const parsed = Number(String(v ?? '').replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const forceRefresh = searchParams.get('refresh') === 'true';
    const fulfillment = resolveFulfillmentFilter(searchParams.get('fulfillment'));
    const cacheKey = `${CACHE_KEY_PREFIX}_${fulfillment}`;

    try {
        if (!forceRefresh) {
            const cached = getCached<InventoryApiPayload>(cacheKey);
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
            const stale = getStale<InventoryApiPayload>(cacheKey);
            if (stale) {
                return NextResponse.json({
                    ...stale,
                    lastUpdated: new Date().toISOString(),
                    source: 'stale-cache',
                });
            }
            return NextResponse.json({
                error: 'Amazon not connected',
                ...emptyPayload(),
            });
        }

        const warnings: string[] = [];
        const includeFba = fulfillment !== 'fbm';

        let listings: any[] = [];
        try {
            listings = await fetchAllListings();
        } catch (err: any) {
            const message = err?.message || 'Unknown report error';
            warnings.push(`Listings report: ${message}`);
            console.error('[Inventory] Listings report failed:', message);
        }

        let fbaItems: any[] = [];
        if (includeFba) {
            try {
                fbaItems = await fetchAmazonInventory();
            } catch (err: any) {
                const message = err?.message || 'Unknown FBA inventory error';
                warnings.push(`FBA inventory: ${message}`);
                console.error('[Inventory] FBA inventory failed:', message);
            }
        }

        if (listings.length === 0 && (!includeFba || fbaItems.length === 0)) {
            const stale = getStale<InventoryApiPayload>(cacheKey);
            if (stale) {
                return NextResponse.json({
                    ...stale,
                    warnings: [...stale.warnings, ...warnings],
                    lastUpdated: new Date().toISOString(),
                    source: 'stale-cache',
                    error: 'Live inventory sources were unavailable',
                });
            }

            return NextResponse.json({
                error: 'Unable to load inventory from Amazon sources',
                ...emptyPayload(),
                meta: {
                    ...emptyPayload().meta,
                    fulfillment,
                },
                warnings,
            }, { status: 502 });
        }

        const fbaMap = new Map<string, any>();
        for (const item of fbaItems) {
            if (item.sellerSku) {
                fbaMap.set(item.sellerSku, item);
            }
        }

        const asins = [...new Set([
            ...listings.map((listing: any) => listing['asin1'] || listing['ASIN'] || listing['asin']).filter(Boolean),
            ...fbaItems.map((item: any) => item.asin).filter(Boolean),
        ])];

        let catalogMap = new Map<string, any>();
        if (asins.length > 0) {
            try {
                catalogMap = await fetchCatalogBatch(asins);
            } catch (err: any) {
                const message = err?.message || 'Unknown catalog error';
                warnings.push(`Catalog enrichment: ${message}`);
                console.error('[Inventory] Catalog batch failed:', message);
            }
        }

        const seenSkus = new Set<string>();
        const items: InventoryProduct[] = [];

        for (const listing of listings) {
            const sku = listing['seller-sku'] || listing['sku'] || listing['Seller SKU'] || '';
            if (!sku || seenSkus.has(sku)) continue;

            const asin = listing['asin1'] || listing['ASIN'] || listing['asin'] || '';
            const fba = fbaMap.get(sku);
            const normalizedChannel = normalizeFulfillmentChannel(
                listing['fulfillment-channel'] || listing['Fulfillment Channel'],
                Boolean(fba),
            );
            if (!matchesFulfillment(normalizedChannel, fulfillment)) continue;
            seenSkus.add(sku);

            const catalog = catalogMap.get(asin) || {};
            const details = fba?.inventoryDetails || {};
            const reserved = details.reservedQuantity || {};
            const unfulfillable = details.unfulfillableQuantity || {};

            const fulfillable = normalizedChannel === 'FBA' ? num(details.fulfillableQuantity) : 0;
            const inboundWorking = num(details.inboundWorkingQuantity);
            const inboundShipped = num(details.inboundShippedQuantity);
            const inboundReceiving = num(details.inboundReceivingQuantity);
            const totalInbound = normalizedChannel === 'FBA' ? inboundWorking + inboundShipped + inboundReceiving : 0;
            const reservedQty = normalizedChannel === 'FBA' ? num(reserved.totalReservedQuantity ?? reserved) : 0;
            const unfulfillableQty = normalizedChannel === 'FBA' ? num(unfulfillable.totalUnfulfillableQuantity ?? unfulfillable) : 0;
            const stock = normalizedChannel === 'FBA'
                ? (fba ? num(fba.totalQuantity) : 0)
                : toNumber(listing['quantity'] || listing['Quantity Available'] || 0);
            const price = toNumber(listing['price'] || listing['Price'] || 0);
            const availableQty = normalizedChannel === 'FBA' ? (fulfillable || stock) : stock;
            const listingStatus = listing['status'] || listing['Status'] || 'Active';

            items.push({
                sku,
                name: catalog.title || listing['item-name'] || listing['Product Name'] || listing['item-description'] || 'Unknown Product',
                asin,
                fnSku: fba?.fnSku || '',
                image: catalog.image || null,
                brand: catalog.brand || null,
                platform: 'Amazon',
                stock,
                maxStock: Math.max(stock, 50),
                price,
                fulfillable,
                inbound: totalInbound,
                reserved: reservedQty,
                unfulfillable: unfulfillableQty,
                fulfillmentChannel: normalizedChannel,
                status: availableQty === 0 ? 'out-of-stock'
                    : availableQty < 10 ? 'low-stock'
                        : 'in-stock',
                listingStatus,
                lastUpdated: fba?.lastUpdatedTime || new Date().toISOString(),
            });
        }

        for (const fba of fbaItems) {
            if (!fba.sellerSku || seenSkus.has(fba.sellerSku)) continue;
            if (!matchesFulfillment('FBA', fulfillment)) continue;
            seenSkus.add(fba.sellerSku);

            const catalog = catalogMap.get(fba.asin) || {};
            const details = fba.inventoryDetails || {};
            const reserved = details.reservedQuantity || {};
            const unfulfillable = details.unfulfillableQuantity || {};
            const fulfillable = num(details.fulfillableQuantity);
            const stock = num(fba.totalQuantity);

            items.push({
                sku: fba.sellerSku,
                name: catalog.title || fba.productName || 'Unknown Product',
                asin: fba.asin || '',
                fnSku: fba.fnSku || '',
                image: catalog.image || null,
                brand: catalog.brand || null,
                platform: 'Amazon',
                stock,
                maxStock: Math.max(stock, 50),
                price: 0,
                fulfillable,
                inbound: num(details.inboundWorkingQuantity) + num(details.inboundShippedQuantity) + num(details.inboundReceivingQuantity),
                reserved: num(reserved.totalReservedQuantity ?? reserved),
                unfulfillable: num(unfulfillable.totalUnfulfillableQuantity ?? unfulfillable),
                fulfillmentChannel: 'FBA',
                status: (fulfillable || stock) === 0 ? 'out-of-stock' : (fulfillable || stock) < 10 ? 'low-stock' : 'in-stock',
                listingStatus: 'Active',
                lastUpdated: fba.lastUpdatedTime || new Date().toISOString(),
            });
        }

        const payload: InventoryApiPayload = {
            items,
            stats: computeStats(items),
            meta: {
                listingsCount: listings.length,
                fbaCount: fbaItems.length,
                fulfillment,
                partialData: warnings.length > 0,
            },
            warnings,
        };

        setCache(cacheKey, payload, TTL.INVENTORY);

        return NextResponse.json({
            ...payload,
            lastUpdated: new Date().toISOString(),
            source: 'api',
        });
    } catch (e: any) {
        const stale = getStale<InventoryApiPayload>(cacheKey);
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
            ...emptyPayload(),
        }, { status: 500 });
    }
}

function num(v: any): number {
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && v !== null) {
        return Number(v.totalReservedQuantity ?? v.totalUnfulfillableQuantity ?? 0);
    }
    return Number(v) || 0;
}

function computeStats(items: InventoryProduct[]): InventoryStats {
    return {
        totalSkus: items.length,
        totalUnits: items.reduce((sum, item) => sum + item.stock, 0),
        fulfillable: items.reduce((sum, item) => sum + item.fulfillable, 0),
        inbound: items.reduce((sum, item) => sum + item.inbound, 0),
        fbaCount: items.filter(item => item.fulfillmentChannel === 'FBA').length,
        fbmCount: items.filter(item => item.fulfillmentChannel === 'FBM').length,
        inStock: items.filter(item => item.status === 'in-stock').length,
        lowStock: items.filter(item => item.status === 'low-stock').length,
        outOfStock: items.filter(item => item.status === 'out-of-stock').length,
    };
}

/**
 * Server-side Amazon SP-API client for Next.js API routes.
 * Uses token-based auth with auto-refresh — no AWS signing needed.
 */

import { gunzipSync } from 'zlib';
import { getCached, setCache, getStale, TTL } from './cache';

let accessToken: string | null = null;
let tokenExpiry = 0;

const DEFAULT_CATALOG_BATCH_CONCURRENCY = process.env.VERCEL ? 4 : 2;
const DEFAULT_CATALOG_BATCH_DELAY_MS = process.env.VERCEL ? 100 : 200;
const DEFAULT_CATALOG_BATCH_MAX_ASINS = process.env.VERCEL ? 150 : Number.MAX_SAFE_INTEGER;
const DEFAULT_REPORT_MAX_WAIT_MS = process.env.VERCEL ? 35000 : 300000;
const DEFAULT_REPORT_POLL_INTERVAL_MS = process.env.VERCEL ? 4000 : 10000;
const DEFAULT_REPORT_DOWNLOAD_TIMEOUT_MS = process.env.VERCEL ? 20000 : 60000;

function readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getConfig() {
    const clientId = process.env.LWA_CLIENT_ID;
    const clientSecret = process.env.LWA_CLIENT_SECRET;
    const refreshToken = process.env.LWA_REFRESH_TOKEN;
    const endpoint = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com';
    const marketplaceId = process.env.MARKETPLACE_ID || 'A21TJRUUN4KGV';

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Amazon SP-API credentials in environment variables');
    }

    return { clientId, clientSecret, refreshToken, endpoint, marketplaceId };
}

async function getAccessToken(): Promise<string> {
    if (accessToken && Date.now() < tokenExpiry - 60000) {
        return accessToken;
    }

    const config = getConfig();
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: config.refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
    });

    const response = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`LWA token exchange failed: ${response.status} ${err}`);
    }

    const data = await response.json();
    accessToken = data.access_token;
    tokenExpiry = Date.now() + data.expires_in * 1000;

    return accessToken!;
}

export async function spApiGet<T = any>(path: string, params: Record<string, string> = {}): Promise<T> {
    const config = getConfig();
    const token = await getAccessToken();

    const url = new URL(`${config.endpoint}${path}`);
    for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
    }

    const response = await fetch(url.toString(), {
        headers: {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
        },
        cache: 'no-store',
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`SP-API ${path} failed: ${response.status} ${err}`);
    }

    return response.json();
}

export interface FetchAmazonOrdersOptions {
    daysBack?: number;
    createdAfter?: string;
    createdBefore?: string;
    maxResultsPerPage?: number;
}

/**
 * Fetch orders from Amazon SP-API
 */
export async function fetchAmazonOrders(options: number | FetchAmazonOrdersOptions = 30): Promise<any> {
    const config = getConfig();
    const resolved = typeof options === 'number' ? { daysBack: options } : options;
    const daysBack = resolved.daysBack ?? 30;
    const createdAfter = resolved.createdAfter || new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();

    const params: Record<string, string> = {
        MarketplaceIds: config.marketplaceId,
        CreatedAfter: createdAfter,
        MaxResultsPerPage: String(Math.min(resolved.maxResultsPerPage || 100, 100)),
    };

    if (resolved.createdBefore) {
        params.CreatedBefore = resolved.createdBefore;
    }

    const data = await spApiGet('/orders/v0/orders', params);

    return data.payload?.Orders || [];
}

/**
 * Fetch order items for a specific order
 */
export async function fetchOrderItems(orderId: string): Promise<any[]> {
    const data = await spApiGet(`/orders/v0/orders/${orderId}/orderItems`);
    return data.payload?.OrderItems || [];
}

/**
 * Fetch catalog item details (title, brand, image) by ASIN
 * Uses persistent file cache — results survive server restarts.
 */
type CatalogInfo = { title?: string; brand?: string; image?: string };

export async function fetchCatalogItem(asin: string): Promise<CatalogInfo> {
    // Check persistent cache first
    const cacheKey = `catalog_${asin}`;
    const cached = getCached<CatalogInfo>(cacheKey);
    if (cached && cached.title) return cached;

    // Try fresh API call
    try {
        const config = getConfig();
        const data = await spApiGet(`/catalog/2022-04-01/items/${asin}`, {
            marketplaceIds: config.marketplaceId,
            includedData: 'summaries,images',
        });

        const summary = data?.summaries?.find((s: any) => s.marketplaceId === config.marketplaceId);
        const images = data?.images?.find((i: any) => i.marketplaceId === config.marketplaceId)?.images;

        const result: CatalogInfo = {
            title: summary?.itemName,
            brand: summary?.brandName,
            image: images?.[0]?.link,
        };

        // Persist to file cache for 7 days
        setCache(cacheKey, result, TTL.CATALOG);
        return result;
    } catch {
        // If API fails, try to return stale cached data
        const stale = getStale<CatalogInfo>(cacheKey);
        if (stale && stale.title) return stale;

        return { title: undefined, brand: undefined, image: undefined };
    }
}

/**
 * Fetch catalog details for multiple ASINs with bounded concurrency.
 * Uses cache to avoid redundant API calls.
 */
export interface FetchCatalogBatchOptions {
    concurrency?: number;
    delayMs?: number;
    maxAsins?: number;
}

export async function fetchCatalogBatch(asins: string[], options: FetchCatalogBatchOptions = {}): Promise<Map<string, CatalogInfo>> {
    const results = new Map<string, CatalogInfo>();

    const uniqueAsins = [...new Set(asins.filter(Boolean))];
    const maxAsins = Math.max(
        1,
        options.maxAsins ?? readPositiveIntEnv('CATALOG_BATCH_MAX_ASINS', DEFAULT_CATALOG_BATCH_MAX_ASINS),
    );
    const targets = uniqueAsins.slice(0, maxAsins);
    if (targets.length === 0) return results;

    const concurrency = Math.max(
        1,
        Math.min(
            options.concurrency ?? readPositiveIntEnv('CATALOG_BATCH_CONCURRENCY', DEFAULT_CATALOG_BATCH_CONCURRENCY),
            targets.length,
        ),
    );
    const delayMs = Math.max(0, options.delayMs ?? readPositiveIntEnv('CATALOG_BATCH_DELAY_MS', DEFAULT_CATALOG_BATCH_DELAY_MS));

    let index = 0;
    const workers = Array.from({ length: concurrency }, async () => {
        while (index < targets.length) {
            const current = targets[index];
            index += 1;

            const info = await fetchCatalogItem(current);
            results.set(current, info);

            if (delayMs > 0) {
                await sleep(delayMs);
            }
        }
    });

    await Promise.all(workers);

    for (const asin of uniqueAsins) {
        if (!results.has(asin)) {
            results.set(asin, { title: undefined, brand: undefined, image: undefined });
        }
    }

    return results;
}

/**
 * Fetch ALL FBA inventory (auto-paginate through all pages)
 */
export async function fetchAmazonInventory(): Promise<any[]> {
    const config = getConfig();
    const allItems: any[] = [];
    let nextToken: string | undefined;

    do {
        const params: Record<string, string> = {
            marketplaceIds: config.marketplaceId,
            granularityType: 'Marketplace',
            granularityId: config.marketplaceId,
            details: 'true',
        };
        if (nextToken) params.nextToken = nextToken;

        const data = await spApiGet('/fba/inventory/v1/summaries', params);
        const items = data.payload?.inventorySummaries || [];
        allItems.push(...items);
        nextToken = data.pagination?.nextToken;

        if (nextToken) {
            // Small delay between pages to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
        }
    } while (nextToken);

    return allItems;
}

/**
 * Platform connection status
 */
export interface PlatformStatus {
    platform: string;
    connected: boolean;
    lastSync?: string;
    error?: string;
}

export async function checkAmazonConnection(): Promise<PlatformStatus> {
    try {
        await getAccessToken();
        return {
            platform: 'Amazon',
            connected: true,
            lastSync: new Date().toISOString(),
        };
    } catch (e: any) {
        return {
            platform: 'Amazon',
            connected: false,
            error: e.message,
        };
    }
}

export function getShopifyStatus(): PlatformStatus {
    return { platform: 'Shopify', connected: false, error: 'API not connected' };
}

export function getWalmartStatus(): PlatformStatus {
    return { platform: 'Walmart', connected: false, error: 'API not connected' };
}

// ─── Reports API ────────────────────────────────────────────────────────────

/**
 * POST to SP-API (used for creating reports)
 */
async function spApiPost<T = any>(path: string, body: any): Promise<T> {
    const config = getConfig();
    const token = await getAccessToken();

    const response = await fetch(`${config.endpoint}${path}`, {
        method: 'POST',
        headers: {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`SP-API POST ${path} failed: ${response.status} ${err}`);
    }

    return response.json();
}

/**
 * Fetch ALL product listings via the Reports API.
 * This returns ALL products (FBA + FBM + inactive) — not just FBA inventory.
 * Uses a 24-hour file cache since product catalog changes infrequently.
 */
export interface FetchAllListingsOptions {
    maxWaitMs?: number;
    pollIntervalMs?: number;
}

export async function fetchAllListings(options: FetchAllListingsOptions = {}): Promise<any[]> {
    const cacheKey = 'all_listings_report_v2';
    const cached = getCached<any[]>(cacheKey);
    if (cached) return cached;

    const config = getConfig();

    // 1. Create report request
    const createRes = await spApiPost('/reports/2021-06-30/reports', {
        reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        marketplaceIds: [config.marketplaceId],
    });
    const reportId = createRes.reportId;

    // 2. Poll until done. Defaults are shorter on Vercel to avoid function timeout.
    const maxWait = options.maxWaitMs ?? readPositiveIntEnv('SP_REPORT_MAX_WAIT_MS', DEFAULT_REPORT_MAX_WAIT_MS);
    const pollInterval = options.pollIntervalMs ?? readPositiveIntEnv('SP_REPORT_POLL_INTERVAL_MS', DEFAULT_REPORT_POLL_INTERVAL_MS);
    const startTime = Date.now();
    let reportDocumentId: string | null = null;

    while (Date.now() - startTime < maxWait) {
        const report = await spApiGet<any>(`/reports/2021-06-30/reports/${reportId}`);

        if (report.processingStatus === 'DONE' && report.reportDocumentId) {
            reportDocumentId = report.reportDocumentId;
            break;
        }
        if (report.processingStatus === 'CANCELLED' || report.processingStatus === 'FATAL') {
            throw new Error(`Report failed: ${report.processingStatus}`);
        }

        await sleep(pollInterval);
    }

    if (!reportDocumentId) {
        throw new Error(`Report timed out after ${Math.round(maxWait / 1000)}s`);
    }

    // 3. Get download URL
    const docInfo = await spApiGet<any>(`/reports/2021-06-30/documents/${reportDocumentId}`);
    const downloadUrl = docInfo.url;

    // 4. Download and parse TSV
    const downloadTimeoutMs = readPositiveIntEnv('SP_REPORT_DOWNLOAD_TIMEOUT_MS', DEFAULT_REPORT_DOWNLOAD_TIMEOUT_MS);
    const downloadRes = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(downloadTimeoutMs),
    });
    if (!downloadRes.ok) {
        throw new Error(`Report download failed: ${downloadRes.status}`);
    }
    const compressed = String(docInfo?.compressionAlgorithm || '').toUpperCase() === 'GZIP';
    const rawBuffer = Buffer.from(await downloadRes.arrayBuffer());
    const hasGzipMagic = rawBuffer.length >= 2 && rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b;

    let tsvText: string;
    if (compressed || hasGzipMagic) {
        tsvText = gunzipSync(rawBuffer).toString('utf-8');
    } else {
        tsvText = rawBuffer.toString('utf-8');
    }
    const listings = parseTsv(tsvText);

    // 5. Cache for 24 hours
    setCache(cacheKey, listings, 24 * 60 * 60 * 1000);

    return listings;
}

/**
 * Parse TSV report data into array of objects
 */
function parseTsv(tsv: string): any[] {
    const lines = tsv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0]
        .split('\t')
        .map(h => h.replace(/^\uFEFF/, '').trim());

    const normalized = headers.map(h => h.toLowerCase());
    const looksLikeListings = normalized.some(h => h.includes('seller-sku') || h === 'sku')
        && normalized.some(h => h.includes('asin'));
    if (!looksLikeListings) {
        throw new Error('Listings report format is invalid or unreadable');
    }

    const rows: any[] = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split('\t');
        const row: any = {};
        headers.forEach((header, idx) => {
            row[header] = values[idx]?.trim() || '';
        });
        rows.push(row);
    }

    return rows;
}

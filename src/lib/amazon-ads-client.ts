/**
 * Amazon Ads API Client
 *
 * Server-side helper for:
 *  - OAuth token refresh
 *  - Sponsored Products v3 campaign listing
 *  - Sponsored Products v3 Reporting (request → poll → download)
 *
 * Env vars required:
 *   ADS_CLIENT_ID, ADS_CLIENT_SECRET, ADS_REFRESH_TOKEN, ADS_REGION, ADS_PROFILE_ID
 */

import { gunzipSync } from 'node:zlib';

// ─── Config ──────────────────────────────────────────────────────────────────

const ADS_CLIENT_ID = process.env.ADS_CLIENT_ID || '';
const ADS_CLIENT_SECRET = process.env.ADS_CLIENT_SECRET || '';
const ADS_REFRESH_TOKEN = process.env.ADS_REFRESH_TOKEN || '';
const ADS_REGION = (process.env.ADS_REGION || 'eu').toLowerCase();
const ADS_PROFILE_ID = process.env.ADS_PROFILE_ID || '3418921143532297';

const TOKEN_URLS: Record<string, string> = {
    na: 'https://api.amazon.com/auth/o2/token',
    eu: 'https://api.amazon.co.uk/auth/o2/token',
    fe: 'https://api.amazon.co.jp/auth/o2/token',
};

const ADS_API_URLS: Record<string, string> = {
    na: 'https://advertising-api.amazon.com',
    eu: 'https://advertising-api-eu.amazon.com',
    fe: 'https://advertising-api-fe.amazon.com',
};

const tokenUrl = TOKEN_URLS[ADS_REGION] || TOKEN_URLS.eu;
const adsApiUrl = ADS_API_URLS[ADS_REGION] || ADS_API_URLS.eu;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AdsCampaign {
    campaignId: string;
    name: string;
    state: string;
    targetingType: string;
    budget?: { budget: number; budgetType: string };
}

export interface AdsMetricsRow {
    date?: string;
    campaignId?: string;
    campaignName?: string;
    adGroupId?: string;
    adGroupName?: string;
    impressions: number;
    clicks: number;
    cost: number;       // spend in currency
    sales14d: number;   // attributed sales (14-day)
    purchases14d: number;
    advertisedSku?: string;
    advertisedAsin?: string;
}

export interface AdsSummary {
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    acos: number;
    roas: number;
    ctr: number;
    cpc: number;
    orders: number;
}

// ─── Token Cache ─────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAdsAccessToken(): Promise<string> {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.token;
    }

    if (!ADS_CLIENT_ID || !ADS_CLIENT_SECRET || !ADS_REFRESH_TOKEN) {
        throw new Error('Missing ADS_CLIENT_ID, ADS_CLIENT_SECRET, or ADS_REFRESH_TOKEN in env');
    }

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: ADS_REFRESH_TOKEN,
            client_id: ADS_CLIENT_ID,
            client_secret: ADS_CLIENT_SECRET,
        }),
    });

    const data = await res.json();
    if (!data.access_token) {
        throw new Error(`Ads token refresh failed: ${JSON.stringify(data)}`);
    }

    cachedToken = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000, // refresh 60s early
    };

    return cachedToken.token;
}

// ─── Headers ─────────────────────────────────────────────────────────────────

function adsHeaders(token: string, extraHeaders?: Record<string, string>): Record<string, string> {
    return {
        'Authorization': `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId': ADS_CLIENT_ID,
        'Amazon-Advertising-API-Scope': ADS_PROFILE_ID,
        'Content-Type': 'application/json',
        ...extraHeaders,
    };
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<AdsCampaign[]> {
    const token = await getAdsAccessToken();

    const res = await fetch(`${adsApiUrl}/sp/campaigns/list`, {
        method: 'POST',
        headers: {
            ...adsHeaders(token),
            'Accept': 'application/vnd.spCampaign.v3+json',
            'Content-Type': 'application/vnd.spCampaign.v3+json',
        },
        body: JSON.stringify({}),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`listCampaigns failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    return (data.campaigns || []) as AdsCampaign[];
}

// ─── Reporting v3 ────────────────────────────────────────────────────────────

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Request a Sponsored Products report, poll until completed, download & parse.
 *
 * @param startDate  YYYY-MM-DD
 * @param endDate    YYYY-MM-DD
 * @param reportType 'campaigns' | 'products'
 */
export async function fetchSPReport(
    startDate: string,
    endDate: string,
    reportType: 'campaigns' | 'products' = 'campaigns',
): Promise<AdsMetricsRow[]> {
    const token = await getAdsAccessToken();

    // ── 1. Create report request ──
    // spCampaigns: groupBy=['campaign'], columns include campaignId/Name
    // spAdvertisedProduct: groupBy=['advertiser'], columns include advertisedSku/Asin
    const isProducts = reportType === 'products';

    const columns = [
        'date', 'impressions', 'clicks', 'cost',
        'purchases14d', 'sales14d',
    ];

    if (isProducts) {
        columns.push('campaignName', 'advertisedSku', 'advertisedAsin');
    } else {
        columns.push('campaignId', 'campaignName');
    }

    const reportConfig = {
        name: `SP ${reportType} report ${startDate} to ${endDate}`,
        startDate,
        endDate,
        configuration: {
            adProduct: 'SPONSORED_PRODUCTS',
            groupBy: [isProducts ? 'advertiser' : 'campaign'],
            columns,
            reportTypeId: isProducts ? 'spAdvertisedProduct' : 'spCampaigns',
            timeUnit: 'DAILY',
            format: 'GZIP_JSON',
        },
    };

    console.log(`[Ads] Creating ${reportType} report: ${startDate} → ${endDate}`);

    const createRes = await fetch(`${adsApiUrl}/reporting/reports`, {
        method: 'POST',
        headers: adsHeaders(token),
        body: JSON.stringify(reportConfig),
    });

    if (!createRes.ok) {
        const text = await createRes.text();
        throw new Error(`Create report failed (${createRes.status}): ${text}`);
    }

    const { reportId } = await createRes.json();
    if (!reportId) throw new Error('No reportId returned');

    console.log(`[Ads] Report created: ${reportId}`);

    // ── 2. Poll until COMPLETED ──
    let status = 'PENDING';
    let downloadUrl = '';
    const maxAttempts = 30;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(2000);

        const pollRes = await fetch(`${adsApiUrl}/reporting/reports/${reportId}`, {
            headers: adsHeaders(token),
        });

        if (!pollRes.ok) {
            console.warn(`[Ads] Poll attempt ${attempt + 1} failed: ${pollRes.status}`);
            continue;
        }

        const pollData = await pollRes.json();
        status = pollData.status;
        console.log(`[Ads] Report status: ${status} (attempt ${attempt + 1}/${maxAttempts})`);

        if (status === 'COMPLETED') {
            downloadUrl = pollData.url;
            break;
        }

        if (status === 'FAILED') {
            throw new Error(`Report failed: ${JSON.stringify(pollData)}`);
        }
    }

    if (status !== 'COMPLETED' || !downloadUrl) {
        throw new Error(`Report timed out after ${maxAttempts} attempts (status: ${status})`);
    }

    // ── 3. Download & decompress ──
    console.log(`[Ads] Downloading report...`);
    const dlRes = await fetch(downloadUrl);
    if (!dlRes.ok) throw new Error(`Download failed: ${dlRes.status}`);

    const buffer = Buffer.from(await dlRes.arrayBuffer());

    let rows: AdsMetricsRow[];
    try {
        // Try gzip first
        const decompressed = gunzipSync(buffer);
        rows = JSON.parse(decompressed.toString('utf-8'));
    } catch {
        // Might be plain JSON
        rows = JSON.parse(buffer.toString('utf-8'));
    }

    console.log(`[Ads] Report downloaded: ${rows.length} rows`);
    return rows;
}

// ─── Aggregate helper ────────────────────────────────────────────────────────

export function aggregateMetrics(rows: AdsMetricsRow[]): AdsSummary {
    let impressions = 0, clicks = 0, spend = 0, sales = 0, orders = 0;

    for (const r of rows) {
        impressions += r.impressions || 0;
        clicks += r.clicks || 0;
        spend += r.cost || 0;
        sales += r.sales14d || 0;
        orders += r.purchases14d || 0;
    }

    return {
        impressions,
        clicks,
        spend: Math.round(spend * 100) / 100,
        sales: Math.round(sales * 100) / 100,
        acos: sales > 0 ? Math.round((spend / sales) * 10000) / 100 : 0,
        roas: spend > 0 ? Math.round((sales / spend) * 100) / 100 : 0,
        ctr: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
        cpc: clicks > 0 ? Math.round((spend / clicks) * 100) / 100 : 0,
        orders,
    };
}

/**
 * Group daily rows by date → daily summary for charting
 */
export function groupByDate(rows: AdsMetricsRow[]): Array<{ date: string } & AdsSummary> {
    const map = new Map<string, AdsMetricsRow[]>();
    for (const r of rows) {
        const d = r.date || 'unknown';
        if (!map.has(d)) map.set(d, []);
        map.get(d)!.push(r);
    }
    return [...map.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, dayRows]) => ({ date, ...aggregateMetrics(dayRows) }));
}

/**
 * Group by advertised SKU for the per-SKU table
 */
export function groupBySku(rows: AdsMetricsRow[]): Array<{ sku: string; asin: string } & AdsSummary> {
    const map = new Map<string, AdsMetricsRow[]>();
    const asinMap = new Map<string, string>();
    for (const r of rows) {
        const sku = r.advertisedSku || r.advertisedAsin || 'UNKNOWN';
        if (!map.has(sku)) map.set(sku, []);
        map.get(sku)!.push(r);
        if (r.advertisedAsin) asinMap.set(sku, r.advertisedAsin);
    }
    return [...map.entries()]
        .map(([sku, skuRows]) => ({
            sku,
            asin: asinMap.get(sku) || '',
            ...aggregateMetrics(skuRows),
        }))
        .sort((a, b) => b.spend - a.spend);
}

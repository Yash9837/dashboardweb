#!/usr/bin/env node
/**
 * Ads Data Sync Script
 *
 * Fetches Sponsored Products reports from Amazon Ads API v3
 * and stores them in Supabase (ads_campaign_daily + ads_product_daily).
 *
 * Handles:
 *  - Date range: 2025-03-01 → today, in 31-day chunks
 *  - Resume: skips chunks already in ads_sync_log
 *  - Rate limiting: 5s delay between report requests
 *  - Upsert: ON CONFLICT (date, campaign_id) / (date, advertised_sku, campaign_name)
 *
 * Usage:
 *   node scripts/sync-ads.mjs
 *   node scripts/sync-ads.mjs --from 2025-06-01 --to 2025-08-31
 *   node scripts/sync-ads.mjs --force  (re-sync even if already done)
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

// ─── Config ──────────────────────────────────────────────────────────────────

const ADS_CLIENT_ID = process.env.ADS_CLIENT_ID;
const ADS_CLIENT_SECRET = process.env.ADS_CLIENT_SECRET;
const ADS_REFRESH_TOKEN = process.env.ADS_REFRESH_TOKEN;
const ADS_REGION = (process.env.ADS_REGION || 'eu').toLowerCase();
const ADS_PROFILE_ID = process.env.ADS_PROFILE_ID || '3418921143532297';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const TOKEN_URLS = { na: 'https://api.amazon.com/auth/o2/token', eu: 'https://api.amazon.co.uk/auth/o2/token', fe: 'https://api.amazon.co.jp/auth/o2/token' };
const ADS_API_URLS = { na: 'https://advertising-api.amazon.com', eu: 'https://advertising-api-eu.amazon.com', fe: 'https://advertising-api-fe.amazon.com' };

const tokenUrl = TOKEN_URLS[ADS_REGION] || TOKEN_URLS.eu;
const adsApiUrl = ADS_API_URLS[ADS_REGION] || ADS_API_URLS.eu;

const CHUNK_DAYS = 14;
const DELAY_BETWEEN_REPORTS_MS = 10000;
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_ATTEMPTS = 120;

// ─── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const fromIdx = args.indexOf('--from');
const toIdx = args.indexOf('--to');
const force = args.includes('--force');

const DEFAULT_START = '2025-03-01';
const startDateStr = fromIdx >= 0 ? args[fromIdx + 1] : DEFAULT_START;
const endDateStr = toIdx >= 0 ? args[toIdx + 1] : new Date().toISOString().slice(0, 10);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function supa(path, opts = {}) {
    return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
        ...opts,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: opts.prefer || '',
            ...(opts.headers || {}),
        },
    });
}

// ─── Token ───────────────────────────────────────────────────────────────────

let cachedToken = null;

async function getToken() {
    if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;

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
    const d = await res.json();
    if (!d.access_token) throw new Error('Token failed: ' + JSON.stringify(d));
    cachedToken = { token: d.access_token, expiresAt: Date.now() + (d.expires_in - 60) * 1000 };
    return cachedToken.token;
}

function adsHeaders(token) {
    return {
        Authorization: `Bearer ${token}`,
        'Amazon-Advertising-API-ClientId': ADS_CLIENT_ID,
        'Amazon-Advertising-API-Scope': ADS_PROFILE_ID,
        'Content-Type': 'application/json',
    };
}

// ─── Report fetch ────────────────────────────────────────────────────────────

async function fetchReport(startDate, endDate, reportType) {
    const token = await getToken();
    const isProducts = reportType === 'products';

    const columns = ['date', 'impressions', 'clicks', 'cost', 'purchases14d', 'sales14d'];
    if (isProducts) {
        columns.push('campaignName', 'advertisedSku', 'advertisedAsin');
    } else {
        columns.push('campaignId', 'campaignName');
    }

    const body = {
        name: `sync-${reportType}-${startDate}-${endDate}`,
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

    // Create
    const createRes = await fetch(`${adsApiUrl}/reporting/reports`, {
        method: 'POST', headers: adsHeaders(token), body: JSON.stringify(body),
    });
    if (!createRes.ok) {
        const t = await createRes.text();
        throw new Error(`Create ${reportType} report failed (${createRes.status}): ${t}`);
    }
    const { reportId } = await createRes.json();

    // Poll
    let downloadUrl = '';
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
        await sleep(POLL_INTERVAL_MS);
        const pollRes = await fetch(`${adsApiUrl}/reporting/reports/${reportId}`, { headers: adsHeaders(token) });
        if (!pollRes.ok) continue;
        const pollData = await pollRes.json();
        if (pollData.status === 'COMPLETED') { downloadUrl = pollData.url; break; }
        if (pollData.status === 'FAILED') throw new Error('Report FAILED: ' + JSON.stringify(pollData));
        process.stdout.write('.');
    }
    if (!downloadUrl) throw new Error('Report timed out');

    // Download
    const dlRes = await fetch(downloadUrl);
    const buf = Buffer.from(await dlRes.arrayBuffer());
    let rows;
    try {
        const { gunzipSync } = await import('node:zlib');
        rows = JSON.parse(gunzipSync(buf).toString('utf-8'));
    } catch {
        rows = JSON.parse(buf.toString('utf-8'));
    }

    return rows;
}

// ─── Check if chunk already synced ───────────────────────────────────────────

async function isChunkSynced(reportType, startDate, endDate) {
    const r = await supa(
        `ads_sync_log?report_type=eq.${reportType}&start_date=eq.${startDate}&end_date=eq.${endDate}&status=eq.completed&select=id&limit=1`
    );
    const d = await r.json();
    return Array.isArray(d) && d.length > 0;
}

async function logSync(reportType, startDate, endDate, rowsSynced, status, errorMessage) {
    await supa('ads_sync_log', {
        method: 'POST',
        prefer: 'return=minimal',
        body: JSON.stringify({
            report_type: reportType,
            start_date: startDate,
            end_date: endDate,
            rows_synced: rowsSynced,
            status,
            error_message: errorMessage || null,
        }),
    });
}

// ─── Upsert to DB ───────────────────────────────────────────────────────────

async function upsertCampaignRows(rows) {
    const mapped = rows.map(r => ({
        date: r.date,
        campaign_id: r.campaignId || 'unknown',
        campaign_name: r.campaignName || '',
        impressions: r.impressions || 0,
        clicks: r.clicks || 0,
        cost: r.cost || 0,
        sales14d: r.sales14d || 0,
        purchases14d: r.purchases14d || 0,
        updated_at: new Date().toISOString(),
    }));

    // Batch upsert in groups of 500
    for (let i = 0; i < mapped.length; i += 500) {
        const batch = mapped.slice(i, i + 500);
        const r = await supa('ads_campaign_daily?on_conflict=date,campaign_id', {
            method: 'POST',
            prefer: 'return=minimal,resolution=merge-duplicates',
            body: JSON.stringify(batch),
        });
        if (r.status >= 400) {
            const t = await r.text();
            throw new Error(`Upsert campaign batch failed: ${r.status} ${t}`);
        }
    }

    return mapped.length;
}

async function upsertProductRows(rows) {
    // Pre-aggregate by (date, sku) — unique constraint is on these two columns
    const aggMap = new Map();
    for (const r of rows) {
        const sku = r.advertisedSku || r.advertisedAsin || 'UNKNOWN';
        const key = `${r.date}|${sku}`;
        if (!aggMap.has(key)) {
            aggMap.set(key, {
                date: r.date,
                campaign_name: r.campaignName || '',
                advertised_sku: sku,
                advertised_asin: r.advertisedAsin || '',
                impressions: 0, clicks: 0, cost: 0, sales14d: 0, purchases14d: 0,
            });
        }
        const a = aggMap.get(key);
        a.impressions += r.impressions || 0;
        a.clicks += r.clicks || 0;
        a.cost += r.cost || 0;
        a.sales14d += r.sales14d || 0;
        a.purchases14d += r.purchases14d || 0;
    }

    const mapped = [...aggMap.values()].map(a => ({
        ...a,
        cost: Math.round(a.cost * 100) / 100,
        sales14d: Math.round(a.sales14d * 100) / 100,
        updated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < mapped.length; i += 500) {
        const batch = mapped.slice(i, i + 500);
        const r = await supa('ads_product_daily?on_conflict=date,advertised_sku', {
            method: 'POST',
            prefer: 'return=minimal,resolution=merge-duplicates',
            body: JSON.stringify(batch),
        });
        if (r.status >= 400) {
            const t = await r.text();
            throw new Error(`Upsert product batch failed: ${r.status} ${t}`);
        }
    }

    return mapped.length;
}

// ─── Generate date chunks ────────────────────────────────────────────────────

function generateChunks(startStr, endStr) {
    const chunks = [];
    let cursor = new Date(startStr);
    const end = new Date(endStr);

    while (cursor < end) {
        const chunkEnd = new Date(Math.min(
            cursor.getTime() + (CHUNK_DAYS - 1) * 24 * 60 * 60 * 1000,
            end.getTime(),
        ));
        chunks.push({
            start: cursor.toISOString().slice(0, 10),
            end: chunkEnd.toISOString().slice(0, 10),
        });
        cursor = new Date(chunkEnd.getTime() + 24 * 60 * 60 * 1000);
    }

    return chunks;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    console.log('═'.repeat(60));
    console.log('  Amazon Ads → Supabase Sync');
    console.log(`  Range: ${startDateStr} → ${endDateStr}`);
    console.log(`  Force: ${force}`);
    console.log('═'.repeat(60));

    if (!ADS_CLIENT_ID || !ADS_CLIENT_SECRET || !ADS_REFRESH_TOKEN) {
        console.error('❌ Missing ADS_* credentials in .env.local');
        process.exit(1);
    }

    // Test token
    await getToken();
    console.log('✅ Token OK\n');

    const chunks = generateChunks(startDateStr, endDateStr);
    console.log(`📅 ${chunks.length} chunks to process\n`);

    let totalCampaignRows = 0;
    let totalProductRows = 0;
    let skipped = 0;

    for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const label = `[${ci + 1}/${chunks.length}] ${chunk.start} → ${chunk.end}`;

        // ── Campaign report ──
        if (!force && await isChunkSynced('campaigns', chunk.start, chunk.end)) {
            console.log(`⏭️  ${label} campaigns — already synced`);
        } else {
            try {
                process.stdout.write(`📊 ${label} campaigns `);
                const rows = await fetchReport(chunk.start, chunk.end, 'campaigns');
                const count = await upsertCampaignRows(rows);
                await logSync('campaigns', chunk.start, chunk.end, count, 'completed');
                totalCampaignRows += count;
                console.log(` ✅ ${count} rows`);
            } catch (err) {
                console.log(` ❌ ${err.message}`);
                await logSync('campaigns', chunk.start, chunk.end, 0, 'failed', err.message);
            }
            await sleep(DELAY_BETWEEN_REPORTS_MS);
        }

        // ── Product report ──
        if (!force && await isChunkSynced('products', chunk.start, chunk.end)) {
            console.log(`⏭️  ${label} products — already synced`);
            skipped++;
        } else {
            try {
                process.stdout.write(`📦 ${label} products `);
                const rows = await fetchReport(chunk.start, chunk.end, 'products');
                const count = await upsertProductRows(rows);
                await logSync('products', chunk.start, chunk.end, count, 'completed');
                totalProductRows += count;
                console.log(` ✅ ${count} rows`);
            } catch (err) {
                console.log(` ❌ ${err.message}`);
                await logSync('products', chunk.start, chunk.end, 0, 'failed', err.message);
            }
            await sleep(DELAY_BETWEEN_REPORTS_MS);
        }
    }

    console.log('\n' + '═'.repeat(60));
    console.log('  ✅ Sync complete');
    console.log(`  Campaign rows: ${totalCampaignRows}`);
    console.log(`  Product rows:  ${totalProductRows}`);
    console.log(`  Chunks skipped: ${skipped}`);
    console.log('═'.repeat(60));
}

main().catch(err => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
});

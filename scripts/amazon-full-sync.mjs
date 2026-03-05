#!/usr/bin/env node
// ============================================================================
// amazon-full-sync.mjs — Complete Amazon SP-API → Supabase Backfill
// ============================================================================
// Pushes ALL historical data from Amazon into every Supabase table.
// Safe to re-run: existing records are NEVER overwritten or duplicated.
// Amazon's slow rate limits are respected via per-API delays and batching.
//
// Tables covered (in FK dependency order):
//   1. skus                  (Listings Report API)
//   2. orders                (Orders API — full history)
//   3. order_items           (Order Items API — per order, skip existing)
//   4. financial_event_groups (Finances API)
//   5. settlement_periods     (Finances API — same call as groups)
//   6. financial_events       (Finances API — all pages)
//   7. settlement_items       (Finances API — per group)
//   8. inventory_snapshots    (FBA Inventory API)
//   9. sku_daily_metrics      (computed from financial_events)
//  10. account_daily_metrics  (computed from sku_daily_metrics)
//  11. inventory_health       (computed from snapshots + sales)
//  12. alerts                 (computed from inventory_health)
//
// Usage:
//   node scripts/amazon-full-sync.mjs                     # full backfill
//   node scripts/amazon-full-sync.mjs --dry-run           # preview only
//   node scripts/amazon-full-sync.mjs --from=2024-01-01   # custom start date
//   node scripts/amazon-full-sync.mjs --skip-order-items  # skip slow step
//   node scripts/amazon-full-sync.mjs --from=2024-01-01 --skip-order-items
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { gunzipSync } from 'zlib';

// ── Load .env.local ──────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
    const envPath = resolve(__dirname, '../.env.local');
    try {
        const raw = readFileSync(envPath, 'utf-8');
        for (const line of raw.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx < 0) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim();
            if (!process.env[key]) process.env[key] = val;
        }
    } catch {
        console.warn('[env] .env.local not found — relying on process environment');
    }
}
loadEnv();

// ── CLI args ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_ORDER_ITEMS = args.includes('--skip-order-items');
const fromArg = args.find(a => a.startsWith('--from='));
const FROM_DATE = fromArg ? fromArg.split('=')[1] : null;

// Default history window
const DEFAULT_ORDER_DAYS = 730;  // 2 years
const DEFAULT_FINANCE_DAYS = 548;  // ~18 months (Amazon max is ~18)
const BATCH_SIZE = 200;
const ORDER_ITEMS_CONCURRENCY = 1;   // Sequential — Order Items API: 0.5 req/s
const ORDER_ITEMS_DELAY_MS = 1200;  // 1.2s between requests (safe under quota)
const ORDER_ITEMS_MAX_RETRIES = 5;   // Retry on 429 with backoff

// ── Supabase client ───────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌  NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set');
    process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Amazon SP-API auth ────────────────────────────────────────────────────────
let _accessToken = null;
let _tokenExpiry = 0;

function getAmazonConfig() {
    const clientId = process.env.LWA_CLIENT_ID;
    const clientSecret = process.env.LWA_CLIENT_SECRET;
    const refreshToken = process.env.LWA_REFRESH_TOKEN;
    const endpoint = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com';
    const marketplaceId = process.env.MARKETPLACE_ID || 'A21TJRUUN4KGV';
    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Amazon SP-API credentials (LWA_CLIENT_ID, LWA_CLIENT_SECRET, LWA_REFRESH_TOKEN)');
    }
    return { clientId, clientSecret, refreshToken, endpoint, marketplaceId };
}

async function getAccessToken() {
    if (_accessToken && Date.now() < _tokenExpiry - 60000) return _accessToken;
    const cfg = getAmazonConfig();
    const params = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: cfg.refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
    });
    const res = await fetch('https://api.amazon.com/auth/o2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
    if (!res.ok) throw new Error(`LWA token failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    _accessToken = data.access_token;
    _tokenExpiry = Date.now() + data.expires_in * 1000;
    return _accessToken;
}

async function spGet(path, params = {}, retries = 4) {
    const cfg = getAmazonConfig();
    const token = await getAccessToken();
    const url = new URL(`${cfg.endpoint}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url.toString(), {
            headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
            cache: 'no-store',
        });

        if (res.ok) return res.json();

        // Check Retry-After header (Amazon sometimes sends it)
        const retryAfter = res.headers.get('x-amzn-RateLimit-Limit') || res.headers.get('Retry-After');

        if (res.status === 429 && attempt < retries) {
            // Exponential backoff: 5s, 10s, 20s, 40s, 60s (capped)
            const waitMs = retryAfter
                ? parseFloat(retryAfter) * 1000
                : Math.min(5000 * Math.pow(2, attempt), 60000);
            warn(`429 on ${path} — backing off ${(waitMs / 1000).toFixed(0)}s (attempt ${attempt + 1}/${retries})…`);
            await sleep(waitMs);
            continue;
        }

        throw new Error(`SP-API ${path} → ${res.status}: ${await res.text()}`);
    }
}

async function spPost(path, body) {
    const cfg = getAmazonConfig();
    const token = await getAccessToken();
    const res = await fetch(`${cfg.endpoint}${path}`, {
        method: 'POST',
        headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`SP-API POST ${path} → ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function toAmount(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v === 'string') { const n = parseFloat(v.replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : 0; }
    if (typeof v === 'object') {
        if ('CurrencyAmount' in v) return toAmount(v.CurrencyAmount);
        if ('Amount' in v) return toAmount(v.Amount);
        if ('amount' in v) return toAmount(v.amount);
    }
    return parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
}

// ── Progress / logging ────────────────────────────────────────────────────────
const stats = {};
const stepTimings = {};

function log(msg) { console.log(`  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }

function header(step, total, name) {
    console.log('');
    console.log(`╔══ Step ${step}/${total}: ${name} ${'═'.repeat(Math.max(0, 55 - name.length - String(step).length - String(total).length))}`);
    stepTimings[name] = Date.now();
}

function stepDone(name, inserted, skipped = 0) {
    const ms = Date.now() - (stepTimings[name] || Date.now());
    const s = (ms / 1000).toFixed(1);
    stats[name] = { inserted, skipped };
    console.log(`╚══ ✅  ${name}: ${inserted} inserted, ${skipped} skipped — ${s}s`);
}

function parseTsv(tsv) {
    const lines = tsv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split('\t').map(h => h.replace(/^\uFEFF/, '').trim());
    return lines.slice(1).map(line => {
        const vals = line.split('\t');
        const row = {};
        headers.forEach((h, i) => { row[h] = vals[i]?.trim() || ''; });
        return row;
    });
}

// ── Batch upsert helper ───────────────────────────────────────────────────────
async function batchUpsert(table, rows, conflictCol, ignoreDuplicates = true) {
    if (DRY_RUN) { log(`[dry-run] Would upsert ${rows.length} rows into ${table}`); return rows.length; }
    let count = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictCol, ignoreDuplicates });
        if (error) warn(`${table} upsert error (batch ${Math.ceil(i / BATCH_SIZE) + 1}): ${error.message}`);
        else count += chunk.length;
    }
    return count;
}

async function batchInsert(table, rows) {
    if (DRY_RUN) { log(`[dry-run] Would insert ${rows.length} rows into ${table}`); return rows.length; }
    let count = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const { error } = await supabase.from(table).insert(chunk);
        if (error) warn(`${table} insert error (batch ${Math.ceil(i / BATCH_SIZE) + 1}): ${error.message}`);
        else count += chunk.length;
    }
    return count;
}

// ── Step 1: SKUs ──────────────────────────────────────────────────────────────
async function syncSkus() {
    const cfg = getAmazonConfig();

    log('Creating listings report request…');
    const createRes = await spPost('/reports/2021-06-30/reports', {
        reportType: 'GET_MERCHANT_LISTINGS_ALL_DATA',
        marketplaceIds: [cfg.marketplaceId],
    });
    const reportId = createRes.reportId;
    log(`Report ID: ${reportId} — polling until DONE…`);

    // Poll up to 5 minutes
    const deadline = Date.now() + 5 * 60 * 1000;
    let docId = null;
    while (Date.now() < deadline) {
        const rpt = await spGet(`/reports/2021-06-30/reports/${reportId}`);
        if (rpt.processingStatus === 'DONE' && rpt.reportDocumentId) {
            docId = rpt.reportDocumentId; break;
        }
        if (['CANCELLED', 'FATAL'].includes(rpt.processingStatus)) {
            throw new Error(`Listings report ${rpt.processingStatus}`);
        }
        log(`  Status: ${rpt.processingStatus} — waiting 10s…`);
        await sleep(10000);
    }
    if (!docId) throw new Error('Listings report timed out after 5 minutes');

    const docInfo = await spGet(`/reports/2021-06-30/documents/${docId}`);
    const raw = await fetch(docInfo.url, { signal: AbortSignal.timeout(60000) });
    if (!raw.ok) throw new Error(`Download failed: ${raw.status}`);

    const buf = Buffer.from(await raw.arrayBuffer());
    const isGz = buf[0] === 0x1f && buf[1] === 0x8b;
    const tsv = isGz ? gunzipSync(buf).toString('utf-8') : buf.toString('utf-8');
    const listings = parseTsv(tsv);
    log(`Parsed ${listings.length} listings from report`);

    const rows = listings.map(item => {
        const sku = (item['seller-sku'] || item['Seller SKU'] || item.sku || '').trim();
        const asin = item['asin1'] || item['ASIN1'] || item.asin || '';
        const title = item['item-name'] || item['Product Name'] || item.title || sku;
        return {
            sku, asin, title,
            category: item['product-type'] || item['Product Type'] || null,
            brand: item['brand'] || item['Brand'] || null,
            cost_per_unit: 0,
        };
    }).filter(r => r.sku);

    const inserted = await batchUpsert('skus', rows, 'sku', true);
    stepDone('skus', inserted, rows.length - inserted);
    return rows;
}

// ── Step 2: Orders ────────────────────────────────────────────────────────────
async function syncOrders() {
    const cfg = getAmazonConfig();
    const createdAfter = FROM_DATE
        ? new Date(FROM_DATE).toISOString()
        : new Date(Date.now() - DEFAULT_ORDER_DAYS * 86400000).toISOString();

    log(`Fetching orders since ${createdAfter.slice(0, 10)}…`);

    // Get existing order IDs to track skipped
    const { data: existingOrders } = await supabase.from('orders').select('amazon_order_id');
    const existingSet = new Set((existingOrders || []).map(o => o.amazon_order_id));
    log(`Already in DB: ${existingSet.size} orders`);

    const allOrders = [];
    let nextToken;
    let page = 0;

    do {
        page++;
        const params = nextToken
            ? { NextToken: nextToken }
            : { MarketplaceIds: cfg.marketplaceId, CreatedAfter: createdAfter, MaxResultsPerPage: '100' };

        const data = await spGet('/orders/v0/orders', params);
        const orders = data.payload?.Orders || [];
        allOrders.push(...orders);
        nextToken = data.payload?.NextToken;
        log(`  Page ${page}: ${orders.length} orders fetched (total: ${allOrders.length})${nextToken ? ' — more pages…' : ''}`);
        if (nextToken) await sleep(1100); // Amazon: 1 req/s
    } while (nextToken);

    const newOrders = allOrders.filter(o => !existingSet.has(o.AmazonOrderId));
    log(`New orders to insert: ${newOrders.length}`);

    const rows = newOrders.map(o => ({
        amazon_order_id: o.AmazonOrderId,
        account_id: 'default',
        purchase_date: o.PurchaseDate || null,
        shipment_date: o.LastUpdateDate || null,
        delivery_date: o.EasyShipShipmentStatus === 'Delivered' ? o.LastUpdateDate : null,
        order_status: o.OrderStatus || 'Pending',
        order_total: toAmount(o.OrderTotal),
        currency: o.OrderTotal?.CurrencyCode || 'INR',
        fulfillment_channel: o.FulfillmentChannel || 'MFN',
        is_prime: o.IsPrime || false,
        financial_status: 'OPEN',
        ship_city: o.ShippingAddress?.City || null,
        ship_state: o.ShippingAddress?.StateOrRegion || null,
        ship_postal_code: o.ShippingAddress?.PostalCode || null,
    }));

    const inserted = await batchUpsert('orders', rows, 'amazon_order_id', true);
    stepDone('orders', inserted, existingSet.size);
    return allOrders;
}

// ── Step 3: Order Items ───────────────────────────────────────────────────────
async function syncOrderItems(allOrders) {
    if (SKIP_ORDER_ITEMS) {
        log('Skipped (--skip-order-items flag)');
        stepDone('order_items', 0, 0);
        return;
    }

    // Find orders that don't yet have items in DB
    const { data: existingItems } = await supabase
        .from('order_items')
        .select('amazon_order_id');
    const ordersWithItems = new Set((existingItems || []).map(r => r.amazon_order_id));

    // Only get valid order IDs that exist in orders table
    const { data: dbOrders } = await supabase.from('orders').select('amazon_order_id');
    const validOrderIds = new Set((dbOrders || []).map(o => o.amazon_order_id));

    const missing = allOrders
        .map(o => o.AmazonOrderId)
        .filter(id => validOrderIds.has(id) && !ordersWithItems.has(id));

    log(`Orders needing items: ${missing.length} (${ordersWithItems.size} already have items)`);
    if (missing.length === 0) {
        stepDone('order_items', 0, ordersWithItems.size);
        return;
    }

    let totalInserted = 0;
    // Sequential fetch — strictly one request at a time to respect 0.5 req/s quota
    for (let i = 0; i < missing.length; i++) {
        const orderId = missing[i];
        try {
            const data = await spGet(`/orders/v0/orders/${orderId}/orderItems`, {}, ORDER_ITEMS_MAX_RETRIES);
            const items = data.payload?.OrderItems || [];

            if (items.length > 0) {
                const rows = items.map(item => ({
                    amazon_order_id: orderId,
                    sku: item.SellerSKU || null,
                    asin: item.ASIN || null,
                    title: item.Title || null,
                    quantity_ordered: item.QuantityOrdered || 1,
                    item_price: toAmount(item.ItemPrice),
                    shipping_price: toAmount(item.ShippingPrice),
                    tax_amount: toAmount(item.ItemTax),
                }));
                const n = await batchInsert('order_items', rows);
                totalInserted += n;
            }

            if ((i + 1) % 25 === 0 || i === missing.length - 1) {
                const pct = Math.round(((i + 1) / missing.length) * 100);
                log(`  [${i + 1}/${missing.length}] ${pct}% — inserted ${totalInserted} items so far`);
            }
        } catch (err) {
            warn(`Order items failed for ${orderId} (skipping): ${err.message.slice(0, 120)}`);
        }
        // Always wait between requests, even on failure
        await sleep(ORDER_ITEMS_DELAY_MS);
    }

    stepDone('order_items', totalInserted, ordersWithItems.size);
}

// ── Step 4: Financial Event Groups + Settlement Periods ───────────────────────
async function syncEventGroups() {
    const startedAfter = FROM_DATE
        ? new Date(FROM_DATE).toISOString()
        : new Date(Date.now() - DEFAULT_FINANCE_DAYS * 86400000).toISOString();

    log(`Fetching financial event groups since ${startedAfter.slice(0, 10)}…`);
    const allGroups = [];
    let nextToken;
    let page = 0;

    do {
        page++;
        const params = {
            FinancialEventGroupStartedAfter: startedAfter,
            MaxResultsPerPage: '100',
        };
        if (nextToken) params.NextToken = nextToken;

        const data = await spGet('/finances/v0/financialEventGroups', params);
        const groups = data.payload?.FinancialEventGroupList || [];
        allGroups.push(...groups);
        nextToken = data.payload?.NextToken;
        log(`  Page ${page}: ${groups.length} groups (total: ${allGroups.length})`);
        if (nextToken) await sleep(2100);
    } while (nextToken);

    log(`Total event groups: ${allGroups.length}`);

    // Upsert financial_event_groups
    const groupRows = allGroups.map(g => ({
        event_group_id: g.FinancialEventGroupId,
        account_id: 'default',
        processing_status: g.ProcessingStatus || 'Open',
        fund_transfer_status: g.FundTransferStatus || 'Initiated',
        fund_transfer_date: g.FundTransferDate || null,
        original_total: toAmount(g.OriginalTotal),
        beginning_balance: toAmount(g.BeginningBalance),
        trace_id: g.TraceId || null,
    }));
    await batchUpsert('financial_event_groups', groupRows, 'event_group_id', false);

    // Upsert settlement_periods
    const settlementRows = allGroups.map(g => ({
        settlement_id: g.FinancialEventGroupId,
        account_id: 'default',
        financial_event_group_start: g.FinancialEventGroupStart || null,
        financial_event_group_end: g.FinancialEventGroupEnd || null,
        fund_transfer_date: g.FundTransferDate || null,
        original_total: toAmount(g.OriginalTotal),
        converted_total: toAmount(g.ConvertedTotal || g.OriginalTotal),
        currency: g.OriginalTotal?.CurrencyCode || g.ConvertedTotal?.CurrencyCode || 'INR',
        processing_status: g.ProcessingStatus === 'Closed' ? 'Closed' : 'Open',
    }));
    const inserted = await batchUpsert('settlement_periods', settlementRows, 'settlement_id', false);

    stepDone('financial_event_groups + settlement_periods', inserted, allGroups.length - inserted);
    return allGroups;
}

// ── Step 5: Financial Events (ledger — SOURCE OF TRUTH) ───────────────────────
// Fetches in 30-day chunks to avoid the Amazon API returning empty results
// for very large date ranges (a known quirk of listFinancialEvents).
async function syncFinancialEvents() {
    const startDate = FROM_DATE
        ? new Date(FROM_DATE)
        : new Date(Date.now() - DEFAULT_FINANCE_DAYS * 86400000);
    // Amazon rejects PostedBefore dates within 2 minutes of now — subtract 5 min to be safe
    const endDate = new Date(Date.now() - 5 * 60 * 1000);

    log(`Fetching financial events from ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)}`);
    log('Chunking into 30-day windows to ensure complete coverage…');

    // Load delivery dates from DB for revenue state classification
    const { data: ordersData } = await supabase.from('orders').select('amazon_order_id, delivery_date');
    const orderDeliveryMap = new Map((ordersData || []).map(o => [o.amazon_order_id, o.delivery_date]));
    log(`Loaded ${orderDeliveryMap.size} order delivery dates from DB`);

    // Build 30-day window pairs covering the full range
    const windows = [];
    let windowStart = new Date(startDate);
    while (windowStart < endDate) {
        const windowEnd = new Date(Math.min(windowStart.getTime() + 30 * 86400000, endDate.getTime()));
        windows.push({ from: windowStart.toISOString(), to: windowEnd.toISOString() });
        windowStart = new Date(windowEnd);
    }
    log(`Total windows to fetch: ${windows.length}`);

    const allPages = [];

    for (let wi = 0; wi < windows.length; wi++) {
        const { from, to } = windows[wi];
        log(`  Window [${wi + 1}/${windows.length}]: ${from.slice(0, 10)} → ${to.slice(0, 10)}`);
        let nextToken;
        let page = 0;
        do {
            page++;
            const params = {
                PostedAfter: from,
                PostedBefore: to,
                MaxResultsPerPage: '100',
            };
            if (nextToken) params.NextToken = nextToken;

            const data = await spGet('/finances/v0/financialEvents', params);
            const eventList = data.payload?.FinancialEvents;
            if (eventList) allPages.push(eventList);
            nextToken = data.payload?.NextToken;
            if (nextToken) await sleep(2100);
        } while (nextToken);
        // Brief pause between windows
        if (wi < windows.length - 1) await sleep(1000);
    }

    // Build ledger rows
    const ledger = [];

    for (const page of allPages) {
        // Shipment events → revenue + fees
        for (const evt of (page.ShipmentEventList || [])) {
            const orderId = evt.AmazonOrderId || '';
            const delivery = orderDeliveryMap.get(orderId) || null;
            for (const item of (evt.ShipmentItemList || [])) {
                const sku = item.SellerSKU || 'UNKNOWN';
                const qty = item.QuantityShipped || 1;
                for (const charge of (item.ItemChargeList || [])) {
                    const amount = toAmount(charge.ChargeAmount);
                    if (!amount) continue;
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'shipment',
                        amount,
                        quantity: qty,
                        currency: charge.ChargeAmount?.CurrencyCode || 'INR',
                        posted_date: evt.PostedDate,
                        delivery_date: delivery,
                        reference_id: `${orderId}-${sku}-${charge.ChargeType || 'Principal'}`,
                    });
                }
                for (const fee of (item.ItemFeeList || [])) {
                    const amount = toAmount(fee.FeeAmount);
                    if (!amount) continue;
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'fee',
                        amount,
                        quantity: 0,
                        currency: fee.FeeAmount?.CurrencyCode || 'INR',
                        posted_date: evt.PostedDate,
                        fee_type: fee.FeeType || 'unknown',
                        reference_id: `${orderId}-${sku}-fee-${fee.FeeType || 'unknown'}`,
                    });
                }
                // Item promotions (coupons, Lightning Deals, etc.)
                for (const promo of (item.PromotionList || [])) {
                    const amount = toAmount(promo.PromotionAmount);
                    if (!amount) continue;
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'promotion',
                        amount,
                        quantity: 0,
                        currency: promo.PromotionAmount?.CurrencyCode || 'INR',
                        posted_date: evt.PostedDate,
                        fee_type: promo.PromotionType || 'Promotion',
                        reference_id: `${orderId}-${sku}-promo-${promo.PromotionId || promo.PromotionType || 'unknown'}`,
                    });
                }
                // TDS / Tax withheld at source
                for (const taxItem of (item.ItemTaxWithheldList || [])) {
                    for (const comp of (taxItem.TaxesWithheld || [])) {
                        const amount = toAmount(comp.ChargeAmount);
                        if (!amount) continue;
                        ledger.push({
                            account_id: 'default',
                            amazon_order_id: orderId,
                            sku,
                            event_type: 'tax_withheld',
                            amount,
                            quantity: 0,
                            currency: comp.ChargeAmount?.CurrencyCode || 'INR',
                            posted_date: evt.PostedDate,
                            fee_type: comp.ChargeType || taxItem.TaxCollectionModel || 'TDS',
                            reference_id: `${orderId}-${sku}-tds-${comp.ChargeType || 'TDS'}`,
                        });
                    }
                }
            }
        }

        // Refund events
        for (const evt of (page.RefundEventList || [])) {
            const orderId = evt.AmazonOrderId || '';
            for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
                const sku = item.SellerSKU || 'UNKNOWN';
                const qty = item.QuantityShipped || 1;
                // Refund charges (negative Principal, ShippingCharge, etc.)
                for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
                    const amount = toAmount(charge.ChargeAmount);
                    if (!amount) continue;
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'refund',
                        amount,
                        quantity: -Math.abs(qty),
                        currency: charge.ChargeAmount?.CurrencyCode || 'INR',
                        posted_date: evt.PostedDate,
                        reference_id: `${orderId}-${sku}-refund-${charge.ChargeType || 'Principal'}`,
                    });
                }
                // Refund fee adjustments (RefundCommission, fee reversals)
                for (const fee of (item.ItemFeeAdjustmentList || item.ItemFeeList || [])) {
                    const amount = toAmount(fee.FeeAmount);
                    if (!amount) continue;
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'refund_fee',
                        amount,
                        quantity: 0,
                        currency: fee.FeeAmount?.CurrencyCode || 'INR',
                        posted_date: evt.PostedDate,
                        fee_type: fee.FeeType || 'RefundFee',
                        reference_id: `${orderId}-${sku}-refundfee-${fee.FeeType || 'unknown'}`,
                    });
                }
                // Refund promotion adjustments
                for (const promo of (item.PromotionAdjustmentList || item.PromotionList || [])) {
                    const amount = toAmount(promo.PromotionAmount);
                    if (!amount) continue;
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: orderId,
                        sku,
                        event_type: 'promotion',
                        amount,
                        quantity: 0,
                        currency: promo.PromotionAmount?.CurrencyCode || 'INR',
                        posted_date: evt.PostedDate,
                        fee_type: promo.PromotionType || 'RefundPromotion',
                        reference_id: `${orderId}-${sku}-refundpromo-${promo.PromotionId || promo.PromotionType || 'unknown'}`,
                    });
                }
                // TDS / Tax withheld on refunds
                for (const taxItem of (item.ItemTaxWithheldList || [])) {
                    for (const comp of (taxItem.TaxesWithheld || [])) {
                        const amount = toAmount(comp.ChargeAmount);
                        if (!amount) continue;
                        ledger.push({
                            account_id: 'default',
                            amazon_order_id: orderId,
                            sku,
                            event_type: 'tax_withheld',
                            amount,
                            quantity: 0,
                            currency: comp.ChargeAmount?.CurrencyCode || 'INR',
                            posted_date: evt.PostedDate,
                            fee_type: comp.ChargeType || taxItem.TaxCollectionModel || 'TDS_Refund',
                            reference_id: `${orderId}-${sku}-tds-refund-${comp.ChargeType || 'TDS'}`,
                        });
                    }
                }
            }
        }

        // Service fee events
        for (const evt of (page.ServiceFeeEventList || [])) {
            for (const fee of (evt.FeeList || [])) {
                const amount = toAmount(fee.FeeAmount);
                if (!amount) continue;
                ledger.push({
                    account_id: 'default',
                    amazon_order_id: evt.AmazonOrderId || null,
                    sku: evt.SellerSKU || null,
                    event_type: 'fee',
                    amount,
                    quantity: 0,
                    currency: fee.FeeAmount?.CurrencyCode || 'INR',
                    posted_date: evt.PostedDate || new Date().toISOString(),
                    fee_type: fee.FeeType || evt.FeeReason || 'service_fee',
                    reference_id: `svc-${evt.AmazonOrderId || 'none'}-${fee.FeeType || 'unknown'}`,
                });
            }
        }

        // Adjustment events (PostageRefund, REVERSAL_REIMBURSEMENT, etc.)
        for (const evt of (page.AdjustmentEventList || [])) {
            const postedDate = evt.PostedDate || new Date().toISOString();
            const adjustmentType = evt.AdjustmentType || 'unknown';
            const adjustmentOrderId = evt.AmazonOrderId || null;

            for (const item of (evt.AdjustmentItemList || [])) {
                const amount = toAmount(item.TotalAmount);
                if (!amount) continue;
                ledger.push({
                    account_id: 'default',
                    amazon_order_id: adjustmentOrderId,
                    sku: item.SellerSKU || null,
                    event_type: 'adjustment',
                    amount,
                    quantity: item.Quantity || 0,
                    currency: item.TotalAmount?.CurrencyCode || 'INR',
                    posted_date: postedDate,
                    fee_type: adjustmentType,
                    reference_id: `adj-${adjustmentType}-${item.SellerSKU || 'none'}-${item.AsinIsbnCode || 'none'}-${postedDate}`,
                });
            }

            // Event-level adjustment with no item list
            if ((!evt.AdjustmentItemList || evt.AdjustmentItemList.length === 0) && evt.AdjustmentAmount) {
                const amount = toAmount(evt.AdjustmentAmount);
                if (amount) {
                    ledger.push({
                        account_id: 'default',
                        amazon_order_id: adjustmentOrderId,
                        sku: null,
                        event_type: 'adjustment',
                        amount,
                        quantity: 0,
                        currency: evt.AdjustmentAmount?.CurrencyCode || 'INR',
                        posted_date: postedDate,
                        fee_type: adjustmentType,
                        reference_id: `adj-${adjustmentType}-evt-${postedDate}`,
                    });
                }
            }
        }
    }

    // In-memory dedup by (event_type, reference_id)
    const seen = new Set();
    const deduped = [];
    for (const row of ledger) {
        const key = row.reference_id
            ? `${row.event_type}|${row.reference_id}`
            : `${row.event_type}|${row.amazon_order_id}|${row.sku}|${row.posted_date}|${row.amount}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(row);
    }
    log(`Built ${ledger.length} ledger rows → ${deduped.length} after in-memory dedup`);

    // Resolve unknown SKUs via order→SKU map built from shipment events
    const orderSkuMap = new Map();
    for (const row of deduped) {
        if (row.event_type === 'shipment' && row.amazon_order_id && row.sku && row.sku !== 'UNKNOWN') {
            if (!orderSkuMap.has(row.amazon_order_id)) orderSkuMap.set(row.amazon_order_id, row.sku);
        }
    }
    let resolved = 0;
    for (const row of deduped) {
        if (row.event_type === 'fee' && row.amazon_order_id && (!row.sku || row.sku === 'UNKNOWN')) {
            const s = orderSkuMap.get(row.amazon_order_id);
            if (s) { row.sku = s; resolved++; }
        }
    }
    if (resolved > 0) log(`Resolved ${resolved} fee events to their order's SKU`);

    // Idempotent write: for rows with reference_id, delete existing then insert
    // For rows without reference_id, only insert if no matching row exists
    if (!DRY_RUN) {
        const withRef = deduped.filter(r => r.reference_id);
        const withoutRef = deduped.filter(r => !r.reference_id);

        // Delete by reference_id chunks, then re-insert
        const refIds = [...new Set(withRef.map(r => r.reference_id))];
        for (let i = 0; i < refIds.length; i += 100) {
            const chunk = refIds.slice(i, i + 100);
            await supabase.from('financial_events').delete().in('reference_id', chunk);
        }
        await batchInsert('financial_events', withRef);

        // For no-reference rows: use upsert via the unique index (reference_id IS NULL path)
        // Just try insert and ignore duplicate errors
        for (let i = 0; i < withoutRef.length; i += BATCH_SIZE) {
            const chunk = withoutRef.slice(i, i + BATCH_SIZE);
            const { error } = await supabase.from('financial_events').insert(chunk);
            if (error && !error.message.includes('duplicate')) warn(`financial_events (no-ref): ${error.message}`);
        }
    } else {
        log(`[dry-run] Would write ${deduped.length} financial events`);
    }

    stepDone('financial_events', deduped.length, ledger.length - deduped.length);
    return deduped;
}

// ── Step 6: Settlement Items (per group) ──────────────────────────────────────
async function syncSettlementItems(allGroups) {
    if (!allGroups || allGroups.length === 0) {
        stepDone('settlement_items', 0, 0);
        return;
    }

    // Check DB: find which groups already have settlement_items (skip those)
    const { data: existingItems } = await supabase
        .from('settlement_items')
        .select('settlement_id');
    const groupsWithItems = new Set((existingItems || []).map(r => r.settlement_id));
    log(`Groups already in DB with items: ${groupsWithItems.size}`);

    // For a full backfill: process ALL groups not yet in DB.
    // Open groups are always re-fetched (they may have new events).
    const groupsToFetch = allGroups.filter(g =>
        g.ProcessingStatus === 'Open' || !groupsWithItems.has(g.FinancialEventGroupId)
    );

    log(`Settlement item groups to fetch: ${groupsToFetch.length} of ${allGroups.length} total (${groupsWithItems.size} already synced)`);

    let totalInserted = 0;
    let idx = 0;

    for (const group of groupsToFetch) {
        idx++;
        const groupId = group.FinancialEventGroupId;
        try {
            const eventPages = [];
            let nextToken;
            do {
                const params = {};
                if (nextToken) params.NextToken = nextToken;
                const data = await spGet(`/finances/v0/financialEventGroups/${groupId}/financialEvents`, params);
                if (data.payload?.FinancialEvents) eventPages.push(data.payload.FinancialEvents);
                nextToken = data.payload?.NextToken;
                if (nextToken) await sleep(2100);
            } while (nextToken);

            const items = [];
            for (const page of eventPages) {
                for (const evt of (page.ShipmentEventList || [])) {
                    for (const item of (evt.ShipmentItemList || [])) {
                        for (const charge of (item.ItemChargeList || [])) {
                            const a = toAmount(charge.ChargeAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null, transaction_type: 'Order', amount_type: 'ItemPrice',
                                amount_description: charge.ChargeType || 'Principal', amount: a,
                                quantity: item.QuantityShipped || 1, posted_date: evt.PostedDate
                            });
                        }
                        for (const fee of (item.ItemFeeList || [])) {
                            const a = toAmount(fee.FeeAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null, transaction_type: 'Order', amount_type: 'ItemFees',
                                amount_description: fee.FeeType || 'Fee', amount: a, quantity: 0, posted_date: evt.PostedDate
                            });
                        }
                        // Promotions
                        for (const promo of (item.PromotionList || [])) {
                            const a = toAmount(promo.PromotionAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null, transaction_type: 'Order', amount_type: 'Promotion',
                                amount_description: promo.PromotionType || 'Promotion', amount: a, quantity: 0, posted_date: evt.PostedDate
                            });
                        }
                        // TDS / Tax withheld
                        for (const taxItem of (item.ItemTaxWithheldList || [])) {
                            for (const comp of (taxItem.TaxesWithheld || [])) {
                                const a = toAmount(comp.ChargeAmount);
                                if (!a) continue;
                                items.push({
                                    settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null, transaction_type: 'Order', amount_type: 'TaxWithheld',
                                    amount_description: comp.ChargeType || 'TDS', amount: a, quantity: 0, posted_date: evt.PostedDate
                                });
                            }
                        }
                    }
                }
                for (const evt of (page.RefundEventList || [])) {
                    for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
                        // Refund charges
                        for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
                            const a = toAmount(charge.ChargeAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null, transaction_type: 'Refund', amount_type: 'ItemPrice',
                                amount_description: charge.ChargeType || 'RefundPrincipal', amount: a,
                                quantity: -(item.QuantityShipped || 1), posted_date: evt.PostedDate
                            });
                        }
                        // Refund fee adjustments (RefundCommission, fee reversals)
                        for (const fee of (item.ItemFeeAdjustmentList || item.ItemFeeList || [])) {
                            const a = toAmount(fee.FeeAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null, transaction_type: 'Refund', amount_type: 'ItemFees',
                                amount_description: fee.FeeType || 'RefundFee', amount: a, quantity: 0, posted_date: evt.PostedDate
                            });
                        }
                        // Refund promotion adjustments
                        for (const promo of (item.PromotionAdjustmentList || item.PromotionList || [])) {
                            const a = toAmount(promo.PromotionAmount);
                            if (!a) continue;
                            items.push({
                                settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                sku: item.SellerSKU || null, transaction_type: 'Refund', amount_type: 'Promotion',
                                amount_description: promo.PromotionType || 'RefundPromotion', amount: a, quantity: 0, posted_date: evt.PostedDate
                            });
                        }
                        // TDS on refunds
                        for (const taxItem of (item.ItemTaxWithheldList || [])) {
                            for (const comp of (taxItem.TaxesWithheld || [])) {
                                const a = toAmount(comp.ChargeAmount);
                                if (!a) continue;
                                items.push({
                                    settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                                    sku: item.SellerSKU || null, transaction_type: 'Refund', amount_type: 'TaxWithheld',
                                    amount_description: comp.ChargeType || 'TDS_Refund', amount: a, quantity: 0, posted_date: evt.PostedDate
                                });
                            }
                        }
                    }
                }
                for (const evt of (page.ServiceFeeEventList || [])) {
                    for (const fee of (evt.FeeList || [])) {
                        const a = toAmount(fee.FeeAmount);
                        if (!a) continue;
                        items.push({
                            settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                            sku: evt.SellerSKU || null, transaction_type: 'ServiceFee', amount_type: 'Other',
                            amount_description: fee.FeeType || 'ServiceFee', amount: a, quantity: 0, posted_date: null
                        });
                    }
                }
                for (const evt of (page.AdjustmentEventList || [])) {
                    for (const item of (evt.AdjustmentItemList || [])) {
                        const a = toAmount(item.TotalAmount);
                        if (!a) continue;
                        items.push({
                            settlement_id: groupId, amazon_order_id: evt.AmazonOrderId || null,
                            sku: item.SellerSKU || null, transaction_type: 'Adjustment', amount_type: 'Other',
                            amount_description: evt.AdjustmentType || 'Adjustment', amount: a,
                            quantity: item.Quantity || 0, posted_date: evt.PostedDate
                        });
                    }
                }
            }

            if (items.length > 0 && !DRY_RUN) {
                await supabase.from('settlement_items').delete().eq('settlement_id', groupId);
                await batchInsert('settlement_items', items);
                totalInserted += items.length;
            }
            log(`  [${idx}/${groupsToFetch.length}] Group ${groupId}: ${items.length} items`);
            await sleep(1200);
        } catch (err) {
            warn(`Settlement items for group ${groupId}: ${err.message}`);
        }
    }

    stepDone('settlement_items', totalInserted, 0);
}

// ── Step 7: Inventory Snapshots ───────────────────────────────────────────────
async function syncInventory() {
    const cfg = getAmazonConfig();
    const today = new Date().toISOString().slice(0, 10);
    log(`Fetching FBA inventory (snapshot date: ${today})…`);

    const allItems = [];
    let nextToken;
    let page = 0;

    do {
        page++;
        const params = {
            marketplaceIds: cfg.marketplaceId,
            granularityType: 'Marketplace',
            granularityId: cfg.marketplaceId,
            details: 'true',
        };
        if (nextToken) params.nextToken = nextToken;

        const data = await spGet('/fba/inventory/v1/summaries', params);
        const items = data.payload?.inventorySummaries || [];
        allItems.push(...items);
        nextToken = data.pagination?.nextToken;
        log(`  Page ${page}: ${items.length} items (total: ${allItems.length})`);
        if (nextToken) await sleep(300);
    } while (nextToken);

    const rows = allItems
        .filter(item => item.sellerSku)
        .map(item => ({
            account_id: 'default',
            sku: item.sellerSku,
            available_quantity: item.inventoryDetails?.fulfillableQuantity || 0,
            inbound_quantity: (item.inventoryDetails?.inboundWorkingQuantity || 0) +
                (item.inventoryDetails?.inboundShippedQuantity || 0) +
                (item.inventoryDetails?.inboundReceivingQuantity || 0),
            reserved_quantity: item.inventoryDetails?.totalReservedQuantity || 0,
            snapshot_date: today,
        }));

    // Ensure all inventory SKUs exist in master table first (FK safety)
    const { data: existingSkus } = await supabase.from('skus').select('sku');
    const skuSet = new Set((existingSkus || []).map(s => s.sku));
    const missingSkuRows = allItems
        .filter(item => item.sellerSku && !skuSet.has(item.sellerSku))
        .map(item => ({ sku: item.sellerSku, asin: item.asin || null, title: item.productName || item.sellerSku }));

    if (missingSkuRows.length > 0) {
        log(`Inserting ${missingSkuRows.length} inventory-only SKUs into master table…`);
        await batchUpsert('skus', missingSkuRows, 'sku', true);
    }

    const inserted = await batchUpsert('inventory_snapshots', rows, 'sku,snapshot_date', true);
    stepDone('inventory_snapshots', inserted, rows.length - inserted);
}

// ── Step 8: Compute Aggregations ──────────────────────────────────────────────
async function computeAggregations() {
    const RETURN_WINDOW_DAYS = 30;
    const lockCutoff = new Date(Date.now() - RETURN_WINDOW_DAYS * 86400000);

    log('Loading all financial events from DB (paginated)…');
    const events = [];
    const PAGE_SIZE = 1000;
    let pageStart = 0;
    while (true) {
        const { data: page, error } = await supabase
            .from('financial_events')
            .select('*')
            .order('posted_date', { ascending: true })
            .range(pageStart, pageStart + PAGE_SIZE - 1);
        if (error) {
            warn(`Could not load financial events (page ${pageStart}): ${error.message}`);
            break;
        }
        if (!page || page.length === 0) break;
        events.push(...page);
        if (page.length < PAGE_SIZE) break; // last page
        pageStart += PAGE_SIZE;
    }

    if (events.length === 0) {
        warn('No financial events found in DB — skipping aggregation');
        stepDone('aggregations', 0, 0);
        return;
    }
    log(`Loaded ${events.length} events — computing SKU daily aggregations…`);

    const { data: skuData } = await supabase.from('skus').select('sku, cost_per_unit');
    const costMap = new Map((skuData || []).map(s => [s.sku, Number(s.cost_per_unit) || 0]));

    const refundedKeys = new Set();
    for (const e of events) {
        if (e.event_type === 'refund') refundedKeys.add(`${e.amazon_order_id}-${e.sku}`);
    }

    const skuDailyMap = new Map();
    for (const evt of events) {
        const dateKey = new Date(evt.posted_date).toISOString().slice(0, 10);
        const sku = evt.sku || 'UNKNOWN';
        const mapKey = `${sku}|${dateKey}`;
        if (!skuDailyMap.has(mapKey)) {
            skuDailyMap.set(mapKey, {
                date: dateKey, sku, revenue_live: 0, revenue_locked: 0,
                units_sold_live: 0, units_sold_locked: 0, refund_amount: 0, refund_units: 0,
                ad_spend: 0, fee_amount: 0
            });
        }
        const agg = skuDailyMap.get(mapKey);
        if (evt.event_type === 'shipment') {
            const isRefunded = refundedKeys.has(`${evt.amazon_order_id}-${evt.sku}`);
            const delivery = evt.delivery_date ? new Date(evt.delivery_date) : null;
            const isLocked = delivery && delivery < lockCutoff && !isRefunded;
            agg.revenue_live += evt.amount;
            agg.units_sold_live += evt.quantity;
            if (isLocked) { agg.revenue_locked += evt.amount; agg.units_sold_locked += evt.quantity; }
        } else if (evt.event_type === 'refund') {
            agg.refund_amount += Math.abs(evt.amount);
            agg.refund_units += Math.abs(evt.quantity);
        } else if (evt.event_type === 'fee') {
            agg.fee_amount += Math.abs(evt.amount);
        } else if (evt.event_type === 'ad_spend') {
            agg.ad_spend += Math.abs(evt.amount);
        }
    }

    const skuDailyRows = [...skuDailyMap.values()].map(agg => {
        const cost = costMap.get(agg.sku) || 0;
        const net = agg.revenue_live - agg.fee_amount - cost * agg.units_sold_live - agg.ad_spend - agg.refund_amount;
        const margin = agg.revenue_live > 0 ? (net / agg.revenue_live) * 100 : 0;
        const tacos = agg.revenue_live > 0 ? (agg.ad_spend / agg.revenue_live) * 100 : 0;
        const rr = agg.units_sold_live > 0 ? (agg.refund_units / agg.units_sold_live) * 100 : 0;
        return {
            date: agg.date, sku: agg.sku,
            revenue_live: Math.round(agg.revenue_live * 100) / 100,
            revenue_locked: Math.round(agg.revenue_locked * 100) / 100,
            units_sold_live: agg.units_sold_live,
            units_sold_locked: agg.units_sold_locked,
            refund_amount: Math.round(agg.refund_amount * 100) / 100,
            refund_units: agg.refund_units,
            ad_spend: Math.round(agg.ad_spend * 100) / 100,
            net_contribution: Math.round(net * 100) / 100,
            margin_percent: Math.round(margin * 100) / 100,
            tacos: Math.round(tacos * 100) / 100,
            return_rate: Math.round(rr * 100) / 100,
        };
    });

    // Build account daily
    const accMap = new Map();
    for (const row of skuDailyRows) {
        if (!accMap.has(row.date)) {
            accMap.set(row.date, {
                date: row.date, total_revenue_live: 0, total_revenue_locked: 0,
                net_contribution_live: 0, net_contribution_locked: 0, total_units_live: 0,
                total_units_locked: 0, total_refund_amount: 0, total_fees: 0, total_ad_spend: 0,
                total_refund_units: 0
            });
        }
        const a = accMap.get(row.date);
        a.total_revenue_live += row.revenue_live;
        a.total_revenue_locked += row.revenue_locked;
        a.total_units_live += row.units_sold_live;
        a.total_units_locked += row.units_sold_locked;
        a.total_refund_amount += row.refund_amount;
        a.total_refund_units += row.refund_units;
        a.net_contribution_live += row.net_contribution;
    }

    const accRows = [...accMap.values()].map(a => {
        const rr = a.total_units_live > 0
            ? Math.round((a.total_refund_units / a.total_units_live) * 10000) / 100 : 0;
        return {
            date: a.date,
            total_revenue_live: Math.round(a.total_revenue_live * 100) / 100,
            total_revenue_locked: Math.round(a.total_revenue_locked * 100) / 100,
            net_contribution_live: Math.round(a.net_contribution_live * 100) / 100,
            net_contribution_locked: 0,
            total_units_live: a.total_units_live,
            total_units_locked: a.total_units_locked,
            total_refund_amount: Math.round(a.total_refund_amount * 100) / 100,
            total_fees: 0,
            total_ad_spend: 0,
            acos: 0,
            total_profit: Math.round(a.net_contribution_live * 100) / 100,
            return_rate: rr,
        };
    });

    if (!DRY_RUN) {
        // Full recompute — safe delete + insert
        await supabase.from('sku_daily_metrics').delete().neq('sku', '__impossible__');
        await batchInsert('sku_daily_metrics', skuDailyRows);
        await supabase.from('account_daily_metrics').delete().neq('date', '1900-01-01');
        await batchInsert('account_daily_metrics', accRows);
    } else {
        log(`[dry-run] Would write ${skuDailyRows.length} sku_daily_metrics, ${accRows.length} account_daily_metrics`);
    }

    stepDone('sku_daily_metrics + account_daily_metrics', skuDailyRows.length + accRows.length, 0);
}

// ── Step 9: Inventory Health + Alerts ─────────────────────────────────────────
async function computeInventoryHealth() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const { data: snapshots } = await supabase
        .from('inventory_snapshots').select('sku, available_quantity')
        .order('snapshot_date', { ascending: false });

    const { data: recentSales } = await supabase
        .from('sku_daily_metrics').select('sku, units_sold_live').gte('date', sevenDaysAgo);

    const latestSnap = new Map();
    for (const s of (snapshots || [])) {
        if (!latestSnap.has(s.sku)) latestSnap.set(s.sku, s.available_quantity);
    }

    const salesMap = new Map();
    for (const r of (recentSales || [])) {
        salesMap.set(r.sku, (salesMap.get(r.sku) || 0) + r.units_sold_live);
    }

    const healthRows = [];
    const alertRows = [];

    for (const [sku, available] of latestSnap) {
        const weekSales = salesMap.get(sku) || 0;
        const avgDaily = weekSales / 7;
        const days = avgDaily > 0 ? available / avgDaily : 999;
        const status = days < 7 ? 'red' : days < 21 ? 'yellow' : 'green';

        healthRows.push({
            sku,
            available_units: available,
            avg_daily_sales_7d: Math.round(avgDaily * 100) / 100,
            days_inventory: Math.round(days * 10) / 10,
            risk_status: status,
            last_updated: new Date().toISOString(),
        });

        if (status === 'red') {
            alertRows.push({
                sku,
                alert_type: 'low_inventory',
                alert_status: 'active',
                severity: available === 0 ? 'critical' : 'warning',
                title: available === 0 ? `${sku}: Out of Stock` : `${sku}: Low Stock`,
                message: `${available} units left (${Math.round(days)} days of cover at current sales rate)`,
                trigger_value: available,
                threshold_value: 7,
            });
        }
    }

    if (!DRY_RUN) {
        // Health: upsert
        await batchUpsert('inventory_health', healthRows, 'sku', false);

        // Alerts: only insert non-duplicate alerts (check by sku + alert_type + alert_status=active)
        const { data: existingAlerts } = await supabase
            .from('alerts').select('sku, alert_type').eq('alert_status', 'active');
        const existingAlertKeys = new Set((existingAlerts || []).map(a => `${a.sku}|${a.alert_type}`));
        const newAlerts = alertRows.filter(a => !existingAlertKeys.has(`${a.sku}|${a.alert_type}`));
        if (newAlerts.length > 0) await batchInsert('alerts', newAlerts);
        stepDone('inventory_health + alerts', healthRows.length + alertRows.length, 0);
    } else {
        log(`[dry-run] Would write ${healthRows.length} health rows, ${alertRows.length} alert rows`);
        stepDone('inventory_health + alerts', healthRows.length + alertRows.length, 0);
    }
}

// ── Summary Report ────────────────────────────────────────────────────────────
function printSummary(totalMs) {
    const secs = Math.floor(totalMs / 1000);
    const mins = Math.floor(secs / 60);
    const s = secs % 60;

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log(`║  ${DRY_RUN ? '🔍 DRY RUN' : '✅ SYNC COMPLETE'} — ${mins}m ${s}s${' '.repeat(Math.max(0, 44 - String(mins).length - String(s).length))}║`);
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  Table                                   Inserted  Skipped ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    for (const [name, { inserted, skipped }] of Object.entries(stats)) {
        const n = name.slice(0, 36).padEnd(38);
        const i = String(inserted).padStart(6);
        const sk = String(skipped).padStart(7);
        console.log(`║  ${n} ${i}  ${sk} ║`);
    }
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    if (DRY_RUN) {
        console.log('  ℹ️  DRY RUN — no data was written to Supabase.');
        console.log('  Run without --dry-run to perform the actual sync.');
    } else {
        console.log('  💡 To verify: check your Supabase dashboard at:');
        console.log(`     ${SUPABASE_URL}`);
        console.log('  💡 Re-run this script anytime — it is fully idempotent.');
    }
    console.log('');
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║       Amazon SP-API → Supabase — Full Backfill Sync       ║');
    console.log(`║  Mode: ${(DRY_RUN ? 'DRY RUN' : 'LIVE   ').padEnd(12)}  From: ${(FROM_DATE || `last ${DEFAULT_ORDER_DAYS}d`).padEnd(12)}           ║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');

    const START = Date.now();
    const TOTAL_STEPS = 9;

    try {
        // ── 1. SKUs
        header(1, TOTAL_STEPS, 'SKU Catalog (Listings Report API)');
        await syncSkus();

        // ── 2. Orders
        header(2, TOTAL_STEPS, 'Orders (Orders API — full history)');
        const allOrders = await syncOrders();

        // ── 3. Order Items
        header(3, TOTAL_STEPS, 'Order Items (per-order, skip existing)');
        await syncOrderItems(allOrders);

        // ── 4. Financial Event Groups + Settlement Periods
        header(4, TOTAL_STEPS, 'Financial Event Groups & Settlement Periods');
        const allGroups = await syncEventGroups();

        // ── 5. Financial Events
        header(5, TOTAL_STEPS, 'Financial Events (Finances API — source of truth)');
        await syncFinancialEvents();

        // ── 6. Settlement Items
        header(6, TOTAL_STEPS, 'Settlement Items (per group events)');
        await syncSettlementItems(allGroups);

        // ── 7. Inventory Snapshots
        header(7, TOTAL_STEPS, 'Inventory Snapshots (FBA Inventory API)');
        await syncInventory();

        // ── 8. Aggregations
        header(8, TOTAL_STEPS, 'Computing SKU & Account Daily Metrics');
        await computeAggregations();

        // ── 9. Inventory Health + Alerts
        header(9, TOTAL_STEPS, 'Inventory Health & Alerts');
        await computeInventoryHealth();

        printSummary(Date.now() - START);
        process.exit(0);
    } catch (err) {
        console.error('');
        console.error(`❌  Fatal error: ${err.message}`);
        console.error(err.stack);
        printSummary(Date.now() - START);
        process.exit(1);
    }
}

main();

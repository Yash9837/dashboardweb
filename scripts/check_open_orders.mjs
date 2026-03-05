#!/usr/bin/env node
// ============================================================================
// Check OPEN orders blocking the "Finalized Till" date against Amazon API
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local
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
    } catch { console.warn('[env] .env.local not found'); }
}
loadEnv();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// ── Amazon Auth ──
let _accessToken = null;
let _tokenExpiry = 0;

function getAmazonConfig() {
    return {
        clientId: process.env.LWA_CLIENT_ID,
        clientSecret: process.env.LWA_CLIENT_SECRET,
        refreshToken: process.env.LWA_REFRESH_TOKEN,
        endpoint: process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com',
        marketplaceId: process.env.MARKETPLACE_ID || 'A21TJRUUN4KGV',
    };
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
    if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    _accessToken = data.access_token;
    _tokenExpiry = Date.now() + data.expires_in * 1000;
    return _accessToken;
}

async function spApiGet(path, params = {}) {
    const cfg = getAmazonConfig();
    const token = await getAccessToken();
    const url = new URL(`${cfg.endpoint}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), {
        headers: {
            'x-amz-access-token': token,
            'Content-Type': 'application/json',
        },
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`SP-API ${path}: ${res.status} ${err}`);
    }
    return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──
(async () => {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  Checking OPEN orders blocking "Finalized Till" date        ║');
    console.log('║  Querying Amazon Orders API for real status                 ║');
    console.log('╚══════════════════════════════════════════════════════════════╝\n');

    // 1. Get all non-closed orders after Sept 7, 2025
    const { data: openOrders } = await supabase
        .from('orders')
        .select('amazon_order_id, purchase_date, order_status, financial_status, settlement_status, delivery_date')
        .gt('purchase_date', '2025-09-07')
        .not('financial_status', 'eq', 'FINANCIALLY_CLOSED')
        .order('purchase_date', { ascending: true });

    console.log(`Found ${(openOrders || []).length} non-closed orders after 2025-09-07\n`);

    if (!openOrders || openOrders.length === 0) {
        console.log('No blocking orders found!');
        return;
    }

    console.log('─'.repeat(130));
    console.log(
        'Order ID'.padEnd(22),
        'DB Date'.padEnd(14),
        'DB Status'.padEnd(14),
        'DB FinStatus'.padEnd(16),
        '│',
        'Amazon Status'.padEnd(14),
        'Amazon Ship'.padEnd(14),
        'Amazon Delivery'.padEnd(18),
        'FulfillChannel'.padEnd(10),
        'ItemStatus'
    );
    console.log('─'.repeat(130));

    for (const order of openOrders) {
        const dbDate = (order.purchase_date || '').slice(0, 10);
        const dbStatus = order.order_status || 'N/A';
        const dbFinStatus = order.financial_status || 'OPEN';

        let amazonStatus = '?';
        let amazonShip = '?';
        let amazonDelivery = '?';
        let fulfillChannel = '?';
        let itemStatuses = '?';

        try {
            // Call Amazon Orders API - getOrder
            const orderData = await spApiGet(`/orders/v0/orders/${order.amazon_order_id}`);
            const payload = orderData.payload || orderData;
            amazonStatus = payload.OrderStatus || '?';
            amazonShip = payload.EarliestShipDate ? payload.EarliestShipDate.slice(0, 10) : '—';
            amazonDelivery = payload.LatestDeliveryDate ? payload.LatestDeliveryDate.slice(0, 10) : '—';
            fulfillChannel = payload.FulfillmentChannel || '?';

            // Also check order items
            await sleep(300); // rate limit
            try {
                const itemsData = await spApiGet(`/orders/v0/orders/${order.amazon_order_id}/orderItems`);
                const items = itemsData.payload?.OrderItems || itemsData.OrderItems || [];
                itemStatuses = items.map(i => `${i.QuantityOrdered}x${i.QuantityShipped || 0}ship`).join(', ') || 'no items';
            } catch (e) {
                itemStatuses = `err: ${e.message.slice(0, 30)}`;
            }
        } catch (e) {
            amazonStatus = `ERR: ${e.message.slice(0, 40)}`;
        }

        console.log(
            order.amazon_order_id.padEnd(22),
            dbDate.padEnd(14),
            dbStatus.padEnd(14),
            dbFinStatus.padEnd(16),
            '│',
            amazonStatus.padEnd(14),
            amazonShip.padEnd(14),
            amazonDelivery.padEnd(18),
            fulfillChannel.padEnd(10),
            itemStatuses
        );

        await sleep(500); // respect rate limits
    }

    console.log('─'.repeat(130));
    console.log('\nDone. Compare DB Status vs Amazon Status to identify stale/ghost orders.');
})();

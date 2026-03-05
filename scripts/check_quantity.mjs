#!/usr/bin/env node
// ============================================================================
// Quantity Cross-Check: Amazon Orders API vs financial_events DB
// ============================================================================
// Picks sample orders, calls Amazon Order Items API for actual QuantityOrdered,
// then compares with what's stored in financial_events table.

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
    if (!res.ok) throw new Error(`LWA token failed: ${res.status}`);
    const data = await res.json();
    _accessToken = data.access_token;
    _tokenExpiry = Date.now() + data.expires_in * 1000;
    return _accessToken;
}

async function spGet(path) {
    const cfg = getAmazonConfig();
    const token = await getAccessToken();
    const res = await fetch(`${cfg.endpoint}${path}`, {
        headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`SP-API ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──
async function main() {
    console.log('╔══════════════════════════════════════════════════════════════');
    console.log('║  Quantity Cross-Check: Amazon Orders API vs DB');
    console.log('╚══════════════════════════════════════════════════════════════\n');

    // 1. Get some unique order IDs from financial_events (shipment type)
    console.log('Fetching sample order IDs from financial_events...');
    const { data: sampleEvents, error: evErr } = await supabase
        .from('financial_events')
        .select('amazon_order_id')
        .eq('event_type', 'shipment')
        .not('amazon_order_id', 'is', null)
        .order('posted_date', { ascending: false })
        .limit(100);

    if (evErr) { console.error('DB error:', evErr.message); return; }

    const uniqueOrderIds = [...new Set((sampleEvents || []).map(e => e.amazon_order_id))].slice(0, 5);
    console.log(`Found ${uniqueOrderIds.length} unique orders to check\n`);

    let totalMismatches = 0;

    for (const orderId of uniqueOrderIds) {
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`ORDER: ${orderId}`);
        console.log(`${'═'.repeat(70)}`);

        // ── A. Get financial_events from DB for this order ──
        const { data: dbEvents } = await supabase
            .from('financial_events')
            .select('event_type, amount, quantity, fee_type, sku, reference_id')
            .eq('amazon_order_id', orderId)
            .order('event_type');

        const shipmentEvts = (dbEvents || []).filter(e => e.event_type === 'shipment');
        const feeEvts = (dbEvents || []).filter(e => e.event_type === 'fee');
        const refundEvts = (dbEvents || []).filter(e => e.event_type === 'refund');

        console.log(`\n  DB financial_events (total: ${(dbEvents || []).length}):`);
        console.log(`    Shipment rows: ${shipmentEvts.length}`);
        console.log(`    Fee rows:      ${feeEvts.length}`);
        console.log(`    Refund rows:   ${refundEvts.length}`);

        // Sum qty from shipment events (how revenue engine does it)
        const dbQtySum = shipmentEvts.reduce((s, e) => s + (Number(e.quantity) || 0), 0);
        console.log(`    Sum of qty across ALL shipment rows: ${dbQtySum}`);

        // Show each shipment event
        console.log(`\n  Shipment events detail:`);
        for (const e of shipmentEvts) {
            console.log(`    qty=${String(e.quantity).padStart(2)}  amt=${String(e.amount).padStart(10)}  sku=${(e.sku || '-').padEnd(20)}  ref=${e.reference_id || '-'}`);
        }

        // ── B. Get from order_items table (what the sync stored from Orders API) ──
        const { data: dbItems } = await supabase
            .from('order_items')
            .select('sku, asin, quantity_ordered, item_price')
            .eq('amazon_order_id', orderId);

        if (dbItems && dbItems.length > 0) {
            const dbItemsQty = dbItems.reduce((s, i) => s + (Number(i.quantity_ordered) || 0), 0);
            console.log(`\n  order_items table (${dbItems.length} rows, total qty: ${dbItemsQty}):`);
            for (const item of dbItems) {
                console.log(`    sku=${(item.sku || '-').padEnd(20)} qty=${item.quantity_ordered}  price=${item.item_price}`);
            }
        }

        // ── C. Call Amazon Order Items API directly ──
        try {
            const apiData = await spGet(`/orders/v0/orders/${orderId}/orderItems`);
            const apiItems = apiData.payload?.OrderItems || [];

            const apiQty = apiItems.reduce((s, i) => s + (Number(i.QuantityOrdered) || 0), 0);

            console.log(`\n  Amazon Orders API (${apiItems.length} items, total QuantityOrdered: ${apiQty}):`);
            for (const item of apiItems) {
                console.log(`    sku=${(item.SellerSKU || '-').padEnd(20)} QtyOrdered=${item.QuantityOrdered}  QtyShipped=${item.QuantityShipped || 0}  price=${item.ItemPrice?.Amount || 0}`);
            }

            // ── D. Compare ──
            console.log(`\n  ┌─────────────────────────────────────────────────┐`);
            console.log(`  │  COMPARISON:                                    │`);
            console.log(`  │  Amazon API QuantityOrdered:  ${String(apiQty).padStart(4)}               │`);
            console.log(`  │  DB financial_events qty sum: ${String(dbQtySum).padStart(4)}               │`);
            if (dbQtySum > apiQty) {
                console.log(`  │  ⚠️  INFLATED by ${(dbQtySum / apiQty).toFixed(1)}x (${dbQtySum - apiQty} extra)      │`);
                totalMismatches++;
            } else if (dbQtySum === apiQty) {
                console.log(`  │  ✅ MATCH                                       │`);
            } else {
                console.log(`  │  ⚠️  UNDER-COUNTED by ${apiQty - dbQtySum}                    │`);
                totalMismatches++;
            }
            console.log(`  └─────────────────────────────────────────────────┘`);

        } catch (err) {
            console.log(`\n  ⚠ Amazon API call failed: ${err.message.slice(0, 100)}`);
        }

        // Rate limit - wait between API calls
        await sleep(1200);
    }

    // ── Summary ──
    console.log(`\n\n${'═'.repeat(70)}`);
    console.log(`SUMMARY: ${totalMismatches} of ${uniqueOrderIds.length} orders have quantity mismatches`);
    console.log(`${'═'.repeat(70)}`);

    if (totalMismatches > 0) {
        console.log(`\nROOT CAUSE ANALYSIS:`);
        console.log(`The sync script (amazon-full-sync.mjs, lines 534-552) creates one`);
        console.log(`financial_events row per ItemChargeList entry for each shipment item.`);
        console.log(`Each charge row (Principal, ShippingCharge, Tax, etc.) gets the SAME`);
        console.log(`QuantityShipped stored in its 'quantity' field.`);
        console.log(`\nThe revenue engine (revenue-engine.ts, line 279) sums quantities`);
        console.log(`across ALL shipment events: rec.quantity += Number(evt.quantity)`);
        console.log(`\nSo if an item has 3 charges, quantity is counted 3x.`);
        console.log(`\nFIX: Only count quantity from the FIRST/Principal shipment charge,`);
        console.log(`or better — set quantity=0 on non-Principal charge rows.`);
    }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });

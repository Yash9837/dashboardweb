#!/usr/bin/env node
// ============================================================================
// FORCE RESYNC — Complete Amazon SP-API → Supabase Data Repair
// ============================================================================
// Unlike amazon-full-sync.mjs, this script:
//   ✅ Force re-fetches ALL settlement groups (not just ones without items)
//   ✅ Deletes + re-inserts settlement_items for EVERY group
//   ✅ Updates ALL orders with latest status from Amazon
//   ✅ Re-syncs ALL financial events with full date coverage
//   ✅ Recomputes aggregations from scratch
//
// Tables synced (in FK order):
//   1. orders          — full upsert from Orders API (status, dates, address)
//   2. financial_events — full replace from Finances API (30-day windows)
//   3. financial_event_groups — upsert from event groups API
//   4. settlement_periods     — upsert (derived from groups)
//   5. settlement_items       — DELETE ALL + re-insert for EVERY group
//   6. sku_daily_metrics      — recompute from financial_events
//   7. account_daily_metrics  — recompute from sku_daily_metrics
//
// Usage:
//   node scripts/force-resync.mjs
//   node scripts/force-resync.mjs --dry-run
//   node scripts/force-resync.mjs --from=2024-06-01
//   node scripts/force-resync.mjs --step=settlements   (only run settlements)
//   node scripts/force-resync.mjs --step=orders         (only run orders)
//   node scripts/force-resync.mjs --step=events         (only run events)
//   node scripts/force-resync.mjs --step=aggregations   (only recompute)
// ============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env.local ──────────────────────────────────────────────────────────
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
  } catch { console.warn('[env] .env.local not found — relying on process environment'); }
}
loadEnv();

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const fromArg = args.find(a => a.startsWith('--from='));
const stepArg = args.find(a => a.startsWith('--step='));
const ONLY_STEP = stepArg ? stepArg.split('=')[1] : null;

const DEFAULT_ORDER_DAYS = 730;    // 2 years
const DEFAULT_FINANCE_DAYS = 548;  // ~18 months (Amazon max)
const FROM_DATE = fromArg ? fromArg.split('=')[1] : null;
const BATCH = 200;

// ── Supabase ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('❌ Missing SUPABASE env vars'); process.exit(1); }
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Amazon SP-API auth ───────────────────────────────────────────────────────
let _token = null, _tokenExp = 0;
function getCfg() {
  const c = {
    clientId: process.env.LWA_CLIENT_ID,
    clientSecret: process.env.LWA_CLIENT_SECRET,
    refreshToken: process.env.LWA_REFRESH_TOKEN,
    endpoint: process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com',
    marketplaceId: process.env.MARKETPLACE_ID || 'A21TJRUUN4KGV',
  };
  if (!c.clientId || !c.clientSecret || !c.refreshToken) throw new Error('Missing LWA credentials');
  return c;
}

async function getToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const cfg = getCfg();
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', refresh_token: cfg.refreshToken,
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
    }).toString(),
  });
  if (!res.ok) throw new Error(`LWA token: ${res.status} ${await res.text()}`);
  const d = await res.json();
  _token = d.access_token; _tokenExp = Date.now() + d.expires_in * 1000;
  return _token;
}

async function spGet(path, params = {}, retries = 5) {
  const cfg = getCfg();
  const token = await getToken();
  const url = new URL(`${cfg.endpoint}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      const wait = Math.min(5000 * Math.pow(2, attempt), 60000);
      warn(`429 on ${path} — backing off ${(wait / 1000).toFixed(0)}s (${attempt + 1}/${retries})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`SP-API ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
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
  return 0;
}
function log(msg) { console.log(`  ${msg}`); }
function warn(msg) { console.warn(`  ⚠  ${msg}`); }
function header(name) { console.log(`\n╔══ ${name} ${'═'.repeat(Math.max(0, 60 - name.length))}`);}
function done(name, stats) { console.log(`╚══ ✅ ${name}: ${JSON.stringify(stats)}`); }

async function batchUpsert(table, rows, conflict) {
  if (DRY_RUN) { log(`[dry-run] Would upsert ${rows.length} → ${table}`); return rows.length; }
  let count = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflict, ignoreDuplicates: false });
    if (error) warn(`${table} upsert error (batch ${Math.ceil(i / BATCH) + 1}): ${error.message}`);
    else count += chunk.length;
  }
  return count;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  STEP 1: ORDERS — Full re-fetch + upsert                                ║
// ╚════════════════════════════════════════════════════════════════════════════╝
async function syncOrders() {
  header('Step 1: Orders (Orders API)');
  const cfg = getCfg();
  const createdAfter = FROM_DATE
    ? new Date(FROM_DATE).toISOString()
    : new Date(Date.now() - DEFAULT_ORDER_DAYS * 86400000).toISOString();

  log(`Fetching ALL orders since ${createdAfter.slice(0, 10)}…`);

  const allOrders = [];
  let nextToken, page = 0;
  do {
    page++;
    const params = nextToken
      ? { NextToken: nextToken }
      : { MarketplaceIds: cfg.marketplaceId, CreatedAfter: createdAfter, MaxResultsPerPage: '100' };
    const data = await spGet('/orders/v0/orders', params);
    const orders = data.payload?.Orders || [];
    allOrders.push(...orders);
    nextToken = data.payload?.NextToken;
    log(`  Page ${page}: +${orders.length} (total: ${allOrders.length})${nextToken ? ' …more' : ''}`);
    if (nextToken) await sleep(1100);
  } while (nextToken);

  log(`Fetched ${allOrders.length} orders from Amazon`);

  // ── Map to DB columns (orders table) ──
  // Columns: amazon_order_id, account_id, purchase_date, shipment_date, delivery_date,
  //          order_status, order_total, currency, fulfillment_channel, is_prime,
  //          ship_city, ship_state, ship_postal_code
  // (financial_status, settlement_status etc. are NOT overwritten — those are computed)
  const rows = allOrders.map(o => ({
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
    ship_city: o.ShippingAddress?.City || null,
    ship_state: o.ShippingAddress?.StateOrRegion || null,
    ship_postal_code: o.ShippingAddress?.PostalCode || null,
  }));

  const count = await batchUpsert('orders', rows, 'amazon_order_id');
  done('Orders', { fetched: allOrders.length, upserted: count });
  return allOrders;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  STEP 2: FINANCIAL EVENTS — Full re-fetch in 30-day windows             ║
// ╚════════════════════════════════════════════════════════════════════════════╝
async function syncFinancialEvents() {
  header('Step 2: Financial Events (Finances API — 30-day windows)');

  const startDate = FROM_DATE
    ? new Date(FROM_DATE)
    : new Date(Date.now() - DEFAULT_FINANCE_DAYS * 86400000);
  const endDate = new Date(Date.now() - 5 * 60 * 1000); // Amazon rejects future dates

  // Load delivery dates for revenue state
  const { data: ordersData } = await supabase.from('orders').select('amazon_order_id, delivery_date');
  const deliveryMap = new Map((ordersData || []).map(o => [o.amazon_order_id, o.delivery_date]));
  log(`Loaded ${deliveryMap.size} order delivery dates`);

  // Build 30-day windows
  const windows = [];
  let wStart = new Date(startDate);
  while (wStart < endDate) {
    const wEnd = new Date(Math.min(wStart.getTime() + 30 * 86400000, endDate.getTime()));
    windows.push({ from: wStart.toISOString(), to: wEnd.toISOString() });
    wStart = new Date(wEnd);
  }
  log(`Date range: ${startDate.toISOString().slice(0, 10)} → ${endDate.toISOString().slice(0, 10)} (${windows.length} windows)`);

  const allPages = [];
  for (let wi = 0; wi < windows.length; wi++) {
    const { from, to } = windows[wi];
    log(`  Window [${wi + 1}/${windows.length}]: ${from.slice(0, 10)} → ${to.slice(0, 10)}`);
    let nextToken, pg = 0;
    do {
      pg++;
      const params = { PostedAfter: from, PostedBefore: to, MaxResultsPerPage: '100' };
      if (nextToken) params.NextToken = nextToken;
      const data = await spGet('/finances/v0/financialEvents', params);
      if (data.payload?.FinancialEvents) allPages.push(data.payload.FinancialEvents);
      nextToken = data.payload?.NextToken;
      if (nextToken) await sleep(2100);
    } while (nextToken);
    if (wi < windows.length - 1) await sleep(1000);
  }
  log(`Fetched ${allPages.length} event pages from Amazon`);

  // ── Build ledger rows ──
  // DB columns: account_id, amazon_order_id, sku, event_type, amount, quantity,
  //             currency, posted_date, delivery_date, fee_type, reference_id
  const ledger = [];

  for (const page of allPages) {
    // Shipment events → revenue + fees
    for (const evt of (page.ShipmentEventList || [])) {
      const orderId = evt.AmazonOrderId || '';
      const delivery = deliveryMap.get(orderId) || null;
      for (const item of (evt.ShipmentItemList || [])) {
        const sku = item.SellerSKU || 'UNKNOWN';
        const qty = item.QuantityShipped || 1;
        for (const charge of (item.ItemChargeList || [])) {
          const a = toAmount(charge.ChargeAmount);
          if (!a) continue;
          ledger.push({
            account_id: 'default', amazon_order_id: orderId, sku,
            event_type: 'shipment', amount: a, quantity: qty,
            currency: charge.ChargeAmount?.CurrencyCode || 'INR',
            posted_date: evt.PostedDate, delivery_date: delivery,
            reference_id: `${orderId}-${sku}-${charge.ChargeType || 'Principal'}`,
          });
        }
        for (const fee of (item.ItemFeeList || [])) {
          const a = toAmount(fee.FeeAmount);
          if (!a) continue;
          ledger.push({
            account_id: 'default', amazon_order_id: orderId, sku,
            event_type: 'fee', amount: a, quantity: 0,
            currency: fee.FeeAmount?.CurrencyCode || 'INR',
            posted_date: evt.PostedDate,
            fee_type: fee.FeeType || 'unknown',
            reference_id: `${orderId}-${sku}-fee-${fee.FeeType || 'unknown'}`,
          });
        }
      }
    }

    // Refund events
    for (const evt of (page.RefundEventList || [])) {
      const orderId = evt.AmazonOrderId || '';
      for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
        const sku = item.SellerSKU || 'UNKNOWN';
        const qty = item.QuantityShipped || 1;
        for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
          const a = toAmount(charge.ChargeAmount);
          if (!a) continue;
          ledger.push({
            account_id: 'default', amazon_order_id: orderId, sku,
            event_type: 'refund', amount: a, quantity: -Math.abs(qty),
            currency: charge.ChargeAmount?.CurrencyCode || 'INR',
            posted_date: evt.PostedDate,
            reference_id: `${orderId}-${sku}-refund-${charge.ChargeType || 'Principal'}`,
          });
        }
      }
    }

    // Service fee events
    for (const evt of (page.ServiceFeeEventList || [])) {
      for (const fee of (evt.FeeList || [])) {
        const a = toAmount(fee.FeeAmount);
        if (!a) continue;
        ledger.push({
          account_id: 'default',
          amazon_order_id: evt.AmazonOrderId || null,
          sku: evt.SellerSKU || null,
          event_type: 'fee', amount: a, quantity: 0,
          currency: fee.FeeAmount?.CurrencyCode || 'INR',
          posted_date: evt.PostedDate || new Date().toISOString(),
          fee_type: fee.FeeType || evt.FeeReason || 'service_fee',
          reference_id: `svc-${evt.AmazonOrderId || 'none'}-${fee.FeeType || 'unknown'}`,
        });
      }
    }

    // Adjustment events
    for (const evt of (page.AdjustmentEventList || [])) {
      for (const item of (evt.AdjustmentItemList || [])) {
        const a = toAmount(item.TotalAmount);
        if (!a) continue;
        ledger.push({
          account_id: 'default', amazon_order_id: null,
          sku: item.SellerSKU || null,
          event_type: 'adjustment', amount: a, quantity: item.Quantity || 0,
          currency: item.TotalAmount?.CurrencyCode || 'INR',
          posted_date: evt.PostedDate || new Date().toISOString(),
          reference_id: `adj-${evt.AdjustmentType || 'unknown'}-${item.SellerSKU || 'none'}-${evt.PostedDate || Date.now()}`,
        });
      }
    }
  }

  // Dedup by (event_type, reference_id)
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
  log(`Built ${ledger.length} → ${deduped.length} after dedup`);

  // Resolve unknown SKUs on fee events
  const orderSkuMap = new Map();
  for (const r of deduped) {
    if (r.event_type === 'shipment' && r.amazon_order_id && r.sku && r.sku !== 'UNKNOWN') {
      if (!orderSkuMap.has(r.amazon_order_id)) orderSkuMap.set(r.amazon_order_id, r.sku);
    }
  }
  let resolved = 0;
  for (const r of deduped) {
    if (r.event_type === 'fee' && r.amazon_order_id && (!r.sku || r.sku === 'UNKNOWN')) {
      const s = orderSkuMap.get(r.amazon_order_id);
      if (s) { r.sku = s; resolved++; }
    }
  }
  if (resolved > 0) log(`Resolved ${resolved} fee events → their order's SKU`);

  // Write: delete by reference_id, then insert
  if (!DRY_RUN && deduped.length > 0) {
    const withRef = deduped.filter(r => r.reference_id);
    const withoutRef = deduped.filter(r => !r.reference_id);

    const refIds = [...new Set(withRef.map(r => r.reference_id))];
    log(`Deleting ${refIds.length} existing reference_ids…`);
    for (let i = 0; i < refIds.length; i += 100) {
      await supabase.from('financial_events').delete().in('reference_id', refIds.slice(i, i + 100));
    }

    log(`Inserting ${withRef.length} events with reference_id…`);
    let inserted = 0;
    for (let i = 0; i < withRef.length; i += BATCH) {
      const chunk = withRef.slice(i, i + BATCH);
      const { error } = await supabase.from('financial_events').insert(chunk);
      if (error) warn(`financial_events insert: ${error.message}`);
      else inserted += chunk.length;
    }

    for (let i = 0; i < withoutRef.length; i += BATCH) {
      const chunk = withoutRef.slice(i, i + BATCH);
      const { error } = await supabase.from('financial_events').insert(chunk);
      if (error && !error.message.includes('duplicate')) warn(`financial_events (no-ref): ${error.message}`);
      else inserted += chunk.length;
    }
    done('Financial Events', { total: deduped.length, inserted });
  } else {
    done('Financial Events', { total: deduped.length, dryRun: true });
  }

  return deduped;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  STEP 3: SETTLEMENT GROUPS + PERIODS + ITEMS — FORCE ALL                ║
// ║  🔧 THE KEY FIX: Re-fetches items for ALL groups, not just new ones     ║
// ╚════════════════════════════════════════════════════════════════════════════╝
async function syncSettlements() {
  header('Step 3: Settlements — FORCE ALL GROUPS');

  const startedAfter = FROM_DATE
    ? new Date(FROM_DATE).toISOString()
    : new Date(Date.now() - DEFAULT_FINANCE_DAYS * 86400000).toISOString();

  log(`Fetching event groups since ${startedAfter.slice(0, 10)}…`);

  // 3a. Fetch all financial event groups
  const allGroups = [];
  let nextToken, page = 0;
  do {
    page++;
    const params = { FinancialEventGroupStartedAfter: startedAfter, MaxResultsPerPage: '100' };
    if (nextToken) params.NextToken = nextToken;
    const data = await spGet('/finances/v0/financialEventGroups', params);
    const groups = data.payload?.FinancialEventGroupList || [];
    allGroups.push(...groups);
    nextToken = data.payload?.NextToken;
    log(`  Page ${page}: +${groups.length} (total: ${allGroups.length})`);
    if (nextToken) await sleep(2100);
  } while (nextToken);
  log(`Total event groups: ${allGroups.length}`);

  // 3b. Upsert financial_event_groups
  // DB columns: event_group_id, account_id, processing_status, fund_transfer_status,
  //             fund_transfer_date, original_total, beginning_balance, trace_id
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
  await batchUpsert('financial_event_groups', groupRows, 'event_group_id');
  log(`Upserted ${groupRows.length} groups`);

  // 3c. Upsert settlement_periods
  // DB columns: settlement_id, account_id, financial_event_group_start, financial_event_group_end,
  //             fund_transfer_date, original_total, converted_total, currency, processing_status
  const periodRows = allGroups.map(g => ({
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
  await batchUpsert('settlement_periods', periodRows, 'settlement_id');
  log(`Upserted ${periodRows.length} settlement periods`);

  // 3d. ★ FORCE FETCH settlement_items for ALL groups ★
  // This is the critical fix — old sync skipped groups that already had items
  log(`\n  ★ FORCE-FETCHING settlement items for ALL ${allGroups.length} groups ★`);
  log(`  (Amazon rate limit: ~0.5 req/s — this will take ~${Math.ceil(allGroups.length * 3 / 60)} minutes)\n`);

  let totalItems = 0, totalLinked = 0, errors = 0;

  for (let gi = 0; gi < allGroups.length; gi++) {
    const group = allGroups[gi];
    const groupId = group.FinancialEventGroupId;
    const pct = Math.round(((gi + 1) / allGroups.length) * 100);

    try {
      // Fetch all event pages for this group
      const eventPages = [];
      let nt;
      do {
        const params = {};
        if (nt) params.NextToken = nt;
        const data = await spGet(`/finances/v0/financialEventGroups/${groupId}/financialEvents`, params);
        if (data.payload?.FinancialEvents) eventPages.push(data.payload.FinancialEvents);
        nt = data.payload?.NextToken;
        if (nt) await sleep(2100);
      } while (nt);

      // Build settlement_items rows
      // DB columns: settlement_id, amazon_order_id, sku, transaction_type,
      //             amount_type, amount_description, amount, quantity, posted_date
      const items = [];

      for (const pg of eventPages) {
        // Shipment events → Order items
        for (const evt of (pg.ShipmentEventList || [])) {
          for (const item of (evt.ShipmentItemList || [])) {
            for (const charge of (item.ItemChargeList || [])) {
              const a = toAmount(charge.ChargeAmount);
              if (!a) continue;
              items.push({
                settlement_id: groupId,
                amazon_order_id: evt.AmazonOrderId || null,
                sku: item.SellerSKU || null,
                transaction_type: 'Order',
                amount_type: 'ItemPrice',
                amount_description: charge.ChargeType || 'Principal',
                amount: a,
                quantity: item.QuantityShipped || 1,
                posted_date: evt.PostedDate,
              });
            }
            for (const fee of (item.ItemFeeList || [])) {
              const a = toAmount(fee.FeeAmount);
              if (!a) continue;
              items.push({
                settlement_id: groupId,
                amazon_order_id: evt.AmazonOrderId || null,
                sku: item.SellerSKU || null,
                transaction_type: 'Order',
                amount_type: 'ItemFees',
                amount_description: fee.FeeType || 'Fee',
                amount: a,
                quantity: 0,
                posted_date: evt.PostedDate,
              });
            }
            // Item promotions
            for (const promo of (item.PromotionList || [])) {
              const a = toAmount(promo.PromotionAmount);
              if (!a) continue;
              items.push({
                settlement_id: groupId,
                amazon_order_id: evt.AmazonOrderId || null,
                sku: item.SellerSKU || null,
                transaction_type: 'Order',
                amount_type: 'Promotion',
                amount_description: promo.PromotionType || 'Promotion',
                amount: a,
                quantity: 0,
                posted_date: evt.PostedDate,
              });
            }
          }
        }

        // Refund events
        for (const evt of (pg.RefundEventList || [])) {
          for (const item of (evt.ShipmentItemAdjustmentList || evt.ShipmentItemList || [])) {
            for (const charge of (item.ItemChargeAdjustmentList || item.ItemChargeList || [])) {
              const a = toAmount(charge.ChargeAmount);
              if (!a) continue;
              items.push({
                settlement_id: groupId,
                amazon_order_id: evt.AmazonOrderId || null,
                sku: item.SellerSKU || null,
                transaction_type: 'Refund',
                amount_type: 'ItemPrice',
                amount_description: charge.ChargeType || 'RefundPrincipal',
                amount: a,
                quantity: -(item.QuantityShipped || 1),
                posted_date: evt.PostedDate,
              });
            }
            // Refund fees
            for (const fee of (item.ItemFeeAdjustmentList || item.ItemFeeList || [])) {
              const a = toAmount(fee.FeeAmount);
              if (!a) continue;
              items.push({
                settlement_id: groupId,
                amazon_order_id: evt.AmazonOrderId || null,
                sku: item.SellerSKU || null,
                transaction_type: 'Refund',
                amount_type: 'ItemFees',
                amount_description: fee.FeeType || 'RefundFee',
                amount: a,
                quantity: 0,
                posted_date: evt.PostedDate,
              });
            }
          }
        }

        // Service fee events
        for (const evt of (pg.ServiceFeeEventList || [])) {
          for (const fee of (evt.FeeList || [])) {
            const a = toAmount(fee.FeeAmount);
            if (!a) continue;
            items.push({
              settlement_id: groupId,
              amazon_order_id: evt.AmazonOrderId || null,
              sku: evt.SellerSKU || null,
              transaction_type: 'ServiceFee',
              amount_type: 'Other',
              amount_description: fee.FeeType || 'ServiceFee',
              amount: a,
              quantity: 0,
              posted_date: null,
            });
          }
        }

        // Adjustment events
        for (const evt of (pg.AdjustmentEventList || [])) {
          for (const item of (evt.AdjustmentItemList || [])) {
            const a = toAmount(item.TotalAmount);
            if (!a) continue;
            items.push({
              settlement_id: groupId,
              amazon_order_id: null,
              sku: item.SellerSKU || null,
              transaction_type: 'Adjustment',
              amount_type: 'Other',
              amount_description: evt.AdjustmentType || 'Adjustment',
              amount: a,
              quantity: item.Quantity || 0,
              posted_date: evt.PostedDate,
            });
          }
        }
      }

      // Delete ALL old items for this group, then re-insert
      if (!DRY_RUN) {
        await supabase.from('settlement_items').delete().eq('settlement_id', groupId);
        if (items.length > 0) {
          for (let i = 0; i < items.length; i += BATCH) {
            const chunk = items.slice(i, i + BATCH);
            const { error } = await supabase.from('settlement_items').insert(chunk);
            if (error) { warn(`Items insert ${groupId}: ${error.message}`); errors++; }
          }
        }
      }

      totalItems += items.length;

      // Link financial_events to this group by posted_date window
      if (!DRY_RUN && group.FinancialEventGroupStart && group.FinancialEventGroupEnd) {
        const { data: linked } = await supabase
          .from('financial_events')
          .update({ event_group_id: groupId })
          .gte('posted_date', group.FinancialEventGroupStart)
          .lte('posted_date', group.FinancialEventGroupEnd)
          .is('event_group_id', null)
          .select('id');
        if (linked) totalLinked += linked.length;
      }

      const status = group.ProcessingStatus === 'Closed' ? '✅' : '🔵';
      log(`  ${status} [${gi + 1}/${allGroups.length}] ${pct}% | ${groupId.slice(0, 20)}… ${items.length} items | xfer=${group.FundTransferStatus || '?'} total=₹${toAmount(group.OriginalTotal)}`);

      await sleep(1200); // Rate limit buffer
    } catch (err) {
      warn(`Group ${groupId}: ${err.message?.slice(0, 120)}`);
      errors++;
      await sleep(3000); // Extra delay after error
    }
  }

  done('Settlements', {
    groups: allGroups.length,
    totalItems,
    eventsLinked: totalLinked,
    errors,
  });

  return allGroups;
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  STEP 4: RECOMPUTE AGGREGATIONS                                          ║
// ╚════════════════════════════════════════════════════════════════════════════╝
async function recomputeAggregations() {
  header('Step 4: Recomputing sku_daily_metrics + account_daily_metrics');

  const RETURN_WINDOW_DAYS = 30;
  const lockCutoff = new Date(Date.now() - RETURN_WINDOW_DAYS * 86400000);

  // Load all events from DB (paginated)
  log('Loading all financial_events (paginated)…');
  const events = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('financial_events').select('*')
      .order('posted_date', { ascending: true })
      .range(from, from + 999);
    if (error) { warn(`Load events: ${error.message}`); break; }
    if (!data || data.length === 0) break;
    events.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  log(`Loaded ${events.length} events`);

  if (events.length === 0) { done('Aggregations', { skipped: 'no events' }); return; }

  const { data: skuData } = await supabase.from('skus').select('sku, cost_per_unit');
  const costMap = new Map((skuData || []).map(s => [s.sku, Number(s.cost_per_unit) || 0]));

  // Identify refunded order-sku combos
  const refundedKeys = new Set();
  for (const e of events) {
    if (e.event_type === 'refund') refundedKeys.add(`${e.amazon_order_id}-${e.sku}`);
  }

  // Build SKU daily aggregations
  const skuMap = new Map();
  for (const evt of events) {
    const dateKey = new Date(evt.posted_date).toISOString().slice(0, 10);
    const sku = evt.sku || 'UNKNOWN';
    const mk = `${sku}|${dateKey}`;
    if (!skuMap.has(mk)) {
      skuMap.set(mk, {
        date: dateKey, sku, revenue_live: 0, revenue_locked: 0,
        units_sold_live: 0, units_sold_locked: 0, refund_amount: 0, refund_units: 0,
        ad_spend: 0, fee_amount: 0,
      });
    }
    const a = skuMap.get(mk);
    if (evt.event_type === 'shipment') {
      const isRefunded = refundedKeys.has(`${evt.amazon_order_id}-${evt.sku}`);
      const delivery = evt.delivery_date ? new Date(evt.delivery_date) : null;
      const isLocked = delivery && delivery < lockCutoff && !isRefunded;
      a.revenue_live += evt.amount; a.units_sold_live += evt.quantity;
      if (isLocked) { a.revenue_locked += evt.amount; a.units_sold_locked += evt.quantity; }
    } else if (evt.event_type === 'refund') {
      a.refund_amount += Math.abs(evt.amount); a.refund_units += Math.abs(evt.quantity);
    } else if (evt.event_type === 'fee') {
      a.fee_amount += Math.abs(evt.amount);
    } else if (evt.event_type === 'ad_spend') {
      a.ad_spend += Math.abs(evt.amount);
    }
  }

  // Map to sku_daily_metrics columns:
  // date, sku, revenue_live, revenue_locked, units_sold_live, units_sold_locked,
  // refund_amount, refund_units, ad_spend, net_contribution, margin_percent, tacos, return_rate
  const skuRows = [...skuMap.values()].map(a => {
    const cost = costMap.get(a.sku) || 0;
    const net = a.revenue_live - a.fee_amount - cost * a.units_sold_live - a.ad_spend - a.refund_amount;
    const margin = a.revenue_live > 0 ? (net / a.revenue_live) * 100 : 0;
    const tacos = a.revenue_live > 0 ? (a.ad_spend / a.revenue_live) * 100 : 0;
    const rr = a.units_sold_live > 0 ? (a.refund_units / a.units_sold_live) * 100 : 0;
    return {
      date: a.date, sku: a.sku,
      revenue_live: Math.round(a.revenue_live * 100) / 100,
      revenue_locked: Math.round(a.revenue_locked * 100) / 100,
      units_sold_live: a.units_sold_live,
      units_sold_locked: a.units_sold_locked,
      refund_amount: Math.round(a.refund_amount * 100) / 100,
      refund_units: a.refund_units,
      ad_spend: Math.round(a.ad_spend * 100) / 100,
      net_contribution: Math.round(net * 100) / 100,
      margin_percent: Math.round(margin * 100) / 100,
      tacos: Math.round(tacos * 100) / 100,
      return_rate: Math.round(rr * 100) / 100,
    };
  });

  // Build account_daily_metrics
  // Columns: date, total_revenue_live, total_revenue_locked, net_contribution_live,
  //          net_contribution_locked, total_units_live, total_units_locked,
  //          total_refund_amount, total_fees, total_ad_spend, acos, total_profit, return_rate
  const accMap = new Map();
  for (const r of skuRows) {
    if (!accMap.has(r.date)) {
      accMap.set(r.date, {
        date: r.date, total_revenue_live: 0, total_revenue_locked: 0,
        net_contribution_live: 0, net_contribution_locked: 0,
        total_units_live: 0, total_units_locked: 0,
        total_refund_amount: 0, total_fees: 0, total_ad_spend: 0,
        total_refund_units: 0,
      });
    }
    const acc = accMap.get(r.date);
    acc.total_revenue_live += r.revenue_live;
    acc.total_revenue_locked += r.revenue_locked;
    acc.total_units_live += r.units_sold_live;
    acc.total_units_locked += r.units_sold_locked;
    acc.total_refund_amount += r.refund_amount;
    acc.net_contribution_live += r.net_contribution;
    acc.total_refund_units += r.refund_units;
  }

  const accRows = [...accMap.values()].map(a => {
    const rr = a.total_units_live > 0 ? Math.round((a.total_refund_units / a.total_units_live) * 10000) / 100 : 0;
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
    log(`Deleting old sku_daily_metrics…`);
    await supabase.from('sku_daily_metrics').delete().neq('sku', '__impossible__');
    log(`Inserting ${skuRows.length} sku_daily_metrics…`);
    for (let i = 0; i < skuRows.length; i += BATCH) {
      const chunk = skuRows.slice(i, i + BATCH);
      const { error } = await supabase.from('sku_daily_metrics').insert(chunk);
      if (error) warn(`sku_daily_metrics: ${error.message}`);
    }

    log(`Deleting old account_daily_metrics…`);
    await supabase.from('account_daily_metrics').delete().neq('date', '1900-01-01');
    log(`Inserting ${accRows.length} account_daily_metrics…`);
    for (let i = 0; i < accRows.length; i += BATCH) {
      const chunk = accRows.slice(i, i + BATCH);
      const { error } = await supabase.from('account_daily_metrics').insert(chunk);
      if (error) warn(`account_daily_metrics: ${error.message}`);
    }
  }

  done('Aggregations', {
    sku_daily_metrics: skuRows.length,
    account_daily_metrics: accRows.length,
  });
}

// ╔════════════════════════════════════════════════════════════════════════════╗
// ║  MAIN                                                                     ║
// ╚════════════════════════════════════════════════════════════════════════════╝
async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     FORCE RESYNC — Amazon SP-API → Supabase              ║');
  console.log(`║  Mode: ${(DRY_RUN ? 'DRY RUN' : 'LIVE   ')}  Step: ${(ONLY_STEP || 'ALL').padEnd(16)}             ║`);
  console.log('╚════════════════════════════════════════════════════════════╝');

  const START = Date.now();

  try {
    if (!ONLY_STEP || ONLY_STEP === 'orders') {
      await syncOrders();
    }

    if (!ONLY_STEP || ONLY_STEP === 'events') {
      await syncFinancialEvents();
    }

    if (!ONLY_STEP || ONLY_STEP === 'settlements') {
      await syncSettlements();
    }

    if (!ONLY_STEP || ONLY_STEP === 'aggregations') {
      await recomputeAggregations();
    }

    const elapsed = Date.now() - START;
    const mins = Math.floor(elapsed / 60000);
    const secs = Math.floor((elapsed % 60000) / 1000);

    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log(`║  ✅ FORCE RESYNC COMPLETE — ${mins}m ${secs}s${' '.repeat(Math.max(0, 30 - String(mins).length - String(secs).length))}║`);
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('  Next steps:');
    console.log('  1. Run: node scripts/audit_v3.js   (verify coverage improved)');
    console.log('  2. Trigger lifecycle detection from Command Center UI');
    console.log('  3. Check Financial Status tab for updated "Payments Finalized Till"');
    console.log('');

    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Fatal: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
}

main();

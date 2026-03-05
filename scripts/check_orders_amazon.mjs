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
  } catch { console.warn('.env.local not found'); }
}
loadEnv();

// Amazon auth
let _token = null, _tokenExp = 0;

async function getToken() {
  if (_token && Date.now() < _tokenExp - 60000) return _token;
  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.LWA_REFRESH_TOKEN,
      client_id: process.env.LWA_CLIENT_ID,
      client_secret: process.env.LWA_CLIENT_SECRET,
    }).toString(),
  });
  if (!res.ok) throw new Error(`LWA token: ${res.status} ${await res.text()}`);
  const d = await res.json();
  _token = d.access_token;
  _tokenExp = Date.now() + d.expires_in * 1000;
  return _token;
}

async function spGet(path, params = {}) {
  const token = await getToken();
  const endpoint = process.env.SP_API_ENDPOINT || 'https://sellingpartnerapi-eu.amazon.com';
  const url = new URL(`${endpoint}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { 'x-amz-access-token': token, 'Content-Type': 'application/json' },
    });
    if (res.ok) return res.json();
    if (res.status === 429) {
      const wait = Math.min(3000 * Math.pow(2, attempt), 30000);
      console.log(`  429 on ${path} — waiting ${(wait/1000).toFixed(0)}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    throw new Error(`SP-API ${path} -> ${res.status}: ${await res.text()}`);
  }
}

function toAmt(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'object') {
    if ('CurrencyAmount' in v) return parseFloat(v.CurrencyAmount) || 0;
    if ('Amount' in v) return parseFloat(v.Amount) || 0;
  }
  return parseFloat(String(v)) || 0;
}

const ORDERS = ['408-3478677-0341928', '405-3723375-1633911'];

async function main() {
  console.log('Fetching directly from Amazon SP-API...\n');

  for (const orderId of ORDERS) {
    console.log('='.repeat(80));
    console.log('ORDER:', orderId);
    console.log('='.repeat(80));

    // 1. Get order metadata
    try {
      const orderRes = await spGet(`/orders/v0/orders/${orderId}`);
      const o = orderRes.payload;
      console.log('\n  [Order Metadata]');
      console.log(`  Status: ${o.OrderStatus}`);
      console.log(`  PurchaseDate: ${o.PurchaseDate}`);
      console.log(`  LastUpdateDate: ${o.LastUpdateDate}`);
      console.log(`  FulfillmentChannel: ${o.FulfillmentChannel}`);
      console.log(`  OrderTotal: ${o.OrderTotal ? `${o.OrderTotal.CurrencyCode} ${o.OrderTotal.Amount}` : 'N/A'}`);
      console.log(`  IsPrime: ${o.IsPrime}`);
      console.log(`  EasyShipShipmentStatus: ${o.EasyShipShipmentStatus || 'N/A'}`);
    } catch (e) {
      console.log(`  [Order Metadata] Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1500)); // rate limit

    // 2. Get order items
    try {
      const itemsRes = await spGet(`/orders/v0/orders/${orderId}/orderItems`);
      const items = itemsRes.payload?.OrderItems || [];
      console.log(`\n  [Order Items] (${items.length} items)`);
      for (const item of items) {
        console.log(`  SKU: ${item.SellerSKU}, ASIN: ${item.ASIN}`);
        console.log(`    Title: ${item.Title?.slice(0, 60)}...`);
        console.log(`    Qty: ${item.QuantityOrdered}, Price: ${item.ItemPrice ? toAmt(item.ItemPrice) : 'N/A'}`);
        console.log(`    Tax: ${item.ItemTax ? toAmt(item.ItemTax) : 'N/A'}`);
        console.log(`    PromoDiscount: ${item.PromotionDiscount ? toAmt(item.PromotionDiscount) : 'N/A'}`);
      }
    } catch (e) {
      console.log(`  [Order Items] Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 1500));

    // 3. Get financial events for this order
    try {
      const finRes = await spGet(`/finances/v0/orders/${orderId}/financialEvents`);
      const payload = finRes.payload?.FinancialEvents || {};

      console.log('\n  [Financial Events from Amazon API]');

      // Shipment events
      const shipments = payload.ShipmentEventList || [];
      for (const evt of shipments) {
        console.log(`\n  ShipmentEvent: PostedDate=${evt.PostedDate}`);
        for (const item of (evt.ShipmentItemList || [])) {
          console.log(`    SKU=${item.SellerSKU} Qty=${item.QuantityShipped}`);

          // Charges
          for (const ch of (item.ItemChargeList || [])) {
            console.log(`      CHARGE: ${ch.ChargeType} = ${toAmt(ch.ChargeAmount)}`);
          }
          // Fees
          for (const fe of (item.ItemFeeList || [])) {
            console.log(`      FEE: ${fe.FeeType} = ${toAmt(fe.FeeAmount)}`);
          }
          // Tax withheld
          for (const tw of (item.ItemTaxWithheldList || [])) {
            console.log(`      TAX_WITHHELD: ${tw.TaxCollectionModel}`);
            for (const tc of (tw.TaxesWithheld || [])) {
              console.log(`        ${tc.ChargeType} = ${toAmt(tc.ChargeAmount)}`);
            }
          }
          // Promos
          for (const pr of (item.PromotionList || [])) {
            console.log(`      PROMO: ${pr.PromotionType} = ${toAmt(pr.PromotionAmount)}`);
          }
        }
      }

      // Refund events
      const refunds = payload.RefundEventList || [];
      for (const evt of refunds) {
        console.log(`\n  RefundEvent: PostedDate=${evt.PostedDate}`);
        for (const item of (evt.ShipmentItemList || evt.ShipmentItemAdjustmentList || [])) {
          console.log(`    SKU=${item.SellerSKU} Qty=${item.QuantityShipped || item.Quantity || 0}`);
          for (const ch of (item.ItemChargeList || item.ItemChargeAdjustmentList || [])) {
            console.log(`      CHARGE_ADJ: ${ch.ChargeType} = ${toAmt(ch.ChargeAmount)}`);
          }
          for (const fe of (item.ItemFeeList || item.ItemFeeAdjustmentList || [])) {
            console.log(`      FEE_ADJ: ${fe.FeeType} = ${toAmt(fe.FeeAmount)}`);
          }
          for (const tw of (item.ItemTaxWithheldList || [])) {
            console.log(`      TAX_WITHHELD_ADJ: ${tw.TaxCollectionModel}`);
            for (const tc of (tw.TaxesWithheld || [])) {
              console.log(`        ${tc.ChargeType} = ${toAmt(tc.ChargeAmount)}`);
            }
          }
        }
      }

      // Service fee events (shipping services, etc.)
      const serviceFees = payload.ServiceFeeEventList || [];
      for (const evt of serviceFees) {
        console.log(`\n  ServiceFeeEvent: Reason=${evt.FeeReason}, OrderId=${evt.SellerInputIdentifier}`);
        for (const fe of (evt.FeeList || [])) {
          console.log(`      SERVICE_FEE: ${fe.FeeType} = ${toAmt(fe.FeeAmount)}`);
        }
      }

      // Retrocharge events
      const retros = payload.RetrochargeEventList || [];
      for (const evt of retros) {
        console.log(`\n  RetrochargeEvent: Type=${evt.RetrochargeEventType}, Posted=${evt.PostedDate}`);
        console.log(`    BaseTax: ${toAmt(evt.BaseTax)}, ShippingTax: ${toAmt(evt.ShippingTax)}`);
      }

      // Any other event types
      const otherKeys = Object.keys(payload).filter(k =>
        !['ShipmentEventList', 'RefundEventList', 'ServiceFeeEventList', 'RetrochargeEventList'].includes(k)
        && Array.isArray(payload[k]) && payload[k].length > 0
      );
      if (otherKeys.length > 0) {
        console.log(`\n  Other event types present: ${otherKeys.join(', ')}`);
        for (const k of otherKeys) {
          console.log(`    ${k}: ${JSON.stringify(payload[k]).slice(0, 300)}`);
        }
      }

    } catch (e) {
      console.log(`  [Financial Events] Error: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 2000)); // rate limit between orders
    console.log('');
  }

  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load env
const raw = readFileSync('/Users/admin1/Documents/workingwithamazonAPI/apps/dashboard/.env.local', 'utf-8');
const env = {};
for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// 1. Count by event_type
const { data: all } = await supabase.from('financial_events').select('event_type, amount, sku, amazon_order_id').limit(5000);
const counts = {};
const amountSums = {};
for (const e of (all || [])) {
    counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    amountSums[e.event_type] = (amountSums[e.event_type] || 0) + Number(e.amount);
}
console.log('\n=== Event Type Breakdown ===');
for (const [type, count] of Object.entries(counts)) {
    console.log(`  ${type}: ${count} events, total amount: ₹${amountSums[type]?.toFixed(2)}`);
}

// 2. Show 5 sample shipment events
const shipments = (all || []).filter(e => e.event_type === 'shipment').slice(0, 5);
console.log(`\n=== Sample Shipment Events (${shipments.length}) ===`);
for (const s of shipments) {
    console.log(`  Order: ${s.amazon_order_id}, SKU: ${s.sku}, Amount: ₹${s.amount}`);
}

// 3. Show 5 sample fee events
const fees = (all || []).filter(e => e.event_type === 'fee').slice(0, 5);
console.log(`\n=== Sample Fee Events (${fees.length}) ===`);
for (const f of fees) {
    console.log(`  Order: ${f.amazon_order_id}, SKU: ${f.sku}, Amount: ₹${f.amount}`);
}

// 4. Check a specific order the user mentioned
const orderId = '402-1033926-3725148';
const { data: orderEvents } = await supabase.from('financial_events')
    .select('*').eq('amazon_order_id', orderId);
console.log(`\n=== Events for order ${orderId} ===`);
for (const e of (orderEvents || [])) {
    console.log(`  type: ${e.event_type}, amount: ₹${e.amount}, fee_type: ${e.fee_type || '-'}, ref: ${e.reference_id}`);
}

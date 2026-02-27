import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const { data } = await supabase
    .from('financial_events')
    .select('event_type, amount, fee_type, posted_date, sku')
    .gte('posted_date', '2026-02-26')
    .lte('posted_date', '2026-02-28');

const summary = {};
for (const e of (data || [])) {
    const type = e.event_type;
    if (!summary[type]) summary[type] = { count: 0, total: 0 };
    summary[type].count++;
    summary[type].total += Number(e.amount);
}
console.log('=== Events for Feb 26-27, 2026 ===');
for (const [type, s] of Object.entries(summary)) {
    console.log(`  ${type}: ${s.count} events, total ₹${s.total.toFixed(2)}`);
}
console.log('Total events:', (data || []).length);

const fees = (data || []).filter(e => e.event_type === 'fee');
const feeTypes = {};
for (const f of fees) {
    const t = f.fee_type || 'unknown';
    if (!feeTypes[t]) feeTypes[t] = { count: 0, total: 0 };
    feeTypes[t].count++;
    feeTypes[t].total += Number(f.amount);
}
console.log('\n=== Fee breakdown by type ===');
for (const [type, s] of Object.entries(feeTypes)) {
    console.log(`  ${type}: ${s.count} events, total ₹${s.total.toFixed(2)}`);
}

const refunds = (data || []).filter(e => e.event_type === 'refund');
console.log('\n=== Refunds ===');
console.log('Count:', refunds.length, 'Total: ₹' + refunds.reduce((s, r) => s + Number(r.amount), 0).toFixed(2));

// Also check account_daily_metrics for those dates
const { data: adm } = await supabase
    .from('account_daily_metrics')
    .select('*')
    .gte('date', '2026-02-26')
    .lte('date', '2026-02-27');
console.log('\n=== account_daily_metrics for Feb 26-27 ===');
for (const row of (adm || [])) {
    console.log(`  ${row.date}: revenue=₹${row.total_revenue_live}, fees=₹${row.total_fees}, refunds=₹${row.total_refund_amount}, units=${row.total_units_live}, net=₹${row.net_contribution_live}`);
}

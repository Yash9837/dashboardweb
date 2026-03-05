import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://zdguqevtaopvwadqonvb.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpkZ3VxZXZ0YW9wdndhZHFvbnZiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5MTMwNzcsImV4cCI6MjA4NzQ4OTA3N30.g1NqaYxFs_WqsbPGjmq8Dvff-OkGJ4GP5ALo5FCGn-Q'
);

const orders = ['408-3478677-0341928', '405-3723375-1633911'];

const { data: events } = await supabase
  .from('financial_events')
  .select('*')
  .in('amazon_order_id', orders)
  .order('posted_date', { ascending: true });

for (const oid of orders) {
  console.log('\n' + '='.repeat(80));
  console.log('ORDER:', oid);
  console.log('='.repeat(80));
  const orderEvents = (events || []).filter(e => e.amazon_order_id === oid);
  console.log('Total events:', orderEvents.length);

  const byType = {};
  for (const e of orderEvents) {
    const key = e.event_type + (e.fee_type ? ':' + e.fee_type : '');
    if (!byType[key]) byType[key] = { count: 0, total: 0, items: [] };
    byType[key].count++;
    byType[key].total += Number(e.amount);
    byType[key].items.push({
      amount: Number(e.amount),
      qty: e.quantity,
      posted: e.posted_date?.slice(0, 10),
      txn: e.transaction_type,
      ref: e.reference_id,
    });
  }

  for (const [key, val] of Object.entries(byType)) {
    console.log(`  ${key}: count=${val.count}, total=${val.total.toFixed(2)}`);
    for (const ev of val.items) {
      console.log(`    amt=${ev.amount.toFixed(2)} qty=${ev.qty} posted=${ev.posted} txn=${ev.txn} ref=${ev.ref}`);
    }
  }

  // Sum totals
  const totalRevenue = orderEvents.filter(e => e.event_type === 'shipment').reduce((s, e) => s + Number(e.amount), 0);
  const totalFees = orderEvents.filter(e => e.event_type === 'fee').reduce((s, e) => s + Number(e.amount), 0);
  const totalRefund = orderEvents.filter(e => e.event_type === 'refund').reduce((s, e) => s + Number(e.amount), 0);
  const totalRefundFee = orderEvents.filter(e => e.event_type === 'refund_fee').reduce((s, e) => s + Number(e.amount), 0);
  const totalShipping = orderEvents.filter(e => e.event_type === 'shipping').reduce((s, e) => s + Number(e.amount), 0);
  const totalShipFee = orderEvents.filter(e => e.event_type === 'shipping_fee').reduce((s, e) => s + Number(e.amount), 0);

  console.log(`\n  TOTALS: revenue=${totalRevenue.toFixed(2)}, fees=${totalFees.toFixed(2)}, refund=${totalRefund.toFixed(2)}, refund_fee=${totalRefundFee.toFixed(2)}, shipping=${totalShipping.toFixed(2)}, ship_fee=${totalShipFee.toFixed(2)}`);
  console.log(`  NET: ${(totalRevenue + totalFees + totalRefund + totalRefundFee + totalShipping + totalShipFee).toFixed(2)}`);
}

// Order metadata
const { data: orderData } = await supabase
  .from('orders')
  .select('amazon_order_id, order_status, delivery_date, financial_status, event_count')
  .in('amazon_order_id', orders);

console.log('\n\nORDER METADATA:');
for (const o of (orderData || [])) {
  console.log(`  ${o.amazon_order_id}: status=${o.order_status}, delivery=${o.delivery_date?.slice(0, 10)}, finance=${o.financial_status}, events=${o.event_count}`);
}

process.exit(0);

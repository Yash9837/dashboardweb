// Find orders blocking "Payments Finalized Till" after Jan 29, 2026
// Run: node scripts/check_blocker_jan29.js

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fetchAll(table, select, filterFn) {
  let all = [], from = 0;
  while (true) {
    let q = sb.from(table).select(select).range(from, from + 999);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) { console.error('Error:', error.message); return all; }
    all = all.concat(data || []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return all;
}

(async () => {
  // Get all orders
  const orders = await fetchAll('orders', 'amazon_order_id, order_status, financial_status, purchase_date, delivery_date, settlement_status, event_count');

  // Get financial events grouped by order
  const events = await fetchAll('financial_events', 'amazon_order_id, event_type, amount, posted_date');
  const eventsByOrder = {};
  for (const e of events) {
    if (!e.amazon_order_id) continue;
    if (!eventsByOrder[e.amazon_order_id]) eventsByOrder[e.amazon_order_id] = [];
    eventsByOrder[e.amazon_order_id].push(e);
  }

  // Get settlement_items by order
  const settItems = await fetchAll('settlement_items', 'amazon_order_id, settlement_id, amount');
  const settlByOrder = {};
  for (const s of settItems) {
    if (!s.amazon_order_id) continue;
    if (!settlByOrder[s.amazon_order_id]) settlByOrder[s.amazon_order_id] = [];
    settlByOrder[s.amazon_order_id].push(s);
  }

  // Simulate the finalized-till calculation exactly as the API does
  // Group orders by purchase_date day
  const dayOrders = {};
  for (const o of orders) {
    if (!o.purchase_date) continue;
    const day = o.purchase_date.slice(0, 10);
    if (!dayOrders[day]) dayOrders[day] = [];
    dayOrders[day].push(o);
  }

  const sortedDays = Object.keys(dayOrders).sort();
  let finalizedTill = null;

  console.log('Walking days chronologically to find the blocker...\n');

  // Walk past Jan 29 to find what breaks
  let pastJan29 = false;
  for (const day of sortedDays) {
    const dayList = dayOrders[day];
    const nonClosed = dayList.filter(o => (o.financial_status || 'OPEN') !== 'FINANCIALLY_CLOSED');

    if (nonClosed.length === 0) {
      finalizedTill = day;
      if (day >= '2026-01-29') pastJan29 = true;
    } else {
      if (day >= '2026-01-29' || !finalizedTill) {
        console.log(`═══════════════════════════════════════════════════`);
        console.log(`🚫 BLOCKER DAY: ${day}`);
        console.log(`   Total orders: ${dayList.length}, Non-closed: ${nonClosed.length}`);
        console.log(`   Last finalized: ${finalizedTill}`);
        console.log(`───────────────────────────────────────────────────`);

        for (const o of nonClosed) {
          const evts = eventsByOrder[o.amazon_order_id] || [];
          const si = settlByOrder[o.amazon_order_id] || [];
          const types = [...new Set(evts.map(e => e.event_type))];
          const netEvt = evts.reduce((s, e) => s + (Number(e.amount) || 0), 0);
          const netSI = si.reduce((s, e) => s + (Number(e.amount) || 0), 0);

          console.log(`  📦 ${o.amazon_order_id}`);
          console.log(`     order_status:     ${o.order_status}`);
          console.log(`     financial_status: ${o.financial_status || 'OPEN'}`);
          console.log(`     settlement_status: ${o.settlement_status || 'Unsettled'}`);
          console.log(`     purchase_date:    ${(o.purchase_date || '').slice(0, 10)}`);
          console.log(`     delivery_date:    ${(o.delivery_date || 'null').toString().slice(0, 10)}`);
          console.log(`     event_count (DB): ${o.event_count || 0}`);
          console.log(`     events found:     ${evts.length} [${types.join(',')}] net=₹${netEvt.toFixed(2)}`);
          console.log(`     settlement_items: ${si.length} net=₹${netSI.toFixed(2)}`);
          if (evts.length > 0) {
            const dates = evts.map(e => (e.posted_date || '').slice(0, 10)).sort();
            console.log(`     event dates:      ${dates[0]} → ${dates[dates.length - 1]}`);
          }
          console.log('');
        }

        // Only show first blocker day
        break;
      }
      // Before Jan 29, just note we hit a non-finalized day but continue logic
      // Actually the API breaks at first non-closed day, so do the same
      if (!finalizedTill || day <= '2026-01-28') {
        finalizedTill = null; // reset if we haven't established a streak
      }
      break;
    }
  }

  if (finalizedTill) {
    console.log(`\n✅ Payments Finalized Till: ${finalizedTill}`);
  }

  // Also show stats for days around Jan 29
  console.log('\n── Days around Jan 29, 2026 ──');
  for (const day of sortedDays) {
    if (day >= '2026-01-27' && day <= '2026-02-03') {
      const dayList = dayOrders[day];
      const closed = dayList.filter(o => (o.financial_status || 'OPEN') === 'FINANCIALLY_CLOSED').length;
      const open = dayList.filter(o => (o.financial_status || 'OPEN') === 'OPEN').length;
      const pending = dayList.filter(o => (o.financial_status || 'OPEN') === 'DELIVERED_PENDING_SETTLEMENT').length;
      console.log(`  ${day}: ${dayList.length} orders → ${closed} closed, ${pending} pending, ${open} open`);
    }
  }
})();

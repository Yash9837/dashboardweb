require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fetchAll(table, select) {
  let all = [], from = 0, batchSize = 1000;
  while (true) {
    const { data, error } = await sb.from(table).select(select).range(from, from + batchSize - 1);
    if (error) { console.error('Error fetching ' + table + ':', error.message); return all; }
    all = all.concat(data);
    if (data.length < batchSize) break;
    from += batchSize;
  }
  return all;
}

(async () => {
  const [orders, events, settlements, groups] = await Promise.all([
    fetchAll('orders', 'amazon_order_id, order_status, financial_status, purchase_date'),
    fetchAll('financial_events', 'amazon_order_id, event_type, posted_date'),
    fetchAll('settlement_items', 'amazon_order_id, settlement_id, transaction_type, amount_type, amount_description, amount, posted_date'),
    fetchAll('financial_event_groups', 'group_id, processing_status, fund_transfer_status, fund_transfer_date, original_total, converted_total')
  ]);
  
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║     SETTLEMENT DATA INTEGRITY AUDIT (v2 - accurate)     ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  
  console.log('\n── Table Row Counts ──');
  console.log('  orders:               ', orders.length);
  console.log('  financial_events:     ', events.length);
  console.log('  settlement_items:     ', settlements.length);
  console.log('  financial_event_groups:', groups.length);
  
  // Unique orders
  const orderSet = new Set(orders.map(o => o.amazon_order_id));
  const eventOrderSet = new Set(events.map(e => e.amazon_order_id).filter(Boolean));
  const settlOrderSet = new Set(settlements.map(s => s.amazon_order_id).filter(Boolean));
  
  console.log('\n── Unique Orders ──');
  console.log('  Orders table:         ', orderSet.size);
  console.log('  In financial_events:  ', eventOrderSet.size);
  console.log('  In settlement_items:  ', settlOrderSet.size);
  
  // Venn
  let bothEventsAndSettl = 0, eventsOnly = 0, settlOnly = 0, neither = 0;
  for (const oid of orderSet) {
    const hasE = eventOrderSet.has(oid);
    const hasS = settlOrderSet.has(oid);
    if (hasE && hasS) bothEventsAndSettl++;
    else if (hasE) eventsOnly++;
    else if (hasS) settlOnly++;
    else neither++;
  }
  console.log('\n── Order Coverage Venn ──');
  console.log('  Has BOTH events + settlement:', bothEventsAndSettl);
  console.log('  Has events only (no settl):  ', eventsOnly, '← THE GAP');
  console.log('  Has settlement only (no evt):', settlOnly);
  console.log('  Has NEITHER:                 ', neither);
  
  // Gap by financial_status
  const gapByStatus = {};
  const gapByMonth = {};
  for (const o of orders) {
    if (eventOrderSet.has(o.amazon_order_id) && !settlOrderSet.has(o.amazon_order_id)) {
      const st = o.financial_status || 'NULL';
      gapByStatus[st] = (gapByStatus[st] || 0) + 1;
      const month = (o.purchase_date || 'unknown').substring(0, 7);
      if (!gapByMonth[month]) gapByMonth[month] = {};
      gapByMonth[month][st] = (gapByMonth[month][st] || 0) + 1;
    }
  }
  console.log('\n── Gap Orders by Financial Status ──');
  for (const [st, cnt] of Object.entries(gapByStatus).sort((a,b) => b[1] - a[1])) {
    console.log('  ' + st + ': ' + cnt);
  }
  
  console.log('\n── Gap Orders by Month ──');
  Object.keys(gapByMonth).sort().forEach(m => {
    const total = Object.values(gapByMonth[m]).reduce((a, b) => a + b, 0);
    console.log('  ' + m + ': ' + total + ' gap orders', JSON.stringify(gapByMonth[m]));
  });
  
  // Event Groups Analysis
  const siByGroup = {};
  for (const s of settlements) {
    if (!siByGroup[s.settlement_id]) siByGroup[s.settlement_id] = [];
    siByGroup[s.settlement_id].push(s);
  }
  
  console.log('\n── Financial Event Groups ──');
  console.log('  Total groups:', groups.length);
  
  let closedCount = 0, openCount = 0;
  let disbursed = 0, notDisbursed = 0;
  let withItems = 0, withoutItems = 0;
  
  const groupsWithItems = [];
  const groupsWithoutItems = [];
  
  for (const g of groups) {
    if (g.processing_status === 'Closed') closedCount++;
    else openCount++;
    if (g.fund_transfer_status === 'Succeeded') disbursed++;
    else notDisbursed++;
    
    const items = siByGroup[g.group_id] || [];
    if (items.length > 0) {
      withItems++;
      groupsWithItems.push({ ...g, itemCount: items.length });
    } else {
      withoutItems++;
      groupsWithoutItems.push(g);
    }
  }
  
  console.log('  Closed:', closedCount, ' Open:', openCount);
  console.log('  Disbursed:', disbursed, ' Not Disbursed:', notDisbursed);
  console.log('  With settlement_items:', withItems);
  console.log('  WITHOUT settlement_items:', withoutItems, '← MISSING DATA');
  
  console.log('\n── Groups WITH Items ──');
  for (const g of groupsWithItems.sort((a, b) => (b.fund_transfer_date || '').localeCompare(a.fund_transfer_date || ''))) {
    const age = g.fund_transfer_date ? Math.floor((Date.now() - new Date(g.fund_transfer_date).getTime()) / 86400000) + 'd ago' : '?';
    console.log('  ✅ ' + g.group_id.substring(0, 25) + '... items=' + g.itemCount + ' proc=' + g.processing_status + ' xfer=' + g.fund_transfer_status + ' date=' + (g.fund_transfer_date || '?') + ' (' + age + ')');
  }
  
  console.log('\n── Groups WITHOUT Items ── (THESE NEED BACKFILL)');
  for (const g of groupsWithoutItems.sort((a, b) => (b.fund_transfer_date || '').localeCompare(a.fund_transfer_date || ''))) {
    const age = g.fund_transfer_date ? Math.floor((Date.now() - new Date(g.fund_transfer_date).getTime()) / 86400000) + 'd ago' : '?';
    console.log('  ❌ ' + g.group_id.substring(0, 25) + '... proc=' + g.processing_status + ' xfer=' + g.fund_transfer_status + ' date=' + (g.fund_transfer_date || '?') + ' (' + age + ')');
  }
  
  // Settlement items referencing unknown groups
  const groupIdSet = new Set(groups.map(g => g.group_id));
  const settlGroupSet = new Set(settlements.map(s => s.settlement_id));
  const unknownGroupsInSettl = [...settlGroupSet].filter(g => !groupIdSet.has(g));
  console.log('\n── Cross-reference ──');
  console.log('  Unique settlement_ids in items:', settlGroupSet.size);
  console.log('  Items referencing unknown groups:', unknownGroupsInSettl.length);
  if (unknownGroupsInSettl.length > 0) {
    for (const ug of unknownGroupsInSettl) {
      const cnt = settlements.filter(s => s.settlement_id === ug).length;
      console.log('    Unknown group ' + ug.substring(0, 25) + '... with ' + cnt + ' items');
    }
  }
  
  // Summary
  const coveragePct = ((bothEventsAndSettl / (bothEventsAndSettl + eventsOnly)) * 100).toFixed(1);
  const groupCoveragePct = ((withItems / groups.length) * 100).toFixed(1);
  
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                      SUMMARY                             ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('  Order settlement coverage: ' + bothEventsAndSettl + '/' + (bothEventsAndSettl + eventsOnly) + ' = ' + coveragePct + '%');
  console.log('  Group settlement coverage: ' + withItems + '/' + groups.length + ' = ' + groupCoveragePct + '%');
  console.log('  MISSING: ' + eventsOnly + ' orders have events but no settlement data');
  console.log('  MISSING: ' + withoutItems + ' groups have no settlement items fetched');
})();

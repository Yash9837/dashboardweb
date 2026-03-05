// ============================================================================
// SETTLEMENT DATA INTEGRITY AUDIT v3
// Cross-checks DB data vs Amazon API to find gaps
// ============================================================================
// Run: node scripts/audit_v3.js
// ============================================================================

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function fetchAll(table, select, filterFn) {
  let all = [], from = 0, batchSize = 1000;
  while (true) {
    let q = sb.from(table).select(select).range(from, from + batchSize - 1);
    if (filterFn) q = filterFn(q);
    const { data, error } = await q;
    if (error) { console.error('  Error fetching ' + table + ':', error.message); return all; }
    all = all.concat(data || []);
    if (!data || data.length < batchSize) break;
    from += batchSize;
  }
  return all;
}

(async () => {
  console.log('Fetching all tables (paginated)...\n');

  const [orders, events, settlements, groups] = await Promise.all([
    fetchAll('orders', 'amazon_order_id, order_status, financial_status, purchase_date, delivery_date, settlement_status'),
    fetchAll('financial_events', 'amazon_order_id, event_type, posted_date, amount'),
    fetchAll('settlement_items', 'settlement_id, amazon_order_id, transaction_type, amount_type, amount_description, amount, posted_date'),
    fetchAll('financial_event_groups', 'event_group_id, processing_status, fund_transfer_status, fund_transfer_date, original_total, beginning_balance'),
  ]);

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║       SETTLEMENT DATA INTEGRITY AUDIT (v3)               ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  // ── 1. Table Row Counts ──
  console.log('\n── 1. Table Row Counts ──');
  console.log('  orders:                ', orders.length);
  console.log('  financial_events:      ', events.length);
  console.log('  settlement_items:      ', settlements.length);
  console.log('  financial_event_groups: ', groups.length);

  // ── 2. Unique Order Coverage ──
  const orderSet = new Set(orders.map(o => o.amazon_order_id));
  const eventOrderSet = new Set(events.filter(e => e.amazon_order_id).map(e => e.amazon_order_id));
  const settlOrderSet = new Set(settlements.filter(s => s.amazon_order_id).map(s => s.amazon_order_id));

  console.log('\n── 2. Unique Order IDs ──');
  console.log('  In orders table:       ', orderSet.size);
  console.log('  In financial_events:   ', eventOrderSet.size);
  console.log('  In settlement_items:   ', settlOrderSet.size);

  // ── 3. Venn Diagram ──
  let bothEventsAndSettl = 0, eventsOnly = 0, settlOnly = 0, neither = 0;
  for (const oid of orderSet) {
    const hasE = eventOrderSet.has(oid);
    const hasS = settlOrderSet.has(oid);
    if (hasE && hasS) bothEventsAndSettl++;
    else if (hasE) eventsOnly++;
    else if (hasS) settlOnly++;
    else neither++;
  }

  console.log('\n── 3. Order Coverage Venn ──');
  console.log('  Has BOTH events + settlement_items:', bothEventsAndSettl);
  console.log('  Has financial_events ONLY (no SI): ', eventsOnly, ' ← THE GAP');
  console.log('  Has settlement_items ONLY (no FE): ', settlOnly);
  console.log('  Has NEITHER:                       ', neither);

  // ── 4. Gap Analysis by Financial Status ──
  const gapOrders = [];
  const gapByStatus = {};
  const gapByMonth = {};
  for (const o of orders) {
    const hasE = eventOrderSet.has(o.amazon_order_id);
    const hasS = settlOrderSet.has(o.amazon_order_id);
    if (hasE && !hasS) {
      gapOrders.push(o);
      const st = o.financial_status || 'NULL';
      gapByStatus[st] = (gapByStatus[st] || 0) + 1;
      const month = (o.purchase_date || 'unknown').substring(0, 7);
      if (!gapByMonth[month]) gapByMonth[month] = 0;
      gapByMonth[month]++;
    }
  }

  console.log('\n── 4. Gap Orders (have events, no settlement_items) ──');
  console.log('  By financial_status:');
  for (const [st, cnt] of Object.entries(gapByStatus).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + st + ': ' + cnt);
  }
  console.log('\n  By month:');
  Object.keys(gapByMonth).sort().forEach(m => {
    console.log('    ' + m + ': ' + gapByMonth[m]);
  });

  // ── 5. Financial Event Groups Analysis ──
  const siByGroup = {};
  for (const s of settlements) {
    if (!siByGroup[s.settlement_id]) siByGroup[s.settlement_id] = { count: 0, orders: new Set() };
    siByGroup[s.settlement_id].count++;
    if (s.amazon_order_id) siByGroup[s.settlement_id].orders.add(s.amazon_order_id);
  }

  console.log('\n── 5. Financial Event Groups ──');
  console.log('  Total groups:', groups.length);

  let closedCount = 0, openCount = 0;
  let disbursed = 0, notDisbursed = 0;
  let grpWithItems = 0, grpWithoutItems = 0;
  const groupsNeedingItems = [];

  for (const g of groups) {
    if (g.processing_status === 'Closed') closedCount++;
    else openCount++;

    const nonTerminal = g.fund_transfer_status === 'Initiated' || g.fund_transfer_status === 'Processing';
    if (g.processing_status === 'Closed' && !nonTerminal) disbursed++;
    else notDisbursed++;

    const items = siByGroup[g.event_group_id];
    if (items && items.count > 0) {
      grpWithItems++;
    } else {
      grpWithoutItems++;
      groupsNeedingItems.push(g);
    }
  }

  console.log('  Closed:', closedCount, ' Open:', openCount);
  console.log('  Disbursed (Closed+terminal):', disbursed, ' Not yet:', notDisbursed);
  console.log('  Groups WITH settlement_items:', grpWithItems);
  console.log('  Groups WITHOUT settlement_items:', grpWithoutItems, grpWithoutItems > 0 ? '← NEED BACKFILL' : '');

  console.log('\n── 6. Groups Detail ──');
  console.log('  Groups WITH items:');
  for (const g of groups.filter(g => siByGroup[g.event_group_id])) {
    const si = siByGroup[g.event_group_id];
    const age = g.fund_transfer_date ? Math.floor((Date.now() - new Date(g.fund_transfer_date).getTime()) / 86400000) + 'd' : '?';
    console.log('    ✅ ' + g.event_group_id.substring(0, 30) + '  items=' + si.count + ' orders=' + si.orders.size +
      ' proc=' + g.processing_status + ' xfer=' + g.fund_transfer_status +
      ' total=₹' + g.original_total + ' (' + age + ')');
  }

  if (groupsNeedingItems.length > 0) {
    console.log('\n  Groups WITHOUT items (NEED BACKFILL):');
    for (const g of groupsNeedingItems) {
      const age = g.fund_transfer_date ? Math.floor((Date.now() - new Date(g.fund_transfer_date).getTime()) / 86400000) + 'd' : '?';
      console.log('    ❌ ' + g.event_group_id.substring(0, 30) + '  proc=' + g.processing_status +
        ' xfer=' + g.fund_transfer_status + ' total=₹' + g.original_total + ' (' + age + ')');
    }
  }

  // ── 7. Cross-reference: settlement_items pointing to unknown groups ──
  const groupIdSet = new Set(groups.map(g => g.event_group_id));
  const settlGroupIds = new Set(settlements.map(s => s.settlement_id));
  const unknownGroups = [...settlGroupIds].filter(id => !groupIdSet.has(id));

  console.log('\n── 7. Cross-reference ──');
  console.log('  Unique settlement_ids in items:', settlGroupIds.size);
  console.log('  Items referencing UNKNOWN groups:', unknownGroups.length);
  for (const ug of unknownGroups) {
    const cnt = settlements.filter(s => s.settlement_id === ug).length;
    console.log('    ⚠ ' + ug + ' (' + cnt + ' items)');
  }

  // ── 8. Orders with events but no settlement — sample event types ──
  console.log('\n── 8. Sample Gap Orders (first 10) ──');
  const eventsByOrder = {};
  for (const e of events) {
    if (!e.amazon_order_id) continue;
    if (!eventsByOrder[e.amazon_order_id]) eventsByOrder[e.amazon_order_id] = [];
    eventsByOrder[e.amazon_order_id].push(e);
  }

  const sampleGap = gapOrders.slice(0, 10);
  for (const o of sampleGap) {
    const evts = eventsByOrder[o.amazon_order_id] || [];
    const types = [...new Set(evts.map(e => e.event_type))];
    const totalAmt = evts.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const dates = evts.map(e => (e.posted_date || '').slice(0, 10)).filter(Boolean);
    const minDate = dates.length ? dates.sort()[0] : '?';
    const maxDate = dates.length ? dates.sort().reverse()[0] : '?';
    console.log('  ' + o.amazon_order_id +
      '  purch=' + (o.purchase_date || '').slice(0, 10) +
      '  status=' + (o.order_status || '?') +
      '  fin=' + (o.financial_status || 'OPEN') +
      '  events=' + evts.length +
      '  types=[' + types.join(',') + ']' +
      '  net=₹' + totalAmt.toFixed(2) +
      '  dates=' + minDate + '→' + maxDate);
  }

  // ── 9. "Neither" orders — no events, no settlement items ──
  console.log('\n── 9. Orders with NO financial data at all ──');
  const neitherOrders = orders.filter(o => !eventOrderSet.has(o.amazon_order_id) && !settlOrderSet.has(o.amazon_order_id));
  const neitherByStatus = {};
  for (const o of neitherOrders) {
    const st = (o.order_status || 'Unknown');
    neitherByStatus[st] = (neitherByStatus[st] || 0) + 1;
  }
  console.log('  Total:', neitherOrders.length);
  for (const [st, cnt] of Object.entries(neitherByStatus).sort((a, b) => b[1] - a[1])) {
    console.log('    ' + st + ': ' + cnt);
  }

  // ── SUMMARY ──
  const coveragePct = eventsOnly + bothEventsAndSettl > 0
    ? ((bothEventsAndSettl / (bothEventsAndSettl + eventsOnly)) * 100).toFixed(1)
    : '0';
  const groupPct = groups.length > 0
    ? ((grpWithItems / groups.length) * 100).toFixed(1)
    : '0';

  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                       SUMMARY                            ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('  Order→Settlement coverage: ' + bothEventsAndSettl + '/' + (bothEventsAndSettl + eventsOnly) + ' = ' + coveragePct + '%');
  console.log('  Group→Items coverage:      ' + grpWithItems + '/' + groups.length + ' = ' + groupPct + '%');
  console.log('  GAP: ' + eventsOnly + ' orders have events but ZERO settlement_items');
  console.log('  GAP: ' + grpWithoutItems + ' groups have ZERO settlement_items');
  console.log('  GAP: ' + neitherOrders.length + ' orders have NO financial data at all');
  console.log('');
  console.log('  Root cause: sync-settlements only fetches items for groups');
  console.log('  that are Open or don\'t have ANY items yet. Orders whose');
  console.log('  events landed in groups that already had some items from');
  console.log('  other orders won\'t get their settlement linkage synced.');
  console.log('');
})();

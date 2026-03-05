#!/usr/bin/env node
// ============================================================================
// Data Integrity Audit: DB settlement coverage vs financial events
// ============================================================================
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: __dirname + '/../.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

// Helper: fetch ALL rows (past Supabase 1000 limit)
async function fetchAll(table, select, filterFn) {
    const PAGE = 1000;
    let all = [], offset = 0;
    while (true) {
        let q = sb.from(table).select(select);
        if (filterFn) q = filterFn(q);
        q = q.range(offset, offset + PAGE - 1);
        const { data, error } = await q;
        if (error) { console.error(`fetchAll(${table}):`, error.message); break; }
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        offset += PAGE;
    }
    return all;
}

(async () => {
    console.log('╔═══════════════════════════════════════════════════════════════════╗');
    console.log('║        DATA INTEGRITY AUDIT: Settlement Coverage                 ║');
    console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

    // ── 1. Count tables ──
    const [orders, events, settItems, groups] = await Promise.all([
        fetchAll('orders', 'amazon_order_id, purchase_date, order_status, financial_status, delivery_date'),
        fetchAll('financial_events', 'amazon_order_id, posted_date, event_type, amount'),
        fetchAll('settlement_items', 'settlement_id, amazon_order_id, total_amount'),
        fetchAll('financial_event_groups', 'event_group_id, processing_status, fund_transfer_status, fund_transfer_date'),
    ]);
    console.log('── Table Row Counts ──');
    console.log(`  orders:                ${orders.length}`);
    console.log(`  financial_events:      ${events.length}`);
    console.log(`  settlement_items:      ${settItems.length}`);
    console.log(`  financial_event_groups: ${groups.length}`);

    // ── 2. Unique orders in each table ──
    const orderIds = new Set(orders.map(o => o.amazon_order_id));
    const eventOrderIds = new Set(events.filter(e => e.amazon_order_id).map(e => e.amazon_order_id));
    const settlOrderIds = new Set(settItems.filter(s => s.amazon_order_id).map(s => s.amazon_order_id));

    console.log(`\n── Unique Order Coverage ──`);
    console.log(`  Orders table:          ${orderIds.size} unique orders`);
    console.log(`  financial_events:      ${eventOrderIds.size} unique orders`);
    console.log(`  settlement_items:      ${settlOrderIds.size} unique orders`);

    // ── 3. Venn diagram ──
    let hasEventsNoSettl = 0, hasSettlNoEvents = 0, hasBoth = 0, hasNeither = 0;
    let hasEventsNoSettlOrders = [];
    for (const oid of orderIds) {
        const hasEv = eventOrderIds.has(oid);
        const hasSi = settlOrderIds.has(oid);
        if (hasEv && hasSi) hasBoth++;
        else if (hasEv && !hasSi) { hasEventsNoSettl++; hasEventsNoSettlOrders.push(oid); }
        else if (!hasEv && hasSi) hasSettlNoEvents++;
        else hasNeither++;
    }
    console.log(`\n── Order Data Coverage (Venn) ──`);
    console.log(`  Has BOTH events + settlement items:  ${hasBoth}`);
    console.log(`  Has events but NO settlement items:  ${hasEventsNoSettl}  ← THE GAP`);
    console.log(`  Has settlement items but NO events:  ${hasSettlNoEvents}`);
    console.log(`  Has NEITHER (no financial data):     ${hasNeither}`);

    // ── 4. Break down the gap by financial_status ──
    console.log(`\n── Gap orders (events but no settlement) by financial_status ──`);
    const gapByStatus = {};
    const gapByMonth = {};
    for (const oid of hasEventsNoSettlOrders) {
        const order = orders.find(o => o.amazon_order_id === oid);
        const fs = order?.financial_status || 'OPEN';
        gapByStatus[fs] = (gapByStatus[fs] || 0) + 1;
        const month = (order?.purchase_date || '').slice(0, 7);
        if (!gapByMonth[month]) gapByMonth[month] = { total: 0, statuses: {} };
        gapByMonth[month].total++;
        gapByMonth[month].statuses[fs] = (gapByMonth[month].statuses[fs] || 0) + 1;
    }
    for (const [status, count] of Object.entries(gapByStatus)) {
        console.log(`  ${status}: ${count}`);
    }
    console.log(`\n── Gap orders by month ──`);
    for (const [month, data] of Object.entries(gapByMonth).sort((a, b) => a[0].localeCompare(b[0]))) {
        console.log(`  ${month}: ${data.total} gap orders`, JSON.stringify(data.statuses));
    }

    // ── 5. Financial event groups analysis ──
    console.log(`\n── Financial Event Groups ──`);
    const groupsByStatus = {};
    let closedDisbursed = 0, closedNotDisbursed = 0;
    const groupIds = new Set(groups.map(g => g.event_group_id));
    for (const g of groups) {
        groupsByStatus[g.processing_status] = (groupsByStatus[g.processing_status] || 0) + 1;
        if (g.processing_status === 'Closed') {
            if (g.fund_transfer_status === 'Succeeded' || g.fund_transfer_status === 'NoFundsDisbursed') closedDisbursed++;
            else closedNotDisbursed++;
        }
    }
    for (const [s, c] of Object.entries(groupsByStatus)) {
        console.log(`  ${s}: ${c}`);
    }
    console.log(`  Closed + Disbursed: ${closedDisbursed}`);
    console.log(`  Closed + Not Disbursed: ${closedNotDisbursed}`);

    // How many groups have settlement_items?
    const groupsWithItems = new Set(settItems.map(s => s.settlement_id));
    const groupsWithoutItems = groups.filter(g => !groupsWithItems.has(g.event_group_id));
    console.log(`\n  Groups WITH settlement_items:    ${groupsWithItems.size}`);
    console.log(`  Groups WITHOUT settlement_items: ${groupsWithoutItems.length}`);
    console.log(`  Groups without items (details):`);
    for (const g of groupsWithoutItems.slice(0, 15)) {
        const age = g.fund_transfer_date ? Math.floor((Date.now() - new Date(g.fund_transfer_date).getTime()) / 86400000) : '?';
        console.log(`    ${g.event_group_id} proc=${g.processing_status} transfer=${g.fund_transfer_status || '?'} transferDate=${(g.fund_transfer_date||'').slice(0,10)||'?'} age=${age}d`);
    }

    // ── 6. Check if settlement_items reference groups NOT in our financial_event_groups table ──
    const itemGroupIds = new Set(settItems.map(s => s.settlement_id));
    let missingGroups = 0;
    for (const gid of itemGroupIds) {
        if (!groupIds.has(gid)) missingGroups++;
    }
    console.log(`\n  settlement_items referencing unknown groups: ${missingGroups}`);

    // ── 7. Sample: orders with events but no settlement — show their event groups ──
    console.log(`\n── Sample gap orders (events but no settlement_items) ──`);
    const sampleGapOrders = hasEventsNoSettlOrders.slice(0, 8);
    for (const oid of sampleGapOrders) {
        const order = orders.find(o => o.amazon_order_id === oid);
        const orderEvents = events.filter(e => e.amazon_order_id === oid);
        const evTypes = [...new Set(orderEvents.map(e => e.event_type))].join(',');
        const dates = orderEvents.map(e => (e.posted_date || '').slice(0, 10));
        const minDate = dates.sort()[0] || '?';
        const maxDate = dates.sort().reverse()[0] || '?';
        console.log(`  ${oid} purch=${(order?.purchase_date||'').slice(0,10)} status=${order?.order_status} fin=${order?.financial_status} events=${orderEvents.length}(${evTypes}) dates=${minDate}→${maxDate}`);
    }
})();

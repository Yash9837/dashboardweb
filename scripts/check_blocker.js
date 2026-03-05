const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/admin1/Documents/workingwithamazonAPI/apps/dashboard/.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
    // 1. Non-closed orders after Nov 20
    const { data } = await sb.from('orders')
        .select('amazon_order_id, purchase_date, order_status, financial_status, settlement_status, delivery_date')
        .gt('purchase_date', '2025-11-20')
        .not('financial_status', 'eq', 'FINANCIALLY_CLOSED')
        .order('purchase_date', { ascending: true })
        .limit(20);

    console.log('=== Non-closed orders after Nov 20, 2025 ===');
    console.log('Count:', (data || []).length);
    for (const o of (data || [])) {
        const day = (o.purchase_date || '').slice(0, 10);
        const del = (o.delivery_date || '').slice(0, 10) || 'no-delivery';
        const age = Math.floor((Date.now() - new Date(o.purchase_date).getTime()) / 86400000);
        console.log(day, o.amazon_order_id, 'status=' + (o.order_status || '?'), 'fin=' + (o.financial_status || 'OPEN'), 'settle=' + (o.settlement_status || '?'), 'delivery=' + del, 'age=' + age + 'd');
    }

    // 2. Day-by-day: Nov 21 - Jan 15 — only days with non-closed orders
    console.log('\n=== Day-by-day Nov 21 - Jan 15 (only days with non-closed) ===');
    const { data: range } = await sb.from('orders')
        .select('amazon_order_id, purchase_date, order_status, financial_status')
        .gte('purchase_date', '2025-11-21')
        .lte('purchase_date', '2026-01-15')
        .order('purchase_date');

    const dayMap = {};
    for (const o of (range || [])) {
        const day = (o.purchase_date || '').slice(0, 10);
        if (!dayMap[day]) dayMap[day] = { total: 0, closed: 0, open: 0, pending: 0, blockers: [] };
        dayMap[day].total++;
        const fs = o.financial_status || 'OPEN';
        if (fs === 'FINANCIALLY_CLOSED') dayMap[day].closed++;
        else if (fs === 'DELIVERED_PENDING_SETTLEMENT') { dayMap[day].pending++; dayMap[day].blockers.push(o.amazon_order_id + '(PENDING/' + o.order_status + ')'); }
        else { dayMap[day].open++; dayMap[day].blockers.push(o.amazon_order_id + '(OPEN/' + o.order_status + ')'); }
    }
    const days = Object.keys(dayMap).sort();
    for (const day of days) {
        const d = dayMap[day];
        const allClosed = d.total === d.closed;
        if (!allClosed) {
            console.log(day, 'total=' + d.total, 'closed=' + d.closed, 'OPEN=' + d.open, 'PENDING=' + d.pending, '| blockers:', d.blockers.join(', '));
        }
    }

    // 3. Check the first blocker's settlement items
    if (data && data.length > 0) {
        const first = data[0];
        console.log('\n=== First blocker details:', first.amazon_order_id, '===');
        const { data: si } = await sb.from('settlement_items')
            .select('settlement_id').eq('amazon_order_id', first.amazon_order_id);
        console.log('settlement_items:', (si || []).length);
        const { data: fe } = await sb.from('financial_events')
            .select('event_type, amount, posted_date, fee_type')
            .eq('amazon_order_id', first.amazon_order_id);
        console.log('financial_events:', (fe || []).length);
        for (const e of (fe || [])) {
            console.log('  ', e.event_type, e.fee_type || '', e.amount, e.posted_date);
        }
    }
})();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/admin1/Documents/workingwithamazonAPI/apps/dashboard/.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
    // Simulate what the API does: fetch ALL events and ALL orders
    // Then check what the revenue engine would produce for the Nov 21 range

    // 1. Get all orders
    const { data: allOrders, count } = await sb.from('orders')
        .select('amazon_order_id, purchase_date, financial_status', { count: 'exact' })
        .gte('purchase_date', '2020-01-01')
        .lte('purchase_date', new Date().toISOString().split('T')[0] + 'T23:59:59');
    
    const orderMap = new Map();
    for (const o of (allOrders || [])) {
        orderMap.set(o.amazon_order_id, o);
    }
    console.log('Total orders in DB:', count);

    // 2. Get events posted between Nov 21 and Jan 30 with order IDs  
    //    that might produce records on those dates
    const { data: events } = await sb.from('financial_events')
        .select('amazon_order_id, posted_date, event_type, amount')
        .gte('posted_date', '2025-11-21')
        .lte('posted_date', '2026-01-30');
    
    console.log('Events in Nov 21 - Jan 30:', (events||[]).length);

    // 3. Find events whose order_id is NOT in orders table
    //    These would produce records with order_date = posted_date and financial_status = OPEN
    const orphanEvents = [];
    for (const e of (events || [])) {
        if (e.amazon_order_id && !orderMap.has(e.amazon_order_id)) {
            orphanEvents.push(e);
        }
    }
    console.log('Orphan events (order not in DB):', orphanEvents.length);
    for (const e of orphanEvents.slice(0, 10)) {
        console.log('  ', e.amazon_order_id, e.event_type, e.posted_date?.slice(0,10), e.amount);
    }

    // 4. Now check the REVERSE: events posted OUTSIDE Nov21-Jan30
    //    but whose order's purchase_date IS in Nov21-Jan30
    //    AND that order is NOT FINANCIALLY_CLOSED
    //    These orders would appear in allRecords with a non-closed status
    console.log('\n=== Orders with purchase_date Nov21-Jan29 that are NOT closed ===');
    const { data: notClosed } = await sb.from('orders')
        .select('amazon_order_id, purchase_date, financial_status, order_status')
        .gte('purchase_date', '2025-11-21')
        .lte('purchase_date', '2026-01-29')
        .not('financial_status', 'eq', 'FINANCIALLY_CLOSED');
    
    console.log('Count:', (notClosed||[]).length);
    for (const o of (notClosed||[]).slice(0, 10)) {
        console.log('  ', o.amazon_order_id, (o.purchase_date||'').slice(0,10), o.financial_status, o.order_status);
    }

    // 5. Events with null amazon_order_id that land on these dates
    const { data: nullEvents } = await sb.from('financial_events')
        .select('event_type, amount, posted_date, fee_type, sku')
        .gte('posted_date', '2025-11-21')
        .lte('posted_date', '2025-12-15')
        .is('amazon_order_id', null)
        .limit(20);
    
    console.log('\n=== Events with NULL order_id (Nov21-Dec15) ===');
    console.log('Count:', (nullEvents||[]).length);
    for (const e of (nullEvents||[]).slice(0,10)) {
        console.log('  ', e.event_type, e.fee_type||'', e.sku||'no-sku', (e.posted_date||'').slice(0,10), e.amount);
    }
})();

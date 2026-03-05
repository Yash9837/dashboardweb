const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/admin1/Documents/workingwithamazonAPI/apps/dashboard/.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
    // Check: are there financial_events with order IDs that DON'T exist in the orders table?
    // These would produce revenue records with financial_status defaulting to 'OPEN'

    // 1. Get all unique order IDs from financial_events in Nov-Jan range
    const { data: events } = await sb.from('financial_events')
        .select('amazon_order_id, posted_date')
        .gte('posted_date', '2025-11-21')
        .lte('posted_date', '2026-01-30')
        .not('amazon_order_id', 'is', null);

    const eventOrderIds = [...new Set((events || []).map(e => e.amazon_order_id))];
    console.log('Unique order IDs from events (Nov 21 - Jan 30):', eventOrderIds.length);

    // 2. Check which of these are in the orders table
    const { data: orders } = await sb.from('orders')
        .select('amazon_order_id, financial_status')
        .in('amazon_order_id', eventOrderIds);

    const orderMap = new Map((orders || []).map(o => [o.amazon_order_id, o.financial_status]));

    let missing = 0;
    let notClosed = 0;
    for (const oid of eventOrderIds) {
        const fs = orderMap.get(oid);
        if (!fs) {
            missing++;
            if (missing <= 5) console.log('MISSING from orders table:', oid);
        } else if (fs !== 'FINANCIALLY_CLOSED') {
            notClosed++;
            if (notClosed <= 10) console.log('NOT CLOSED:', oid, 'status=' + fs);
        }
    }
    console.log('\nTotal event order IDs:', eventOrderIds.length);
    console.log('Missing from orders table:', missing);
    console.log('In orders but not FINANCIALLY_CLOSED:', notClosed);

    // 3. Check if there are events with purchase_dates in the blocking range
    // that map to orders NOT in the orders table
    // The revenue engine uses purchase_date from orders table, but for orphan events
    // it might use posted_date as order_date
    console.log('\n=== Checking revenue engine order_date source ===');
    // Get events between Nov 21 - Dec 31 that have order IDs not in orders table
    let orphanCount = 0;
    for (const oid of eventOrderIds) {
        if (!orderMap.has(oid)) {
            orphanCount++;
            if (orphanCount <= 3) {
                const { data: evts } = await sb.from('financial_events')
                    .select('event_type, amount, posted_date, amazon_order_id')
                    .eq('amazon_order_id', oid)
                    .limit(5);
                console.log('Orphan order', oid, 'events:', (evts||[]).map(e => e.event_type + ' ' + (e.posted_date||'').slice(0,10)).join(', '));
            }
        }
    }
    console.log('Total orphan event orders:', orphanCount);
})();

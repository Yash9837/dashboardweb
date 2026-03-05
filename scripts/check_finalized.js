const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/admin1/Documents/workingwithamazonAPI/apps/dashboard/.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

(async () => {
    const { data } = await sb.from('orders')
        .select('amazon_order_id, purchase_date, financial_status, settlement_status')
        .gt('purchase_date', '2025-09-07')
        .not('financial_status', 'eq', 'FINANCIALLY_CLOSED')
        .order('purchase_date', { ascending: true })
        .limit(10);

    console.log('=== Non-closed orders after Sep 7, 2025 ===');
    for (const o of (data || [])) {
        const day = (o.purchase_date || '').slice(0, 10);
        console.log(`${day} ${o.amazon_order_id} status=${o.financial_status || 'OPEN'} settlement=${o.settlement_status || 'N/A'}`);
        const { data: si } = await sb.from('settlement_items')
            .select('settlement_id').eq('amazon_order_id', o.amazon_order_id);
        const sids = [...new Set((si || []).map(s => s.settlement_id))];
        if (sids.length > 0) {
            for (const sid of sids) {
                const { data: grp } = await sb.from('financial_event_groups')
                    .select('processing_status, fund_transfer_status')
                    .eq('event_group_id', sid).single();
                console.log(`  -> proc=${grp?.processing_status} transfer=${grp?.fund_transfer_status}`);
            }
        } else {
            console.log('  -> NO settlement_items');
        }
    }
})();

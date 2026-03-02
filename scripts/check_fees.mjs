const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
(async () => {
    const { data } = await sb.from('financial_events').select('sku, amount, posted_date, amazon_order_id').eq('fee_type', 'MFNPostageFee').order('posted_date', { ascending: false }).limit(20);
    console.log('MFNPostageFee events:');
    for (const e of (data || [])) console.log(e.posted_date?.slice(0, 10), '|', e.sku || 'NULL', '|', e.amount, '|', e.amazon_order_id || 'no-order');
    const withSku = (data || []).filter(e => e.sku);
    const withoutSku = (data || []).filter(e => !e.sku);
    console.log('\nWith SKU:', withSku.length, '| Without SKU:', withoutSku.length);
})();

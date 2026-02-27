import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const metric = searchParams.get('metric') || 'revenue';
        const period = searchParams.get('period') || '30d';
        const customStart = searchParams.get('startDate');
        const customEnd = searchParams.get('endDate');

        let startStr: string;
        let endStr: string | null = null;

        if (customStart) {
            startStr = customStart;
            endStr = customEnd || new Date().toISOString().split('T')[0];
        } else {
            const days = PERIOD_DAYS[period] || 30;
            const d = new Date(); d.setDate(d.getDate() - days);
            startStr = d.toISOString().split('T')[0];
        }

        // Fetch financial events
        let evtQuery = supabase
            .from('financial_events')
            .select('event_type, amount, quantity, fee_type, sku, amazon_order_id, posted_date, delivery_date')
            .gte('posted_date', startStr)
            .order('posted_date', { ascending: false });
        if (endStr) evtQuery = evtQuery.lte('posted_date', endStr + 'T23:59:59');
        const { data: events } = await evtQuery;

        // Fetch SKU master
        const { data: skuMaster } = await supabase.from('skus').select('sku, title, cost_per_unit, packaging_cost, shipping_cost_internal');
        const skuMap = new Map((skuMaster || []).map((s: any) => [s.sku, s]));

        // Fetch inventory health
        const { data: invHealth } = await supabase.from('inventory_health').select('*');
        const invMap = new Map((invHealth || []).map((h: any) => [h.sku, h]));

        // Fetch daily metrics
        let dailyQuery = supabase.from('account_daily_metrics').select('*').gte('date', startStr).order('date', { ascending: true });
        if (endStr) dailyQuery = dailyQuery.lte('date', endStr);
        const { data: dailyMetrics } = await dailyQuery;

        // Fetch sku daily metrics
        let skuDailyQuery = supabase.from('sku_daily_metrics').select('*').gte('date', startStr);
        if (endStr) skuDailyQuery = skuDailyQuery.lte('date', endStr);
        const { data: skuDaily } = await skuDailyQuery;

        // Aggregate by SKU
        const skuAgg: Record<string, any> = {};
        for (const evt of (events || [])) {
            const sku = evt.sku || 'UNKNOWN';
            if (!skuAgg[sku]) {
                const master = skuMap.get(sku);
                skuAgg[sku] = {
                    sku, title: master?.title || sku,
                    revenue: 0, units: 0, fees: 0, refunds: 0, refund_units: 0,
                    cost_per_unit: master?.cost_per_unit || 0,
                    shipping_cost: master?.shipping_cost_internal || 0,
                    packaging_cost: master?.packaging_cost || 0,
                    orders: new Set(),
                };
            }
            const amt = Number(evt.amount);
            const qty = Math.abs(Number(evt.quantity) || 0);
            if (evt.event_type === 'shipment') {
                skuAgg[sku].revenue += amt;
                skuAgg[sku].units += qty;
                if (evt.amazon_order_id) skuAgg[sku].orders.add(evt.amazon_order_id);
            } else if (evt.event_type === 'fee') {
                skuAgg[sku].fees += amt;
            } else if (evt.event_type === 'refund') {
                skuAgg[sku].refunds += amt;
                skuAgg[sku].refund_units += qty;
                if (evt.amazon_order_id) skuAgg[sku].orders.add(evt.amazon_order_id);
            }
        }

        // Compute derived values per SKU
        const skuList = Object.values(skuAgg).map((s: any) => {
            const cogs = s.cost_per_unit * s.units;
            const shipping = (s.shipping_cost + s.packaging_cost) * s.units;
            const net = s.revenue + s.fees + s.refunds - cogs - shipping;
            const margin = s.revenue > 0 ? (net / s.revenue) * 100 : 0;
            const returnRate = s.units > 0 ? (s.refund_units / s.units) * 100 : 0;
            const inv = invMap.get(s.sku);
            return {
                sku: s.sku,
                title: s.title,
                revenue: Math.round(s.revenue * 100) / 100,
                units: s.units,
                fees: Math.round(s.fees * 100) / 100,
                refunds: Math.round(s.refunds * 100) / 100,
                refund_units: s.refund_units,
                cogs: Math.round(cogs * 100) / 100,
                shipping: Math.round(shipping * 100) / 100,
                net: Math.round(net * 100) / 100,
                margin: Math.round(margin * 10) / 10,
                return_rate: Math.round(returnRate * 10) / 10,
                avg_price: s.units > 0 ? Math.round(s.revenue / s.units * 100) / 100 : 0,
                order_count: s.orders.size,
                stock: inv?.available_units || 0,
                days_inv: inv?.days_inventory || 0,
            };
        }).sort((a, b) => b.revenue - a.revenue);

        // Daily trend
        const dailyTrend = (dailyMetrics || []).map((d: any) => ({
            date: d.date,
            revenue: Math.round((d.total_revenue_live || 0) * 100) / 100,
            fees: Math.round(Math.abs(d.total_fees || 0) * 100) / 100,
            refunds: Math.round(Math.abs(d.total_refund_amount || 0) * 100) / 100,
            units: d.total_units_live || 0,
            net: Math.round((d.net_contribution_live || 0) * 100) / 100,
        }));

        // Compute totals
        const totals = {
            revenue: skuList.reduce((s, r) => s + r.revenue, 0),
            units: skuList.reduce((s, r) => s + r.units, 0),
            fees: skuList.reduce((s, r) => s + r.fees, 0),
            refunds: skuList.reduce((s, r) => s + r.refunds, 0),
            refund_units: skuList.reduce((s, r) => s + r.refund_units, 0),
            cogs: skuList.reduce((s, r) => s + r.cogs, 0),
            shipping: skuList.reduce((s, r) => s + r.shipping, 0),
            net: skuList.reduce((s, r) => s + r.net, 0),
            order_count: new Set((events || []).filter(e => e.amazon_order_id).map(e => e.amazon_order_id)).size,
            active_skus: skuList.filter(s => s.stock > 0).length,
            total_stock: skuList.reduce((s, r) => s + r.stock, 0),
        };
        totals.revenue = Math.round(totals.revenue * 100) / 100;
        totals.fees = Math.round(totals.fees * 100) / 100;
        totals.refunds = Math.round(totals.refunds * 100) / 100;
        totals.net = Math.round(totals.net * 100) / 100;

        // Build metric-specific insights
        const insights: { title: string; description: string }[] = [];

        if (metric === 'revenue') {
            const topSku = skuList[0];
            if (topSku) insights.push({ title: 'Top Seller', description: `${topSku.sku} (${topSku.title}) generated ₹${topSku.revenue.toLocaleString('en-IN')} from ${topSku.units} units (${Math.round(topSku.revenue / totals.revenue * 100)}% of total revenue).` });
            const avgPrice = totals.units > 0 ? totals.revenue / totals.units : 0;
            insights.push({ title: 'Average Selling Price', description: `₹${avgPrice.toFixed(2)} per unit across ${totals.units} units sold.` });
            insights.push({ title: 'Revenue Source', description: `Revenue is from ${totals.order_count} unique orders across ${skuList.filter(s => s.revenue > 0).length} SKUs.` });
        } else if (metric === 'net-contribution') {
            insights.push({ title: 'Breakdown', description: `Revenue (₹${totals.revenue.toLocaleString('en-IN')}) − Fees (₹${Math.abs(totals.fees).toLocaleString('en-IN')}) − COGS (₹${totals.cogs.toLocaleString('en-IN')}) − Shipping (₹${totals.shipping.toLocaleString('en-IN')}) − Refunds (₹${Math.abs(totals.refunds).toLocaleString('en-IN')}) = Net ₹${totals.net.toLocaleString('en-IN')}` });
            const marginPct = totals.revenue > 0 ? (totals.net / totals.revenue * 100).toFixed(1) : '0';
            insights.push({ title: 'Overall Margin', description: `${marginPct}% of revenue is retained after all costs.${totals.cogs === 0 ? ' COGS is set to ₹0 — enter actual cost per unit for accurate margins.' : ''}` });
            const worstSku = [...skuList].sort((a, b) => a.net - b.net)[0];
            if (worstSku && worstSku.net < 0) insights.push({ title: 'Biggest Profit Drag', description: `${worstSku.sku} lost ₹${Math.abs(worstSku.net).toLocaleString('en-IN')}.${worstSku.refund_units > 0 ? ` ${worstSku.refund_units} units were refunded.` : ''} Fees were ₹${Math.abs(worstSku.fees).toLocaleString('en-IN')}.` });
        } else if (metric === 'units-sold') {
            insights.push({ title: 'Total Orders', description: `${totals.order_count} unique orders across ${totals.units} units shipped.` });
            const avgUnitsPerOrder = totals.order_count > 0 ? (totals.units / totals.order_count).toFixed(1) : '0';
            insights.push({ title: 'Avg Units/Order', description: `${avgUnitsPerOrder} units per order on average.` });
            const topVolume = [...skuList].sort((a, b) => b.units - a.units)[0];
            if (topVolume) insights.push({ title: 'Highest Volume', description: `${topVolume.sku} sold ${topVolume.units} units (${Math.round(topVolume.units / totals.units * 100)}% of total).` });
        } else if (metric === 'refunds') {
            const returnRate = totals.units > 0 ? (totals.refund_units / totals.units * 100).toFixed(1) : '0';
            insights.push({ title: 'Return Rate', description: `${returnRate}% return rate — ${totals.refund_units} units returned out of ${totals.units} sold.` });
            insights.push({ title: 'Refund Timing', description: 'Amazon posts refunds on the date PROCESSED, not the original sale date. Refunds here may be for orders placed weeks ago.' });
            const worstRefund = [...skuList].sort((a, b) => b.return_rate - a.return_rate).filter(s => s.refund_units > 0)[0];
            if (worstRefund) insights.push({ title: 'Highest Return SKU', description: `${worstRefund.sku} — ${worstRefund.return_rate}% return rate (${worstRefund.refund_units} of ${worstRefund.units} units returned).` });
        } else if (metric === 'contribution-pct') {
            const marginPct = totals.revenue > 0 ? (totals.net / totals.revenue * 100).toFixed(1) : '0';
            insights.push({ title: 'Contribution %', description: `${marginPct}% of every ₹1 revenue is profit after fees, COGS, shipping, and refunds.` });
            insights.push({ title: 'Fee Impact', description: `Amazon fees alone eat ${totals.revenue > 0 ? Math.round(Math.abs(totals.fees) / totals.revenue * 100) : 0}% of revenue.` });
            if (totals.cogs === 0) insights.push({ title: '⚠ COGS not set', description: 'Cost of Goods Sold is ₹0. Contribution % is overstated. Enter actual COGS per SKU for accurate margins.' });
        } else if (metric === 'inventory-value' || metric === 'active-skus') {
            insights.push({ title: 'Active SKUs', description: `${totals.active_skus} SKUs have stock > 0 (total ${totals.total_stock} units).` });
            const atRisk = skuList.filter(s => s.days_inv > 0 && s.days_inv <= 7);
            if (atRisk.length > 0) insights.push({ title: 'At Risk', description: `${atRisk.length} SKU(s) have ≤7 days of stock remaining: ${atRisk.map(s => s.sku).join(', ')}` });
            insights.push({ title: 'FBM Note', description: 'For FBM sellers, stock quantities are estimated from sales velocity (daily sales × 30 days). Enter real stock levels for accurate tracking.' });
        }

        return NextResponse.json({
            metric,
            period: { start: startStr, end: endStr || 'now' },
            totals,
            insights,
            sku_breakdown: skuList,
            daily_trend: dailyTrend,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}

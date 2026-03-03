import { NextResponse } from 'next/server';
import { supabase, fetchAllRows } from '@/lib/supabase';

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
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

        // Fetch ALL financial events in range (paginated past 1k limit)
        const events = await fetchAllRows(
            'financial_events',
            'event_type, amount, quantity, fee_type, sku, amazon_order_id, posted_date, delivery_date',
            q => {
                let fq = q.gte('posted_date', startStr);
                if (endStr) fq = fq.lte('posted_date', endStr + 'T23:59:59');
                return fq;
            },
            'posted_date',
            false,
        );

        // ── Resolve null/UNKNOWN SKUs for fee events using order→SKU lookup ──
        const orderSkuLookup = new Map<string, string>();
        for (const e of (events || [])) {
            if (e.event_type === 'shipment' && e.amazon_order_id && e.sku && e.sku !== 'UNKNOWN') {
                if (!orderSkuLookup.has(e.amazon_order_id)) {
                    orderSkuLookup.set(e.amazon_order_id, e.sku);
                }
            }
        }
        for (const e of (events || [])) {
            if (e.event_type === 'fee' && e.amazon_order_id && (!e.sku || e.sku === 'UNKNOWN')) {
                const resolved = orderSkuLookup.get(e.amazon_order_id);
                if (resolved) e.sku = resolved;
            }
        }

        // Get SKU titles
        const { data: skuMaster } = await supabase.from('skus').select('sku, title');
        const titleMap = new Map((skuMaster || []).map((s: any) => [s.sku, s.title]));

        // ── 1. Summary by category ──
        const categoryTotals: Record<string, { count: number; total: number }> = {};
        for (const e of (events || [])) {
            const cat = e.event_type;
            if (!categoryTotals[cat]) categoryTotals[cat] = { count: 0, total: 0 };
            categoryTotals[cat].count++;
            categoryTotals[cat].total += Number(e.amount);
        }

        // ── 2. Fee breakdown by fee_type ──
        const feeBreakdown: Record<string, { count: number; total: number; description: string }> = {};
        const feeDescriptions: Record<string, string> = {
            'Commission': 'Amazon referral fee (% of item price)',
            'FixedClosingFee': 'Fixed fee per item sold (₹4-30)',
            'MFNPostageFee': 'FBM shipping label cost — Amazon settles these in bulk batches, so a large batch may appear on a single day',
            'FBAPerUnitFulfillmentFee': 'FBA pick, pack, and ship fee per unit',
            'FBAWeightBasedFee': 'FBA weight/size-based handling fee',
            'ShippingChargeback': 'Shipping fee adjustment/chargeback',
            'GiftwrapChargeback': 'Gift wrap fee adjustment',
            'TechnologyFee': 'Amazon 2% technology fee on orders',
            'VariableClosingFee': 'Variable closing fee based on category',
        };
        for (const e of (events || []).filter(e => e.event_type === 'fee')) {
            const t = e.fee_type || 'Other';
            if (!feeBreakdown[t]) feeBreakdown[t] = { count: 0, total: 0, description: feeDescriptions[t] || 'Amazon marketplace fee' };
            feeBreakdown[t].count++;
            feeBreakdown[t].total += Number(e.amount);
        }

        // ── 3. Revenue by SKU ──
        const skuRevenue: Record<string, { sku: string; title: string; revenue: number; units: number; fees: number; refunds: number; net: number }> = {};
        for (const e of (events || [])) {
            const sku = e.sku || 'UNKNOWN';
            if (!skuRevenue[sku]) {
                skuRevenue[sku] = {
                    sku,
                    title: titleMap.get(sku) || sku,
                    revenue: 0, units: 0, fees: 0, refunds: 0, net: 0,
                };
            }
            const amt = Number(e.amount);
            const qty = Number(e.quantity) || 0;
            if (e.event_type === 'shipment') {
                skuRevenue[sku].revenue += amt;
                skuRevenue[sku].units += qty;
            } else if (e.event_type === 'fee') {
                skuRevenue[sku].fees += amt;
            } else if (e.event_type === 'refund') {
                skuRevenue[sku].refunds += amt;
            }
        }
        // Compute net per SKU
        for (const s of Object.values(skuRevenue)) {
            s.net = Math.round((s.revenue + s.fees + s.refunds) * 100) / 100;
            s.revenue = Math.round(s.revenue * 100) / 100;
            s.fees = Math.round(s.fees * 100) / 100;
            s.refunds = Math.round(s.refunds * 100) / 100;
        }

        // ── 4. Daily timeline ──
        const dailyMap: Record<string, { date: string; revenue: number; fees: number; refunds: number; net: number }> = {};
        for (const e of (events || [])) {
            const day = (e.posted_date || '').slice(0, 10);
            if (!dailyMap[day]) dailyMap[day] = { date: day, revenue: 0, fees: 0, refunds: 0, net: 0 };
            const amt = Number(e.amount);
            if (e.event_type === 'shipment') dailyMap[day].revenue += amt;
            else if (e.event_type === 'fee') dailyMap[day].fees += amt;
            else if (e.event_type === 'refund') dailyMap[day].refunds += amt;
        }
        for (const d of Object.values(dailyMap)) {
            d.net = Math.round((d.revenue + d.fees + d.refunds) * 100) / 100;
            d.revenue = Math.round(d.revenue * 100) / 100;
            d.fees = Math.round(d.fees * 100) / 100;
            d.refunds = Math.round(d.refunds * 100) / 100;
        }
        const dailyTimeline = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

        // ── 5. Root Cause Insights ──
        const insights: {
            title: string;
            reason: string;
            details: { label: string; value: string }[];
            severity: 'info' | 'warning' | 'critical';
        }[] = [];

        // ─ Fee spike root cause ─
        for (const d of dailyTimeline) {
            if (d.revenue > 0 && Math.abs(d.fees) > d.revenue * 3) {
                // Find which fee types caused the spike on this day
                const dayFees: Record<string, number> = {};
                for (const e of (events || [])) {
                    if (e.event_type === 'fee' && (e.posted_date || '').slice(0, 10) === d.date) {
                        const ft = e.fee_type || 'Other';
                        dayFees[ft] = (dayFees[ft] || 0) + Math.abs(Number(e.amount));
                    }
                }
                const sortedFees = Object.entries(dayFees).sort((a, b) => b[1] - a[1]);
                const topFee = sortedFees[0];
                const topFeeName = topFee?.[0] || 'Unknown';

                // Build reason based on fee type
                let reason = '';
                if (topFeeName === 'MFNPostageFee') {
                    reason = `Amazon does NOT charge FBM shipping fees per order in real-time. Instead, it accumulates shipping costs (MFNPostageFee) over several days and settles them in a single bulk batch. On ${d.date}, Amazon settled ₹${topFee[1].toLocaleString('en-IN')} worth of accumulated shipping charges at once. This fee total covers shipments from previous days, not just today's ${Math.round(d.revenue)} revenue.`;
                } else if (topFeeName === 'Commission') {
                    reason = `High commission fees on ${d.date} may indicate a batch of high-value items shipped, or Amazon processing delayed commission charges. Commission is typically 5-15% of the item price depending on the category.`;
                } else {
                    reason = `The fee type "${topFeeName}" spiked on ${d.date}. This could be a batch settlement by Amazon where accumulated charges are processed together.`;
                }

                insights.push({
                    title: `Fee Spike on ${d.date}`,
                    reason,
                    details: sortedFees.map(([name, amt]) => ({
                        label: name,
                        value: `₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
                    })),
                    severity: 'warning',
                });
            }
        }

        // ─ High refund rate root cause ─
        const totalRev = categoryTotals['shipment']?.total || 0;
        const totalRefund = Math.abs(categoryTotals['refund']?.total || 0);
        if (totalRev > 0 && totalRefund > totalRev * 0.15) {
            // Find which SKUs are driving the refunds
            const refundedSkus = Object.values(skuRevenue)
                .filter(s => s.refunds !== 0)
                .sort((a, b) => a.refunds - b.refunds)  // most negative first
                .slice(0, 5);

            const reason = `${Math.round(totalRefund / totalRev * 100)}% of revenue (₹${totalRefund.toLocaleString('en-IN')}) was refunded. ` +
                `Amazon posts refund events on the date the refund is PROCESSED, not the original sale date. ` +
                `So refunds appearing in this period may be for orders placed weeks or months ago. ` +
                (refundedSkus.length > 0
                    ? `The top offending SKUs are listed below — check if these products have quality, sizing, or description issues.`
                    : '');

            insights.push({
                title: `High Refund Rate (${Math.round(totalRefund / totalRev * 100)}% of Revenue)`,
                reason,
                details: refundedSkus.map(s => ({
                    label: `${s.sku} — ${s.title}`,
                    value: `₹${Math.abs(s.refunds).toLocaleString('en-IN', { maximumFractionDigits: 2 })} refunded (${s.units > 0 ? Math.round(Math.abs(s.refunds) / s.revenue * 100) + '% of its revenue' : 'no sales in period'})`,
                })),
                severity: totalRefund > totalRev * 0.3 ? 'critical' : 'warning',
            });
        }

        // ─ Batched FBM postage explanation ─
        const mfnPostage = feeBreakdown['MFNPostageFee'];
        if (mfnPostage && categoryTotals['shipment']) {
            const shipCount = categoryTotals['shipment'].count;
            if (mfnPostage.count > shipCount * 1.5) {
                insights.push({
                    title: 'FBM Postage Batch Settlement Detected',
                    reason: `You have ${mfnPostage.count} MFNPostageFee entries but only ${shipCount} shipments in this period. ` +
                        `This happens because Amazon accumulates FBM (Fulfilled by Merchant) shipping charges and settles them periodically in bulk. ` +
                        `The extra ${mfnPostage.count - shipCount} fee entries are likely shipping costs from orders outside this date range that were settled during it. ` +
                        `Total postage fees: ₹${Math.abs(mfnPostage.total).toLocaleString('en-IN')}. ` +
                        `On a 30-day view these batch settlements average out, but on short date ranges they create spikes.`,
                    details: [
                        { label: 'MFN Postage Fee events', value: String(mfnPostage.count) },
                        { label: 'Shipment events', value: String(shipCount) },
                        { label: 'Total postage cost', value: `₹${Math.abs(mfnPostage.total).toLocaleString('en-IN')}` },
                        { label: 'Avg postage per fee entry', value: `₹${Math.round(Math.abs(mfnPostage.total) / mfnPostage.count).toLocaleString('en-IN')}` },
                    ],
                    severity: 'info',
                });
            }
        }

        // Sort SKUs by revenue desc
        const skuList = Object.values(skuRevenue)
            .filter(s => s.revenue > 0 || s.fees !== 0 || s.refunds !== 0)
            .sort((a, b) => b.revenue - a.revenue);

        // Round category totals
        for (const c of Object.values(categoryTotals)) {
            c.total = Math.round(c.total * 100) / 100;
        }
        for (const f of Object.values(feeBreakdown)) {
            f.total = Math.round(f.total * 100) / 100;
        }

        // ── 6. Fee breakdown by Day → SKU ──
        const feeDaySku: Record<string, Record<string, { sku: string; title: string; fees: Record<string, number>; total: number }>> = {};
        for (const e of (events || []).filter(e => e.event_type === 'fee')) {
            const day = (e.posted_date || '').slice(0, 10);
            const sku = e.sku || 'UNKNOWN';
            const ft = e.fee_type || 'Other';
            if (!feeDaySku[day]) feeDaySku[day] = {};
            if (!feeDaySku[day][sku]) feeDaySku[day][sku] = { sku, title: titleMap.get(sku) || sku, fees: {}, total: 0 };
            feeDaySku[day][sku].fees[ft] = (feeDaySku[day][sku].fees[ft] || 0) + Math.abs(Number(e.amount));
            feeDaySku[day][sku].total += Math.abs(Number(e.amount));
        }
        // Convert to sorted array
        const feeDaySkuList = Object.entries(feeDaySku)
            .sort((a, b) => b[0].localeCompare(a[0]))
            .map(([date, skus]) => ({
                date,
                total: Math.round(Object.values(skus).reduce((s, v) => s + v.total, 0) * 100) / 100,
                skus: Object.values(skus)
                    .map(s => ({ ...s, total: Math.round(s.total * 100) / 100, fees: Object.fromEntries(Object.entries(s.fees).map(([k, v]) => [k, Math.round(v * 100) / 100])) }))
                    .sort((a, b) => b.total - a.total),
            }));

        // ── 7. MFNPostageFee per-SKU summary ──
        const mfnBySkuMap: Record<string, { sku: string; title: string; total: number; count: number; revenue: number; units: number }> = {};
        for (const e of (events || [])) {
            const sku = e.sku || 'UNKNOWN';
            if (e.event_type === 'fee' && (e.fee_type === 'MFNPostageFee' || e.fee_type === 'ShippingHB')) {
                if (!mfnBySkuMap[sku]) {
                    mfnBySkuMap[sku] = { sku, title: titleMap.get(sku) || sku, total: 0, count: 0, revenue: 0, units: 0 };
                }
                mfnBySkuMap[sku].total += Math.abs(Number(e.amount));
                mfnBySkuMap[sku].count++;
            }
            // Also accumulate revenue & units for context
            if (e.event_type === 'shipment') {
                if (!mfnBySkuMap[sku]) {
                    mfnBySkuMap[sku] = { sku, title: titleMap.get(sku) || sku, total: 0, count: 0, revenue: 0, units: 0 };
                }
                mfnBySkuMap[sku].revenue += Number(e.amount);
                mfnBySkuMap[sku].units += Number(e.quantity) || 0;
            }
        }
        const mfnPostageBySku = Object.values(mfnBySkuMap)
            .filter(s => s.total > 0)
            .map(s => ({
                sku: s.sku,
                title: s.title,
                postage_total: Math.round(s.total * 100) / 100,
                event_count: s.count,
                avg_per_event: s.count > 0 ? Math.round(s.total / s.count * 100) / 100 : 0,
                postage_per_unit: s.units > 0 ? Math.round(s.total / s.units * 100) / 100 : 0,
                revenue: Math.round(s.revenue * 100) / 100,
                units: s.units,
                pct_of_revenue: s.revenue > 0 ? Math.round(s.total / s.revenue * 10000) / 100 : 0,
            }))
            .sort((a, b) => b.postage_total - a.postage_total);

        return NextResponse.json({
            period: { start: startStr, end: endStr || 'now' },
            summary: categoryTotals,
            fee_breakdown: feeBreakdown,
            sku_breakdown: skuList,
            daily_timeline: dailyTimeline,
            insights,
            fee_by_day_sku: feeDaySkuList,
            mfn_postage_by_sku: mfnPostageBySku,
            total_events: (events || []).length,
        });
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
